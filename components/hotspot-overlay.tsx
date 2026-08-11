import type { HotspotBox } from "@/lib/queries";

/**
 * The tappable regions of a screen, drawn over its render.
 *
 * What a static screenshot cannot say is which parts of it do anything. A
 * designer reading a flow knows; everyone else is guessing, and guessing wrong
 * is how a build ships a button nobody wired. These boxes are Figma's own
 * prototype wiring made visible without playing the prototype.
 *
 * Coordinates were normalised to 0–1 against the frame at sync time, so they
 * position in percentages — correct at a 20vw card and at full width, with no
 * measurement and no client JavaScript. This is a server component for that
 * reason: nothing here needs the browser.
 *
 * `aria-hidden` and `pointer-events-none` throughout. The boxes are an
 * annotation of the image, and a screen reader already has the screen's copy
 * and name; letting them swallow a click would break the card's own link.
 */
export function HotspotOverlay({
  hotspots,
  /**
   * Hairlines on a card, a firmer ring at full size. A 1px ring reads as a
   * clean outline on a thumbnail but nearly vanishes on a large render.
   */
  weight = "thin",
}: {
  hotspots: HotspotBox[];
  weight?: "thin" | "thick";
}) {
  if (hotspots.length === 0) return null;

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {hotspots.map((box, index) =>
        box.wholeScreen ? (
          // Tap-anywhere, or a scrim. Drawn as a dashed border just inside the
          // render's edge: a filled box would tint the entire screenshot, and a
          // ring on the outer edge is indistinguishable from the card's own
          // border. Dashed because it marks a region with no visible shape of
          // its own, unlike a button.
          <span
            key={`whole-${index}`}
            className={
              "absolute inset-[3px] rounded-[3px] border border-dashed " +
              "border-hotspot/70"
            }
          />
        ) : (
          <span
            key={`${box.x}-${box.y}-${index}`}
            // The fill is faint on purpose: it has to mark the area without
            // hiding the thing being marked, which is usually a button with copy
            // on it that the reader still needs.
            className={
              "absolute rounded-[3px] bg-hotspot/12 " +
              (weight === "thick"
                ? "ring-2 ring-hotspot/70"
                : "ring-1 ring-hotspot/60")
            }
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          />
        ),
      )}
    </span>
  );
}
