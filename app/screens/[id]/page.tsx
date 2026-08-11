import { Suspense } from "react";

import { FlowRails, FlowRailsSkeleton } from "@/components/flow-rails";
import { ScreenLightbox } from "@/components/screen-lightbox";

type Props = PageProps<"/screens/[id]">;

/**
 * The screen route as it renders cold: a reload, a shared link, a new tab.
 *
 * The catalogue, with the screen's lightbox already open over it — the same
 * two things a click from a rail leaves on screen, because that is what this
 * route exists to survive. Interception only covers client navigation, so
 * without the listing here a reload would swap the reader's whole view for a
 * page about one screen and read as a redirect. The URL never changed; only
 * what answered it did.
 *
 * So the rails are rebuilt behind the panel rather than shown: nobody sees
 * them until the modal closes, and then they are already there to close onto.
 * They stream in behind their own boundary, so they cost the panel nothing —
 * whichever of the two resolves first paints first.
 */
export default function ScreenPage({ params, searchParams }: Props) {
  return (
    <>
      <Suspense fallback={<FlowRailsSkeleton />}>
        <FlowRails />
      </Suspense>

      {/*
        Home, not `router.back()`: there is no history entry behind a cold
        load, and Back from here walks out of the site. The flow's own rail
        would be the better landing, but its slug arrives with the screen —
        long after the panel needs to know where its close button goes.
      */}
      <ScreenLightbox
        params={params}
        searchParams={searchParams}
        closeHref="/"
        priority
      />
    </>
  );
}
