import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { DriftBadge, hasDriftLabel } from "@/components/drift-badge";
import { ScreenImage } from "@/components/screen-image";
import { getScreenById } from "@/lib/queries";

type Props = PageProps<"/screens/[id]">;

export default function ScreenPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading screen…</p>}>
      <ScreenContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ScreenContent({ params, searchParams }: Props) {
  const { id } = await params;
  const { q } = await searchParams;
  const highlight = typeof q === "string" ? q : undefined;

  await connection();

  const screen = await getScreenById(id);
  if (!screen) notFound();

  return (
    <>
      <nav className="mb-4 text-sm">
        <Link href="/" className="text-muted hover:text-foreground">
          Flows
        </Link>
        <span className="mx-2 text-muted">/</span>
        <Link
          href={`/flows/${screen.flowSlug}`}
          className="text-muted hover:text-foreground"
        >
          {screen.flowName}
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span>{screen.name}</span>
      </nav>

      {screen.archivedAt && (
        <div className="mb-6 rounded-lg border border-border bg-surface-muted p-4">
          <p className="text-sm font-medium">No longer published</p>
          <p className="mt-1 text-sm text-muted">
            This screen was removed from the Figma documentation project on{" "}
            {screen.archivedAt.toLocaleDateString()}. It is kept so existing
            links stay meaningful, and it no longer appears in listings or
            search.
          </p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ScreenImage
          src={screen.imageUrl}
          alt={screen.name}
          width={screen.imageWidth}
          height={screen.imageHeight}
          texts={screen.texts}
          highlight={highlight}
          priority
        />

        <aside className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {screen.name}
            </h1>
            {screen.section && (
              <p className="mt-1 text-sm text-muted">{screen.section}</p>
            )}
          </div>

          {screen.description && (
            <div>
              <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Description
              </h2>
              <p className="text-sm leading-relaxed">{screen.description}</p>
            </div>
          )}

          {/*
            Both halves open the same documented frame — only Figma's viewing
            mode differs — so they are paired rather than stacked as peers.
            The source design is a different node in a different file and
            belongs with the drift badge below, not here.
          */}
          <div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Open in Figma
            </h2>
            <div className="flex overflow-hidden rounded-lg border border-border">
              <a
                href={screen.figmaUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 border-r border-border px-3 py-2 text-center text-sm font-medium hover:bg-surface-muted"
              >
                Design <span aria-hidden>↗</span>
              </a>
              <a
                href={`${screen.figmaUrl}&m=dev`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 px-3 py-2 text-center text-sm font-medium hover:bg-surface-muted"
              >
                Dev mode <span aria-hidden>↗</span>
              </a>
            </div>
          </div>

          {/*
            `sourceUrl` is absent when the docs frame has no Dev Resource
            attached, and the badge is absent unless drift was detected —
            so the whole block collapses rather than leaving a stray gap.
          */}
          {(hasDriftLabel(screen.driftState) || screen.sourceUrl) && (
            <div className="flex flex-col items-start gap-2">
              <DriftBadge
                state={screen.driftState}
                checkedAt={screen.driftCheckedAt}
              />
              {screen.sourceUrl && (
                <a
                  href={screen.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
                >
                  View source design <span aria-hidden>↗</span>
                </a>
              )}
            </div>
          )}

          {screen.textContent && (
            <div>
              <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Copy in this screen
              </h2>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-muted p-3 font-sans text-xs leading-relaxed">
                {screen.textContent}
              </pre>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
