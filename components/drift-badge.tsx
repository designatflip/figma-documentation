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
 * Lets callers lay out around the badge without duplicating the rule for
 * which states are worth showing. `DriftBadge` renders nothing for the rest.
 */
export function hasDriftLabel(state: DriftState): boolean {
  return state in LABELS;
}

export function DriftBadge({
  state,
  checkedAt,
}: {
  state: DriftState;
  checkedAt?: Date | null;
}) {
  const label = LABELS[state];
  if (!label) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning"
      title={
        checkedAt
          ? `Checked ${checkedAt.toLocaleDateString()}`
          : "Compared against the linked source frame"
      }
    >
      <span aria-hidden>△</span>
      {label}
    </span>
  );
}
