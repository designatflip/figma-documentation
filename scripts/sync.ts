#!/usr/bin/env tsx
/**
 * Sync the Figma documentation project into Postgres + Blob.
 *
 *   npm run sync -- --dry-run          resolve everything, write nothing
 *   npm run sync                       normal run
 *   npm run sync -- --force            ignore the last_modified change gate
 *   npm run sync -- --file <key>       one flow file only
 *   npm run sync -- --allow-mass-archive
 *   npm run sync -- --check-token      verify token scopes and exit
 *   npm run sync -- --skip-drift
 */
import { syncProject } from "@/lib/figma/sync";
import { FigmaClient } from "@/lib/figma/client";
import { figmaEnv } from "@/lib/env";
import { SyncBusyError, withSyncLock } from "@/lib/sync-lock";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const has = (name: string) => process.argv.includes(`--${name}`);

const log = (message: string) => console.log(message);

/**
 * A token without `file_dev_resources:read` syncs "successfully" while
 * silently dropping every source link and drift signal. Cheaper to fail here.
 */
async function checkToken() {
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });

  const project = await client.getProjectFiles(env.projectId);
  console.log(
    `✓ projects:read — "${project.name}" (${project.files.length} files)`,
  );

  const first = project.files[0];
  if (!first) {
    console.log("… No files in the project; cannot check remaining scopes.");
    return;
  }

  await client.getFile(first.key);
  console.log(`✓ file_content:read — "${first.name}"`);

  try {
    const { dev_resources } = await client.getDevResources(first.key);
    console.log(
      `✓ file_dev_resources:read (${dev_resources.length} resource(s) on "${first.name}")`,
    );
  } catch (error) {
    console.error(
      `✗ file_dev_resources:read MISSING — source links and drift detection ` +
        `will be silently unavailable.\n  ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  }
}

async function main() {
  if (has("check-token")) {
    await checkToken();
    return;
  }

  const dryRun = has("dry-run");
  const started = Date.now();

  const run = () =>
    syncProject({
      dryRun,
      force: has("force"),
      allowMassArchive: has("allow-mass-archive"),
      skipDrift: has("skip-drift"),
      onlyFileKey: arg("file"),
      onLog: log,
    });

  // A dry run writes nothing, so it has no business blocking — or being blocked
  // by — a real one. Everything else takes the lease the plugin and cron share.
  const summary = dryRun
    ? await run()
    : await withSyncLock(`cli:${process.env.USER ?? "unknown"}`, run);

  if (dryRun) {
    console.log("\n──── DRY RUN — nothing was written ────\n");
    for (const flow of summary.preview) {
      console.log(`▸ ${flow.name}  (${flow.frames.length} screens)`);
      for (const proto of flow.prototypes) {
        console.log(`   prototype "${proto.name}" starts on ${proto.startsOn}`);
      }
      for (const frame of flow.frames) {
        console.log(`   ${frame.section} / ${frame.name}`);
        if (frame.description) {
          console.log(`      description: ${frame.description}`);
        }
        if (frame.sourceUrl) {
          console.log(`      source: ${frame.sourceUrl}`);
        }
        if (frame.hotspots.length > 0) {
          console.log(
            `      hotspots (${frame.hotspots.length}): ${frame.hotspots
              .slice(0, 8)
              .join(", ")}${frame.hotspots.length > 8 ? " …" : ""}`,
          );
        }
        if (frame.textSample.length > 0) {
          console.log(
            `      text: ${frame.textSample.map((t) => JSON.stringify(t)).join(", ")}${
              frame.textSample.length >= 8 ? " …" : ""
            }`,
          );
        }
      }
      console.log("");
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log("──── Summary ────");
  console.table({
    flowsChecked: summary.flowsChecked,
    flowsSkipped: summary.flowsSkipped,
    flowsSynced: summary.flowsSynced,
    screensRendered: summary.screensRendered,
    blobWrites: summary.blobWrites,
    prototypesPublished: summary.prototypesPublished,
    screensArchived: summary.screensArchived,
    driftFlagged: summary.driftFlagged,
    figmaRequests: summary.requestCount,
    seconds,
  });

  if (summary.errors.length > 0) {
    console.error(`\n${summary.errors.length} error(s):`);
    for (const error of summary.errors) console.error(`  • ${error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    // Expected whenever the cron, a plugin, or another terminal got there
    // first. A stack trace would suggest something broke.
    if (error instanceof SyncBusyError) {
      console.error(`${error.message}\nTry again once it finishes.`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    // postgres.js keeps the pool open, which would hang the CLI.
    process.exit(process.exitCode ?? 0);
  });
