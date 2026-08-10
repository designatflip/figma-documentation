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

export const databaseUrl = () => required("DATABASE_URL");

export const blobToken = () => required("BLOB_READ_WRITE_TOKEN");

export const cronSecret = () => required("CRON_SECRET");

/**
 * Email domain allowed to sign in. Enforced in `proxy.ts` in addition to the
 * Clerk dashboard restriction, so a dashboard misconfiguration cannot silently
 * open the site up.
 */
export const allowedEmailDomain = () =>
  optional("ALLOWED_EMAIL_DOMAIN", "flip.id").toLowerCase();
