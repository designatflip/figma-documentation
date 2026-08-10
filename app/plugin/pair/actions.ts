"use server";

import { auth } from "@clerk/nextjs/server";

import { checkSessionAccess, logMissingClaim, sessionEmail } from "@/lib/auth";
import { createPairing, isValidPairingState } from "@/lib/plugin-auth";

export interface PairActionResult {
  ok: boolean;
  message: string;
}

/**
 * Mint a plugin token for the signed-in person.
 *
 * Deliberately behind a button rather than run on page load: this hands out a
 * credential, and the URL that reaches it is one the plugin asks the browser to
 * open. A link someone was tricked into following must not silently pair a
 * plugin instance they do not control.
 */
export async function pairPluginAction(
  pairingState: string,
): Promise<PairActionResult> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
  }

  // Repeated here rather than trusted from `proxy.ts`, for the same reason the
  // admin action repeats it: a Server Action is a POST to an arbitrary
  // endpoint, and this one grants standing access to the sync pipeline.
  const access = checkSessionAccess(sessionClaims);
  if (access === "missing-claim") logMissingClaim("pairPluginAction");
  if (access !== "allowed") {
    return { ok: false, message: "Not authorised." };
  }

  const email = sessionEmail(sessionClaims);
  if (email === null) {
    return { ok: false, message: "Not authorised." };
  }

  if (!isValidPairingState(pairingState)) {
    return { ok: false, message: "That pairing link is malformed. Start again from the plugin." };
  }

  await createPairing({ pairingState, clerkUserId: userId, email });

  return {
    ok: true,
    message: "Paired. Return to Figma — the plugin should be connected.",
  };
}
