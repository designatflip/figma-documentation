import Image from "next/image";
import Link from "next/link";

import type { FlowRailScreen } from "@/lib/queries";
import { DriftBadge, hasDriftLabel } from "./drift-badge";

/** How many frames of the first rail are worth loading before the fold. */
const EAGER_FRAMES = 4;

export interface FlowRailProps {
  name: string;
  slug: string;
  screens: FlowRailScreen[];
  /** Set on the first rail, whose leading frames are the page's LCP. */
  priority?: boolean;
}

/**
 * A flow as one horizontal run of frames, with its name underneath.
 *
 * The home page is the flow page now: rather than a cover thumbnail that has to
 * be clicked to find out what a flow contains, the screens themselves are the
 * listing, and reading a flow is scrolling sideways through it. Sections are
 * flattened into one run — see `getFlows` — because a rail has only the one
 * axis, and the frames are already in the order Figma lays them out.
 *
 * Every frame links to `/screens/[id]`, which the modal in `app/@modal`
 * intercepts: clicking one opens the lightbox over this page, with the whole
 * flow in it. That is where the things a rail has no room for live — the
 * prototype, the hotspot overlay, Figma links, Copy to Figma — so nothing that
 * was on the flow page has been lost, only moved one click further in.
 */
export function FlowRail({ name, slug, screens, priority }: FlowRailProps) {
  return (
    // The anchor the breadcrumbs and the lightbox's title point back to.
    // `scroll-mt` clears the sticky header, which would otherwise land on top
    // of the rail it just scrolled to.
    <section id={slug} className="scroll-mt-24">
      {/*
        Bleeding the scroller past the page's gutter and paying it back as
        padding: the run starts flush with everything else on the page, and
        keeps going to the edge of the window instead of stopping short at a
        margin — which is the thing that says it scrolls.

        `scroll-fade` is the rest of that sentence: frames dissolve into
        whichever end the run can still travel towards, so a rail whose last
        visible frame happens to land near the edge does not read as a flow of
        five screens. See `globals.css`.
      */}
      <ul className="scroll-fade -mx-6 flex gap-6 overflow-x-auto px-6 pb-3">
        {screens.map((screen, index) => (
          <li key={screen.id} className="shrink-0">
            <Link
              href={`/screens/${screen.id}`}
              title={screen.name}
              // Height-first, like the lightbox strip: every frame in the run
              // lines up on one baseline whatever its own aspect ratio, and
              // only the length of the rail varies.
              className="group relative block h-80 overflow-hidden rounded-3xl border border-border bg-surface-muted outline-offset-4 transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent sm:h-96 lg:h-[32rem]"
            >
              {screen.imageUrl ? (
                <Image
                  src={screen.imageUrl}
                  alt={screen.name}
                  width={screen.imageWidth ?? 800}
                  height={screen.imageHeight ?? 1600}
                  className="h-full w-auto max-w-none"
                  priority={priority && index < EAGER_FRAMES}
                  sizes="(max-width: 640px) 60vw, 25vw"
                  // A drag across the rail is someone scrolling it, not someone
                  // dragging a picture out of it.
                  draggable={false}
                />
              ) : (
                // No render to take a width from, so it borrows a phone's.
                <span className="flex aspect-[9/16] h-full items-center justify-center text-xs text-muted">
                  No render
                </span>
              )}

              {/* Corner of the frame it is about, like every other listing. */}
              {hasDriftLabel(screen.driftState) && (
                <span className="absolute right-3 top-3">
                  <DriftBadge state={screen.driftState} />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {/* Under the run rather than over it: the frames are what the eye lands
          on, and the caption says which flow it just looked at. */}
      <div className="mt-1">
        <h2 className="text-base font-semibold tracking-tight">{name}</h2>
        <p className="mt-0.5 text-sm text-muted">
          {screens.length} screen{screens.length === 1 ? "" : "s"}
        </p>
      </div>
    </section>
  );
}
