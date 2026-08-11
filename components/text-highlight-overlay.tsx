import type { TextBox } from "@/lib/queries";

/** The rule for "this copy matched", shared by every caller that outlines it. */
export function matchesTerm(content: string, term: string): boolean {
  return content.toLowerCase().includes(term.toLowerCase());
}

/**
 * Which of a screen's text boxes to outline for a search term.
 *
 * The no-term case is the whole reason this is a function rather than a filter
 * at each call site: a render arrived at without searching has nothing
 * highlighted, and handing the overlay an unfiltered list instead outlines
 * every line of copy on the screen.
 */
export function matchingBoxes(
  texts: TextBox[],
  term: string | undefined,
): TextBox[] {
  const trimmed = term?.trim();
  if (!trimmed) return [];
  return texts.filter((text) => matchesTerm(text.content, trimmed));
}

/**
 * Where on a render the search term actually is, drawn over it.
 *
 * A search result is a picture of a screen, and the reason it came back is a
 * line of copy somewhere inside that picture. Pointing at it on the render says
 * both what matched and where, which a fragment of text quoted underneath can
 * only half do — and it leaves the card to be the screen it stands for.
 *
 * Coordinates were normalised to 0–1 against the frame at sync time, so they
 * position in percentages: correct on a 20vw card and on a full-width render
 * alike, with no measurement and no client JavaScript.
 */
export function TextHighlightOverlay({
  boxes,
  /**
   * A hairline on a card, a firmer ring at full size — same reasoning as
   * `HotspotOverlay`: a 2px ring swamps a thumbnail, a 1px one disappears on a
   * large render.
   */
  weight = "thin",
}: {
  boxes: TextBox[];
  weight?: "thin" | "thick";
}) {
  if (boxes.length === 0) return null;

  return (
    // `aria-hidden` and `pointer-events-none`: an annotation of the image, and
    // never something that can swallow the card's own click.
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {boxes.map((box, index) => (
        <span
          key={`${box.x}-${box.y}-${index}`}
          className={
            "absolute rounded-[2px] bg-accent/25 " +
            (weight === "thick" ? "ring-2 ring-accent" : "ring-1 ring-accent")
          }
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
        />
      ))}
    </span>
  );
}
