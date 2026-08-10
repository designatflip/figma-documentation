import { NextResponse } from "next/server";

import { captureClip, getCaptureStatus } from "@/lib/clips";
import { corsHeaders, preflight } from "@/lib/cors";
import { parseClipboardHtml } from "@/lib/figma/clipboard";
import { authenticateSyncRequest } from "@/lib/plugin-auth";

/**
 * Clipboard capture, called by the Figma plugin.
 *
 * The body is the raw `text/html` off the designer's clipboard — no JSON
 * wrapper, because the payload runs to hundreds of kilobytes and re-encoding
 * it would only add a way for the bytes to change in transit. Which screen it
 * belongs to is read out of the payload itself, not from the request.
 */
export const maxDuration = 60;

/** The plugin's UI iframe is a cross-origin caller. */
export async function OPTIONS() {
  return preflight();
}

/**
 * The capture worklist for one file: every published screen, and whether it
 * still needs capturing. Called by the plugin, so it authenticates the same
 * way `POST` does rather than through a session.
 */
export async function GET(request: Request) {
  const caller = await authenticateSyncRequest(request);
  if (!caller || caller.kind !== "plugin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  const fileKey = new URL(request.url).searchParams.get("fileKey");
  if (!fileKey) {
    return NextResponse.json(
      { ok: false, error: "fileKey is required" },
      { status: 400, headers: corsHeaders },
    );
  }

  const status = await getCaptureStatus(fileKey);
  if (!status) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This file has no published screens. Publish it first, then capture.",
      },
      { status: 404, headers: corsHeaders },
    );
  }

  return NextResponse.json({ ok: true, ...status }, { headers: corsHeaders });
}

export async function POST(request: Request) {
  const caller = await authenticateSyncRequest(request);

  // Cron holds a valid token but has no clipboard and no business writing one.
  if (!caller || caller.kind !== "plugin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  const html = await request.text();
  const parsed = parseClipboardHtml(html);

  if (!parsed.ok) {
    // 422, not 500: the payload arrived intact and was understood well enough
    // to reject. The plugin shows `error` verbatim, so it is written for the
    // designer reading it.
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: 422, headers: corsHeaders },
    );
  }

  try {
    const result = await captureClip({
      html,
      header: parsed.header,
      email: caller.email,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason },
        { status: 409, headers: corsHeaders },
      );
    }

    console.log(
      `[clips] ${caller.email} captured "${result.screenName}" ` +
        `(${Math.round(result.byteSize / 1024)} KB)`,
    );

    // No `revalidateTag` here: clip status is read uncached (see
    // `getClipStatus`), precisely so a capture session does not expire the
    // whole catalogue once per screen.
    return NextResponse.json(
      {
        ok: true,
        message: `Captured "${result.screenName}" · ${Math.round(result.byteSize / 1024)} KB`,
        screenId: result.screenId,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[clips] capture failed", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: corsHeaders },
    );
  }
}
