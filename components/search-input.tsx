"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

/**
 * Where the recent searches live.
 *
 * The browser was already offering this list — its own form history — but that
 * list is the browser's: it spans every site the field's name matches, it can't
 * be styled, and it doesn't survive a switch of machine or profile in any way
 * we control. Keeping our own means the suggestions under the field are always
 * searches somebody ran *here*, and we can say so.
 */
const STORAGE_KEY = "figma-docs.recent-searches";

/** Enough to be useful, few enough to read without scanning. */
const MAX_RECENT = 6;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, MAX_RECENT);
  } catch {
    // Private mode, a full quota, or something else's data under our key.
    // Recent searches are a convenience; none of that is worth an error.
    return [];
  }
}

function writeRecent(queries: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch {
    // Same bargain as above: the search still runs, it just won't be recalled.
  }
}

export function SearchInput({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [isPending, startTransition] = useTransition();
  // Read at first render rather than in an effect: nothing below is on screen
  // until the field is focused, so the server's empty list and the client's
  // real one hydrate to identical markup either way.
  const [recent, setRecent] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readRecent(),
  );
  const [isOpen, setIsOpen] = useState(false);
  /** -1 means "no suggestion picked" — Enter submits what was typed. */
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  /** Clearing the field shouldn't cost you the caret. */
  const inputRef = useRef<HTMLInputElement>(null);

  // Typing narrows the list to the recent searches that contain what's there,
  // the way the browser's list did. An exact match is dropped: offering the
  // user the words already in the field isn't a suggestion.
  const typed = value.trim().toLowerCase();
  const suggestions = typed
    ? recent.filter(
        (entry) =>
          entry.toLowerCase().includes(typed) && entry.toLowerCase() !== typed,
      )
    : recent;
  const isListVisible = isOpen && suggestions.length > 0;

  function remember(query: string) {
    // Most recent first, and a repeat search moves up rather than piling on.
    const next = [
      query,
      ...recent.filter((entry) => entry.toLowerCase() !== query.toLowerCase()),
    ].slice(0, MAX_RECENT);
    setRecent(next);
    writeRecent(next);
  }

  function search(raw: string) {
    const q = raw.trim();
    setValue(q);
    setIsOpen(false);
    setActiveIndex(-1);
    if (q) remember(q);
    startTransition(() => {
      router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    });
  }

  function clearRecent() {
    setRecent([]);
    writeRecent([]);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div
      className="relative w-full max-w-md"
      // Closes when focus leaves the field *and* the list — clicking a
      // suggestion moves focus inside, so it must not count as leaving.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      {/*
        A filled pill rather than an outlined box. In the header the field is
        the one thing you type into, and a fill says that on its own — the
        border was doing the same job twice. The border here is transparent so
        focus can paint it without the row shifting a pixel.
      */}
      <form
        role="search"
        className="flex h-10 items-center gap-2.5 rounded-full border border-transparent bg-surface-muted px-4 transition focus-within:border-accent focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent/25"
        onSubmit={(event) => {
          event.preventDefault();
          search(value);
        }}
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          className="h-4 w-4 shrink-0 text-muted"
        >
          <circle cx="9" cy="9" r="5.25" />
          <path d="M13 13l4 4" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          autoFocus={autoFocus}
          // The browser's own history dropdown would sit on top of ours.
          autoComplete="off"
          role="combobox"
          aria-expanded={isListVisible}
          aria-controls={isListVisible ? listId : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          onChange={(event) => {
            setValue(event.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              setActiveIndex(-1);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (suggestions.length === 0) return;
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setActiveIndex(event.key === "ArrowDown" ? 0 : suggestions.length - 1);
                return;
              }
              const step = event.key === "ArrowDown" ? 1 : -1;
              // Wraps through -1, so arrowing past either end hands the field
              // back what was typed instead of trapping focus in the list.
              const count = suggestions.length + 1;
              setActiveIndex(((activeIndex + 1 + step + count) % count) - 1);
              return;
            }
            if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              search(suggestions[activeIndex]);
            }
          }}
          placeholder="Search screens and their copy…"
          aria-label="Search screens"
          // The pill draws the field now, so the input keeps no box of its
          // own; WebKit's built-in clear button is dropped for the one below,
          // which can be a real target and follow the theme.
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
        />
        {isPending ? (
          <span className="shrink-0 text-xs text-muted" role="status">
            …
          </span>
        ) : (
          value !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setValue("");
                setActiveIndex(-1);
                setIsOpen(true);
                inputRef.current?.focus();
              }}
              className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-foreground"
            >
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                className="h-3.5 w-3.5"
              >
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          )
        )}
      </form>

      {isListVisible && (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-xl">
          <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
            <span className="text-xs font-medium text-muted">
              Recent searches
            </span>
            <button
              type="button"
              onClick={clearRecent}
              className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear
            </button>
          </div>
          <ul id={listId} role="listbox" aria-label="Recent searches">
            {suggestions.map((entry, index) => (
              <li key={entry}>
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  // Keeps focus in the field so the blur above doesn't close
                  // the list out from under the click.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => search(entry)}
                  className={
                    "block w-full truncate rounded-xl px-2.5 py-2 text-left text-sm transition-colors " +
                    (index === activeIndex
                      ? "bg-surface-muted text-foreground"
                      : "text-foreground")
                  }
                >
                  {entry}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
