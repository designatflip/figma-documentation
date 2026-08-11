"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

export interface PrototypeStageProps {
  /** Embed URL carrying `client-id`, or null when none is configured. */
  controlledUrl: string | null;
  /** Same embed without the message channel, keeping Figma's own controls. */
  plainUrl: string;
  title: string;
  /** Width ÷ height of the starting frame. Sizes the box the iframe fills. */
  aspect: number;
  /** Bottom-left caption. Absent when no starting frame is known. */
  startsOnLabel?: string;
  /** Figma's presentation view, for the bottom-right link out. */
  protoUrl: string;
  /** Node the flow starts on. Recognising it is how "first screen" is known. */
  startNodeId: string;
  /**
   * Nodes with nothing wired to tap. Landing on one is the end of the flow.
   *
   * Empty is the honest answer for a flow synced before the column existed,
   * and it costs nothing: the forward arrow then falls back to noticing that
   * a press went nowhere, which is how this worked before.
   */
  flowEndNodeIds: string[];
}

/** Tall enough to read a phone screen, short enough to leave the page visible. */
const STAGE_HEIGHT = "min(78vh, 54rem)";

/**
 * Pixels trimmed from the embed's edges — `x` from left and right, `y` from
 * top and bottom.
 *
 * Figma's viewer puts its own margin around the prototype, and that margin is
 * inside a cross-origin document — `contentDocument` is null and any style we
 * write cannot reach it, so it cannot be removed at the source. What we do own
 * is the window: oversizing the iframe by this much on each side and clipping
 * the overflow pushes Figma's margin out of view, leaving the design flush.
 *
 * Oversizing does not slide the design out from under a fixed margin, it grows
 * the area the viewer scales into — so the design comes back bigger by roughly
 * the same amount, and the margin ends up outside the clip. That only lands
 * flush while these values match the real margin: too low leaves a band, too
 * high scales the design past the window and crops it, and the crop is silent.
 *
 * Two axes because they are not equal — measured at 48 and 60 against a stage
 * about 258 × 562 CSS px. To re-measure, open the embed in DevTools (its frame
 * is selectable in the frame picker despite the origin) and read the offset
 * from the iframe's edge to the design's.
 */
const CROP = { x: 48, y: 60 };

/**
 * Where prototype commands must be addressed.
 *
 * `https://www.figma.com`, even though the iframe's src is `embed.figma.com` —
 * Figma's Embed API documents this exact origin as the only accepted one, and
 * a `postMessage` sent to the src origin instead is silently discarded.
 */
const FIGMA_TARGET_ORIGIN = "https://www.figma.com";

/**
 * Origins we accept events from. Figma documents every prototype event as
 * coming from `www.figma.com`; `embed.figma.com` is listed too because it is
 * the frame we loaded and equally theirs, so if the sender ever moves there
 * the controls keep working instead of quietly never enabling.
 */
const FIGMA_EVENT_ORIGINS = new Set([
  FIGMA_TARGET_ORIGIN,
  "https://embed.figma.com",
]);

/**
 * How long after the frame loads to wait for the embed to say hello.
 *
 * The channel opens only for an OAuth app whose origins include this one, and
 * a rejected handshake looks exactly like a slow one: nothing arrives. Rather
 * than leave dead controls on screen, the stage reloads the embed with Figma's
 * own — the state this component replaced.
 *
 * Timed from the iframe's `load` rather than from mount, because `INITIAL_LOAD`
 * means "the first screen has finished rendering" and a heavy prototype on a
 * cold cache takes its time getting there. Counting from mount made a slow
 * network indistinguishable from a rejected origin, and a wrongly-triggered
 * fallback is expensive: it reloads the iframe out from under the viewer.
 */
const HANDSHAKE_TIMEOUT_MS = 20_000;

/**
 * How long a `NAVIGATE_FORWARD` has to produce a screen change before the
 * stage concludes there was nowhere to go.
 *
 * There is no "which screen is last" to ask for. Figma reports the node being
 * presented and nothing about what surrounds it — no flow list, no position,
 * no end-of-flow event — and the flow order is Figma's own, not the order of
 * the screens we sync, so it cannot be reconstructed from our side either.
 * What is observable is that forward at the end of a flow does nothing at all.
 *
 * So the end is inferred from a press that went nowhere, which means the last
 * screen keeps its forward button until someone presses it once. Long enough
 * to cover a transition — smart animate runs to about half a second — and any
 * `PRESENTED_NODE_CHANGED` cancels it, so a slow navigation is not mistaken
 * for a dead end.
 */
const FORWARD_PROBE_MS = 900;

type Channel = "connecting" | "open" | "absent";

/** Figma writes node ids with a colon; URLs use a hyphen. Compare one form. */
function sameNode(a: string | null, b: string | null) {
  return (
    a != null && b != null && a.replaceAll("-", ":") === b.replaceAll("-", ":")
  );
}

