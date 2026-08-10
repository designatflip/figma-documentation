"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

export function SearchInput({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = value.trim();
        startTransition(() => {
          router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
        });
      }}
      className="relative w-full max-w-md"
    >
      <input
        type="search"
        name="q"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search screens and their copy…"
        aria-label="Search screens"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      />
      {isPending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          …
        </span>
      )}
    </form>
  );
}
