import type { DriftState } from "@/db/schema";

/**
 * Wording is deliberately factual, never a verdict.
 *
 * We can prove the source design changed; we cannot know whether the
 * documented screen is now "wrong" — a designer may have documented an
 * intentional variant. A badge that overclaims gets trained-ignored.
 */
const LABELS: Partial<Record<DriftState, string>> = {
  content_changed: "Source copy differs",
  source_changed: "Source design has changed",
};

/**
 * What the badge actually says. The corner of a thumbnail is narrow — a card at
 * 50vw on a phone is barely wider than the sentence above — and the badge is
 * the same badge everywhere, so everywhere gets the short claim. The full one
 * stays in the tooltip.
 */
const SHORT_LABELS: Partial<Record<DriftState, string>> = {
  content_changed: "Copy differs",
  source_changed: "Design changed",
};

/**
 * Lets callers lay out around the badge without duplicating the rule for
 * which states are worth showing. `DriftBadge` renders nothing for the rest.
 */
export function hasDriftLabel(state: DriftState): boolean {
  return state in LABELS;
}

/**
 * One badge, one look, wherever drift is worth saying.
 *
 * The solid fill is set by the hardest place it has to work: the corner of a
 * render, where the backdrop is whatever the designer drew, from a white sheet
 * to a photo. A tint would have done off a render — under the prototype, beside
 * a description — but a warning that changes colour depending on what happens
 * to be behind it reads as two different warnings, and the reader has to learn
 * both.
 */
export function DriftBadge({
  state,
  checkedAt,
}: {
  state: DriftState;
  checkedAt?: Date | null;
}) {
  const label = LABELS[state];
  if (!label) return null;

  const provenance = checkedAt
    ? `Checked ${checkedAt.toLocaleDateString()}`
    : "Compared against the linked source frame";

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-black/10 bg-warning-solid px-2.5 py-1 text-xs font-semibold text-warning-solid-fg"
      title={`${label}. ${provenance}`}
    >
      <WarningIcon />
      {SHORT_LABELS[state]}
    </span>
  );
}

/**
 * Drawn rather than typed: the outline triangle we used before is a glyph that
 * renders thin and small next to bold text, which undersells the one thing the
 * badge is for.
 */
function WarningIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden
      className="shrink-0"
    >
      <path d="M7.13 1.87a1 1 0 0 1 1.74 0l6.1 11.13a1 1 0 0 1-.87 1.5H1.9a1 1 0 0 1-.87-1.5zM8 5.25a.85.85 0 0 0-.85.9l.2 3.1a.65.65 0 0 0 1.3 0l.2-3.1a.85.85 0 0 0-.85-.9m0 5.5a.88.88 0 1 0 0 1.75.88.88 0 0 0 0-1.75" />
    </svg>
  );
}
