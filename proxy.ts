import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { allowedEmailDomain } from "@/lib/env";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. Same execution model.
 */

/**
 * The cron target authenticates with `CRON_SECRET` inside the route handler,
 * so it must bypass Clerk entirely — Vercel Cron cannot present a session.
 */
const isPublic = createRouteMatcher([
  "/api/sync",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/not-authorized",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublic(request)) return;

  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return (await auth()).redirectToSignIn();
  }

  // Defence in depth. The primary control is the domain allowlist configured
  // in the Clerk dashboard; this catches a dashboard misconfiguration.
  //
  // Requires an `email` custom claim on the session token (see SETUP.md).
  // When the claim is absent we deliberately do NOT block — otherwise a
  // missing claim configuration locks out the entire team, and the dashboard
  // restriction is still enforcing the real boundary.
  const email = (sessionClaims as { email?: string } | null)?.email;
  if (email && !email.toLowerCase().endsWith(`@${allowedEmailDomain()}`)) {
    return NextResponse.redirect(new URL("/not-authorized", request.url));
  }
});

export const config = {
  matcher: [
    // Everything except Next internals and static assets, which never need auth.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
