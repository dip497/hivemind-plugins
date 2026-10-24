// Jira's REST rate limits, kept by the client (design jira-sync §9.1). API-token traffic is exempt
// from the points quota but not from the burst and per-issue limits, and a site can still answer a
// quota 429. So:
// - at most 4 requests in flight;
// - a 429 says why in `RateLimit-Reason`: a quota (`jira-quota-*`) pauses every request until its
//   reset, a burst (`jira-burst-based`) slows only that endpoint, `jira-per-issue-on-write` delays
//   writes to that issue only;
// - only an idempotent request whose 429 (or 503) carries `Retry-After` is retried here, at most 4
//   times, after the longer of `Retry-After` and a jittered backoff (2–5 s, doubling, ×0.7–1.3,
//   30 s at most); anything else fails as `rate-limited` and the caller decides (the poll waits, a
//   write goes back to the push queue);
// - `X-RateLimit-NearLimit` and the `RateLimit` / `Beta-RateLimit` / `X-RateLimit-*` headers are
//   read, so the poll slows down before Jira refuses.
import { TransportError } from "../transport.js";
import { retryAfterMs } from "../mcp/session.js";

export const MAX_IN_FLIGHT = 4;
export const MAX_RETRIES = 4;
export const MAX_WAIT_MS = 30_000;
/** Near the limit: less than this share left. */
const NEAR = 0.2;
/** How long a near-limit warning slows the poll after it was last seen. */
const NEAR_FOR_MS = 5 * 60_000;

export interface RestLimitsOptions {
  maxInFlight?: number;
  now?: () => number;
  /** Waits (tests pass a fake clock's). */
  sleep?: (ms: number) => Promise<void>;
  /** 0 ≤ x < 1 (tests pin the jitter). */
  random?: () => number;
}

/** One request as the limits see it. */
export interface RestCall {
  /** The endpoint, as a template (`POST /rest/api/3/search/jql`): a burst slows this one alone. */
  endpoint: string;
  /** Safe to send again: reads, PUTs, DELETEs, and POSTs that only read or upsert. */
  idempotent: boolean;
  /** The issue a write changes: a per-issue 429 delays writes to it alone. */
  issue?: string;
}

export type LimitReason = "quota" | "burst" | "per-issue" | "other";

export function reasonOf(h: string | null): LimitReason {
  if (!h) return "other";
  if (/quota/i.test(h)) return "quota";
  if (/burst/i.test(h)) return "burst";
  if (/per-issue/i.test(h)) return "per-issue";
  return "other";
}

/** What a response's headers say about the limit: remaining and limit when given, and whether Jira
 *  warned. Reads `X-RateLimit-*`, the draft `RateLimit` / `RateLimit-Policy` (`"burst";r=10;t=1`,
 *  `"burst";q=100;w=1`, or `limit=…, remaining=…`) and their `Beta-` forms. */
