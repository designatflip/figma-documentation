"use server";

import { updateTag } from "next/cache";
import { auth } from "@clerk/nextjs/server";

import { checkSessionAccess, logMissingClaim, sessionEmail } from "@/lib/auth";
import { formatSyncSummary, syncProject } from "@/lib/figma/sync";
import { revokePluginToken } from "@/lib/plugin-auth";
import { SyncBusyError, withSyncLock } from "@/lib/sync-lock";

export interface SyncActionResult {
  ok: boolean;
  message: string;
}

/**
 * Manual "Sync now". Runs the exact same `syncProject` the cron route calls —
 * there is deliberately no second code path that could drift from it.
 */
export async function runSyncAction(): Promise<SyncActionResult> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
  }

  // Re-checked here rather than trusted from `proxy.ts`. A Server Action is a
  // POST to an arbitrary endpoint, and this one spends Figma quota and rewrites
  // the catalogue — too much to hang on an optimistic proxy check.
  const access = checkSessionAccess(sessionClaims);
  if (access === "missing-claim") logMissingClaim("runSyncAction");
  if (access !== "allowed") {
    return { ok: false, message: "Not authorised." };
  }

  try {
    const summary = await withSyncLock(sessionEmail(sessionClaims) ?? userId, () =>
      syncProject({
        onLog: (message) => console.log(`[sync] ${message}`),
      }),
    );

    // Read-your-own-writes: someone just clicked "Sync now" and is watching.
    // `updateTag` expires immediately so the next render blocks on fresh data,
    // where revalidateTag(_, "max") would only mark it stale. Server-Action-only,
    // which is why the cron Route Handler cannot use it.
    updateTag("catalog");

    const message = formatSyncSummary(summary);

    if (summary.errors.length > 0) {
      return {
        ok: false,
        message: `${message}. Errors: ${summary.errors.join("; ")}`,
      };
    }

    return { ok: true, message };
  } catch (error) {
    if (error instanceof SyncBusyError) {
      return { ok: false, message: error.message };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Revoke one paired Figma plugin. Any admin may revoke anyone's token — the
 * page is already limited to the allowed domain, and a stuck token that only
 * its owner can clear is worse than a shared kill switch.
 */
export async function revokePluginTokenAction(
  id: string,
): Promise<SyncActionResult> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
  }

  const access = checkSessionAccess(sessionClaims);
  if (access === "missing-claim") logMissingClaim("revokePluginTokenAction");
  if (access !== "allowed") {
    return { ok: false, message: "Not authorised." };
  }

  await revokePluginToken(id);

  return { ok: true, message: "Revoked." };
}
