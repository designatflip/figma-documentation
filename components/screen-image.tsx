import Image from "next/image";

import type { TextBox } from "@/lib/queries";
import { matchingBoxes, TextHighlightOverlay } from "./text-highlight-overlay";

/**
 * The screenshot, with optional highlight boxes over matching copy.
 *
 * The boxes themselves live in `TextHighlightOverlay`, which the search cards
 * draw too — one definition of what a highlight looks like and where it sits.
 */
export function ScreenImage({
  src,
  alt,
  width,
  height,
  texts = [],
  highlight,
  priority,
  contain,
  actions,
  badge,
}: {
  src: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  texts?: TextBox[];
  highlight?: string;
  priority?: boolean;
  /**
   * Fit the render inside the viewport instead of filling its column. The
   * wrapper still hugs the image exactly, so the percentage-positioned
   * highlight boxes stay aligned.
   */
  contain?: boolean;
  /**
   * Overlaid on the render, inside the wrapper that hugs it — so an absolutely
   * positioned bar lines up with the image and not with the column around it.
   * The wrapper is a `group`, which is how a bar can reveal itself on hover.
   */
  actions?: React.ReactNode;
  /**
   * Pinned to the top-right corner of the render. For a marker that is a fact
   * about the picture — drift — rather than something to act on: the corner is
   * where the eye already is when it is looking at the frame, and unlike the
   * bar below it never waits for a hover.
   */
  badge?: React.ReactNode;
}) {
  if (!src) {
    return (
      <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-border bg-surface-muted text-sm text-muted">
        No render available
      </div>
    );
  }

  const boxes = matchingBoxes(texts, highlight);

  return (
    <div
      className={
        "group relative overflow-hidden rounded-lg border border-border bg-surface-muted" +
        (contain ? " mx-auto w-fit" : "")
      }
    >
      <Image
        src={src}
        alt={alt}
        width={width ?? 800}
        height={height ?? 1600}
        className={
          contain ? "h-auto max-h-[70vh] w-auto max-w-full" : "h-auto w-full"
        }
        priority={priority}
        sizes="(max-width: 1024px) 100vw, 60vw"
      />
      <TextHighlightOverlay boxes={boxes} weight="thick" />
      {badge && <div className="absolute right-3 top-3">{badge}</div>}
      {actions}
    </div>
  );
}
