"use client";

import { useState, useTransition } from "react";

import { runSyncAction, type SyncActionResult } from "./actions";

export function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncActionResult | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await runSyncAction());
          })
        }
        className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        {isPending ? "Syncing…" : "Sync now"}
      </button>

      {isPending && (
        <p className="text-xs text-muted">
          Files sync serially against Figma&rsquo;s rate limit, so a full run can
          take a few minutes.
        </p>
      )}

      {result && (
        <p
          className={`text-xs ${result.ok ? "text-muted" : "text-warning"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
