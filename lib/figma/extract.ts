import { createHash } from "node:crypto";

import type { BoundingBox, FigmaNode } from "./types";

/** A text run pulled from a frame, positioned 0–1 relative to that frame. */
export interface ExtractedText {
  nodeId: string;
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExtractedFrame {
  nodeId: string;
  name: string;
  /** Figma page the frame sits on. Becomes `screens.section`. */
  section: string;
  /** From `devStatus.description`, when the designer wrote one. */
  description: string | null;
  texts: ExtractedText[];
  /** Reading-order text, newline-joined. Feeds the search vector. */
  textContent: string;
  position: number;
}

const MAX_TEXT_CONTENT = 20_000;

export function isHidden(node: FigmaNode): boolean {
  return node.visible === false;
}

/**
 * Top-level frames on each page of a documentation file.
 *
 * Only direct children of a page count as screens — nested frames are parts of
 * a screen, not screens themselves.
 */
export function findScreenFrames(
  document: FigmaNode,
  ignorePattern: RegExp,
): { page: FigmaNode; frame: FigmaNode; position: number }[] {
  const found: { page: FigmaNode; frame: FigmaNode; position: number }[] = [];
  let position = 0;

  for (const page of document.children ?? []) {
    if (page.type !== "CANVAS" || isHidden(page)) continue;

    for (const frame of page.children ?? []) {
      if (frame.type !== "FRAME") continue;
      if (isHidden(frame)) continue;
      if (ignorePattern.test(frame.name.trim())) continue;
      found.push({ page, frame, position: position++ });
    }
  }

  return found;
}

/**
 * Collect visible TEXT nodes, positioned relative to `frame`.
 *
 * Coordinates are normalised against the frame's own bounding box, which makes
 * them resolution-independent: the same 0–1 values overlay correctly on the
 * PNG at any rendered scale or display width.
 *
 * This assumes the default render crop. If `use_absolute_bounds` is ever added
 * to the images call, every coordinate here silently becomes wrong.
 */
export function extractTexts(frame: FigmaNode): ExtractedText[] {
  const box = frame.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return [];

  const collected: ExtractedText[] = [];
  walk(frame, box, collected);

  // Visual reading order. Rows first (with a tolerance so items that are
  // roughly level are not split by sub-pixel differences), then left to right.
  const ROW_TOLERANCE = 0.01;
  collected.sort((a, b) =>
    Math.abs(a.y - b.y) > ROW_TOLERANCE ? a.y - b.y : a.x - b.x,
  );

  return dedupe(collected);
}

function walk(node: FigmaNode, frameBox: BoundingBox, out: ExtractedText[]) {
  // Skipping the whole subtree matters: a hidden group's children carry no
  // `visible: false` of their own, so checking only leaves would leak text
  // from hidden variants and unused states.
  if (isHidden(node)) return;

  if (node.type === "TEXT" && typeof node.characters === "string") {
    const content = node.characters.trim();
    if (content && !isIconGlyph(content)) {
      const b = node.absoluteBoundingBox;
      out.push({
        nodeId: node.id,
        content,
        x: b ? (b.x - frameBox.x) / frameBox.width : 0,
        y: b ? (b.y - frameBox.y) / frameBox.height : 0,
        w: b ? b.width / frameBox.width : 0,
        h: b ? b.height / frameBox.height : 0,
      });
    }
  }

  for (const child of node.children ?? []) walk(child, frameBox, out);
}

/**
 * Icon fonts render as single private-use-area codepoints. They are noise in
 * search and produce meaningless highlight boxes.
 */
function isIconGlyph(content: string): boolean {
  if ([...content].length > 1) return false;
  const code = content.codePointAt(0) ?? 0;
  return (
    (code >= 0xe000 && code <= 0xf8ff) || // BMP private use area
    (code >= 0xf0000 && code <= 0xffffd) || // supplementary PUA-A
    code < 0x20 // control characters
  );
}

/** Same string at the same spot twice is a stacked duplicate, not two labels. */
function dedupe(texts: ExtractedText[]): ExtractedText[] {
  const seen = new Set<string>();
  return texts.filter((t) => {
    const key = `${t.content}@${t.x.toFixed(3)},${t.y.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildTextContent(texts: ExtractedText[]): string {
  const joined: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    // The index wants each distinct phrase once; repeated list labels add
    // nothing to recall and inflate the row.
    if (seen.has(t.content)) continue;
    seen.add(t.content);
    joined.push(t.content);
  }
  return joined.join("\n").slice(0, MAX_TEXT_CONTENT);
}

export function extractFrame(
  page: FigmaNode,
  frame: FigmaNode,
  position: number,
): ExtractedFrame {
  const texts = extractTexts(frame);
  return {
    nodeId: frame.id,
    name: frame.name.trim(),
    section: page.name.trim(),
    description: frame.devStatus?.description?.trim() || null,
    texts,
    textContent: buildTextContent(texts),
    position,
  };
}

/**
 * Structural fingerprint of a node subtree, for drift detection over time.
 *
 * Covers shape (ids, types, names, geometry) and copy. Deliberately excludes
 * paint and effect data — a colour tweak in a shared style would otherwise
 * flag every documented screen at once.
 */
export function hashNodeSubtree(node: FigmaNode): string {
  const hash = createHash("sha256");
  const visit = (n: FigmaNode) => {
    if (isHidden(n)) return;
    const b = n.absoluteBoundingBox;
    hash.update(
      `${n.type}|${n.name}|${n.characters ?? ""}|` +
        `${b ? `${round(b.width)}x${round(b.height)}` : ""}\n`,
    );
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);
  return hash.digest("hex");
}

// Sub-pixel jitter from auto-layout reflow is not a design change.
const round = (n: number) => Math.round(n);

export function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

/**
 * Figma deep link. Node ids use a colon in the API and a hyphen in URLs.
 */
export function figmaUrl(fileKey: string, slug: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}/${slug}?node-id=${nodeId.replaceAll(":", "-")}`;
}

/**
 * Pull `{fileKey, nodeId}` out of a Figma URL attached as a Dev Resource.
 *
 * Returns null rather than throwing — a designer can attach any link at all,
 * including a Jira ticket, and that must never fail a screen's sync.
 */
export function parseFigmaUrl(
  url: string,
): { fileKey: string; nodeId: string } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("figma.com")) return null;

    // /design/:key/:slug, also /file/ and /proto/ for older links.
    const match = parsed.pathname.match(
      /^\/(?:design|file|proto)\/([A-Za-z0-9]+)/,
    );
    if (!match) return null;

    const nodeParam = parsed.searchParams.get("node-id");
    if (!nodeParam) return null;

    return { fileKey: match[1], nodeId: nodeParam.replaceAll("-", ":") };
  } catch {
    return null;
  }
}
