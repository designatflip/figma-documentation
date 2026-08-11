import Link from "next/link";

import { DriftBadge, hasDriftLabel } from "@/components/drift-badge";
import { HotspotToggle } from "@/components/hotspot-toggle";
import { PrototypePlayer } from "@/components/prototype-player";
import { ScreenActions, revealOnHover } from "@/components/screen-actions";
import { ScreenImage } from "@/components/screen-image";
import { ScreenStrip } from "@/components/screen-strip";
import { ViewTabs } from "@/components/view-tabs";
import { getClipStatus, getFlowClipStatuses } from "@/lib/clips";
import { getFlowById, type ScreenDetail as Screen } from "@/lib/queries";

export interface ScreenDetailProps {
  screen: Screen;
  /** Search term to draw highlight boxes over the matching copy. */
  highlight?: string;
  /** Which half of the switch is showing. Ignored when nothing is playable. */
  view?: string;
  /** Starting point to play, when the flow has more than one. */
  start?: string;
  /** `"off"` hides the tappable regions. Only the strip draws them. */
  hotspots?: string;
  /** Set on a cold load, where the render is the page's LCP. */
  priority?: boolean;
  /** Fit the render to the viewport — the modal shows the whole screen at once. */
  contain?: boolean;
}

/**
 * Every state of this view is a URL, so both routes share one link builder.
 * Only the non-default overlay state is written, which keeps the plain screen
 * link — the one that gets shared — clean.
 */
function screenHref(
  id: string,
  params: { q?: string; view?: string; start?: string; hotspots?: "off" },
) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.view) search.set("view", params.view);
  if (params.start) search.set("start", params.start);
  if (params.hotspots) search.set("hotspots", params.hotspots);
  const query = search.toString();
  return `/screens/${id}${query ? `?${query}` : ""}`;
}

/**
 * A way out of the site, worn as lightly as the stage wears its own — see the
 * "Open in Figma" link in `prototype-stage`. Muted until you point at it, and
 * an arrow to say it leaves.
 */
const figmaLink =
  "rounded-sm text-xs text-muted underline underline-offset-4 transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Everything a documented screen has to say about itself: the render, and the
 * ways out of the site into Figma.
 *
 * Shared by the `/screens/[id]` page and the modal that intercepts it, and now
 * framed the same either way: the flow's name up top, its screens laid end to
 * end, scrolled to this one. A screen only means something next to its
 * neighbours, and that is as true of a link opened cold as of a click from a
 * rail — so the route a reader came in by is not something this view can tell,
 * and a reload does not land them somewhere they have to get their bearings in
 * again. What differs between the two routes is only what sits behind the
 * lightbox, and where closing it goes.
 */
