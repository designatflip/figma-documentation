import { sql } from "drizzle-orm";
import {
  boolean,
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

/**
 * A prototype entry point in a flow file — one row per "Flow starting point"
 * pin Figma reports on a page.
 *
 * Rows exist only for starting points that land inside a published screen, so
 * the presence of a row is exactly the question the screen view asks: is there
 * a prototype worth offering here? Like everything else in the catalogue this is
 * derived from Figma on every sync and never authored.
 */
export const flowPrototypes = pgTable(
  "flow_prototypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),

    /** Figma node id of the frame the prototype starts on. */
    nodeId: text("node_id").notNull(),
    /**
     * The published screen containing that frame — usually the same node, but
     * a starting point can sit on a nested frame. Resolved during extraction,
     * where the tree is in hand, so the site can show the entry screen without
     * guessing at the hierarchy.
     */
    screenNodeId: text("screen_node_id").notNull(),
    /** The starting point's label in Figma. Defaults to "Flow 1" there. */
    name: text("name").notNull(),
    /** Page name within the flow file, matching `screens.section`. */
    section: text("section"),

    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("flow_prototypes_flow_node_idx").on(t.flowId, t.nodeId),
    index("flow_prototypes_flow_id_idx").on(t.flowId),
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

    /**
     * Whether anything on the frame is wired to navigate elsewhere. A screen
     * with nothing to tap is the end of its flow, which is how the prototype
     * player knows to drop the forward arrow.
     *
     * Defaults true — the arrow shows — so a database that has not been
     * re-synced since this column landed behaves as it did before rather than
     * hiding controls on every screen at once.
     */
    navigates: boolean("navigates").notNull().default(true),

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

/**
 * One row per wired-up layer on a frame — the buttons, rows and cards a viewer
 * can act on — with coordinates normalised 0–1 against the frame's bounding
 * box, like `screen_texts`. Powers the hotspot overlay on the render.
 *
 * Rows are absent, not empty, for a screen synced before this table existed.
 * The overlay simply draws nothing until that flow is re-synced, which is the
 * same shape of degradation `navigates` was given a default for.
 */
export const screenHotspots = pgTable(
  "screen_hotspots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screens.id, { onDelete: "cascade" }),
    nodeId: text("node_id"),
    /** The layer's name in Figma, shown on hover. */
    name: text("name"),
    x: real("x").notNull(),
    y: real("y").notNull(),
    w: real("w").notNull(),
    h: real("h").notNull(),
    /** Figma's trigger type, e.g. `ON_CLICK`. Null on legacy wiring. */
    trigger: text("trigger"),
    /**
     * Figma node the interaction leads to. Kept as the node id rather than a
     * screen reference: it often points at a nested frame or an overlay that is
     * not a documented screen of its own, so a foreign key would have to drop
     * exactly the hotspots that are hardest to explain without one.
     */
    destinationNodeId: text("destination_node_id"),
  },
  (t) => [index("screen_hotspots_screen_id_idx").on(t.screenId)],
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
 * A captured Figma clipboard payload, so the site can offer "copy this screen
 * into my file" and have it paste as real layers.
 *
 * One row per screen, hence `screen_id` as the primary key. The payload itself
 * lives in Blob: it runs to hundreds of kilobytes for one frame, and it is
 * only ever fetched whole by the button that puts it on the clipboard.
 *
 * These rows outlive a sync — `screens` is upserted on `(flow_id, node_id)`
 * and archived rather than deleted, so the id a clip points at is stable.
 */
export const screenClips = pgTable("screen_clips", {
  screenId: uuid("screen_id")
    .primaryKey()
    .references(() => screens.id, { onDelete: "cascade" }),

  blobUrl: text("blob_url").notNull(),
  /** sha256 of the payload. Content-addresses the blob, so re-capture of an
   * unchanged frame rewrites the same bytes to the same path. */
  contentHash: text("content_hash").notNull(),
  byteSize: integer("byte_size").notNull(),

  /**
   * `screens.image_hash` at the moment of capture.
   *
   * The payload is a snapshot and cannot re-sync itself, so this is how the
   * site knows a clip has fallen behind the design: the rendered PNG's hash
   * changes exactly when the frame's appearance does.
   */
  capturedImageHash: text("captured_image_hash"),

  /** Who pasted it in. Capture is a manual act and worth attributing. */
  capturedByEmail: text("captured_by_email").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
export type FlowPrototype = typeof flowPrototypes.$inferSelect;
export type Screen = typeof screens.$inferSelect;
export type ScreenText = typeof screenTexts.$inferSelect;
export type ScreenHotspot = typeof screenHotspots.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type PluginToken = typeof pluginTokens.$inferSelect;
export type ScreenClip = typeof screenClips.$inferSelect;

/** `unknown` also covers "source file unreadable" — never an error state. */
export type DriftState =
  | "unknown"
  | "in_sync"
  | "content_changed"
  | "source_changed";
