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

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      await this.waitForSlot();
      this.recent.push(Date.now());
      return task();
    });
    // Keep the chain alive even when a task rejects, or one failure would
    // wedge every subsequent request behind a permanently rejected promise.
    this.chain = result.catch(() => undefined);
    return result;
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

  private async request<T>(path: string, attempt = 0): Promise<T> {
    return this.limiter.run(async () => {
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

        if (attempt >= 5) {
          throw new FigmaError(
            `Rate limited after ${attempt} retries (plan=${tier}, type=${kind})`,
            429,
            path,
          );
        }
        const backoffMs = retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 1000, 60_000);
        this.onLog(
          `429 rate limited (plan=${tier}, type=${kind}) — waiting ${Math.round(backoffMs / 1000)}s`,
        );
        await sleep(backoffMs);
        return this.request<T>(path, attempt + 1);
      }

      if (response.status === 403) {
        throw new FigmaError(
          `403 Forbidden. If this is /dev_resources the token is missing the ` +
            `file_dev_resources:read scope; otherwise it cannot read this file.`,
          403,
          path,
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new FigmaError(
          `${response.status} ${response.statusText} ${body.slice(0, 200)}`,
          response.status,
          path,
        );
      }

      return (await response.json()) as T;
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
