import { connection } from "next/server";

import { FlowRail } from "@/components/flow-rail";
import { getStreams } from "@/lib/queries";

/**
 * The catalogue: every stream, and under it a rail per flow. That is the home
 * page, and it mirrors how the work is filed in Figma — a file is a product
 * stream, a page inside it is a flow, a frame on that page is a screen.
 *
 * Its own component rather than part of `app/page`, because the screen route
 * renders it too — a link opened cold lands on the listing with the screen's
 * lightbox over it, so a reload looks like what it interrupted. See
 * `app/screens/[id]/page`.
 */
export async function StreamRails() {
  // Stop prerendering here. Without this, `use cache` would be filled at build
  // time, making every deploy depend on the database being reachable — for
  // data that only ever changes when a sync runs, never when we deploy. The
  // static shell around this still prerenders; this streams in behind Suspense
  // and is cached from the first real request onward.
  await connection();
  const streams = await getStreams();

  if (streams.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-8 text-center">
        <p className="text-sm font-medium">Nothing documented yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Add a file to the Figma documentation project and publish a page from
          the plugin, or run{" "}
          <code className="font-mono text-xs">npm run sync</code>. Each file
          becomes a stream, each of its pages a flow, and the frames on that
          page its screens.
        </p>
      </div>
    );
  }

  let railIndex = 0;

  return (
    <div className="flex flex-col gap-16">
      {streams.map((stream) => (
        <section key={stream.id} id={stream.slug} className="scroll-mt-24">
          {/* The stream names the shelf its flows sit on. A rule under it, so
              two products' worth of rails do not read as one long run. */}
          <h2 className="mb-6 border-b border-border pb-2 text-sm font-medium uppercase tracking-wide text-muted">
            {stream.name}
          </h2>

          <div className="flex flex-col gap-12">
            {stream.flows.map((flow) => (
              <FlowRail
                key={flow.id}
                name={flow.name}
                anchor={flow.anchor}
                screens={flow.screens}
                // Only the very first rail on the page carries the LCP.
                priority={railIndex++ === 0}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Shaped like what lands: a stream heading over rails of frames, at the height
 * they arrive at, so the page does not jump under the reader when the screens
 * resolve.
 */
export function StreamRailsSkeleton() {
  return (
    <div className="flex flex-col gap-16">
      {[0, 1].map((stream) => (
        <div key={stream}>
          <div className="mb-6 h-4 w-40 animate-pulse rounded bg-surface-muted" />
          <div className="flex flex-col gap-12">
            {[0, 1].map((rail) => (
              <div key={rail}>
                <div className="-mx-6 flex gap-4 overflow-hidden px-6 pb-3">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div
                      key={index}
                      className="aspect-[9/16] h-80 shrink-0 animate-pulse rounded-3xl bg-surface-muted sm:h-96 lg:h-[32rem]"
                    />
                  ))}
                </div>
                <div className="mt-1 flex flex-col gap-2">
                  <div className="h-5 w-48 animate-pulse rounded bg-surface-muted" />
                  <div className="h-4 w-20 animate-pulse rounded bg-surface-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
