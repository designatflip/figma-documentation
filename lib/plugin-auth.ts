/**
 * Authentication for callers that cannot present a Clerk session.
 *
 * Two kinds reach `/api/sync`:
 *
 * - **cron**, holding `CRON_SECRET`. Unchanged from before the plugin existed.
 * - **plugin**, holding a token minted for one person by `/plugin/pair`. A Figma
 *   plugin bundle is readable by anyone who can run it, so it never carries a
 *   shared secret; each designer pairs once and gets their own revocable token.
 *
 * The access boundary stays `lib/auth.ts`. This module only decides *who is
 * calling* — `isAllowedEmail` still decides whether they may.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { pluginTokens } from "@/db/schema";
import { isAllowedEmail } from "@/lib/auth";
import { cronSecret } from "@/lib/env";
import { sha256 } from "@/lib/figma/extract";

/** How long a designer has to finish pairing in the browser. */
const PICKUP_TTL_MS = 5 * 60 * 1000;

/** 32 bytes for both the plugin's nonce and the token it collects. */
const SECRET_BYTES = 32;

export type SyncCaller =
  | { kind: "cron" }
  | { kind: "plugin"; tokenId: string; clerkUserId: string; email: string };

const hash = (value: string) => sha256(Buffer.from(value, "utf8"));

/**
 * Hash both sides before comparing. `timingSafeEqual` throws on a length
 * mismatch, which would otherwise leak the secret's length to a prober.
 */
function secretMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(hash(candidate), "hex"),
    Buffer.from(hash(expected), "hex"),
  );
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const value = header.slice("Bearer ".length).trim();
  return value.length > 0 ? value : null;
}

export async function authenticateSyncRequest(
  request: Request,
): Promise<SyncCaller | null> {
  const token = bearer(request);
  if (!token) return null;

  if (secretMatches(token, cronSecret())) return { kind: "cron" };

  const [row] = await db
    .select()
    .from(pluginTokens)
    .where(and(eq(pluginTokens.tokenHash, hash(token)), isNull(pluginTokens.revokedAt)))
    .limit(1);

  if (!row) return null;

  // Re-checked on every call rather than trusted from pairing time, so losing
  // the email domain revokes plugin access without anyone touching this table.
  if (!isAllowedEmail(row.email)) {
    console.warn(
      `[plugin-auth] token ${row.id} belongs to ${row.email}, no longer in the ` +
        "allowed domain. Denying.",
    );
    return null;
  }

  await db
    .update(pluginTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(pluginTokens.id, row.id));

  return {
    kind: "plugin",
    tokenId: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
  };
}

/** Shape check for a plugin-supplied nonce, before it reaches a query. */
export function isValidPairingState(state: unknown): state is string {
  return typeof state === "string" && /^[a-f0-9]{64}$/.test(state);
}

/**
 * Called from the pairing Server Action, once the session has been checked.
 * The token is stored hashed *and* in the clear; `claimPairing` removes the
 * clear copy, and nothing can recover it afterwards.
 */
export async function createPairing(input: {
  pairingState: string;
  clerkUserId: string;
  email: string;
}): Promise<void> {
  const token = randomBytes(SECRET_BYTES).toString("base64url");

  // A retried pairing reuses the nonce, and the unique index would reject the
  // insert. Dropping the earlier attempt is right: only one can be collected.
  await db
    .delete(pluginTokens)
    .where(eq(pluginTokens.pairingState, input.pairingState));

  await db.insert(pluginTokens).values({
    tokenHash: hash(token),
    pairingState: input.pairingState,
    pickupToken: token,
    pickupExpiresAt: new Date(Date.now() + PICKUP_TTL_MS),
    clerkUserId: input.clerkUserId,
    email: input.email,
  });
}

/**
 * Hand the token to the plugin instance that started the pairing, exactly once.
 *
 * A single statement so two concurrent claims cannot both succeed: the second
 * blocks on the row lock, then re-tests `pickup_token IS NOT NULL` against the
 * committed row and matches nothing. `RETURNING` reads the CTE's copy, which
 * still holds the pre-update value.
 */
export async function claimPairing(pairingState: string): Promise<string | null> {
  const rows = await db.execute<{ token: string }>(sql`
    WITH candidate AS (
      SELECT id, pickup_token
      FROM plugin_tokens
      WHERE pairing_state = ${pairingState}
        AND pickup_token IS NOT NULL
        AND pickup_expires_at > now()
    )
    UPDATE plugin_tokens AS t
    SET pickup_token = NULL, pairing_state = NULL, paired_at = now()
    FROM candidate AS c
    WHERE t.id = c.id AND t.pickup_token IS NOT NULL
    RETURNING c.pickup_token AS token
  `);

  return rows[0]?.token ?? null;
}

export async function listPluginTokens() {
  return db
    .select({
      id: pluginTokens.id,
      email: pluginTokens.email,
      createdAt: pluginTokens.createdAt,
      pairedAt: pluginTokens.pairedAt,
      lastUsedAt: pluginTokens.lastUsedAt,
      revokedAt: pluginTokens.revokedAt,
    })
    .from(pluginTokens)
    .orderBy(desc(pluginTokens.createdAt));
}

export async function revokePluginToken(id: string): Promise<void> {
  await db
    .update(pluginTokens)
    .set({ revokedAt: new Date(), pickupToken: null, pairingState: null })
    .where(and(eq(pluginTokens.id, id), isNull(pluginTokens.revokedAt)));
}
