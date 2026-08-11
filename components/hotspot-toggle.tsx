import Link from "next/link";

/**
 * Turns the hotspot overlay off, and back on.
 *
 * On by default, because the question "what can you actually tap here" is the
 * one a static grid of screenshots is worst at answering — but off has to be
 * one click away, since the boxes sit over the copy anyone proof-reading the
 * screens is trying to read.
 *
 * A link rather than client state, like every other view switch here: the
 * setting survives a reload, and a link into a review thread carries whichever
 * way the reader wanted it seen. It reads as a switch and announces itself as
 * one — `aria-pressed` rather than `role="switch"`, because a switch is
 * expected to answer to Space, and an anchor only answers to Enter.
 */
export function HotspotToggle({
  href,
  active,
}: {
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      title={
        active
          ? "Hide the tappable regions"
          : "Outline the tappable regions on every screen"
      }
      className={
        "inline-flex shrink-0 items-center gap-2 rounded-full border py-1 " +
        "pl-2 pr-3 text-sm font-medium transition " +
        "outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent " +
        (active
          ? "border-hotspot/50 bg-hotspot/5 text-foreground"
          : "border-border text-muted hover:text-foreground")
      }
    >
      {/*
        A switch, drawn rather than an <input>: the state lives in the URL and
        the anchor is what changes it, so a real checkbox would be a second
        source of truth that needs client JavaScript to stay in step with the
        page it describes.

        The track carries the overlay's own colour when on, which is how the
        control says what it turns on without being tried once.
      */}
      <span
        aria-hidden
        className={
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full " +
          "transition-colors " +
          (active ? "bg-hotspot" : "bg-border")
        }
      >
        <span
          className={
            "size-3 rounded-full shadow-sm transition-transform " +
            (active ? "translate-x-3.5 bg-white" : "translate-x-0.5 bg-muted")
          }
        />
      </span>
      Hotspots
    </Link>
  );
}
