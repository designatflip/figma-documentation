import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { type DriftState, screens } from "@/db/schema";
import type { FigmaClient } from "./client";
import { buildTextContent, extractTexts, hashNodeSubtree } from "./extract";

const NODE_CHUNK_SIZE = 50;

/**
 * Compare each documented screen against the frame it was duplicated from.
 *
 * Cost is one request per *distinct source file*, not per screen — source node
 * ids are grouped by file and passed to `/nodes?ids=` together. That is the
 * same request count a file-level `last_modified` check would need, without
 * its false positives: editing an unrelated frame in a busy feature file bumps
 * `last_modified` but leaves the documented node untouched, and this pass
 * correctly reports no drift.
 *
 * Returns the number of screens currently flagged.
 */
export async function checkDrift(
  client: FigmaClient,
  log: (message: string) => void,
): Promise<number> {
  const tracked = await db
    .select({
      id: screens.id,
      name: screens.name,
      textContent: screens.textContent,
      sourceFileKey: screens.sourceFileKey,
      sourceNodeId: screens.sourceNodeId,
      sourceHash: screens.sourceHash,
    })
    .from(screens)
    .where(
      and(
        isNull(screens.archivedAt),
        isNotNull(screens.sourceFileKey),
        isNotNull(screens.sourceNodeId),
      ),
    );

  if (tracked.length === 0) return 0;

  const byFile = new Map<string, typeof tracked>();
  for (const screen of tracked) {
    const key = screen.sourceFileKey!;
    const list = byFile.get(key) ?? [];
    list.push(screen);
    byFile.set(key, list);
  }

  log(
    `  drift  ${tracked.length} screen(s) across ${byFile.size} source file(s)`,
  );

  let flagged = 0;

  for (const [fileKey, group] of byFile) {
    const nodeIds = [...new Set(group.map((s) => s.sourceNodeId!))];

    for (const chunk of chunked(nodeIds, NODE_CHUNK_SIZE)) {
      let nodes: Awaited<ReturnType<FigmaClient["getFileNodes"]>>["nodes"];
      try {
        ({ nodes } = await client.getFileNodes(fileKey, chunk));
      } catch (error) {
        // A source file we cannot read is not an error condition — the
        // designer may have linked to another team's file, or it may be
        // deleted. Report unknown and carry on.
        const message = error instanceof Error ? error.message : String(error);
        log(`         WARN source file ${fileKey} unreadable: ${message}`);
        await markUnknown(group.filter((s) => chunk.includes(s.sourceNodeId!)));
        continue;
      }

      for (const screen of group) {
        if (!chunk.includes(screen.sourceNodeId!)) continue;

        const entry = nodes[screen.sourceNodeId!];
        if (!entry?.document) {
          await markUnknown([screen]);
          continue;
        }

        const sourceTexts = extractTexts(entry.document);
        const sourceText = buildTextContent(sourceTexts);
        const sourceHash = hashNodeSubtree(entry.document);

        let state: DriftState;
        if (normalise(sourceText) !== normalise(screen.textContent ?? "")) {
          // Available on the very first sync — no stored history needed.
          state = "content_changed";
        } else if (screen.sourceHash && screen.sourceHash !== sourceHash) {
          // Needs a prior run to compare against.
          state = "source_changed";
        } else {
          state = "in_sync";
        }

        if (state !== "in_sync") flagged++;

        await db
          .update(screens)
          .set({
            sourceText,
            sourceHash,
            driftState: state,
            driftCheckedAt: new Date(),
          })
          .where(eq(screens.id, screen.id));
      }
    }
  }

  log(`         ${flagged} screen(s) flagged`);
  return flagged;
}

/**
 * Compare the *set* of distinct lines, not their order.
 *
 * A designer rearranging sections in the documented copy is not a copy change,
 * and flagging it would train people to ignore the badge.
 */
function normalise(text: string): string {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim().replace(/\s+/g, " ").toLowerCase())
        .filter(Boolean),
    ),
  ]
    .sort()
    .join("\n");
}

async function markUnknown(rows: { id: string }[]) {
  for (const row of rows) {
    await db
      .update(screens)
      .set({ driftState: "unknown", driftCheckedAt: new Date() })
      .where(eq(screens.id, row.id));
  }
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}
