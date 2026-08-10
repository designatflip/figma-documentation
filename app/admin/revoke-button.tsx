"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { revokePluginTokenAction } from "./actions";

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await revokePluginTokenAction(id);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            // The list is read uncached on every request, so re-rendering the
            // Server Component is all it takes to reflect the revocation.
            router.refresh();
          })
        }
        className="rounded-md border border-border px-2 py-1 text-xs text-warning disabled:opacity-60"
      >
        {isPending ? "Revoking…" : "Revoke"}
      </button>
      {error && <span className="text-xs text-warning">{error}</span>}
    </div>
  );
}
