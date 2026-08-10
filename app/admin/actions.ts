"use server";

import { updateTag } from "next/cache";
import { auth } from "@clerk/nextjs/server";

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
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
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
