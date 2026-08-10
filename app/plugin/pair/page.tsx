import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { sessionEmail } from "@/lib/auth";
import { isValidPairingState } from "@/lib/plugin-auth";
import { PairForm } from "./pair-form";

/**
 * Where the Figma plugin sends the browser to pair.
 *
 * Not listed in `proxy.ts`'s `isPublic`, so reaching this page already required
 * a Clerk session inside the allowed domain — which is the whole point. The
 * plugin never sees a password or a shared secret; it only collects the token
 * this page mints.
 */
export default function PluginPairPage({
  searchParams,
}: PageProps<"/plugin/pair">) {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect the Figma plugin
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          This gives the plugin on this computer permission to publish flows as
          you. It can be revoked at any time from{" "}
          <a href="/admin" className="underline">
            Admin
          </a>
          .
        </p>
      </header>

      <Suspense fallback={<p className="text-sm text-muted">Checking…</p>}>
        <Pairing searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Pairing({
  searchParams,
}: {
  searchParams: PageProps<"/plugin/pair">["searchParams"];
}) {
  await connection();

  const { state } = await searchParams;
  if (!isValidPairingState(state)) {
    return (
      <p className="max-w-prose text-sm text-warning">
        This link is missing a valid pairing code. Open the plugin in Figma and
        press Connect there — it will reopen this page with the right link.
      </p>
    );
  }

  const { sessionClaims } = await auth();
  const email = sessionEmail(sessionClaims);
  if (email === null) {
    // The proxy already let this request through, so a missing claim here is
    // the misconfiguration `logMissingClaim` describes rather than a denial.
    return (
      <p className="max-w-prose text-sm text-warning">
        Your session is missing its email claim, so pairing cannot record who
        this token belongs to. See SETUP.md.
      </p>
    );
  }

  return <PairForm pairingState={state} email={email} />;
}
