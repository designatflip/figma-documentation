/**
 * Capture and retrieval of Figma clipboard payloads.
 *
 * The payload is stored verbatim. It is Figma's own serialisation of a frame
 * (see `lib/figma/clipboard.ts`), and the one thing that makes replaying it
 * safe is that we never rewrite it — the site hands back exactly the bytes
 * Figma produced.
 */
import { del, put } from "@vercel/blob";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { flows, screenClips, screens, streams } from "@/db/schema";
import { blobToken } from "@/lib/env";
import { sha256 } from "@/lib/figma/extract";
import type { ClipboardHeader } from "@/lib/figma/clipboard";

export type CaptureResult =
  | { ok: true; screenId: string; screenName: string; byteSize: number }
  | { ok: false; reason: string };

/**
 * Resolve the screen a payload belongs to, then store it.
 *
 * The screen is looked up from the payload's own header rather than from
 * anything the caller asserts, so a clip cannot be filed against a screen it
 * did not come from.
 */
export async function captureClip(input: {
  html: string;
  header: ClipboardHeader;
  email: string;
}): Promise<CaptureResult> {
  const { html, header, email } = input;

  const [target] = await db
    .select({
      id: screens.id,
      name: screens.name,
      imageHash: screens.imageHash,
      archivedAt: screens.archivedAt,
    })
    .from(screens)
    .innerJoin(flows, eq(flows.id, screens.flowId))
    .innerJoin(streams, eq(streams.id, flows.streamId))
    .where(
      and(
        eq(streams.fileKey, header.fileKey),
        eq(screens.nodeId, header.nodeId),
      ),
    )
    .limit(1);

  if (!target) {
    return {
      ok: false,
      reason:
        "That frame isn't a published screen yet. Publish its page first, " +
        "then capture it.",
    };
  }

  if (target.archivedAt) {
    return {
      ok: false,
      reason: `"${target.name}" is no longer published, so a clip would never be shown.`,
    };
  }

  const bytes = Buffer.from(html, "utf8");
  const hash = sha256(bytes);

  const [prior] = await db
    .select()
    .from(screenClips)
    .where(eq(screenClips.screenId, target.id))
    .limit(1);

  let blobUrl = prior?.blobUrl ?? null;

  // Re-capturing an unchanged frame is a no-op on storage. Designers will do
  // this — it is the obvious way to check whether a clip is current.
  if (!blobUrl || prior?.contentHash !== hash) {
    const pathname = `clips/${header.fileKey}/${header.nodeId.replaceAll(":", "-")}-${hash.slice(0, 8)}.html`;
    const blob = await put(pathname, bytes, {
      access: "public",
      token: blobToken(),
      contentType: "text/html",
      addRandomSuffix: false,
      // Content-addressed, so an overwrite can only ever write identical
      // bytes — which keeps re-capture idempotent after a database reset.
      allowOverwrite: true,
    });

    if (prior?.blobUrl && prior.blobUrl !== blob.url) {
      await del(prior.blobUrl, { token: blobToken() }).catch(() => {});
    }
    blobUrl = blob.url;
  }

  const values = {
    screenId: target.id,
    blobUrl,
    contentHash: hash,
    byteSize: bytes.byteLength,
    capturedImageHash: target.imageHash,
    capturedByEmail: email,
    capturedAt: new Date(),
  };

  await db
    .insert(screenClips)
    .values(values)
    .onConflictDoUpdate({ target: screenClips.screenId, set: values });

  return {
    ok: true,
    screenId: target.id,
    screenName: target.name,
    byteSize: bytes.byteLength,
  };
}

export interface ClipStatus {
  capturedAt: Date;
  byteSize: number;
  /**
   * The frame has been re-rendered since capture, so the payload no longer
   * matches the screenshot above it. Still offered — a slightly old set of
   * real layers beats no layers — but never silently.
   */
  stale: boolean;
}

