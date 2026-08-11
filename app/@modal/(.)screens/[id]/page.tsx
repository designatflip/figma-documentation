import { ScreenLightbox } from "@/components/screen-lightbox";

type Props = PageProps<"/screens/[id]">;

/**
 * A screen opened from a listing, overlaid on the listing it was opened from.
 *
 * Intercepts `/screens/[id]` on client navigation only: the URL still changes,
 * and a reload or a shared link falls through to `app/screens/[id]`. That route
 * renders the same lightbox over the catalogue, so falling through costs the
 * reader nothing but a fresh copy of the page behind — which is why this one
 * hands over no `closeHref`. Its reader arrived by navigating, and closing can
 * simply undo that.
 */
export default function ScreenModalPage({ params, searchParams }: Props) {
  return <ScreenLightbox params={params} searchParams={searchParams} />;
}
