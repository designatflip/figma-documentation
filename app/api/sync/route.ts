import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { corsHeaders, preflight } from "@/lib/cors";
import { formatSyncSummary, syncProject } from "@/lib/figma/sync";
import { authenticateSyncRequest } from "@/lib/plugin-auth";
import { SyncBusyError, withSyncLock } from "@/lib/sync-lock";

/**
 * A full sync walks every changed flow file serially against a 10–20 req/min
 * ceiling, so it needs the long end of the function timeout.
 */
export const maxDuration = 300;

/** The Figma plugin's UI iframe is a cross-origin caller. */
export async function OPTIONS() {
  return preflight();
}

export async function POST(request: Request) {
  const caller = await authenticateSyncRequest(request);
  if (!caller) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  const url = new URL(request.url);
  const logs: string[] = [];

  // The plugin sends `figma.fileKey` so a designer publishes only the file they
  // are looking at — seconds against the rate limit instead of minutes. Cron
  // sends nothing and syncs everything.
  const fileKey = await readFileKey(request);

  const startedBy = caller.kind === "cron" ? "cron" : caller.email;
  if (caller.kind === "plugin") {
    console.log(`[sync] triggered by ${caller.email}${fileKey ? ` for file ${fileKey}` : ""}`);
  }

  try {
    const summary = await withSyncLock(startedBy, () =>
      syncProject({
        force: url.searchParams.get("force") === "1",
        allowMassArchive: url.searchParams.get("allowMassArchive") === "1",
        skipDrift: url.searchParams.get("skipDrift") === "1",
        onlyFileKey: fileKey ?? undefined,
        onLog: (message) => {
          logs.push(message);
          console.log(`[sync] ${message}`);
        },
      }),
    );

    // A file key that matches nothing leaves every counter at zero and reports
    // success, which reads as "published!" in the plugin. Say what happened.
    if (fileKey && summary.flowsChecked === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This file isn't in the documentation project — or its name matches " +
            "the ignore pattern — so there is nothing to publish.",
          ...summary,
          preview: undefined,
          logs,
        },
        { status: 404, headers: corsHeaders },
      );
    }

    // Every cached read is tagged 'catalog'. `updateTag` is Server-Action-only,
    // so a Route Handler uses revalidateTag; "max" gives stale-while-revalidate,
    // which is right for a nightly job — nobody is waiting on this response.
    //
    // A designer who just pressed Publish *is* waiting, and is about to reload
    // the site to check. `{ expire: 0 }` is what the docs prescribe for an
    // external caller that needs data expired immediately.
    revalidateTag("catalog", caller.kind === "plugin" ? { expire: 0 } : "max");

    return NextResponse.json(
      {
        ok: summary.errors.length === 0,
        message: formatSyncSummary(summary),
        ...summary,
        preview: undefined,
        logs,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof SyncBusyError) {
      return NextResponse.json(
        { ok: false, error: error.message, logs },
        { status: 409, headers: corsHeaders },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync] fatal", error);
    return NextResponse.json(
      { ok: false, error: message, logs },
      { status: 500, headers: corsHeaders },
    );
  }
}

/**
 * Optional, and cron sends no body at all — so an absent or unparseable body is
 * not an error here.
 */
async function readFileKey(request: Request): Promise<string | null> {
  try {
    const body = await request.json();
    const fileKey = (body as { fileKey?: unknown } | null)?.fileKey;
    return typeof fileKey === "string" && fileKey.length > 0 ? fileKey : null;
  } catch {
    return null;
  }
}
