import { NextResponse } from "next/server";

import { corsHeaders, preflight } from "@/lib/cors";
import { claimPairing, isValidPairingState } from "@/lib/plugin-auth";

/**
 * The plugin's half of pairing: exchange the nonce it generated for the token
 * `/plugin/pair` minted, once.
 *
 * Public by necessity — the caller has no session, which is the problem pairing
 * exists to solve. What protects it is that `state` is 256 bits of plugin-local
 * randomness with a five-minute window and a single use.
 */
export async function OPTIONS() {
  return preflight();
}

export async function POST(request: Request) {
  let state: unknown;
  try {
    ({ state } = await request.json());
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!isValidPairingState(state)) {
    return NextResponse.json(
      { error: "Malformed pairing code." },
      { status: 400, headers: corsHeaders },
    );
  }

  const token = await claimPairing(state);

  // "Not yet confirmed", "already collected" and "expired" are deliberately one
  // response. The plugin polls, then gives up and asks the designer to retry,
  // and none of those cases wants different handling.
  if (!token) {
    return NextResponse.json({ status: "pending" }, { headers: corsHeaders });
  }

  return NextResponse.json({ status: "ready", token }, { headers: corsHeaders });
}
