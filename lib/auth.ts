import { allowedEmailDomain } from "@/lib/env";

/**
 * Access control.
 *
 * Clerk's domain allowlist needs a paid plan on production instances (SETUP.md),
 * so this module — not the Clerk dashboard — is the boundary. Every enforcement
 * point calls `checkSessionAccess` so there is exactly one rule to reason about.
 *
 * Reading the domain from the session token means no per-request call to Clerk.
 * The cost is a dependency on the `email` custom claim being configured, which
 * is why "no claim" is a distinct outcome worth logging rather than a silent no.
 */

export type AccessCheck =
  /** Claim present and inside the allowed domain. */
  | "allowed"
  /** Claim present, wrong domain. Expected and uninteresting — do not log. */
  | "wrong-domain"
  /**
   * No `email` claim on the token. Always a misconfiguration: either Clerk →
   * Sessions → Customize session token was never set up, or it was changed.
   * Denied like any other failure, but loudly, because nobody can sign in.
   */
  | "missing-claim";

/**
 * The rule itself. Also used by the Clerk webhook, which sees an address from
 * the event payload rather than a session token.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string" || email.length === 0) return false;
  return email.toLowerCase().endsWith(`@${allowedEmailDomain()}`);
}

/** The `email` custom claim, or null when it was never configured. */
export function sessionEmail(sessionClaims: unknown): string | null {
  const email = (sessionClaims as { email?: string } | null | undefined)?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

/**
 * A human name for the header, built from the address rather than from a Clerk
 * profile: everyone signs in with Google Workspace, where the local part is
 * `first.last` by policy, and the session token already carries it — so this
 * costs no request to Clerk. Anything that does not split into words (a shared
 * mailbox, say) falls back to the address itself.
 */
export function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0].split("+")[0];
  const words = localPart.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return email;

  return words
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function checkSessionAccess(sessionClaims: unknown): AccessCheck {
  const email = sessionEmail(sessionClaims);
  if (email === null) return "missing-claim";

  return isAllowedEmail(email) ? "allowed" : "wrong-domain";
}

export function logMissingClaim(where: string): void {
  console.error(
    `[auth] ${where}: session token carries no \`email\` claim. Set it in ` +
      "Clerk → Sessions → Customize session token (see SETUP.md). Denying access.",
  );
}
