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
  /** Whether anything on the frame is wired to navigate somewhere else. */
  navigates: boolean;
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

/** A prototype entry point that survives the publishing rules. */
export interface ExtractedPrototype {
  /** The frame the prototype starts on. */
  nodeId: string;
  /** The starting point's own label in Figma, e.g. "Flow 1". */
  name: string;
  /** Figma page the starting point sits on. */
  section: string;
  /** Documented screen the start frame belongs to. Always a published one. */
  screenNodeId: string;
  position: number;
}

/**
 * Prototype entry points, one per "Flow starting point" pin in the file.
 *
 * Figma reports these per page, on the CANVAS node, and they are the only
 * reliable signal that a file is prototyped at all: a frame can carry a stray
 * inherited interaction without ever being reachable, but a starting point is
 * something a designer placed on purpose.
 *
 * A starting point is kept only when it lands inside a *published* screen.
 * That keeps one publishing rule rather than two — a prototype that begins on
 * a `_wip` frame is as unpublished as the frame itself, and the site can
 * always show the entry screen it opens on.
 */
export function findPrototypeFlows(
  document: FigmaNode,
  ignorePattern: RegExp,
): ExtractedPrototype[] {
  // Node ids are file-unique, so one map covers every page.
  const screenByDescendant = new Map<string, string>();
  for (const { frame } of findScreenFrames(document, ignorePattern)) {
    const mark = (node: FigmaNode) => {
      if (isHidden(node)) return;
      screenByDescendant.set(node.id, frame.id);
      for (const child of node.children ?? []) mark(child);
    };
    mark(frame);
  }

  const found: ExtractedPrototype[] = [];
  let position = 0;

  for (const page of document.children ?? []) {
    if (page.type !== "CANVAS" || isHidden(page)) continue;

    for (const point of page.flowStartingPoints ?? []) {
      const screenNodeId = screenByDescendant.get(point.nodeId);
      if (!screenNodeId) continue;
      found.push({
        nodeId: point.nodeId,
        name: point.name.trim() || "Prototype",
        section: page.name.trim(),
        screenNodeId,
        position: position++,
      });
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
    navigates: navigatesAway(frame),
    position,
  };
}

/**
 * Whether anything inside `frame` is wired to take the viewer to another
 * frame — the difference between a screen you can leave and the end of a flow.
 *
 * Answers for the whole subtree, because the tap target is almost never the
 * screen: it is a button, a row, a card several levels down. Hidden branches
 * are skipped for the same reason the text walk skips them — an off variant's
 * connections are not reachable, and counting them would make every screen
 * that contains a component set look navigable.
 *
 * Only navigation counts. An interaction that opens a URL, closes an overlay,
 * scrolls, or sets a variable leaves the viewer on the same screen, so it says
 * nothing about whether the flow continues.
 */
export function navigatesAway(node: FigmaNode): boolean {
  if (isHidden(node)) return false;

  // The legacy field, for files authored before `interactions` existed.
  if (node.transitionNodeID) return true;

  for (const interaction of node.interactions ?? []) {
    for (const action of interaction.actions ?? []) {
      if (action.destinationId) return true;
    }
  }

  return (node.children ?? []).some(navigatesAway);
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

/** Figma's presentation view, opened at a prototype's starting point. */
export function figmaProtoUrl(
  fileKey: string,
  slug: string,
  nodeId: string,
): string {
  const id = nodeId.replaceAll(":", "-");
  return `https://www.figma.com/proto/${fileKey}/${slug}?node-id=${id}&starting-point-node-id=${id}&scaling=contain`;
}

/**
 * Same prototype, on the host Figma serves in an iframe.
 *
 * `embed-host` is required and only has to be a stable identifier for us.
 * `node-id` is the hyphen form used in URLs; `starting-point-node-id` is the
 * colon form, per Figma's own example — they are not interchangeable.
 *
 * The embed renders against the viewer's own Figma session, so it shows a
 * request-access screen to anyone without file access rather than leaking
 * anything. That is why every embed is paired with a plain link out.
 *
 * Pass `clientId` to make the embed controllable: Figma only opens the
 * postMessage channel for an OAuth app that has claimed this origin, and
 * without it every command we send is dropped in silence. See
 * `figmaEmbedClientId` in `lib/env.ts`.
 */
export function figmaEmbedUrl(
  fileKey: string,
  nodeId: string,
  { clientId }: { clientId?: string | null } = {},
): string {
  const params = new URLSearchParams({
    "node-id": nodeId.replaceAll(":", "-"),
    "starting-point-node-id": nodeId,
    "embed-host": EMBED_HOST,
    /**
     * `fit-width`, not `contain`.
     *
     * The player already sizes the iframe to the frame's own aspect ratio, so
     * matching the width lands the height flush too. `contain` fits the design
     * into the viewer's *inner* area — inside a margin we cannot reach, being
     * another origin — and was rendering the phone at roughly half size with
     * that margin all around it. Matching the width sidesteps the margin
     * instead of fighting it.
     *
     * A screen taller than the starting frame now scrolls rather than being
     * shrunk to fit, which is what a long page should do anyway.
     */
    scaling: "fit-width",
    "content-scaling": "fixed",
    // The blue flashes on tap are the point of showing a prototype at all.
    "hotspot-hints": "true",
    footer: "false",
    // A bezel would be drawn outside the frame and break that exact fit.
    "device-frame": "false",
  });

  if (clientId) {
    params.set("client-id", clientId);
    /**
     * Clears Figma's own chrome — prev/next/restart and the fullscreen
     * button — leaving the design and nothing else.
     *
     * Only set alongside `client-id`, and that pairing is the point: with
     * only a couple of hotspots wired into a file, those buttons are the only
     * way through the flow, so hiding them before our own controls can work
     * would strand the viewer on the first screen.
     *
     * Undocumented in Embed Kit 2.0's parameter tables, and used anyway:
     * it is an Embed Kit 1.0 parameter, and the migration guide states that
     * 2.0 supports all of them bar `embed_origin`. `viewport-controls=false`
     * is the documented neighbour and does something else — it takes away
     * pan and zoom, which is how a screen taller than the frame is scrolled,
     * while leaving every button in place.
     *
     * If Figma ever drops it, the buttons reappear underneath ours rather
     * than anything breaking. That is ugly, not broken, and it is the reason
     * this is an acceptable bet.
     */
    params.set("hide-ui", "1");
  }

  return `https://embed.figma.com/proto/${fileKey}?${params}`;
}

const EMBED_HOST = "flip-design-docs";

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
