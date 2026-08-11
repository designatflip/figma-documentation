"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { ScreenActions, revealOnHover } from "@/components/screen-actions";
import type { DriftState } from "@/db/schema";
import type { HotspotBox, TextBox } from "@/lib/queries";
import { DriftBadge, hasDriftLabel } from "./drift-badge";
import { HotspotOverlay } from "./hotspot-overlay";
import { matchingBoxes, TextHighlightOverlay } from "./text-highlight-overlay";

export interface StripScreen {
  id: string;
  name: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  /**
   * Whether this screen has a Figma clip captured for it, and whether that clip
   * predates its latest render. Absent means no Copy to Figma on this frame.
   */
  clip?: { stale: boolean };
  /**
   * Tappable regions to outline. Empty when the reader has switched them off —
   * the caller decides, exactly as the search results' cards do.
   */
  hotspots?: HotspotBox[];
  /**
   * Whether this frame's source design has moved on. Per frame rather than for
   * the open one alone: the strip is the whole flow, and drift is a fact about
   * a picture, so scrolling along the run says which screens are stale.
   */
  driftState?: DriftState;
}

/**
 * A whole flow as one horizontal run of frames, opened on one of them.
 *
 * A screen only means something next to the screens either side of it, so the
 * lightbox shows the flow rather than a lone render: the neighbours are right
 * there to scroll to.
 *
 * Nothing here is a link, and no frame can be picked. Scrolling the run is the
 * only thing the strip does, and what a reader wants from any one frame — the
 * render, the layers — its own bar hands over without moving them off the
 * screen they opened. A click that quietly re-pointed the panel's footer at a
 * different screen would be a selection nobody could see.
 */
