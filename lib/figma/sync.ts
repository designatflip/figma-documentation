import { del, put } from "@vercel/blob";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { flows, screens, screenTexts } from "@/db/schema";
import { blobToken, figmaEnv } from "@/lib/env";
import { FigmaClient } from "./client";
import { checkDrift } from "./drift";
import {
  type ExtractedFrame,
  extractFrame,
  figmaUrl,
  findScreenFrames,
  parseFigmaUrl,
  sha256,
  slugify,
} from "./extract";
import type { FigmaNode, ProjectFile } from "./types";

/** Node ids per images request. Keeps URLs well under any length limit. */
const IMAGE_CHUNK_SIZE = 50;

/** Figma refuses to render above 32 megapixels. */
const MAX_MEGAPIXELS = 32_000_000;

/**
 * A single sync run would have to archive more than this share of a flow's
 * live screens for us to suspect a moved file or a partial API response
 * rather than a real bulk unpublish.
 */
const MASS_ARCHIVE_RATIO = 0.5;

export interface SyncOptions {
  /** Re-sync files whose `last_modified` is unchanged. */
  force?: boolean;
  /** Resolve and report everything, write nothing. */
  dryRun?: boolean;
  allowMassArchive?: boolean;
  /** Limit the run to one flow file. */
  onlyFileKey?: string;
  /** Skip the drift pass (it is the slowest stage). */
  skipDrift?: boolean;
  onLog?: (message: string) => void;
}

export interface SyncSummary {
  flowsChecked: number;
  flowsSkipped: number;
  flowsSynced: number;
  screensRendered: number;
  blobWrites: number;
  screensArchived: number;
  driftFlagged: number;
  requestCount: number;
  errors: string[];
  /** Populated on dry runs for the CLI to print. */
  preview: FlowPreview[];
}

/**
 * The result every trigger surface shows — the admin button, the plugin, and
 * the API response. Shared so the wording cannot drift between them.
 *
 * Written for the designer who just pressed Publish rather than for whoever
 * wrote the sync: each sentence says what is true of the site now, in the order
 * someone actually cares about it — what got published, what changed, what
 * disappeared, what needs review — with the request count last because it only
 * matters when debugging the rate limit. It renders into a plain `<p>` on the
 * admin page, so it has to read as prose; no counters-and-dots table.
 */
export function formatSyncSummary(summary: SyncSummary): string {
  const parts: string[] = [];

  if (summary.flowsSynced === 0) {
    parts.push(nothingPublished(summary));
  } else {
    parts.push(published(summary));
    // Nothing was rendered, so there is no image story to tell — `published`
    // has already explained why.
    if (summary.screensRendered > 0) parts.push(images(summary));
  }

  if (summary.screensArchived > 0) {
    parts.push(
      `${plural(summary.screensArchived, "screen")} no longer in Figma, ` +
        `now hidden from the site.`,
    );
  }

  parts.push(
    summary.driftFlagged === 0
      ? "Nothing has drifted from its source design."
      : `${plural(summary.driftFlagged, "screen")} no longer match the source ` +
        `design they were copied from — flagged for review.`,
  );

  if (summary.errors.length > 0) {
    parts.push(
      `${plural(summary.errors.length, "problem")} along the way: ${summary.errors.join("; ")}.`,
    );
  }

  parts.push(`${plural(summary.requestCount, "Figma API request")} used.`);

  return parts.filter(Boolean).join(" ");
}

function nothingPublished(summary: SyncSummary): string {
  if (summary.flowsChecked === 0) {
    return "Nothing to publish — no Figma files matched.";
  }
  return summary.flowsChecked === 1
    ? "Nothing to publish — this file has not changed in Figma since it was last published."
    : `Nothing to publish — none of the ${summary.flowsChecked} files have changed in Figma since they were last published.`;
}

function published(summary: SyncSummary): string {
  const scope =
    summary.flowsSynced === 1 ? "" : ` from ${summary.flowsSynced} files`;

  if (summary.screensRendered === 0) {
    return (
      `Published${scope}, but found no frames to document. ` +
      `Frames are skipped when their name matches the ignore prefix.`
    );
  }

  const also =
    summary.flowsSkipped > 0
      ? ` ${plural(summary.flowsSkipped, "other file")} had not changed and ` +
        `${summary.flowsSkipped === 1 ? "was" : "were"} left alone.`
      : "";

  return `${plural(summary.screensRendered, "screen")} published${scope}.${also}`;
}