export function readLimit(h: Headers): { near: boolean; remaining?: number; limit?: number } {
  const num = (v: string | null | undefined) => (v !== null && v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const param = (v: string | null, ...names: string[]) => {
    if (!v) return undefined;
    for (const n of names) {
      const m = new RegExp(`(?:^|[;,\\s])${n}=("?)(\\d+)\\1`, "i").exec(v);
      if (m) return Number(m[2]);
    }
    return undefined;
  };
  const draft = h.get("ratelimit") ?? h.get("beta-ratelimit");
  const policy = h.get("ratelimit-policy") ?? h.get("beta-ratelimit-policy");
  const remaining = num(h.get("x-ratelimit-remaining")) ?? num(h.get("ratelimit-remaining")) ?? param(draft, "r", "remaining");
  const limit = num(h.get("x-ratelimit-limit")) ?? num(h.get("ratelimit-limit")) ?? param(draft, "limit") ?? param(policy, "q") ?? (policy && /^\s*\d+/.test(policy) ? Number(/^\s*(\d+)/.exec(policy)![1]) : undefined);
  const warned = (h.get("x-ratelimit-nearlimit") ?? "").toLowerCase() === "true";
  const low = remaining !== undefined && limit !== undefined && limit > 0 && remaining / limit < NEAR;
  return { near: warned || low, ...(remaining !== undefined ? { remaining } : {}), ...(limit !== undefined ? { limit } : {}) };
}

export class RestLimits {
  private inFlight = 0;
  private readonly queue: (() => void)[] = [];
  private quotaUntil = 0;
  private readonly endpointUntil = new Map<string, number>();
  private readonly issueUntil = new Map<string, number>();
  private nearAt = 0;
  /** The most requests ever in flight at once (tests, the log). */
  peak = 0;
  /** Requests sent, retries included. */
  sent = 0;

  constructor(private readonly o: RestLimitsOptions = {}) {}

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }
  private sleep(ms: number): Promise<void> {
    return this.o.sleep ? this.o.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  /** Until when everything waits for a quota reset, or undefined. */
  rateLimitedUntil(): number | undefined {
    return this.quotaUntil > this.now() ? this.quotaUntil : undefined;
  }

  /** Jira warned lately that the limit is close: the poll slows down. */
  nearLimit(): boolean {
    return this.nearAt > 0 && this.now() - this.nearAt < NEAR_FOR_MS;
  }

  /** The n-th retry's backoff (n from 0): 2–5 s, doubling, jittered ×0.7–1.3, 30 s at most. */
  backoffMs(n: number): number {
    const r = () => (this.o.random ? this.o.random() : Math.random());
    const base = 2_000 + r() * 3_000;
    return Math.min(MAX_WAIT_MS, Math.round(base * 2 ** n * (0.7 + r() * 0.6)));
  }

  /** Wait out a slowed endpoint or issue, when that's soon; refuse when it isn't. */
  private async waitFor(until: number | undefined, what: string): Promise<void> {
    const ms = (until ?? 0) - this.now();
    if (ms <= 0) return;
    if (ms > MAX_WAIT_MS) throw new TransportError("rate-limited", `Jira asked to slow down ${what} until ${new Date(until!).toISOString()}`, ms);
    await this.sleep(ms);
  }

  private async slot(): Promise<void> {
    if (this.inFlight >= (this.o.maxInFlight ?? MAX_IN_FLIGHT)) await new Promise<void>((r) => this.queue.push(r));
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
  }
  private release(): void {
    this.inFlight--;
    this.queue.shift()?.();
  }

  /** Send one request within the limits: the response, unless the limits refused it. */
  async run(call: RestCall, send: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const quota = this.rateLimitedUntil();
      if (quota) throw new TransportError("rate-limited", `Jira's rate limit is used up until ${new Date(quota).toISOString()}`, quota - this.now());
      await this.waitFor(this.endpointUntil.get(call.endpoint), `on ${call.endpoint}`);
      if (call.issue) await this.waitFor(this.issueUntil.get(call.issue), `writes to ${call.issue}`);
      await this.slot();
      let res: Response;
      try {
        this.sent++;
        res = await send();
      } finally {
        this.release();
      }
      if (readLimit(res.headers).near) this.nearAt = this.now();
      const after = retryAfterMs(res.headers.get("retry-after"), this.now());
      if (res.status !== 429 && !(res.status === 503 && after !== undefined)) return res;

      const reason = reasonOf(res.headers.get("ratelimit-reason"));
      const reset = Date.parse(res.headers.get("x-ratelimit-reset") ?? "");
      const wait = after ?? (Number.isFinite(reset) ? Math.max(0, reset - this.now()) : undefined);
      const until = this.now() + (wait ?? 60_000);
      await res.body?.cancel().catch(() => {});
      if (reason === "quota") {
        this.quotaUntil = Math.max(this.quotaUntil, until);
        throw new TransportError("rate-limited", `Jira's rate limit is used up until ${new Date(this.quotaUntil).toISOString()} (${res.headers.get("ratelimit-reason")})`, this.quotaUntil - this.now());
      }
      if (reason === "burst") this.endpointUntil.set(call.endpoint, Math.max(this.endpointUntil.get(call.endpoint) ?? 0, until));
      if (reason === "per-issue" && call.issue) this.issueUntil.set(call.issue, Math.max(this.issueUntil.get(call.issue) ?? 0, until));
      // Atlassian's rule: retry only what is safe to send again, and only when told when.
      const delay = Math.max(after ?? 0, this.backoffMs(attempt));
      if (!call.idempotent || after === undefined || attempt >= MAX_RETRIES || delay > MAX_WAIT_MS) {
        throw new TransportError("rate-limited", `Jira asked to slow down (${res.status}${reason === "other" ? "" : `, ${res.headers.get("ratelimit-reason")}`}${wait !== undefined ? `, retry after ${Math.ceil(wait / 1000)} s` : ""})`, wait ?? 60_000);
      }
      await this.sleep(delay);
    }
  }
}
