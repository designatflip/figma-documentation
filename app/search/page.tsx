import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { ScreenCard } from "@/components/screen-card";
import { searchScreens } from "@/lib/queries";

type Props = PageProps<"/search">;

export default function SearchPage({ searchParams }: Props) {
  return (
    <>
      {/* Static shell — prerendered and served instantly from the CDN. */}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-muted">
          Matches screen names, descriptions, and the copy inside each screen.
        </p>
      </header>

      <Suspense fallback={<p className="text-sm text-muted">Searching…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: Props["searchParams"] }) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  if (!query) {
    return (
      <p className="text-sm text-muted">
        Try a product term, a screen name, or a phrase you remember seeing in
        the UI.
      </p>
    );
  }

  await connection();
  const hits = await searchScreens(query);

  if (hits.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-8 text-center">
        <p className="text-sm font-medium">No screens matched “{query}”</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Search covers documented screens only. If you expect this screen to be
          here, check that its file is in the Figma documentation project and
          that a sync has run since.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {hits.length} screen{hits.length === 1 ? "" : "s"} matching “{query}”
      </p>
      <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {hits.map((hit) => (
          <li key={hit.id}>
            <ScreenCard
              id={hit.id}
              name={hit.name}
              imageUrl={hit.imageUrl}
              imageWidth={hit.imageWidth}
              imageHeight={hit.imageHeight}
              subtitle={hit.flowName}
              snippetHtml={hit.snippet}
              query={query}
            />
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted">
        Looking for something older?{" "}
        <Link href="/" className="underline hover:text-foreground">
          Browse all flows
        </Link>
        .
      </p>
    </>
  );
}
