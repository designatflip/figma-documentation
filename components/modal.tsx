"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The lightbox a screen renders into, whether it was opened from a listing or
 * landed on cold.
 *
 * A native `<dialog>` opened with `showModal()`, so the focus trap, the
 * inert page behind it, and Escape are the browser's rather than ours. Every
 * way out funnels through `close`, which pops the history entry that opened
 * the modal — the URL and the overlay stay in step, and Back closes rather
 * than leaving the route behind.
 *
 * Except when there is no such entry to pop. A reload, or a link opened in a
 * fresh tab, renders this from the screen route itself with nothing behind it
 * in history, and Back would walk out of the site; `closeHref` is what those
 * callers hand over instead — the route to walk forward to.
 */
export function Modal({
  label,
  closeHref,
  children,
}: {
  label: string;
  /**
   * Where closing goes when this modal did not come from a click on the page
   * behind it. Omitted by the intercepting route, whose reader arrived by
   * navigating and can simply be sent back.
   */
  closeHref?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // `showModal` makes the page inert but not unscrollable: without this, a
  // wheel over the backdrop scrolls the flow underneath the open screen.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={() => (closeHref ? router.push(closeHref) : router.back())}
      // A click that lands on the dialog itself landed on the backdrop —
      // the panel below covers the element's whole painted area.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-transparent p-4 text-foreground backdrop:bg-black/70 sm:p-8"
    >
      <div className="flex min-h-full items-stretch justify-center">
        {/*
          Wide and full height: what it holds is a flow read end to end, so the
          panel takes as much of the viewport as it can and hands the room to
          its content. `items-stretch` above is what makes the height real —
          a column laid out inside can then grow into it.
        */}
        <div className="relative flex w-full max-w-7xl flex-col rounded-3xl border border-border bg-surface p-6 shadow-2xl sm:p-8">
          {/*
            Sat on the panel's own top-right corner rather than tight into the
            rounding, so it lines up with the first row of content and with any
            control the content puts beside it.

            The ✕ is drawn rather than typed: a multiplication sign is a glyph
            at the mercy of the font — off-centre in its own box, and thin at
            the size a target this big deserves.
          */}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="absolute right-6 top-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-muted text-muted transition hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:right-8 sm:top-8"
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
          </button>
          {children}
        </div>
      </div>
    </dialog>
  );
}
