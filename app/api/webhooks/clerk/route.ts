import { clerkClient } from "@clerk/nextjs/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/auth";
import { allowedEmailDomain } from "@/lib/env";

/**
 * Deletes accounts created outside the allowed email domain.
 *
 * Restricted mode in the Clerk dashboard already stops open sign-ups, so this
 * is the second lock, not the first: it covers restricted mode being turned off
 * by accident, an invitation forwarded to a personal address, and any future SSO
 * connection that hands us a domain we did not expect.
 *
 * Deleting rather than merely denying keeps the Clerk user list equal to the
 * set of people who can actually sign in — otherwise stray accounts accumulate
 * and every audit of "who has access" has to re-derive the domain rule by hand.
 *
 * Webhooks are eventually consistent, so a rejected account may exist for a few
 * seconds. That is harmless here: `proxy.ts` refuses the session on every
 * request regardless of whether this handler has run yet.
 */
export async function POST(request: NextRequest) {
  let event;
  try {
    // Reads CLERK_WEBHOOK_SIGNING_SECRET itself and throws on a bad signature.
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("[clerk-webhook] verification failed:", error);
    return new Response("Verification failed", { status: 400 });
  }

  if (event.type !== "user.created") {
    return new Response("Ignored", { status: 200 });
  }

  const { id, email_addresses, primary_email_address_id } = event.data;

  // The primary address is what `{{user.primary_email_address}}` puts in the
  // session token, so match on the same one — index 0 is not always primary.
  const primary =
    email_addresses.find((address) => address.id === primary_email_address_id) ??
    email_addresses[0];

  if (isAllowedEmail(primary?.email_address)) {
    return new Response("OK", { status: 200 });
  }

  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUser(id);
    console.warn(
      `[clerk-webhook] deleted ${id}: ${primary?.email_address ?? "no address"} ` +
        `is not @${allowedEmailDomain()}`,
    );
  } catch (error) {
    // 5xx so Svix retries — a surviving off-domain account is worth another go.
    console.error(`[clerk-webhook] could not delete ${id}:`, error);
    return new Response("Delete failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
