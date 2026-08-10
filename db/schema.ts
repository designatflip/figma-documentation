import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres `tsvector`. Drizzle has no native type for it. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * A flow is a Figma *file* inside the documentation project.
 *
 * There is deliberately no separate `figma_files` table — publishing a flow
 * means creating a file in the project, so the two concepts are one row.
 */
export const flows = pgTable(
  "flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileKey: text("file_key").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    thumbnailUrl: text("thumbnail_url"),

    /**
     * Figma's `last_modified` for this file, as reported by the project
     * listing. The change gate: when this is unchanged we skip the file
     * entirely without a single further request.
     */
    lastModified: timestamp("last_modified", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    syncStatus: text("sync_status").notNull().default("pending"),
    syncError: text("sync_error"),

    position: integer("position").notNull().default(0),

    /** Set when the file leaves the project. Never hard-deleted. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("flows_file_key_idx").on(t.fileKey),
    uniqueIndex("flows_slug_idx").on(t.slug),
    index("flows_archived_at_idx").on(t.archivedAt),
  ],
);

export const screens = pgTable(
  "screens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),

    /** Figma node id of the documented frame, e.g. "42:1". */
    nodeId: text("node_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Page name within the flow file. Optional sub-grouping. */
    section: text("section"),
    /** Sourced from Figma's `devStatus.description`, not authored here. */
    description: text("description"),

    imageUrl: text("image_url"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    /** sha256 of the rendered PNG. Lets a re-sync skip the Blob write. */
    imageHash: text("image_hash"),

    figmaUrl: text("figma_url").notNull(),

    // --- Origin, from a Figma Dev Resource attached to the docs frame ---
    sourceFileKey: text("source_file_key"),
    sourceNodeId: text("source_node_id"),
    sourceUrl: text("source_url"),
    /** Hash of the *source* node subtree, for structural drift over time. */
    sourceHash: text("source_hash"),
    /** Text extracted from the *source* node, for immediate content drift. */
    sourceText: text("source_text"),
    driftState: text("drift_state").notNull().default("unknown"),
    driftCheckedAt: timestamp("drift_checked_at", { withTimezone: true }),

    /** Every visible TEXT node, reading order, newline-joined. */
    textContent: text("text_content"),

    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(name, '')), 'A')
       || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
       || setweight(to_tsvector('simple', coalesce(text_content, '')), 'C')`,
    ),

    position: integer("position").notNull().default(0),

    /**
     * The only publish state, and it is derived, never authored. A screen is
     * live iff Figma still lists it in the project.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("screens_flow_node_idx").on(t.flowId, t.nodeId),
    index("screens_flow_id_idx").on(t.flowId),
    index("screens_archived_at_idx").on(t.archivedAt),
    // Drift checks group by source file, so this is the access path.
    index("screens_source_file_key_idx").on(t.sourceFileKey),
    index("screens_search_vector_idx").using("gin", t.searchVector),
  ],
);

/**
 * One row per TEXT node, with coordinates normalised 0–1 against the frame's
 * own bounding box. Powers highlight overlays on the screenshot.
 */
export const screenTexts = pgTable(
  "screen_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screens.id, { onDelete: "cascade" }),
    nodeId: text("node_id"),
    content: text("content").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    w: real("w").notNull(),
    h: real("h").notNull(),
  },
  (t) => [index("screen_texts_screen_id_idx").on(t.screenId)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [uniqueIndex("tags_slug_idx").on(t.slug)],
);

export const screenTags = pgTable(
  "screen_tags",
  {
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screens.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.screenId, t.tagId] })],
);

/**
 * A single-row mutual exclusion lease for sync runs.
 *
 * A sync spends Figma rate-limit quota and rewrites the catalogue, so two at
 * once is never wanted — and once designers can trigger one from a plugin,
 * concurrent runs stop being hypothetical.
 *
 * A lease rather than `pg_advisory_lock` because that lock is session-scoped:
 * holding one across a multi-minute run would mean pinning a pooled connection
 * and sitting idle-in-transaction for the duration. The holder renews while it
 * works, so a crashed run frees the lease by simply going quiet.
 */
export const syncLocks = pgTable("sync_locks", {
  /** Always `sync`. The table holds exactly one row. */
  id: text("id").primaryKey(),
  /** Identifies the holder, so only it can release. */
  token: uuid("token").notNull(),
  /** Who started it: `cron`, or the email behind the action or plugin call. */
  startedBy: text("started_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  /** Renewed while the run works. Past this, the lease is up for grabs. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * A Figma plugin cannot hold a Clerk session, so it carries a bearer token
 * minted for one person through the browser pairing flow in `/plugin/pair`.
 *
 * The row doubles as the pairing record. It is created the moment someone
 * confirms pairing, carrying `pickupToken` in the clear so the plugin — which
 * has no session and can only prove it knows `pairingState` — can collect it
 * exactly once. Both columns are nulled on collection, after which only
 * `tokenHash` remains and the plaintext is unrecoverable.
 */
export const pluginTokens = pgTable(
  "plugin_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** sha256 of the bearer token. Null until the plugin collects it. */
    tokenHash: text("token_hash"),

    /**
     * The plugin-generated nonce that ties a browser pairing to the plugin
     * instance that started it. Nulled on collection so it cannot be replayed.
     */
    pairingState: text("pairing_state"),
    /** Plaintext, readable once. Nulled on collection. */
    pickupToken: text("pickup_token"),
    pickupExpiresAt: timestamp("pickup_expires_at", { withTimezone: true }),

    /**
     * Identity, captured at pairing. `email` is re-checked against the allowed
     * domain on every request rather than trusted from here, so someone who
     * leaves loses plugin access without anyone revoking the row by hand.
     */
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("plugin_tokens_token_hash_idx").on(t.tokenHash),
    uniqueIndex("plugin_tokens_pairing_state_idx").on(t.pairingState),
    index("plugin_tokens_clerk_user_id_idx").on(t.clerkUserId),
  ],
);

export type Flow = typeof flows.$inferSelect;
export type Screen = typeof screens.$inferSelect;
export type ScreenText = typeof screenTexts.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type PluginToken = typeof pluginTokens.$inferSelect;

/** `unknown` also covers "source file unreadable" — never an error state. */
export type DriftState =
  | "unknown"
  | "in_sync"
  | "content_changed"
  | "source_changed";
