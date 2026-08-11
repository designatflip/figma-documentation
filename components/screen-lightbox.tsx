import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Modal } from "@/components/modal";
import { ScreenDetail } from "@/components/screen-detail";
import { getScreenById } from "@/lib/queries";

interface ScreenLightboxProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  /**
   * Where closing goes when the reader did not click their way in. See
   * `Modal`; the intercepting route leaves it off and sends them back.
   */
  closeHref?: string;
  /** Set on a cold load, where the frames in the panel are the page's LCP. */
  priority?: boolean;
}

/**
 * A documented screen as a lightbox over whatever is behind it.
 *
 * Both routes that can show a screen render this, which is the point: the
 * intercepting route in `app/@modal` puts it over the listing the reader
 * clicked from, and `app/screens/[id]` puts it over the listing rebuilt from
 * scratch. Neither the panel nor its contents can tell which happened, so a
 * reload — the one thing interception cannot survive — leaves the reader
 * looking at what they were already looking at.
 *
 * The dialog is mounted outside the Suspense boundary so it opens on the click
 * and stays open while the screen streams in — a boundary around the whole
 * modal would tear it down and re-open it on every resolve.
 */
export function ScreenLightbox({
  params,
  searchParams,
  closeHref,
  priority,
}: ScreenLightboxProps) {
  return (
    <Modal label="Screen details" closeHref={closeHref}>
      <Suspense fallback={<ScreenLightboxSkeleton />}>
        <ScreenLightboxContent
          params={params}
          searchParams={searchParams}
          priority={priority}
        />
      </Suspense>
    </Modal>
  );
}

async function ScreenLightboxContent({
  params,
  searchParams,
  priority,
}: Pick<ScreenLightboxProps, "params" | "searchParams" | "priority">) {
  const { id } = await params;
  const { q, view, start, hotspots } = await searchParams;

  await connection();

  const screen = await getScreenById(id);
  if (!screen) notFound();

  return (
    <ScreenDetail
      screen={screen}
      highlight={typeof q === "string" ? q : undefined}
      view={typeof view === "string" ? view : undefined}
      start={typeof start === "string" ? start : undefined}
      hotspots={typeof hotspots === "string" ? hotspots : undefined}
      priority={priority}
      contain
    />
  );
}

/**
 * Shaped like what lands: a title, then a run of frames filling the panel —
 * including how it fills it, so the modal does not resize under the reader
 * when the screens arrive.
 */
function ScreenLightboxSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex h-10 items-center">
        <div className="h-6 w-64 max-w-full animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="aspect-[9/16] h-full shrink-0 animate-pulse rounded-xl bg-surface-muted"
          />
        ))}
      </div>
    </div>
  );
}
