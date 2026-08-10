import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { checkSessionAccess, logMissingClaim } from "@/lib/auth";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. Same execution model.
 */

/**
 * Routes that carry their own authentication, or none:
 *
 * - `/api/sync` and `/api/webhooks/*` authenticate inside the handler
 *   (`CRON_SECRET` and a Svix signature). Neither caller can present a session.
 * - `/sign-in`, `/sign-up` and `/not-authorized` must stay reachable signed out,
 *   or the redirect below loops.
 *
 * Plain string comparison rather than Clerk's `createRouteMatcher`, which is
 * deprecated in v7. Clerk's migration guide keeps `clerkMiddleware()` and points
 * at `req.nextUrl.pathname` for exactly this kind of non-auth routing.
 */
function isPublic(pathname: string): boolean {
  return (
    pathname === "/api/sync" ||
    pathname === "/not-authorized" ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up")
  );
}

export default clerkMiddleware(async (auth, request) => {
  if (isPublic(request.nextUrl.pathname)) return;

  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return (await auth()).redirectToSignIn();
  }

  // The optimistic check — it makes the whole site redirect cleanly rather than
  // render for someone who should not see it. Next's docs are explicit that
  // proxy is not an authorization layer, so anything that acts on data (the
  // admin Server Action) repeats `checkSessionAccess` where it runs.
  const access = checkSessionAccess(sessionClaims);
  if (access === "missing-claim") logMissingClaim("proxy");
  if (access !== "allowed") {
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
