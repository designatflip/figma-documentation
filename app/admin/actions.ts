"use server";

import { updateTag } from "next/cache";
import { auth } from "@clerk/nextjs/server";

import { checkSessionAccess, logMissingClaim } from "@/lib/auth";
import { syncProject } from "@/lib/figma/sync";

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
    const summary = await syncProject({
      onLog: (message) => console.log(`[sync] ${message}`),
    });

    // Read-your-own-writes: someone just clicked "Sync now" and is watching.
    // `updateTag` expires immediately so the next render blocks on fresh data,
    // where revalidateTag(_, "max") would only mark it stale. Server-Action-only,
    // which is why the cron Route Handler cannot use it.
    updateTag("catalog");

    const parts = [
      `${summary.flowsSynced} flow(s) synced`,
      `${summary.flowsSkipped} unchanged`,
      `${summary.screensRendered} screen(s)`,
      `${summary.blobWrites} image write(s)`,
      `${summary.driftFlagged} drift flag(s)`,
      `${summary.requestCount} Figma request(s)`,
    ];

    if (summary.errors.length > 0) {
      return {
        ok: false,
        message: `${parts.join(" · ")}. Errors: ${summary.errors.join("; ")}`,
      };
    }

    return { ok: true, message: parts.join(" · ") };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
