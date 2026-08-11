/**
 * Environment access with fail-fast validation.
 *
 * Server-only. Never import from a Client Component.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See SETUP.md.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/** Figma credentials and scope. Only read by the sync pipeline. */
export const figmaEnv = () => ({
  /**
   * Personal access token. Needs file read AND `file_dev_resources:read` —
   * a token missing the latter syncs "successfully" but silently drops every
   * source link and drift signal. `npm run sync -- --check-token` verifies it.
   */
  accessToken: required("FIGMA_ACCESS_TOKEN"),
  /** The Figma project (folder) used exclusively for documentation. */
  projectId: required("FIGMA_PROJECT_ID"),
  rateLimitPerMin: Number(optional("FIGMA_RATE_LIMIT_PER_MIN", "10")),
  /** Applied to both file names and frame names as a publish escape hatch. */
  ignorePattern: new RegExp(optional("DOCS_IGNORE_PATTERN", "^(_|wip|scratch)"), "i"),
});

/**
 * OAuth client id that lets this site talk to an embedded prototype.
 *
 * Optional, and null is a working state: the embed still plays, it just keeps
 * Figma's own control cluster instead of ours. Setting it is only half the
 * job — the deployed origin has to be registered under the same OAuth app's
 * **Embed API** origins, or Figma drops our messages exactly as if the id were
 * missing. See SETUP.md §1.
 *
 * Not secret: it ends up in the iframe URL either way, and the origin
 * allowlist is what does the actual gating.
 */
export const figmaEmbedClientId = () =>
  process.env.FIGMA_EMBED_CLIENT_ID || null;

export const databaseUrl = () => required("DATABASE_URL");

export const blobToken = () => required("BLOB_READ_WRITE_TOKEN");

export const cronSecret = () => required("CRON_SECRET");

/**
 * Email domain allowed to sign in. Clerk's dashboard allowlist is paid-only on
 * production instances, so this value *is* the access boundary — see
 * `lib/auth.ts` for the rule and the two places that enforce it.
 */
export const allowedEmailDomain = () =>
  optional("ALLOWED_EMAIL_DOMAIN", "flip.id").toLowerCase();
