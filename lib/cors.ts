/**
 * CORS for the two routes a Figma plugin calls.
 *
 * A plugin's UI iframe has an opaque `null` origin, and a POST carrying
 * `Authorization` plus `application/json` is not a simple request — so the
 * browser sends a preflight first. Without an `OPTIONS` handler the fetch fails
 * with an opaque network error and *no server-side log at all*, which is a
 * miserable thing to debug.
 *
 * `*` is safe here because these routes authenticate with a bearer token and
 * never read cookies: there is no ambient authority for another origin to
 * borrow. (`*` and credentialed requests are mutually exclusive anyway.)
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
} as const;

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
