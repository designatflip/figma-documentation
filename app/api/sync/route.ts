import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { corsHeaders, preflight } from "@/lib/cors";
import {
  PublishError,
  formatPageSyncSummary,
  formatScreenSyncSummary,
  formatSyncSummary,
  syncPage,
  syncProject,
  syncScreen,
} from "@/lib/figma/sync";
import { authenticateSyncRequest } from "@/lib/plugin-auth";
import { SyncBusyError, withSyncLock } from "@/lib/sync-lock";

/**
 * A full sync walks every changed file, page by page, serially against a
 * 10–20 req/min ceiling, so it needs the long end of the function timeout.
 * A page publish is three requests and never comes close.
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

  // The plugin sends `figma.fileKey` and the id of the page being looked at, so
  // a designer publishes one flow — seconds against the rate limit instead of
  // minutes — plus a `nodeId` when they are publishing one selected frame.
  // Cron sends nothing and syncs everything.
  const { fileKey, pageId, nodeId } = await readBody(request);

  const startedBy = caller.kind === "cron" ? "cron" : caller.email;
  if (caller.kind === "plugin") {
    const scope = nodeId
      ? ` for node ${nodeId} in file ${fileKey}`
      : pageId
        ? ` for page ${pageId} in file ${fileKey}`
        : fileKey
          ? ` for file ${fileKey}`
          : "";
    console.log(`[sync] triggered by ${caller.email}${scope}`);
  }

  if ((nodeId || pageId) && !fileKey) {
    return NextResponse.json(
      { ok: false, error: "A scoped publish needs the file it belongs to." },
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
    const onLog = (message: string) => {
      logs.push(message);
      console.log(`[sync] ${message}`);
    };

    // One selected frame. It takes the same lease as a full run: both write the
    // same rows, and a scoped publish landing halfway through a nightly sync is
    // exactly the race the lock exists to prevent.
    if (nodeId && fileKey) {
      const summary = await withSyncLock(startedBy, () =>
        syncScreen({
          fileKey,
          nodeId,
          pageId: pageId ?? undefined,
          onLog,
        }),
      );

      expireCatalog();

      return NextResponse.json(
        { ok: true, message: formatScreenSyncSummary(summary), ...summary, logs },
        { headers: corsHeaders },
      );
    }

    // One page — the plugin's ordinary publish, and the only one a designer
    // presses by hand.
    if (pageId && fileKey) {
      const summary = await withSyncLock(startedBy, () =>
        syncPage({ fileKey, pageId, onLog }),
      );

      expireCatalog();

      return NextResponse.json(
        { ok: true, message: formatPageSyncSummary(summary), ...summary, logs },
        { headers: corsHeaders },
      );
    }

    const summary = await withSyncLock(startedBy, () =>
      syncProject({
        force: url.searchParams.get("force") === "1",
        allowMassArchive: url.searchParams.get("allowMassArchive") === "1",
        skipDrift: url.searchParams.get("skipDrift") === "1",
        onlyFileKey: fileKey ?? undefined,
        onLog,
      }),
    );

    // A file key that matches nothing leaves every counter at zero and reports
    // success, which reads as "published!" in the plugin. Say what happened.
    if (fileKey && summary.streamsChecked === 0) {
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
    if (error instanceof PublishError) {
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
  pageId: string | null;
  nodeId: string | null;
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
      pageId: readString(body?.pageId),
      nodeId: readString(body?.nodeId),
    };
  } catch {
    return { fileKey: null, pageId: null, nodeId: null };
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
