import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

declare global {
  var __figmaDocsSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  return postgres(databaseUrl(), {
    // Neon's pooled endpoint runs PgBouncer in transaction mode, which cannot
    // hold prepared statements across a pooled connection.
    prepare: false,
    // The sync CLI is the only long-running consumer; Functions want a small
    // per-instance pool since Fluid Compute reuses instances.
    max: process.env.NEXT_RUNTIME ? 5 : 10,
  });
}

// Reused across HMR reloads in dev, otherwise each edit leaks a pool.
const client = globalThis.__figmaDocsSql ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__figmaDocsSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
