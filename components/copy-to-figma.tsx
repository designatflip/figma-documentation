"use client";

import { useState } from "react";

type Status = "idle" | "copying" | "copied" | "error";

/** How long the confirmation stays up before the button offers itself again. */
const CONFIRM_MS = 4000;

/**
 * Puts a stored Figma clipboard payload on the system clipboard, so the next
 * ⌘V inside Figma pastes the screen as real, editable layers.
 *
 * Only rendered for screens that have a captured clip — an always-present
 * button that usually fails would teach designers to stop trusting it.
 */
export function CopyToFigma({
  screenId,
  stale,
}: {
  screenId: string;
  stale: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setStatus("copying");
    setError(null);

    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error(
          "This browser can't write rich clipboard data. Try Chrome, Edge, or Safari.",
        );
      }

      // The fetch promise is handed to `ClipboardItem` rather than awaited
      // first: Safari only honours a clipboard write that is constructed
      // synchronously inside the click, and drops one issued after an await.
      const payload = fetch(`/api/clips/${screenId}`).then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "This screen has no captured clip yet."
              : `Could not load the clip (${response.status}).`,
          );
        }

        // Re-wrapped rather than passed through as `response.blob()`, whose
        // type would be `text/html; charset=utf-8` — `ClipboardItem` requires
        // the blob's type to equal its key exactly.
        return new Blob([await response.text()], { type: "text/html" });
      });

      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": payload }),
      ]);

      setStatus("copied");
      setTimeout(() => setStatus("idle"), CONFIRM_MS);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Copy to your file
      </h2>

      <button
        type="button"
        onClick={copy}
        disabled={status === "copying"}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-60"
      >
        {status === "copied"
          ? "Copied — press ⌘V in Figma"
          : status === "copying"
            ? "Copying…"
            : "Copy to Figma"}
      </button>

      {status === "error" && (
        <p className="mt-2 text-sm text-muted">{error}</p>
      )}

      {status !== "error" && (
        <p className="mt-2 text-sm text-muted">
          {stale
            ? "Pastes as editable layers. This copy was captured before the latest change to this screen, so it may be slightly out of date."
            : "Pastes as editable layers, not an image."}
        </p>
      )}
    </div>
  );
}
