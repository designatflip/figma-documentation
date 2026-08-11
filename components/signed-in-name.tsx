import { auth } from "@clerk/nextjs/server";

import { displayNameFromEmail, sessionEmail } from "@/lib/auth";

/**
 * The signed-in person's name, next to their avatar in the header.
 *
 * Reads the session token, so it is a runtime read and belongs inside a
 * Suspense boundary — the rest of the header prerenders around it.
 */
export async function SignedInName() {
  const { sessionClaims } = await auth();
  const email = sessionEmail(sessionClaims);

  // proxy.ts denies a session without the claim, so this is belt and braces.
  if (email === null) return null;

  return <span className="text-muted">{displayNameFromEmail(email)}</span>;
}
