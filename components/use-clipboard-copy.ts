"use client";

import { useState } from "react";

export type CopyStatus = "idle" | "copying" | "copied" | "error";

/** How long a confirmation stays up before the button offers itself again. */
const CONFIRM_MS = 4000;

/**
 * One clipboard write, with the state a button needs to narrate it.
 *
 * The item is built by the caller and handed over as a factory rather than an
 * awaited blob: Safari only honours a clipboard write constructed
 * synchronously inside the click, and drops one issued after an `await`. That
 * is why `screenClip` and `screenRender` below return promises for
 * `ClipboardItem` to resolve itself, instead of being fetched up front.
 */
export function useClipboardCopy() {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function copy(item: () => ClipboardItem) {
    setStatus("copying");
    setError(null);

    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error(
          "This browser can't write rich clipboard data. Try Chrome, Edge, or Safari.",
        );
      }

      await navigator.clipboard.write([item()]);

      setStatus("copied");
      setTimeout(() => setStatus("idle"), CONFIRM_MS);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return { status, error, copy };
}

/**
 * Re-wrapped rather than passed through as `response.blob()`, whose type
 * would carry a charset — `ClipboardItem` requires the blob's type to equal
 * its key exactly.
 */
async function blob(
  response: Response,
  type: string,
  missing: string,
): Promise<Blob> {
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? missing
        : `Could not load it from the server (${response.status}).`,
    );
  }
  return new Blob([await response.arrayBuffer()], { type });
}

/** The stored Figma payload: pastes into Figma as real, editable layers. */
export function screenClip(screenId: string): ClipboardItem {
  const payload = fetch(`/api/clips/${screenId}`).then((response) =>
    blob(response, "text/html", "This screen has no captured clip yet."),
  );
  return new ClipboardItem({ "text/html": payload });
}

/** The flat render, for pasting into anything that takes a picture. */
export function screenRender(screenId: string): ClipboardItem {
  const payload = fetch(`/api/screens/${screenId}/image`).then((response) =>
    blob(response, "image/png", "This screen has no render yet."),
  );
  return new ClipboardItem({ "image/png": payload });
}
