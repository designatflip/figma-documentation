/**
 * Mutual exclusion for sync runs.
 *
 * Every caller — cron, the admin action, the Figma plugin — goes through
 * `withSyncLock`, so there is one rule about concurrency rather than three.
 * Without it, two designers pressing Publish at the same moment would both
 * spend Figma quota against a 10 req/min ceiling and race on the same rows.
 *
 * See `syncLocks` in `db/schema.ts` for why this is a lease rather than
 * `pg_advisory_lock`.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { syncLocks } from "@/db/schema";

const LOCK_ID = "sync";

/**
 * Long enough that a slow full-project run never loses its lease between
 * renewals, short enough that a crashed run does not block the next one for
 * long. The holder renews every `RENEW_EVERY_MS`, so this is really "how long
 * after a hard crash until the lease is up for grabs".
 */
const LEASE_MS = 5 * 60 * 1000;
const RENEW_EVERY_MS = 60 * 1000;

export class SyncBusyError extends Error {
  constructor(readonly startedBy: string, readonly startedAt: Date) {
    super(
      `A sync started by ${startedBy} at ${startedAt.toISOString()} is still running.`,
    );
    this.name = "SyncBusyError";
  }
}

interface Lease {
  token: string;
}

/**
 * Take the lease, or find out who holds it.
 *
 * One statement, so two simultaneous callers cannot both win: the `WHERE` on
 * the conflict path only fires for an expired lease, and the second writer
 * re-evaluates it after blocking on the row lock.
 */
async function acquire(startedBy: string): Promise<Lease | null> {
  const token = randomUUID();

  const rows = await db.execute<{ token: string }>(sql`
    INSERT INTO sync_locks (id, token, started_by, started_at, expires_at)
    VALUES (
      ${LOCK_ID}, ${token}, ${startedBy}, now(), now() + ${`${LEASE_MS} milliseconds`}::interval
    )
    ON CONFLICT (id) DO UPDATE
      SET token = ${token},
          started_by = ${startedBy},
          started_at = now(),
          expires_at = now() + ${`${LEASE_MS} milliseconds`}::interval
      WHERE sync_locks.expires_at < now()
    RETURNING token
  `);

  return rows[0] ? { token: rows[0].token } : null;
}

async function renew(token: string): Promise<void> {
  await db
    .update(syncLocks)
    .set({ expiresAt: new Date(Date.now() + LEASE_MS) })
    .where(and(eq(syncLocks.id, LOCK_ID), eq(syncLocks.token, token)));
}

/** Expire the lease immediately, but only if we still hold it. */
async function release(token: string): Promise<void> {
  await db
    .update(syncLocks)
    .set({ expiresAt: new Date(0) })
    .where(and(eq(syncLocks.id, LOCK_ID), eq(syncLocks.token, token)));
}

async function holder(): Promise<{ startedBy: string; startedAt: Date } | null> {
  const [row] = await db.select().from(syncLocks).where(eq(syncLocks.id, LOCK_ID));
  if (!row || row.expiresAt <= new Date()) return null;
  return { startedBy: row.startedBy, startedAt: row.startedAt };
}

/**
 * Run `fn` with the sync lease held, renewing it until `fn` settles.
 *
 * Throws `SyncBusyError` when someone else holds it — callers turn that into a
 * 409 or a friendly message rather than silently queueing.
 */
export async function withSyncLock<T>(
  startedBy: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lease = await acquire(startedBy);
  if (!lease) {
    const current = await holder();
    throw new SyncBusyError(
      current?.startedBy ?? "another run",
      current?.startedAt ?? new Date(),
    );
  }

  const heartbeat = setInterval(() => {
    void renew(lease.token).catch((error) => {
      // Losing a renewal is not fatal on its own — the lease may still outlive
      // the run — but it is the only warning before a takeover.
      console.error("[sync-lock] failed to renew lease", error);
    });
  }, RENEW_EVERY_MS);
  // Never keep the sync CLI alive on the timer alone.
  heartbeat.unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await release(lease.token).catch((error) => {
      // The lease expires on its own, so the next run is delayed, not blocked.
      console.error("[sync-lock] failed to release lease", error);
    });
  }
}