/** What the detail page needs to decide whether to offer the button. */
export async function getClipStatus(
  screenId: string,
): Promise<ClipStatus | null> {
  const [row] = await db
    .select({
      capturedAt: screenClips.capturedAt,
      byteSize: screenClips.byteSize,
      capturedImageHash: screenClips.capturedImageHash,
      imageHash: screens.imageHash,
    })
    .from(screenClips)
    .innerJoin(screens, eq(screens.id, screenClips.screenId))
    .where(eq(screenClips.screenId, screenId))
    .limit(1);

  if (!row) return null;

  return {
    capturedAt: row.capturedAt,
    byteSize: row.byteSize,
    stale: row.capturedImageHash !== row.imageHash,
  };
}

/**
 * The same, for every screen in one flow at once, keyed by screen id.
 *
 * One query rather than one per screen: the lightbox lays a whole flow out and
 * offers the same actions on each frame in it, and a flow runs to dozens — that
 * is dozens of round trips on every open, for a decision each. A screen that
 * has never been captured is simply absent, which is exactly the case where
 * there is no button to offer.
 */
export async function getFlowClipStatuses(
  flowId: string,
): Promise<Map<string, ClipStatus>> {
  const rows = await db
    .select({
      screenId: screenClips.screenId,
      capturedAt: screenClips.capturedAt,
      byteSize: screenClips.byteSize,
      capturedImageHash: screenClips.capturedImageHash,
      imageHash: screens.imageHash,
    })
    .from(screenClips)
    .innerJoin(screens, eq(screens.id, screenClips.screenId))
    .where(and(eq(screens.flowId, flowId), isNull(screens.archivedAt)));

  return new Map(
    rows.map((row) => [
      row.screenId,
      {
        capturedAt: row.capturedAt,
        byteSize: row.byteSize,
        stale: row.capturedImageHash !== row.imageHash,
      },
    ]),
  );
}

/**
 * `missing` — never captured, so the screen has no Copy button at all.
 * `stale`   — captured, but the frame has been re-rendered since.
 * `captured`— current.
 */
export type CaptureState = "missing" | "stale" | "captured";

export interface CaptureStatusItem {
  nodeId: string;
  name: string;
  /** The page it sits on, so the list reads as the file's own structure. */
  flowName: string;
  state: CaptureState;
}

export interface CaptureStatus {
  streamName: string;
  items: CaptureStatusItem[];
}

/**
 * Every published screen in one file, with what capture still owes it.
 *
 * Drives the plugin's worklist. Capture is manual and irreducibly so — Figma
 * only surrenders a copyable payload on a real ⌘C — so the least this can do
 * is make sure nobody has to remember where they got to.
 *
 * Deliberately the whole file rather than the open page, unlike publishing:
 * clicking a row jumps the viewport to that frame wherever it lives, so a
 * file-wide list is a worklist a designer can actually work down.
 */
export async function getCaptureStatus(
  fileKey: string,
): Promise<CaptureStatus | null> {
  const rows = await db
    .select({
      streamName: streams.name,
      flowName: flows.name,
      nodeId: screens.nodeId,
      name: screens.name,
      imageHash: screens.imageHash,
      capturedImageHash: screenClips.capturedImageHash,
      hasClip: sql<boolean>`${screenClips.screenId} IS NOT NULL`,
    })
    .from(screens)
    .innerJoin(flows, eq(flows.id, screens.flowId))
    .innerJoin(streams, eq(streams.id, flows.streamId))
    .leftJoin(screenClips, eq(screenClips.screenId, screens.id))
    .where(
      and(
        eq(streams.fileKey, fileKey),
        isNull(screens.archivedAt),
        isNull(flows.archivedAt),
        isNull(streams.archivedAt),
      ),
    )
    .orderBy(asc(flows.position), asc(screens.position));

  if (rows.length === 0) return null;

  return {
    streamName: rows[0].streamName,
    items: rows.map((row) => ({
      nodeId: row.nodeId,
      name: row.name,
      flowName: row.flowName,
      state: !row.hasClip
        ? "missing"
        : row.capturedImageHash !== row.imageHash
          ? "stale"
          : "captured",
    })),
  };
}

/** The stored payload's Blob URL, for the route that streams it back. */
export async function getClipBlobUrl(screenId: string): Promise<string | null> {
  const [row] = await db
    .select({ blobUrl: screenClips.blobUrl })
    .from(screenClips)
    .where(eq(screenClips.screenId, screenId))
    .limit(1);

  return row?.blobUrl ?? null;
}
