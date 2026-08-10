import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { getFlows } from "@/lib/queries";

export default function HomePage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Flows</h1>
        <p className="mt-1 text-sm text-muted">
          Every documented flow, synced from the Figma documentation project.
        </p>
      </header>

      <Suspense fallback={<FlowGridSkeleton />}>
        <FlowGrid />
      </Suspense>
    </>
  );
}

async function FlowGrid() {
  // Stop prerendering here. Without this, `use cache` would be filled at build
  // time, making every deploy depend on the database being reachable — for
  // data that only ever changes when a sync runs, never when we deploy. The
  // static shell above still prerenders; this streams in behind Suspense and
  // is cached from the first real request onward.
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
    <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
      {flows.map((flow) => (
        <li key={flow.id}>
          <Link
            href={`/flows/${flow.slug}`}
            className="group flex flex-col gap-3 rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <div className="overflow-hidden rounded-lg border border-border bg-surface-muted transition group-hover:border-accent">
              {flow.coverImageUrl ? (
                <Image
                  src={flow.coverImageUrl}
                  alt=""
                  width={600}
                  height={1200}
                  className="h-auto w-full"
                  sizes="(max-width: 640px) 50vw, 25vw"
                />
              ) : (
                <div className="aspect-[9/16]" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-medium leading-tight">{flow.name}</h2>
              <p className="mt-0.5 text-xs text-muted">
                {flow.screenCount} screen{flow.screenCount === 1 ? "" : "s"}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FlowGridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex flex-col gap-3">
          <div className="aspect-[9/16] animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
        </li>
      ))}
    </ul>
  );
}
