import { auth } from "@clerk/nextjs/server";

import { checkSessionAccess, logMissingClaim } from "@/lib/auth";
import { getClipBlobUrl } from "@/lib/clips";

/**
 * Stream a stored clipboard payload back to the browser, for the
 * "Copy to Figma" button to put on the clipboard.
 *
 * Proxied rather than pointing the button straight at the Blob URL. Blob's
 * public URLs are unguessable but not access-controlled, and a documented
 * screen's full layer data is exactly as sensitive as the screenshot beside
 * it — so it goes through the same session boundary as the rest of the site.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/clips/[screenId]">,
) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // Repeated here rather than trusted from `proxy.ts`, per `lib/auth.ts`:
  // proxy is an optimistic redirect, not the authorization layer.
  const access = checkSessionAccess(sessionClaims);
  if (access === "missing-claim") logMissingClaim("GET /api/clips/[screenId]");
  if (access !== "allowed") return new Response("Forbidden", { status: 403 });

  const { screenId } = await context.params;
  const blobUrl = await getClipBlobUrl(screenId);
  if (!blobUrl) return new Response("No clip for this screen", { status: 404 });

  const upstream = await fetch(blobUrl);
  if (!upstream.ok || !upstream.body) {
    console.error(`[clips] blob fetch failed for ${screenId}: ${upstream.status}`);
    return new Response("Clip is unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      // The payload is content-addressed in Blob and this route is
      // session-scoped, so it caches privately and revalidates on recapture.
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