export function ScreenStrip({
  screens,
  activeId,
  texts = [],
  highlight,
}: {
  screens: StripScreen[];
  activeId: string;
  /**
   * The open screen's copy — only that one's, since it is the only frame here
   * whose text has been loaded. Outlined where it matches the search term, and
   * nowhere at all without one; `ScreenImage` takes the same pair.
   */
  texts?: TextBox[];
  highlight?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const boxes = matchingBoxes(texts, highlight);

  // Open on the screen that was clicked, wherever it sits in the flow — by
  // travelling there from the flow's start rather than beginning there.
  //
  // Landing mid-run with no journey reads as a flow of one screen that happens
  // to have neighbours off both edges; the frames sliding past on the way in
  // are how many screens came before this one, said in the only terms a
  // horizontal run has. A screen at the start has nothing to travel, and gets
  // the plain jump.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !active) return;

    // Assigning `scrollLeft` rather than calling `scrollIntoView`: the strip
    // lives inside a `<dialog>`, and scrolling an element into view walks up
    // the ancestors, dragging the modal itself around to get there.
    //
    // Read afresh on every tick below, not measured once: renders arriving
    // late settle the widths ahead of this frame, and with them where it sits.
    const centred = () =>
      active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;

    const distance = centred();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || distance <= 0) {
      list.scrollLeft = distance;
      return;
    }

    // Mandatory snapping fights a scroll it did not start, tugging the run
    // back to the nearest frame between ticks. Off for the length of the
    // travel, and on again wherever it comes to rest.
    list.style.scrollSnapType = "none";
    list.scrollLeft = 0;

    // A long flow travels further, not proportionally longer: past a second or
    // so the run is a blur, and its length has already been made.
    const duration = Math.min(1400, 500 + distance * 0.4);
    // A beat on the first frames before setting off, so the run is seen to
    // start at the beginning rather than to arrive already moving.
    const hold = 160;

    let frame = 0;
    let began = 0;

    const settle = () => {
      cancelAnimationFrame(frame);
      list.style.scrollSnapType = "";
      for (const event of ["wheel", "touchstart", "pointerdown"] as const) {
        list.removeEventListener(event, settle);
      }
    };

    const step = (now: number) => {
      began ||= now;
      const elapsed = now - began - hold;
      const t = Math.min(1, Math.max(0, elapsed) / duration);
      // Eased both ends: it leaves the flow's start and arrives at this screen
      // under its own weight, which is what makes it read as travel rather
      // than as the strip being dragged.
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      list.scrollLeft = centred() * eased;
      if (t < 1) frame = requestAnimationFrame(step);
      else settle();
    };

    frame = requestAnimationFrame(step);

    // Whoever reaches for the strip mid-flight owns it from there: the travel
    // is an introduction, not something to scroll against.
    for (const event of ["wheel", "touchstart", "pointerdown"] as const) {
      list.addEventListener(event, settle, { passive: true });
    }

    return settle;
  }, [activeId]);

  return (
    <ul
      ref={listRef}
      // `h-full`: the frames take whatever height the panel hands down, so a
      // taller window is a taller flow rather than more empty panel.
      //
      // Positioned, so `offsetLeft` above is measured against the strip and
      // not against whatever happens to be positioned further up the page.
      //
      // `scroll-fade` says the run continues past the panel's edge, the same
      // way the home page's rails do — and here it says it on both sides at
      // once, which is the strip's whole point: a screen opened mid-flow has
      // neighbours in both directions. See `globals.css`.
      className="scroll-fade relative flex h-full snap-x snap-mandatory gap-8 overflow-x-auto pb-2"
    >
      {screens.map((screen) => {
        const active = screen.id === activeId;
        return (
          // `group`: each frame reveals its own bar, so pointing at a screen is
          // what says which screen the actions act on.
          <li
            key={screen.id}
            data-active={active}
            className="group relative h-full shrink-0 snap-center"
          >
            {/*
              Every frame drawn the same. The screen the modal was opened on is
              still where the strip scrolls to, but it is not marked: nothing
              can be picked here, so a ring around one of them would be a
              selection the reader cannot change or explain.

              `title`, since the strip no longer names the screens: the pointer
              is how you ask which one you are looking at.
            */}
            <div
              title={screen.name}
              className="relative h-full select-none overflow-hidden rounded-3xl border border-border bg-surface-muted"
            >
              {screen.imageUrl ? (
                <Image
                  src={screen.imageUrl}
                  alt={screen.name}
                  width={screen.imageWidth ?? 800}
                  height={screen.imageHeight ?? 1600}
                  // Height-first: every frame in a flow lines up on one
                  // baseline whatever its own aspect ratio, and the strip's
                  // length is the only thing that varies.
                  className="h-full w-auto max-w-none"
                  priority={active}
                  sizes="40vw"
                  // A drag across the strip is someone scrolling it, not
                  // someone dragging a picture out of it.
                  draggable={false}
                />
              ) : (
                // No render to take a width from, so it borrows a phone's.
                <span className="flex aspect-[9/16] h-full items-center justify-center text-xs text-muted">
                  No render
                </span>
              )}

              {/* Inside the wrapper that hugs the image: the percentage-placed
                  boxes line up with the render and not with the strip. */}
              <HotspotOverlay hotspots={screen.hotspots ?? []} weight="thick" />
              {active && <TextHighlightOverlay boxes={boxes} weight="thick" />}

              {/* Corner of the frame it is about, like the home page's rails. */}
              {screen.driftState && hasDriftLabel(screen.driftState) && (
                <span className="absolute right-3 top-3">
                  <DriftBadge state={screen.driftState} />
                </span>
              )}
            </div>

            {/*
              Above the frame, and outside it: the only thing in the strip that
              answers to a pointer, on the screen the pointer is over. On touch
              it stays put, on every frame — with nothing to hover and nothing
              to click, a bar that waited would be a bar nobody could reach.
            */}
            <ScreenActions
              screenId={screen.id}
              hasRender={Boolean(screen.imageUrl)}
              clip={screen.clip}
              className={
                "absolute inset-x-0 bottom-4 z-10 items-center px-3 " +
                revealOnHover
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