/**
 * Renders are compared by hash before upload, so most screens in a re-publish
 * cost nothing. Saying so is what stops "0 image writes" reading like a failure.
 */
function images(summary: SyncSummary): string {
  const identical = Math.max(0, summary.screensRendered - summary.blobWrites);

  if (summary.blobWrites === 0) {
    return "Every image was already identical, so none were re-uploaded.";
  }
  if (identical === 0) {
    return `${plural(summary.blobWrites, "image")} uploaded.`;
  }
  return (
    `${plural(summary.blobWrites, "image")} changed and ${summary.blobWrites === 1 ? "was" : "were"} ` +
    `re-uploaded; the other ${identical} were identical.`
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface FlowPreview {
  fileKey: string;
  name: string;
  changed: boolean;
  frames: {
    nodeId: string;
    name: string;
    section: string;
    description: string | null;
    textSample: string[];
    sourceUrl: string | null;
  }[];
}

export async function syncProject(
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const log = options.onLog ?? (() => {});
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });

  const summary: SyncSummary = {
    flowsChecked: 0,
    flowsSkipped: 0,
    flowsSynced: 0,
    screensRendered: 0,
    blobWrites: 0,
    screensArchived: 0,
    driftFlagged: 0,
    requestCount: 0,
    errors: [],
    preview: [],
  };

  // 1. Discover + change gate. One request returns every file in the project
  //    along with its last_modified, so unchanged flows cost nothing further.
  const project = await client.getProjectFiles(env.projectId);
  log(`Project "${project.name}": ${project.files.length} file(s)`);

  let candidates = project.files.filter(
    (f) => !env.ignorePattern.test(f.name.trim()),
  );
  if (options.onlyFileKey) {
    candidates = candidates.filter((f) => f.key === options.onlyFileKey);
  }

  const existingFlows = await db.select().from(flows);
  const flowByKey = new Map(existingFlows.map((f) => [f.fileKey, f]));

  for (const file of candidates) {
    summary.flowsChecked++;
    const existing = flowByKey.get(file.key);
    const remoteModified = new Date(file.last_modified);
    const unchanged =
      existing?.lastModified != null &&
      existing.lastModified.getTime() === remoteModified.getTime() &&
      existing.archivedAt == null;

    if (unchanged && !options.force) {
      summary.flowsSkipped++;
      log(`  skip  ${file.name} (unchanged)`);
      continue;
    }

    try {
      await syncFlowFile(client, file, remoteModified, options, summary, log);
      summary.flowsSynced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${file.name}: ${message}`);
      log(`  ERROR ${file.name}: ${message}`);
      if (!options.dryRun) {
        await db
          .update(flows)
          .set({
            syncStatus: "error",
            syncError: message,
            // The flow row is upserted with the new `last_modified` *before*
            // rendering, so a failure after that point would leave the change
            // gate believing this file is done — and the retry would skip it
            // until Figma next touched the file. Clearing the gate makes a
            // failed sync retry, which is what anyone pressing Publish again
            // in the plugin already assumes happens.
            lastModified: null,
          })
          .where(eq(flows.fileKey, file.key));
      }
    }
  }

  // Flow files that left the project entirely.
  if (!options.dryRun) {
    const liveKeys = candidates.map((f) => f.key);
    const archivedFlows = await db
      .update(flows)
      .set({ archivedAt: new Date() })
      .where(
        and(
          isNull(flows.archivedAt),
          liveKeys.length > 0
            ? notInArray(flows.fileKey, liveKeys)
            : sql`true`,
        ),
      )
      .returning({ id: flows.id, name: flows.name });

    for (const flow of archivedFlows) {
      log(`  archived flow "${flow.name}" (no longer in project)`);
      const result = await db
        .update(screens)
        .set({ archivedAt: new Date() })
        .where(and(eq(screens.flowId, flow.id), isNull(screens.archivedAt)))
        .returning({ id: screens.id });
      summary.screensArchived += result.length;
    }
  }

  if (!options.skipDrift && !options.dryRun) {
    summary.driftFlagged = await checkDrift(client, log);
  }

  summary.requestCount = client.requestCount;
  return summary;
}

async function syncFlowFile(
  client: FigmaClient,
  file: ProjectFile,
  remoteModified: Date,
  options: SyncOptions,
  summary: SyncSummary,
  log: (message: string) => void,
) {
  const env = figmaEnv();
  log(`  sync  ${file.name}`);

  // 2. Full nested tree — one request, includes the TEXT nodes.
  const fileData = await client.getFile(file.key);
  const found = findScreenFrames(fileData.document, env.ignorePattern);

  if (found.length === 0) {
    log(`        no frames found — check DOCS_IGNORE_PATTERN`);
  }

  const extracted = found.map(({ page, frame, position }) =>
    extractFrame(page, frame, position),
  );
  const frameByNodeId = new Map(found.map(({ frame }) => [frame.id, frame]));

  // 3. Source links. Absent scope or absent links must not fail the file.
  const sourceByNodeId = new Map<
    string,
    { url: string; fileKey: string; nodeId: string }
  >();
  try {
    const { dev_resources } = await client.getDevResources(file.key);
    for (const resource of dev_resources) {
      const parsed = parseFigmaUrl(resource.url);
      if (!parsed) continue;
      sourceByNodeId.set(resource.node_id, { url: resource.url, ...parsed });
    }
    log(`        ${sourceByNodeId.size} source link(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`        WARN could not read dev resources: ${message}`);
    summary.errors.push(`${file.name}: dev_resources — ${message}`);
  }

  const flowSlug = slugify(file.name);

  if (options.dryRun) {
    summary.preview.push({
      fileKey: file.key,
      name: file.name,
      changed: true,
      frames: extracted.map((f) => ({
        nodeId: f.nodeId,
        name: f.name,
        section: f.section,
        description: f.description,
        textSample: f.texts.slice(0, 8).map((t) => t.content),
        sourceUrl: sourceByNodeId.get(f.nodeId)?.url ?? null,
      })),
    });
    summary.screensRendered += extracted.length;
    return;
  }

  const [flow] = await db
    .insert(flows)
    .values({
      fileKey: file.key,
      name: file.name,
      slug: await uniqueFlowSlug(flowSlug, file.key),
      thumbnailUrl: file.thumbnail_url ?? null,
      lastModified: remoteModified,
      lastSyncedAt: new Date(),
      syncStatus: "ok",
      syncError: null,
      archivedAt: null,
    })
    .onConflictDoUpdate({
      target: flows.fileKey,
      set: {
        name: file.name,
        thumbnailUrl: file.thumbnail_url ?? null,
        lastModified: remoteModified,
        lastSyncedAt: new Date(),
        syncStatus: "ok",
        syncError: null,
        // Republishing must be as cheap as publishing.
        archivedAt: null,
      },
    })
    .returning();

  // 4/5. Render. Frames that would exceed the 32MP ceiling at 2x are rendered
  // at 1x instead of being allowed to fail.
  const scaleGroups = groupByScale(extracted, frameByNodeId);
  const renderedUrls = new Map<string, string>();

  for (const [scale, nodeIds] of scaleGroups) {
    for (const chunk of chunked(nodeIds, IMAGE_CHUNK_SIZE)) {
      const { images } = await client.getImages(file.key, chunk, scale);
      for (const [nodeId, url] of Object.entries(images)) {
        // A null here is a per-node render failure. Keeping the existing row
        // is strictly better than blanking a screen that was fine yesterday.
        if (!url) {
          log(`        WARN render failed for ${nodeId}`);
          continue;
        }
        renderedUrls.set(nodeId, url);
      }
    }
  }

  const existingScreens = await db
    .select()
    .from(screens)
    .where(eq(screens.flowId, flow.id));
  const screenByNodeId = new Map(existingScreens.map((s) => [s.nodeId, s]));

  for (const frame of extracted) {
    const prior = screenByNodeId.get(frame.nodeId);
    const renderUrl = renderedUrls.get(frame.nodeId);
    const source = sourceByNodeId.get(frame.nodeId);
    const node = frameByNodeId.get(frame.nodeId);
    const box = node?.absoluteBoundingBox;
    const scale = scaleFor(node);

    let imageUrl = prior?.imageUrl ?? null;
    let imageHash = prior?.imageHash ?? null;

    if (renderUrl) {
      const response = await fetch(renderUrl);
      if (!response.ok) {
        log(`        WARN download failed for ${frame.name}`);
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        const hash = sha256(bytes);

        if (hash === prior?.imageHash && prior.imageUrl) {
          // Byte-identical render. Skipping the write is what keeps storage
          // and operation costs flat across nightly runs.
          imageUrl = prior.imageUrl;
        } else {
          const pathname = `screens/${file.key}/${frame.nodeId.replaceAll(":", "-")}-${hash.slice(0, 8)}.png`;
          const blob = await put(pathname, bytes, {
            access: "public",
            token: blobToken(),
            contentType: "image/png",
            addRandomSuffix: false,
            // The pathname is content-addressed, so an "overwrite" can only
            // ever write identical bytes. This makes a re-sync after a
            // database reset idempotent instead of erroring.
            allowOverwrite: true,
          });
          summary.blobWrites++;

          if (prior?.imageUrl && prior.imageUrl !== blob.url) {
            // Deletes are free and this pathname is unique to this screen.
            await del(prior.imageUrl, { token: blobToken() }).catch(() => {});
          }
          imageUrl = blob.url;
        }
        imageHash = hash;
      }
    }

    const values = {
      flowId: flow.id,
      nodeId: frame.nodeId,
      name: frame.name,
      slug: slugify(frame.name),
      section: frame.section,
      description: frame.description,
      imageUrl,
      imageWidth: box ? Math.round(box.width * scale) : null,
      imageHeight: box ? Math.round(box.height * scale) : null,
      imageHash,
      figmaUrl: figmaUrl(file.key, flowSlug, frame.nodeId),
      sourceFileKey: source?.fileKey ?? null,
      sourceNodeId: source?.nodeId ?? null,
      sourceUrl: source?.url ?? null,
      textContent: frame.textContent,
      position: frame.position,
      archivedAt: null,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(screens)
        .values(values)
        .onConflictDoUpdate({
          target: [screens.flowId, screens.nodeId],
          set: values,
        })
        .returning({ id: screens.id });

      // Replaced wholesale in the same transaction as the screen, so the
      // highlight boxes can never describe a different render than the image.
      await tx.delete(screenTexts).where(eq(screenTexts.screenId, row.id));
      if (frame.texts.length > 0) {
        await tx.insert(screenTexts).values(
          frame.texts.map((t) => ({
            screenId: row.id,
            nodeId: t.nodeId,
            content: t.content,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
          })),
        );
      }
    });

    summary.screensRendered++;
  }

  // 9. Reconcile within this flow.
  const liveNodeIds = extracted.map((f) => f.nodeId);
  const toArchive = existingScreens.filter(
    (s) => s.archivedAt == null && !liveNodeIds.includes(s.nodeId),
  );
  const liveBefore = existingScreens.filter((s) => s.archivedAt == null).length;

  if (
    toArchive.length > 0 &&
    liveBefore > 0 &&
    toArchive.length / liveBefore > MASS_ARCHIVE_RATIO &&
    !options.allowMassArchive
  ) {
    throw new Error(
      `Refusing to archive ${toArchive.length} of ${liveBefore} live screens in "${file.name}". ` +
        `That usually means a moved file or a partial API response, not a bulk unpublish. ` +
        `Re-run with --allow-mass-archive if this is intended.`,
    );
  }

  if (toArchive.length > 0) {
    await db
      .update(screens)
      .set({ archivedAt: new Date() })
      .where(
        inArray(
          screens.id,
          toArchive.map((s) => s.id),
        ),
      );
    summary.screensArchived += toArchive.length;
    log(`        archived ${toArchive.length} screen(s)`);
  }
}

/** Frames too large to render at 2x fall back to 1x rather than failing. */
function scaleFor(node: FigmaNode | undefined): number {
  const box = node?.absoluteBoundingBox;
  if (!box) return 2;
  return box.width * box.height * 4 > MAX_MEGAPIXELS ? 1 : 2;
}

function groupByScale(
  frames: ExtractedFrame[],
  nodes: Map<string, FigmaNode>,
): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const frame of frames) {
    const scale = scaleFor(nodes.get(frame.nodeId));
    const list = groups.get(scale) ?? [];
    list.push(frame.nodeId);
    groups.set(scale, list);
  }
  return groups;
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/** Flow slugs are public URLs, so two files with the same name must not collide. */
async function uniqueFlowSlug(base: string, fileKey: string): Promise<string> {
  const clash = await db
    .select({ fileKey: flows.fileKey })
    .from(flows)
    .where(eq(flows.slug, base))
    .limit(1);
  if (clash.length === 0 || clash[0].fileKey === fileKey) return base;
  return `${base}-${fileKey.slice(0, 6).toLowerCase()}`;
}
