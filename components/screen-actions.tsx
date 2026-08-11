"use client";

import { useEffect, useRef, useState } from "react";

import {
  screenClip,
  screenRender,
  useClipboardCopy,
} from "@/components/use-clipboard-copy";

export interface ScreenActionsProps {
  screenId: string;
  /** Without a render there is nothing to save, and nothing to copy as one. */
  hasRender: boolean;
  /**
   * Whether a clip has been captured for this screen, and whether it predates
   * the screen's latest change. Absent means nothing to copy into Figma — the
   * option is left out rather than disabled, since an action that usually
   * fails teaches designers to stop trusting it.
   */
  clip?: { stale: boolean };
  /**
   * Placement, alignment and visibility are the caller's: this is a bar, not
   * a layer. Nothing here sets `items-*`, so the caller's wins outright rather
   * than depending on which class Tailwind happens to emit last.
   */
  className?: string;
}

/**
 * Placement-free classes for a bar that rides on a render and waits for the
 * pointer. The caller still says where it sits; this says when it is there.
 *
 * Only where hovering is a thing: on a touch screen there is nothing to hover,
 * so the bar stays put, and a keyboard tab into it brings it back the same way.
 * Untouchable while hidden, so an invisible bar is never what catches a click
 * meant for the render under it.
 *
 * Requires a `group` on whatever wraps the render.
 */
export const revealOnHover =
  "transition-opacity [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:pointer-events-auto [@media(hover:hover)]:group-focus-within:opacity-100";

const pill =
  "whitespace-nowrap rounded-full px-3 py-1.5 text-center text-sm font-medium transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

/**
 * Equal halves, in a bar that is only as wide as it needs to be.
 *
 * Grid rather than flex: the bar shrinks to fit its contents, so there is no
 * free space for `flex-grow` to hand out and the items would keep their own
 * widths — "Copy ▾" next to "Save image" makes that obvious. Equal `fr`
 * columns in an auto-width grid all take the width of the widest one instead.
 */
const bar =
  "grid grid-flow-col auto-cols-fr items-center gap-1 rounded-full border border-border bg-surface/90 p-1 shadow-lg backdrop-blur";

/**
 * What you can take away from a documented screen: the render as a file, or
 * either form of it on the clipboard.
 *
 * Sits over the render itself rather than in a column beside it — these are
 * actions on the thing you are looking at, so they meet the pointer where the
 * eye already is. The links out to Figma are deliberately not here: they
 * navigate away, they apply just as well while the prototype is playing, and
 * they belong in the open under the frame rather than behind a hover.
 */
export function ScreenActions({
  screenId,
  hasRender,
  clip,
  className,
}: ScreenActionsProps) {
  const image = useClipboardCopy();
  const figma = useClipboardCopy();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const options = [
    ...(hasRender
      ? [
          {
            label: "Copy image",
            run: () => image.copy(() => screenRender(screenId)),
          },
        ]
      : []),
    ...(clip
      ? [
          {
            label: "Copy to Figma",
            run: () => figma.copy(() => screenClip(screenId)),
          },
        ]
      : []),
  ];

  // A menu that outlives the pointer leaving it would hang over the render
  // with nothing to dismiss it, since the bar itself fades out on unhover.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      // Stopped short of the dialog: Escape closes the menu first, and only a
      // second press closes the screen behind it.
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (options.length === 0 && !hasRender) return null;

  // One shared line of status: only one copy can be in flight at a time.
  const status = image.status !== "idle" ? image.status : figma.status;
  const caption =
    image.error ??
    figma.error ??
    (figma.status === "copied"
      ? "Press ⌘V in Figma."
      : image.status === "copied"
        ? "Press ⌘V wherever you want the picture."
        : clip?.stale
          ? "The Figma copy was captured before the latest change to this screen, so it may be slightly out of date."
          : null);

  const label = (idle: string) =>
    status === "copied" ? "Copied" : status === "copying" ? "Copying…" : idle;

  return (
    <div className={"flex flex-col gap-2 " + (className ?? "")}>
      <div className={bar}>
        {hasRender && (
          <a
            href={`/api/screens/${screenId}/image?download`}
            download
            className={pill}
          >
            Save image
          </a>
        )}

        {/* With one way to copy, the menu would be a click in the way of
            itself — the single option becomes the button. */}
        {options.length === 1 ? (
          <button
            type="button"
            onClick={options[0].run}
            disabled={status === "copying"}
            className={pill}
          >
            {label(options[0].label)}
          </button>
        ) : (
          options.length > 1 && (
            // The menu's anchor is the grid item, so the trigger fills it
            // rather than sizing itself and leaving the half short.
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                disabled={status === "copying"}
                aria-haspopup="menu"
                aria-expanded={open}
                // The label centres on the whole pill, as it does in the other
                // half of the bar; the caret is taken out of the flow so it
                // can sit on the edge without pulling the label off-centre.
                className={pill + " relative w-full"}
              >
                {label("Copy")}
                <span
                  aria-hidden
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  ▾
                </span>
              </button>

              {open && (
                <div
                  role="menu"
                  // Upwards: the bar sits at the foot of the render, so a menu
                  // below it would open off the bottom of the frame.
                  className="absolute bottom-full right-0 z-10 mb-2 min-w-max overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-xl"
                >
                  {options.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        option.run();
                      }}
                      className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {caption && (
        <p
          role="status"
          className="max-w-xs rounded-md bg-surface/90 px-2 py-1 text-center text-xs text-muted backdrop-blur"
        >
          {caption}
        </p>
      )}
    </div>
  );
}
