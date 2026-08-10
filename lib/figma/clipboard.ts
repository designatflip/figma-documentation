/**
 * Figma's clipboard payload.
 *
 * Copying a frame in Figma writes `text/html` to the clipboard holding two
 * otherwise-empty spans:
 *
 *     <span data-metadata="<!--(figmeta)BASE64(/figmeta)-->"></span>
 *     <span data-buffer="<!--(figma)BASE64(/figma)-->"></span>
 *
 * `figmeta` is a plain JSON header. `figma` is the scene itself in Figma's
 * internal fig-kiwi binary format — undocumented, versioned, and emphatically
 * not ours to parse. Nothing here decodes it: the payload is stored and
 * replayed to the clipboard byte-for-byte, and only the header is read, to
 * learn which documented screen the copy came from.
 *
 * That header is why capture needs no out-of-band bookkeeping. It names the
 * file and the node, so a pasted payload identifies itself rather than relying
 * on the designer's selection still being intact when the paste lands.
 */

/** Well beyond a complex frame; a guard against a pathological paste. */
const MAX_CLIP_BYTES = 20 * 1024 * 1024;

/**
 * The markers, tolerant of two things we cannot control:
 *
 * - the payload arriving HTML-escaped, if a browser re-serialises the
 *   attribute value on the way out of `getData('text/html')`
 * - the closing marker being `(/figma)` or `(figma)` — the observed format is
 *   the former, and accepting both costs nothing if Figma ever changes it back
 */
const marker = (tag: string) =>
  new RegExp(
    `(?:<|&lt;)!--\\(${tag}\\)([A-Za-z0-9+/=\\s]+?)\\(/?${tag}\\)--(?:>|&gt;)`,
  );

const META_RE = marker("figmeta");
const BUFFER_RE = marker("figma");

/** Node ids as they appear in `selectedNodeData`, e.g. `1:8874`. */
const NODE_ID_RE = /\d+:\d+/g;

export interface ClipboardHeader {
  /** The Figma file the frame was copied from. Matches `flows.file_key`. */
  fileKey: string;
  /** The single copied node, e.g. `1:8874`. Matches `screens.node_id`. */
  nodeId: string;
}

export type ClipboardParse =
  | { ok: true; header: ClipboardHeader }
  | { ok: false; reason: string };

/**
 * Read the header off a clipboard payload, rejecting anything that is not a
 * single-frame Figma scene copy.
 *
 * Every rejection carries a reason the designer can act on — this runs behind
 * a paste box, where "it didn't work" is a uniquely unhelpful thing to say.
 */
export function parseClipboardHtml(html: string): ClipboardParse {
  if (html.length === 0) {
    return { ok: false, reason: "The clipboard held no HTML." };
  }

  if (html.length > MAX_CLIP_BYTES) {
    return {
      ok: false,
      reason:
        `That payload is ${Math.round(html.length / 1024 / 1024)} MB, past the ` +
        `${MAX_CLIP_BYTES / 1024 / 1024} MB limit. Copy a single frame rather ` +
        "than a whole page.",
    };
  }

  const meta = html.match(META_RE);
  if (!meta) {
    return {
      ok: false,
      reason:
        "No Figma header in what you pasted. Copy a frame from the Figma " +
        "canvas with ⌘C, not from anywhere else.",
    };
  }

  // Checked but never decoded: without the scene buffer there is nothing to
  // replay later, and a header-only payload would store a clip that pastes
  // as nothing at all.
  if (!BUFFER_RE.test(html)) {
    return {
      ok: false,
      reason:
        "The Figma header is there but the scene data is missing, so this " +
        "would paste as nothing. Try copying the frame again.",
    };
  }

  let header: unknown;
  try {
    header = JSON.parse(
      Buffer.from(meta[1].replace(/\s/g, ""), "base64").toString("utf8"),
    );
  } catch {
    return { ok: false, reason: "The Figma header could not be decoded." };
  }

  const { fileKey, dataType, editorType, selectedNodeData } = (header ??
    {}) as Record<string, unknown>;

  if (typeof fileKey !== "string" || fileKey.length === 0) {
    return { ok: false, reason: "The Figma header names no source file." };
  }

  // A frame copy is a `scene`. Copying text, or copying out of FigJam, gives
  // something else — and would upsert a clip that pastes as the wrong thing.
  if (dataType !== "scene" || editorType !== "design") {
    return {
      ok: false,
      reason:
        `That looks like a ${String(dataType)} copy from ` +
        `${String(editorType)}, not a frame from a Figma design file.`,
    };
  }

  if (typeof selectedNodeData !== "string") {
    return { ok: false, reason: "The Figma header names no copied node." };
  }

  const nodeIds = [...new Set(selectedNodeData.match(NODE_ID_RE) ?? [])];

  if (nodeIds.length === 0) {
    return { ok: false, reason: "The Figma header names no copied node." };
  }

  // One clip is one screen. A multi-frame copy would paste all of them, which
  // is never what a "copy this screen" button should hand over.
  if (nodeIds.length > 1) {
    return {
      ok: false,
      reason: `You copied ${nodeIds.length} nodes. Select exactly one frame.`,
    };
  }

  return { ok: true, header: { fileKey, nodeId: nodeIds[0] } };
}
