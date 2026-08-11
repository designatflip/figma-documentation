import { connection } from "next/server";

import { FlowRail } from "@/components/flow-rail";
import { getFlows } from "@/lib/queries";

/**
 * The catalogue: every flow as a rail, which is what the home page is.
 *
 * Its own component rather than part of `app/page`, because the screen route
 * renders it too — a link opened cold lands on the listing with the screen's
 * lightbox over it, so a reload looks like what it interrupted. See
 * `app/screens/[id]/page`.
 */
export async function FlowRails() {
  // Stop prerendering here. Without this, `use cache` would be filled at build
  // time, making every deploy depend on the database being reachable — for
  // data that only ever changes when a sync runs, never when we deploy. The
  // static shell around this still prerenders; this streams in behind Suspense
  // and is cached from the first real request onward.
  await connection();
  const flows = await getFlows();

  if (flows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-8 text-center">
        <p className="text-sm font-medium">Nothing documented yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Add a file to the Figma documentation project and run{" "}
          <code className="font-mono text-xs">npm run sync</code>. Each file
          becomes a flow and its frames become screens.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {flows.map((flow, index) => (
        <FlowRail
          key={flow.id}
          name={flow.name}
          slug={flow.slug}
          screens={flow.screens}
          priority={index === 0}
        />
      ))}
    </div>
  );
}

/**
 * Shaped like what lands: rails of frames, at the height they arrive at, so the
 * page does not jump under the reader when the screens resolve.
 */
export function FlowRailsSkeleton() {
  return (
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
  );
}
