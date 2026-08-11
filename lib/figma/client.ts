import { figmaEnv } from "@/lib/env";
import type {
  GetDevResourcesResponse,
  GetFileNodesResponse,
  GetFileResponse,
  GetImagesResponse,
  GetProjectFilesResponse,
} from "./types";

const API = "https://api.figma.com";

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "FigmaError";
  }
}

/**
 * Serial token bucket.
 *
 * File and image endpoints are Tier 1: 10/min on Starter, 15/min Professional,
 * 20/min Organization, unlimited on Enterprise. We run every call through one
 * queue rather than firing in parallel — a burst that trips 429 costs far more
 * wall-clock time than pacing does.
 */
class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private recent: number[] = [];

  constructor(private readonly perMinute: number) {}

  /**
   * Queues `task` behind everything already scheduled.
   *
   * A task may issue several HTTP calls — a retry is still one task — so taking
   * a slot is `claimSlot`'s job, not this one's. Doing it here instead would
   * mean a retry had to re-enter the queue, and it would wait forever: the
   * chain it queues behind cannot advance until the task holding it returns.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    // Keep the chain alive even when a task rejects, or one failure would
    // wedge every subsequent request behind a permanently rejected promise.
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** Blocks until the window has room. Call once per HTTP call, retries included. */
  async claimSlot() {
    await this.waitForSlot();
    this.recent.push(Date.now());
  }

  private async waitForSlot() {
    const windowMs = 60_000;
    for (;;) {
      const cutoff = Date.now() - windowMs;
      this.recent = this.recent.filter((t) => t > cutoff);
      if (this.recent.length < this.perMinute) return;
      const waitMs = this.recent[0] - cutoff + 50;
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The endpoint in the plugin's voice. The raw path carries a file key and an id
 * list, neither of which means anything to the designer reading the error.
 */
function endpointName(path: string): string {
  if (path.startsWith("/v1/images/")) return "the image render";
  if (path.startsWith("/v1/projects/")) return "the project listing";
  if (path.includes("/dev_resources")) return "the dev-resources read";
  if (path.includes("/nodes")) return "the frame read";
  if (path.startsWith("/v1/files/")) return "the file read";
  return path;
}

export interface FigmaClientOptions {
  accessToken?: string;
  rateLimitPerMin?: number;
  /** Called with one-line progress notes. Wired to the CLI logger. */
  onLog?: (message: string) => void;
}

export class FigmaClient {
  private readonly token: string;
  private readonly limiter: RateLimiter;
  private readonly onLog: (message: string) => void;
  /** Requests issued this run. Verification asserts against this. */
  requestCount = 0;

  constructor(options: FigmaClientOptions = {}) {
    this.token = options.accessToken ?? figmaEnv().accessToken;
    this.limiter = new RateLimiter(
      options.rateLimitPerMin ?? Number(process.env.FIGMA_RATE_LIMIT_PER_MIN ?? 10),
    );
    this.onLog = options.onLog ?? (() => {});
  }

  /**
   * One queued task, however many attempts it takes.
   *
   * The two retryable failures are counted separately: being rate limited says
   * nothing about whether Figma is healthy, so a 429 must not spend the budget
   * a later 5xx needs.
   */
  private request<T>(path: string): Promise<T> {
    return this.limiter.enqueue(async () => {
      let rateLimitAttempt = 0;
      let serverAttempt = 0;

      for (;;) {
        await this.limiter.claimSlot();
        this.requestCount++;
        const response = await fetch(`${API}${path}`, {
          headers: { "X-Figma-Token": this.token },
          cache: "no-store",
        });

        if (response.status === 429) {
          // Surface the ceiling we actually hit — the plan tier is the thing
          // that determines how long a full sync takes.
          const tier = response.headers.get("X-Figma-Plan-Tier");
          const kind = response.headers.get("X-Figma-Rate-Limit-Type");
          const retryAfter = Number(response.headers.get("Retry-After") ?? "0");

          if (rateLimitAttempt >= 5) {
            throw new FigmaError(
              `Rate limited after ${rateLimitAttempt} retries (plan=${tier}, type=${kind})`,
              429,
              path,
            );
          }
          const backoffMs = retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2 ** rateLimitAttempt * 1000, 60_000);
          this.onLog(
            `429 rate limited (plan=${tier}, type=${kind}) — waiting ${Math.round(backoffMs / 1000)}s`,
          );
          await sleep(backoffMs);
          rateLimitAttempt++;
          continue;
        }

        if (response.status === 403) {
          throw new FigmaError(
            `403 Forbidden. If this is /dev_resources the token is missing the ` +
              `file_dev_resources:read scope; otherwise it cannot read this file.`,
            403,
            path,
          );
        }

        // Rendering is the slow, flaky half of the API: a heavy frame can sit
        // on /v1/images for 15s and come back 500 "Internal error, please try
        // again later", then succeed on the very next call. Both sync paths
        // already treat a per-node render failure as survivable, so a transient
        // 5xx on the request as a whole should not be the one thing that aborts
        // a designer's publish.
        if (response.status >= 500 && serverAttempt < 3) {
          const backoffMs = 2 ** serverAttempt * 1000;
          this.onLog(
            `${response.status} from ${endpointName(path)} — retrying in ` +
              `${backoffMs / 1000}s`,
          );
          await sleep(backoffMs);
          serverAttempt++;
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const tries =
            serverAttempt > 0 ? ` after ${serverAttempt + 1} tries` : "";
          // Name the call. Without it a designer sees a bare "500 Internal
          // Server Error" in the plugin and cannot tell a broken frame from a
          // Figma hiccup.
          throw new FigmaError(
            `${response.status} ${response.statusText} from ${endpointName(path)}` +
              `${tries} ${body.slice(0, 200)}`,
            response.status,
            path,
          );
        }

        return (await response.json()) as T;
      }
    });
  }

  /**
   * Discovery *and* change gate in one request: the response carries
   * `last_modified` per file, so unchanged flows are skipped without ever
   * fetching them.
   */
  getProjectFiles(projectId: string) {
    return this.request<GetProjectFilesResponse>(
      `/v1/projects/${encodeURIComponent(projectId)}/files`,
    );
  }

  /**
   * Full nested tree in a single Tier 1 request.
   *
   * No `depth` — we need TEXT nodes, which `depth=2` would omit. No
   * `geometry=paths` — vector data is what makes these payloads enormous and
   * we never read it.
   */
  getFile(fileKey: string) {
    return this.request<GetFileResponse>(
      `/v1/files/${encodeURIComponent(fileKey)}`,
    );
  }

  /** Scoped subtrees. Used for drift: one request per distinct source file. */
  getFileNodes(fileKey: string, nodeIds: string[]) {
    const ids = nodeIds.map(encodeURIComponent).join(",");
    return this.request<GetFileNodesResponse>(
      `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids}`,
    );
  }

  /**
   * Batch render. Never pass `use_absolute_bounds` — it changes the crop and
   * silently invalidates every normalised highlight coordinate.
   */
  getImages(fileKey: string, nodeIds: string[], scale = 2) {
    const ids = nodeIds.map(encodeURIComponent).join(",");
    return this.request<GetImagesResponse>(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${ids}&format=png&scale=${scale}`,
    );
  }

  /** Requires the `file_dev_resources:read` scope. */
  getDevResources(fileKey: string) {
    return this.request<GetDevResourcesResponse>(
      `/v1/files/${encodeURIComponent(fileKey)}/dev_resources`,
    );
  }
}
