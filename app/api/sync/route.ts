import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { cronSecret } from "@/lib/env";
import { syncProject } from "@/lib/figma/sync";

/**
 * A full sync walks every changed flow file serially against a 10–20 req/min
 * ceiling, so it needs the long end of the function timeout.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret()}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const logs: string[] = [];

  try {
    const summary = await syncProject({
      force: url.searchParams.get("force") === "1",
      allowMassArchive: url.searchParams.get("allowMassArchive") === "1",
      skipDrift: url.searchParams.get("skipDrift") === "1",
      onLog: (message) => {
        logs.push(message);
        console.log(`[sync] ${message}`);
      },
    });

    // Every cached read is tagged 'catalog'. `updateTag` is Server-Action-only,
    // so a Route Handler uses revalidateTag; "max" gives stale-while-revalidate,
    // which is right for a nightly job — nobody is waiting on this response.
    revalidateTag("catalog", "max");

    return NextResponse.json({
      ok: summary.errors.length === 0,
      ...summary,
      preview: undefined,
      logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync] fatal", error);
    return NextResponse.json({ ok: false, error: message, logs }, { status: 500 });
  }
}
