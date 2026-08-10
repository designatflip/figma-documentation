"use client";

import { useState, useTransition } from "react";

import { pairPluginAction, type PairActionResult } from "./actions";

export function PairForm({
  pairingState,
  email,
}: {
  pairingState: string;
  email: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PairActionResult | null>(null);

  if (result?.ok) {
    return (
      <p className="text-sm text-muted" role="status">
        {result.message} You can close this tab.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await pairPluginAction(pairingState));
          })
        }
        className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        {isPending ? "Pairing…" : `Pair as ${email}`}
      </button>

      {result && !result.ok && (
        <p className="text-xs text-warning" role="status">
          {result.message}
        </p>
      )}
    </div>
  );
}
