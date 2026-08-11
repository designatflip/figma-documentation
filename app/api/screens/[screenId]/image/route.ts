import { auth } from "@clerk/nextjs/server";

import { checkSessionAccess, logMissingClaim } from "@/lib/auth";
import { getScreenById } from "@/lib/queries";

/** Keeps a screen name usable as a filename on every OS. */
function filename(name: string): string {
  const safe = name.replace(/[^\w.\- ]+/g, " ").trim() || "screen";
  return `${safe}.png`;
}

/**
 * Stream a screen's render back to the browser, for "Save image" and
 * "Copy image".
 *
 * Proxied for the same reason the clip is: Blob's public URLs are unguessable
 * but not access-controlled, so the download goes through the session boundary
 * the rest of the site sits behind. Serving it same-origin is also what makes
 * the two buttons work at all — `download` is ignored on a cross-origin link,
 * and a clipboard write needs a blob the page is allowed to read.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/screens/[screenId]/image">,
) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // Repeated here rather than trusted from `proxy.ts`, per `lib/auth.ts`:
  // proxy is an optimistic redirect, not the authorization layer.
  const access = checkSessionAccess(sessionClaims);
  if (access === "missing-claim")
    logMissingClaim("GET /api/screens/[screenId]/image");
  if (access !== "allowed") return new Response("Forbidden", { status: 403 });

  const { screenId } = await context.params;
  const screen = await getScreenById(screenId);
  if (!screen?.imageUrl)
    return new Response("No render for this screen", { status: 404 });

  const upstream = await fetch(screen.imageUrl);
  if (!upstream.ok || !upstream.body) {
    console.error(
      `[screens] render fetch failed for ${screenId}: ${upstream.status}`,
    );
    return new Response("Render is unavailable", { status: 502 });
  }

  // Only the save link asks for a download; the copy button wants the bytes
  // in the page, and an attachment header there would be noise.
  const download = new URL(request.url).searchParams.has("download");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "image/png",
      ...(download && {
        "Content-Disposition": `attachment; filename="${filename(screen.name)}"`,
      }),
      // The Blob pathname is content-addressed and this route is
      // session-scoped, so it caches privately and revalidates on re-sync.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