/**
 * The embed itself, plus the controls that drive it.
 *
 * These are one component because the buttons need the iframe's
 * `contentWindow` to post to, and a ref does not cross the server/client
 * boundary. Everything the stage draws over the prototype lives here too, so
 * there is a single place that knows what overlaps the design.
 *
 * The prototype is Figma's, not ours: we send `NAVIGATE_FORWARD`,
 * `NAVIGATE_BACKWARD` and `RESTART` and let Figma decide what they mean —
 * these are the same commands its own cluster issues, so overlays, smart
 * animate and flow order all behave exactly as they do in the real player.
 *
 * Back and forward stand at the stage's left and right edges, restart sits
 * centred along the bottom with the captions. That is the shape of Figma's
 * own full-screen viewer, which is where designers already know to look.
 *
 * Each arrow is absent rather than dimmed at the end it cannot move past. A
 * disabled control still reads as something to try; nothing at all reads as
 * an edge, which is what the first and last screen of a flow are.
 */
export function PrototypeStage({
  controlledUrl,
  plainUrl,
  title,
  aspect,
  startsOnLabel,
  protoUrl,
  startNodeId,
  flowEndNodeIds,
}: PrototypeStageProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [channel, setChannel] = useState<Channel>(
    controlledUrl ? "connecting" : "absent",
  );
  /**
   * The node Figma says it is showing.
   *
   * Seeded with the starting point because nothing is reported at load: the
   * first `PRESENTED_NODE_CHANGED` only arrives once the prototype moves, so
   * without this the first screen would not be recognised as the first.
   */
  const [presentedNodeId, setPresentedNodeId] = useState(startNodeId);
  /** Set when a forward press produced no movement. See `FORWARD_PROBE_MS`. */
  const [probedEnd, setProbedEnd] = useState(false);
  /** The iframe's own `load`, which is when the handshake clock starts. */
  const [frameLoaded, setFrameLoaded] = useState(false);
  const probeRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const src = controlledUrl && channel !== "absent" ? controlledUrl : plainUrl;
  const showControls = channel === "open";
  const atStart = sameNode(presentedNodeId, startNodeId);
  // Two ways to know the flow is over, and they are answers to different
  // questions. The synced one is known before the viewer touches anything;
  // the probe covers screens we have no row for — an overlay, or a frame
  // synced before this was recorded.
  const atEnd =
    probedEnd || flowEndNodeIds.some((id) => sameNode(presentedNodeId, id));

  useEffect(() => {
    if (channel === "absent") return;

    function onMessage(event: MessageEvent) {
      /**
       * The origin is the only check, deliberately.
       *
       * Matching `event.source` against the iframe's `contentWindow` looks
       * like the tighter test and silently rejects everything: we load
       * `embed.figma.com`, but the events arrive from `www.figma.com`, so the
       * sender is a frame nested inside the one we mounted — a window we
       * cannot reach across origins to compare against. Figma's own example
       * checks the origin and nothing else, for the same reason.
       *
       * The cost is that a page holding two stages would have both react to
       * either one's prototype. A page only ever renders one, and Figma
       * publishes no id on these events to tell them apart if it did.
       */
      if (!FIGMA_EVENT_ORIGINS.has(event.origin)) return;

      // The whole handshake is invisible when it fails, so in development say
      // what did arrive. Silence here means Figma is not talking to us at all.
      if (process.env.NODE_ENV !== "production") {
        console.debug("[prototype] from Figma:", event.data?.type, event.data);
      }

      switch (event.data?.type) {
        case "INITIAL_LOAD":
          setChannel("open");
          break;
        case "PRESENTED_NODE_CHANGED":
          // Fires for hotspot taps as well as our own commands, so tapping
          // through the design keeps the arrows as honest as pressing them.
          setPresentedNodeId(event.data.data?.presentedNodeId ?? null);
          // The prototype moved, so wherever we are is not a dead end — and
          // the press that got us here was not one either.
          clearTimeout(probeRef.current);
          setProbedEnd(false);
          break;
        // Both mean the channel works but the prototype is not playing: the
        // viewer has to sign in or enter the file's password inside the frame
        // first. Leaving the bar as it is beats falling back to a cluster
        // that would be just as inert.
        case "LOGIN_SCREEN_SHOWN":
        case "PASSWORD_SCREEN_SHOWN":
          setChannel("open");
          break;
      }
    }

    window.addEventListener("message", onMessage);
    const timer = frameLoaded
      ? setTimeout(() => {
          setChannel((current) => {
            if (current !== "connecting") return current;
            console.warn(
              "[prototype] Figma never opened the embed message channel. " +
                "Check that FIGMA_EMBED_CLIENT_ID is an OAuth app with " +
                `${window.location.origin} registered under Embed API. ` +
                "Falling back to Figma's own controls.",
            );
            return "absent";
          });
        }, HANDSHAKE_TIMEOUT_MS)
      : undefined;

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [channel, frameLoaded, src]);

  // Nothing else clears this one: a probe outliving the component would call
  // `setAtEnd` on something unmounted.
  useEffect(() => () => clearTimeout(probeRef.current), []);

  function send(type: "NAVIGATE_BACKWARD" | "NAVIGATE_FORWARD" | "RESTART") {
    iframeRef.current?.contentWindow?.postMessage(
      { type },
      FIGMA_TARGET_ORIGIN,
    );

    if (type === "NAVIGATE_FORWARD") {
      // Watch for the press going nowhere. `PRESENTED_NODE_CHANGED` cancels it.
      clearTimeout(probeRef.current);
      probeRef.current = setTimeout(() => setProbedEnd(true), FORWARD_PROBE_MS);
    }

    if (type === "RESTART") {
      // Restart returns to the starting point, which we know without being
      // told — and from there the flow has somewhere to go again.
      clearTimeout(probeRef.current);
      setPresentedNodeId(startNodeId);
      setProbedEnd(false);
    }
  }

  return (
    <div
      // Deeper at the bottom than the top: the restart button and the captions
      // sit in that band, and the frame has to end above them rather than
      // running underneath. Everything else about the stage is symmetric.
      className="relative flex items-center justify-center overflow-hidden rounded-2xl border border-border bg-stage px-6 pt-10 pb-20"
      style={{ height: STAGE_HEIGHT }}
    >
      {/* Full stage height, width derived from the frame — this is what
          makes the phone fill the space instead of floating in it. The
          iframe is positioned against this box rather than filling it, so
          `CROP` can hang it over every edge and have the overflow clipped —
          which is also what rounds the design's corners. */}
      <div
        className="relative h-full overflow-hidden rounded-3xl"
        style={{ aspectRatio: aspect }}
      >
        <iframe
          // Keyed so switching starting point — or dropping to the plain
          // embed above — remounts the iframe rather than leaving React to
          // mutate `src` on a frame Figma has already navigated internally;
          // that reload is unreliable.
          key={src}
          ref={iframeRef}
          src={src}
          title={title}
          className="absolute block border-0"
          style={{
            top: -CROP.y,
            left: -CROP.x,
            width: `calc(100% + ${CROP.x * 2}px)`,
            height: `calc(100% + ${CROP.y * 2}px)`,
          }}
          allowFullScreen
          onLoad={() => setFrameLoaded(true)}
        />
      </div>

      {/* Out at the stage's edges rather than over the design: the prototype
          is the thing being read, and a control sitting on top of it competes
          with the screen's own buttons — which are what a viewer is actually
          being asked to look at. The dead space either side of a phone-shaped
          frame is exactly the room this needs. */}
      {showControls && !atStart && (
        <EdgeButton
          side="left"
          label="Previous screen"
          onClick={() => send("NAVIGATE_BACKWARD")}
        >
          <ArrowLeft />
        </EdgeButton>
      )}

      {showControls && !atEnd && (
        <EdgeButton
          side="right"
          label="Next screen"
          onClick={() => send("NAVIGATE_FORWARD")}
        >
          <ArrowRight />
        </EdgeButton>
      )}

      {/* Corner chrome, clear of the phone. `pointer-events-none` on the row
          keeps the dead space around the frame draggable for Figma's own pan,
          with the button and the link opting back in. The outer two cells
          share the leftover width evenly, which is what centres restart. */}
      <div className="pointer-events-none absolute inset-x-5 bottom-4 flex items-center gap-4 text-xs text-muted">
        <span className="flex-1 basis-0">
          {startsOnLabel && `Starts on ${startsOnLabel}`}
        </span>

        {showControls && (
          <button
            type="button"
            onClick={() => send("RESTART")}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-raised/80 px-4 py-2 text-sm text-foreground backdrop-blur-sm transition hover:bg-surface-raised"
          >
            <Restart />
            Restart prototype
          </button>
        )}

        <span className="flex-1 basis-0 text-right">
          <a
            href={protoUrl}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto hover:text-foreground"
          >
            Open in Figma <span aria-hidden>↗</span>
          </a>
        </span>
      </div>
    </div>
  );
}

/**
 * One of the two round buttons standing off the edge of the stage.
 *
 * Sized well past the 44px touch target and centred on the frame's own
 * midline, so reaching for it never means aiming at the design.
 */
function EdgeButton({
  side,
  label,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "absolute top-1/2 z-10 flex size-12 -translate-y-1/2 items-center " +
        "justify-center rounded-full border border-border " +
        "bg-surface-raised/80 text-foreground backdrop-blur-sm transition " +
        "hover:bg-surface-raised " +
        (side === "left" ? "left-4" : "right-4")
      }
    >
      {children}
    </button>
  );
}

/** Line icons on a 16px grid, drawn at the weight of the site's own type. */
function Icon({
  children,
  className = "size-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function ArrowLeft() {
  return (
    <Icon className="size-5">
      <path d="M13 8H3m0 0 4.5-4.5M3 8l4.5 4.5" />
    </Icon>
  );
}

function ArrowRight() {
  return (
    <Icon className="size-5">
      <path d="M3 8h10m0 0L8.5 3.5M13 8l-4.5 4.5" />
    </Icon>
  );
}

function Restart() {
  return (
    <Icon>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.16" />
      <path d="M12.9 1.6v2.6h-2.6" />
    </Icon>
  );
}