export async function ScreenDetail({
  screen,
  highlight,
  view,
  start,
  hotspots,
  priority,
  contain,
}: ScreenDetailProps) {
  // Cached under the same tag as the screen itself, so this is a cheap second
  // read of data the catalogue has usually already filled. Null for an archived
  // screen whose flow is gone — which is also a flow with nothing to play.
  const flow = await getFlowById(screen.flowId);
  const prototypes = flow?.prototypes ?? [];
  // A shared `?view=prototype` link outlives the prototype it pointed at —
  // starting points come and go in Figma — so the render is the fallback rather
  // than an empty state explaining what used to be here.
  const showPrototype = prototypes.length > 0 && view === "prototype";
  // Prefer a starting point that opens on this very screen: from here, "play
  // the prototype" means this screen, not wherever the flow happens to begin.
  const startNodeId =
    start ?? prototypes.find((p) => p.startsOn?.id === screen.id)?.nodeId;

  // One continuous run — the flow read end to end, in the order its frames sit
  // on the Figma page, which is how the home page's rail reads it too.
  const flowScreens = flow?.screens ?? [];
  // An archived screen keeps its page after its flow is gone, and a flow with
  // no live screens has no run to show: either way it falls back to its own
  // render rather than an empty rail.
  const showStrip = !showPrototype && flowScreens.length > 0;

  // On unless asked otherwise — and only offered when
  // there is wiring to show, since a control that visibly does nothing is
  // worse than no control. Carried by every link below, so a trip through the
  // prototype, or along the flow, does not switch the overlay back on.
  const showHotspots = hotspots !== "off";
  const hotspotParam = showHotspots ? undefined : ("off" as const);
  const hasHotspots = flowScreens.some((card) => card.hotspots.length > 0);

  // Clip status is read uncached, unlike the screen itself: capture happens
  // outside a sync, so it has no `catalog` revalidation to ride on. At most one
  // of these runs, and the prototype view runs neither — it offers no actions
  // at all. The strip carries a bar per frame, so it asks about the flow rather
  // than about this screen.
  const flowClips =
    showStrip && flow ? await getFlowClipStatuses(flow.id) : null;
  const clip =
    showStrip || showPrototype ? null : await getClipStatus(screen.id);

  // Copying into Figma is offered only for a screen that has actually been
  // captured through the plugin, and never for one that is no longer
  // published. Saving the render has no such condition.
  const actionsProps = {
    screenId: screen.id,
    hasRender: Boolean(screen.imageUrl),
    clip: clip && !screen.archivedAt ? { stale: clip.stale } : undefined,
  };
  // The bar rides on the render it acts on. With no render to sit on it drops
  // into the row under the frame instead; in the strip every frame carries its
  // own — see below.
  const actionsOnImage =
    !showPrototype && !showStrip && Boolean(screen.imageUrl);
  // Drift rides the render it is about, in its corner: the strip's frames each
  // carry their own, and a lone render carries this screen's. Only with the
  // prototype playing, or with no render at all, is there nothing to ride —
  // then it falls back to the provenance block under the frame.
  const driftOnMedia =
    hasDriftLabel(screen.driftState) &&
    (showStrip || (!showPrototype && Boolean(screen.imageUrl)));

  const tabs = prototypes.length > 0 && (
    <ViewTabs
      screensLabel="Design"
      screensHref={screenHref(screen.id, {
        q: highlight,
        hotspots: hotspotParam,
      })}
      prototypeHref={screenHref(screen.id, {
        q: highlight,
        view: "prototype",
        start,
        hotspots: hotspotParam,
      })}
      active={showPrototype ? "prototype" : "screens"}
    />
  );

  // Beside the modal's close button: it acts on every frame in the run at
  // once, so it belongs to the chrome rather than to any one screen. This is
  // the only place the overlay can be switched — the home page's rails show
  // the renders plain, and a page of flows is no place to argue about wiring.
  const hotspotToggle = showStrip && hasHotspots && (
    <HotspotToggle
      href={screenHref(screen.id, {
        q: highlight,
        hotspots: showHotspots ? "off" : undefined,
      })}
      active={showHotspots}
    />
  );

  const media =
    showPrototype && flow ? (
      <PrototypePlayer
        flowName={flow.name}
        streamSlug={flow.streamSlug}
        fileKey={flow.fileKey}
        prototypes={prototypes}
        selectedNodeId={startNodeId}
        flowEndNodeIds={flow.flowEndNodeIds}
        // Keeps the picker on this screen's URL, so switching starting
        // point inside the modal does not navigate out of it.
        startHref={(nodeId) =>
          screenHref(screen.id, {
            q: highlight,
            view: "prototype",
            start: nodeId,
            hotspots: hotspotParam,
          })
        }
      />
    ) : showStrip ? (
      <ScreenStrip
        activeId={screen.id}
        texts={screen.texts}
        highlight={highlight}
        screens={flowScreens.map((card) => {
          const cardClip = flowClips?.get(card.id);
          return {
            id: card.id,
            name: card.name,
            imageUrl: card.imageUrl,
            imageWidth: card.imageWidth,
            imageHeight: card.imageHeight,
            clip: cardClip ? { stale: cardClip.stale } : undefined,
            hotspots: showHotspots ? card.hotspots : [],
            driftState: card.driftState,
          };
        })}
      />
    ) : (
      <ScreenImage
        src={screen.imageUrl}
        alt={screen.name}
        width={screen.imageWidth}
        height={screen.imageHeight}
        texts={screen.texts}
        highlight={highlight}
        priority={priority}
        contain={contain}
        badge={
          hasDriftLabel(screen.driftState) && (
            <DriftBadge
              state={screen.driftState}
              checkedAt={screen.driftCheckedAt}
            />
          )
        }
        actions={
          actionsOnImage && (
            <ScreenActions
              {...actionsProps}
              className={
                "absolute inset-x-0 bottom-3 items-center px-3 " + revealOnHover
              }
            />
          )
        }
      />
    );

  /*
    The ways out of the site, in the open: both links open the same documented
    node — only Figma's viewing mode differs — and unlike the bar on the render
    they navigate away, which is not something to hide behind a hover.

    Quiet text rather than buttons, matching the stage's own "Open in Figma": a
    way out is not what a reader came here to do, so it stays legible without
    competing with the screen it sits beside.

    Placement is the caller's, since the two routes read the row differently:
    the page keeps it centred under the frame it is about; the modal hangs it
    off the flow's name in the header, where the run of frames below has no one
    frame for it to sit under.

    Gone while the prototype is playing, though. Every one of these acts on this
    screen — its node, its render — and a few taps into a prototype the frame on
    the stage is some other screen entirely, so the row would be quietly offering
    to open, save and copy something the reader is no longer looking at. What is
    on the stage has its own way out, on the stage: "Open in Figma".
  */
  const figmaLinks = !showPrototype && (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={screen.figmaUrl}
        target="_blank"
        rel="noreferrer"
        className={figmaLink}
      >
        Design <span aria-hidden>↗</span>
      </a>
      <span>
        •
      </span>
      <a
        href={`${screen.figmaUrl}&m=dev`}
        target="_blank"
        rel="noreferrer"
        className={figmaLink}
      >
        Dev mode <span aria-hidden>↗</span>
      </a>

      {/* Only when nothing above is carrying it: no render to ride on, and no
          strip, where the bar belongs to whichever frame is under the pointer
          rather than to the one the URL happens to be about. */}
      {!actionsOnImage && !showStrip && (
        <ScreenActions {...actionsProps} className="items-center" />
      )}
    </div>
  );

  const description = screen.description && (
    <div>
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
        Description
      </h2>
      <p className="text-sm leading-relaxed">{screen.description}</p>
    </div>
  );

  /*
    Only when drift was detected and the render is not already carrying the
    badge in its corner — otherwise the block collapses rather than leaving a
    stray gap, or saying the same thing twice.
  */
  const driftBelow = hasDriftLabel(screen.driftState) && !driftOnMedia;
  const provenance = driftBelow && (
    <div className="flex flex-col items-start gap-2">
      <DriftBadge state={screen.driftState} checkedAt={screen.driftCheckedAt} />
    </div>
  );

  const archivedNotice = screen.archivedAt && (
    <div className="mb-6 rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-sm font-medium">No longer published</p>
      <p className="mt-1 text-sm text-muted">
        This screen was removed from the Figma documentation project on{" "}
        {screen.archivedAt.toLocaleDateString()}. It is kept so existing links
        stay meaningful, and it no longer appears in listings or search.
      </p>
    </div>
  );

  return (
    <>
      {archivedNotice}

      {/*
        Three tracks so the switch centres on the panel rather than on the
        title, whatever sits either side of it. The row spans the panel's full
        width for exactly that reason: room reserved for the close button here
        would narrow the box the tracks divide, and the middle one would come
        to rest half that reservation left of centre. So the right track keeps
        clear of the button itself, below, and only the stacked layout — one
        track, the title running the whole width — pads the row.
      */}
      <header className="mb-6 grid items-start gap-3 pr-12 sm:grid-cols-[1fr_auto_1fr] sm:pr-0">
        {/* The flow's name, not this screen's: the panel shows the whole run
            and no frame in it is picked, so a line naming one screen would be
            describing something the reader cannot see the modal doing. */}
        <div className="min-w-0">
          {/* The stream over the flow, in the shape the catalogue files them:
              a product area, then the flow inside it. Quiet, because the run of
              frames below is a flow and that is what the reader is looking at. */}
          <p className="truncate text-xs uppercase tracking-wide text-muted">
            {screen.streamName}
          </p>
          <div className="flex min-w-0 items-center">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {/* Out to the flow's rail on the home page: the same run of
                  frames this panel is showing, in the listing behind it. */}
              <Link href={`/#${screen.flowAnchor}`} className="hover:underline">
                {screen.flowName}
              </Link>
            </h1>
          </div>
          {/* Under the name rather than under the frames, where a row would
              read as belonging to whichever frame it happened to land beside.
              Up here it is part of the chrome, like the switch and the close
              button — and, like the URL itself, it is about the screen the
              modal was opened on however far the run is scrolled. */}
          {figmaLinks && <div className="mt-2">{figmaLinks}</div>}
        </div>
        {/*
          `h-10` is the close button's height, and these cells start at the
          same top edge it is pinned to — so every control in the row shares
          one centreline, however tall the title beside them turns out to be.

          The middle cell is rendered even when there is nothing playable to
          switch to: it is the centre track, and without it anything after the
          title would slide into the middle of the panel.
        */}
        <div className="flex h-10 items-center justify-center">{tabs}</div>
        {/* The padding is the close button's own width and a gap, so the
            toggle stops beside it and the two read as one row of chrome. */}
        <div className="flex h-10 items-center justify-end sm:pr-14">
          {hotspotToggle}
        </div>
      </header>

      {/*
        The column the panel's height goes to. `min-h-0` on both this and the
        frames below it: a flex child's floor is its content, so without it a
        strip of tall renders would push the panel past the viewport instead
        of fitting inside it.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        {/*
          Only the strip takes the leftover room — the player sizes itself to
          the prototype's own aspect ratio and is not ours to stretch.

          The floor is what a short window gets: rather than squeezing the
          renders down to a sliver, the panel grows past the viewport and the
          modal scrolls, which is the same thing the page behind it does.
        */}
        <div className={showStrip ? "min-h-64 flex-1" : undefined}>{media}</div>
        {(description || provenance) && (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {description}
            {provenance}
          </div>
        )}
      </div>
    </>
  );
}
