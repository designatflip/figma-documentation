import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PrototypePlayer } from "@/components/prototype-player";
import { ScreenCard } from "@/components/screen-card";
import { getFlowBySlug } from "@/lib/queries";

type Props = PageProps<"/flows/[slug]">;

/**
 * `params` is deliberately not awaited here. Awaiting it in the page body
 * would put request data outside the Suspense boundary and make the whole
 * route blocking; passing the promise down keeps the shell prerenderable.
 */
export default function FlowPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading flow…</p>}>
      <FlowContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function FlowContent({ params, searchParams }: Props) {
  const { slug } = await params;
  const { view, start } = await searchParams;
  // See app/page.tsx: keeps the build independent of the database.
  await connection();

  const flow = await getFlowBySlug(slug);
  if (!flow) notFound();

  const hasPrototype = flow.prototypes.length > 0;
  // A shared `?view=prototype` link outlives the prototype it pointed at —
  // starting points come and go in Figma — so the screens are the fallback
  // rather than an empty state explaining what used to be here.
  const showPrototype = hasPrototype && view === "prototype";

  const hasSections =
    flow.sections.length > 1 || flow.sections.some((s) => s.name);

  return (
    <>
      <nav className="mb-2 text-sm">
        <Link href="/" className="text-muted hover:text-foreground">
          Flows
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span>{flow.name}</span>
      </nav>

      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{flow.name}</h1>
          {flow.lastSyncedAt && (
            <p className="mt-1 text-sm text-muted">
              Last synced {flow.lastSyncedAt.toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Absent, not disabled, when nobody has pinned a starting point in
            Figma — there is nothing to switch to. */}
        {hasPrototype && (
          <div className="inline-flex shrink-0 gap-1 rounded-full bg-surface-muted p-1">
            <ViewTab href={`/flows/${flow.slug}`} active={!showPrototype}>
              Screens
            </ViewTab>
            <ViewTab
              href={`/flows/${flow.slug}?view=prototype`}
              active={showPrototype}
            >
              Prototype
            </ViewTab>
          </div>
        )}
      </header>

      {showPrototype && (
        <PrototypePlayer
          flowName={flow.name}
          flowSlug={flow.slug}
          fileKey={flow.fileKey}
          prototypes={flow.prototypes}
          selectedNodeId={typeof start === "string" ? start : undefined}
          flowEndNodeIds={flow.flowEndNodeIds}
        />
      )}

      {!showPrototype &&
        flow.sections.map((section, index) => (
          <section key={section.name ?? index} className="mb-10">
            {hasSections && section.name && (
              <h2 className="mb-4 text-sm font-medium text-muted">
                {section.name}
              </h2>
            )}
            <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
              {section.screens.map((screen) => (
                <li key={screen.id}>
                  <ScreenCard
                    id={screen.id}
                    name={screen.name}
                    imageUrl={screen.imageUrl}
                    imageWidth={screen.imageWidth}
                    imageHeight={screen.imageHeight}
                    driftState={screen.driftState}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}

function ViewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "rounded-full px-3.5 py-1 text-sm font-medium transition " +
        (active
          ? "bg-surface-raised text-foreground shadow-sm"
          : "text-muted hover:text-foreground")
      }
    >
      {children}
    </Link>
  );
}
