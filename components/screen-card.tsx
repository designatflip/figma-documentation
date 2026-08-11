import Image from "next/image";
import Link from "next/link";

import type { DriftState } from "@/db/schema";
import type { HotspotBox, TextBox } from "@/lib/queries";
import { DriftBadge, hasDriftLabel } from "./drift-badge";
import { HotspotOverlay } from "./hotspot-overlay";
import { TextHighlightOverlay } from "./text-highlight-overlay";

export interface ScreenCardProps {
  id: string;
  name: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  subtitle?: string | null;
  driftState?: DriftState;
  /**
   * Tappable regions to outline on the render. Omitted by callers that have
   * not loaded them — search results, where the answer is the copy that
   * matched rather than what the screen does.
   */
  hotspots?: HotspotBox[];
  /**
   * Copy on the render that contains the search term, outlined on the
   * thumbnail. The same boxes the detail view draws, so opening a result keeps
   * pointing at what the card pointed at.
   */
  highlights?: TextBox[];
  /**
   * Search passes the active query through so the detail page can draw
   * highlight boxes over the matching copy.
   */
  query?: string;
  /**
   * Carry "the reader switched the overlay off" into the screen this opens.
   * The lightbox shows the same flow the card came from, with the same boxes
   * over it, so arriving there would otherwise switch them back on.
   */
  hotspotsOff?: boolean;
}

export function ScreenCard({
  id,
  name,
  imageUrl,
  imageWidth,
  imageHeight,
  subtitle,
  driftState,
  hotspots = [],
  highlights = [],
  query,
  hotspotsOff,
}: ScreenCardProps) {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (hotspotsOff) search.set("hotspots", "off");
  const params = search.toString();
  const href = `/screens/${id}${params ? `?${params}` : ""}`;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-3xl outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-muted transition group-hover:border-accent">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name}
            width={imageWidth ?? 800}
            height={imageHeight ?? 1600}
            className="h-auto w-full"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          />
        ) : (
          <div className="flex aspect-[9/16] items-center justify-center text-xs text-muted">
            No render
          </div>
        )}
        {/* Inside the wrapper that hugs the image, so the percentage-positioned
            boxes line up with the render and not with the grid column. */}
        {imageUrl && <HotspotOverlay hotspots={hotspots} />}
        {imageUrl && <TextHighlightOverlay boxes={highlights} />}
        {/* On the render rather than under the name: drift is a fact about the
            picture, and a grid of thumbnails is scanned by picture. */}
        {driftState && hasDriftLabel(driftState) && (
          <div className="absolute right-2 top-2">
            <DriftBadge state={driftState} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium leading-tight">{name}</span>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
    </Link>
  );
}
