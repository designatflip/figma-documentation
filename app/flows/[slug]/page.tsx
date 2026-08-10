import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ScreenCard } from "@/components/screen-card";
import { getFlowBySlug } from "@/lib/queries";

type Props = PageProps<"/flows/[slug]">;

/**
 * `params` is deliberately not awaited here. Awaiting it in the page body
 * would put request data outside the Suspense boundary and make the whole
 * route blocking; passing the promise down keeps the shell prerenderable.
 */
export default function FlowPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading flow…</p>}>
      <FlowContent params={params} />
    </Suspense>
  );
}

async function FlowContent({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  // See app/page.tsx: keeps the build independent of the database.
  await connection();

  const flow = await getFlowBySlug(slug);
  if (!flow) notFound();

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

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{flow.name}</h1>
        {flow.lastSyncedAt && (
          <p className="mt-1 text-sm text-muted">
            Last synced {flow.lastSyncedAt.toLocaleDateString()}
          </p>
        )}
      </header>

      {flow.sections.map((section, index) => (
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
