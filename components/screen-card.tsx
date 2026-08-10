import Image from "next/image";
import Link from "next/link";

import type { DriftState } from "@/db/schema";
import { DriftBadge } from "./drift-badge";

export interface ScreenCardProps {
  id: string;
  name: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  subtitle?: string | null;
  driftState?: DriftState;
  /** Pre-rendered `ts_headline` fragment; contains <mark> elements. */
  snippetHtml?: string | null;
  /**
   * Search passes the active query through so the detail page can draw
   * highlight boxes over the matching copy.
   */
  query?: string;
}

export function ScreenCard({
  id,
  name,
  imageUrl,
  imageWidth,
  imageHeight,
  subtitle,
  driftState,
  snippetHtml,
  query,
}: ScreenCardProps) {
  const href = query
    ? `/screens/${id}?q=${encodeURIComponent(query)}`
    : `/screens/${id}`;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="relative overflow-hidden rounded-lg border border-border bg-surface-muted transition group-hover:border-accent">
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
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium leading-tight">{name}</span>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
        {snippetHtml && (
          <p
            className="text-xs leading-snug text-muted"
            // ts_headline output. The only markup Postgres emits here is the
            // <mark> pair we configured via StartSel/StopSel, and the text it
            // wraps is HTML-escaped by ts_headline itself.
            dangerouslySetInnerHTML={{ __html: snippetHtml }}
          />
        )}
        {driftState && <DriftBadge state={driftState} />}
      </div>
    </Link>
  );
}
