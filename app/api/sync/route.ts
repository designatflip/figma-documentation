import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { corsHeaders, preflight } from "@/lib/cors";
import {
  ScreenPublishError,
  formatScreenSyncSummary,
  formatSyncSummary,
  syncProject,
  syncScreen,
} from "@/lib/figma/sync";
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
  // are looking at — seconds against the rate limit instead of minutes — and a
  // `nodeId` as well when they are publishing one selected frame. Cron sends
  // nothing and syncs everything.
  const { fileKey, nodeId, section } = await readBody(request);

  const startedBy = caller.kind === "cron" ? "cron" : caller.email;
  if (caller.kind === "plugin") {
    const scope = nodeId
      ? ` for node ${nodeId} in file ${fileKey}`
      : fileKey
        ? ` for file ${fileKey}`
        : "";
    console.log(`[sync] triggered by ${caller.email}${scope}`);
  }

  if (nodeId && !fileKey) {
    return NextResponse.json(
      { ok: false, error: "A screen publish needs the file it belongs to." },
      { status: 400, headers: corsHeaders },
    );
  }

  // Every cached read is tagged 'catalog'. `updateTag` is Server-Action-only,
  // so a Route Handler uses revalidateTag; "max" gives stale-while-revalidate,
  // which is right for a nightly job — nobody is waiting on this response.
  //
  // A designer who just pressed Publish *is* waiting, and is about to reload
  // the site to check. `{ expire: 0 }` is what the docs prescribe for an
  // external caller that needs data expired immediately.
  const expireCatalog = () =>
    revalidateTag("catalog", caller.kind === "plugin" ? { expire: 0 } : "max");

  try {
    // One selected frame. It takes the same lease as a full run: both write the
    // same rows, and a scoped publish landing halfway through a nightly sync is
    // exactly the race the lock exists to prevent.
    if (nodeId && fileKey) {
      const summary = await withSyncLock(startedBy, () =>
        syncScreen({
          fileKey,
          nodeId,
          section: section ?? undefined,
          onLog: (message) => {
            logs.push(message);
            console.log(`[sync] ${message}`);
          },
        }),
      );

      expireCatalog();

      return NextResponse.json(
        { ok: true, message: formatScreenSyncSummary(summary), ...summary, logs },
        { headers: corsHeaders },
      );
    }

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

    expireCatalog();

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

    // A refusal, not a breakage: the message names what the designer should do
    // instead, so it goes back verbatim rather than as a 500.
    if (error instanceof ScreenPublishError) {
      return NextResponse.json(
        { ok: false, error: error.message, logs },
        { status: error.status, headers: corsHeaders },
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

interface SyncRequestBody {
  fileKey: string | null;
  nodeId: string | null;
  section: string | null;
}

/**
 * Every field is optional, and cron sends no body at all — so an absent or
 * unparseable body is not an error here.
 */
async function readBody(request: Request): Promise<SyncRequestBody> {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    return {
      fileKey: readString(body?.fileKey),
      nodeId: readString(body?.nodeId),
      section: readString(body?.section),
    };
  } catch {
    return { fileKey: null, nodeId: null, section: null };
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
