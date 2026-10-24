// One connection to the Rovo MCP server (design §9.2): the SDK's Client over Streamable HTTP at
// `…/v2/mcp?tools=all`, signed in with the kept sign-in. It finds its tools by capability through
// the paged `tools/list`, makes every tool call within the limiter (≤3 in flight, the hourly
// budget), reads each answer's text and checks it against the tool's schema, and turns every
// failure into a `TransportError` the sync branches on.
//
// The SDK hides two things the service needs, so its fetch is wrapped: a 429's `Retry-After` (the
// SDK's error drops it) and refreshes, which the SDK can start twice at once (its GET stream and a
// POST meeting one expired token; with refresh-token rotation the second can revoke the grant).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { z } from "zod";
import { prettifyError } from "zod";
import { TransportError } from "../transport.js";
import type { Limiter } from "../limiter.js";
import type { Logger } from "../log.js";
import { NEVER, resolveTools, type Capability } from "./tools.js";
import { ToolErrorZ } from "./schemas.js";

export const DEFAULT_MCP_URL = "https://mcp.atlassian.com/v2/mcp?tools=all";

export interface SessionOptions {
  /** The MCP endpoint, with `?tools=all`. */
  url: string;
  provider: OAuthClientProvider;
  limiter: Limiter;
  log: Logger;
  /** The fetch underneath (tests count requests). */
  fetch?: typeof fetch;
  /** Told when the server says the sign-in no longer works (refused refresh, stale grant). */
  onSignInNeeded?: (why: string) => void;
}

/** `Retry-After` in ms: seconds, or an HTTP date. */
export function retryAfterMs(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return Math.ceil(s * 1000);
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - now) : undefined;
}

/**
 * The fetch the SDK is given: a 429 pauses the limiter and fails with its `Retry-After`; refreshes
 * of one refresh token share one request (refresh tokens rotate, and a second rotation can revoke
 * the grant).
 */
export function wrapFetch(base: typeof fetch, limiter: Limiter): typeof fetch {
  const refreshing = new Map<string, Promise<Response>>();
  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = init?.body;
    const form = typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : undefined;
    const rt = form && /(^|&)grant_type=refresh_token(&|$)/.test(form) ? new URLSearchParams(form).get("refresh_token") : null;
    if (rt) {
      let p = refreshing.get(rt);
      if (!p) {
        const asked = base(input, init);
        p = asked;
        refreshing.set(rt, asked);
        // For a while, a caller with the old refresh token — or with the one this refresh issued,
        // because its 401 came back before the refresh and its turn to refresh after — gets this
        // same answer, not a second rotation.
        const keys = [rt];
        const drop = () => setTimeout(() => { for (const k of keys) if (refreshing.get(k) === asked) refreshing.delete(k); }, 30_000).unref?.();
        asked.then(async (res) => {
          const issued = res.ok ? ((await res.clone().json().catch(() => ({}))) as { refresh_token?: string }).refresh_token : undefined;
          if (issued) { keys.push(issued); refreshing.set(issued, asked); }
        }).then(drop, drop);
      }
      return (await p).clone();
    }
    const res = await base(input, init);
    if (res.status === 429) {
      const ms = retryAfterMs(res.headers.get("retry-after")) ?? 60_000;
      limiter.pause(ms);
      throw new TransportError("rate-limited", `Atlassian asked to slow down (429, retry after ${Math.ceil(ms / 1000)} s)`, ms);
    }
    return res;
  };
  return wrapped as typeof fetch;
}

/** A tool's failure as the transport reports it. */
export function toolFailure(tool: string, body: unknown): TransportError {
  const e = ToolErrorZ.safeParse(body);
  const message = e.success ? e.data.message : String(typeof body === "string" ? body : JSON.stringify(body)).slice(0, 300);
  const status = e.success ? ("statusCode" in e.data ? e.data.statusCode : e.data.code) : undefined;
  const at = `${tool}: ${message}`;
  if (status === 403 && /not installed/i.test(message)) return new TransportError("consent", `${tool}: the Atlassian app is not installed for this sign-in any more (${message}); sign in again`);
  switch (status) {
    case 401: return new TransportError("auth", at);
    case 403: return new TransportError("forbidden", at);
    case 404: return new TransportError("not-found", at);
    case 409: return new TransportError("conflict", at);
    case 429: return new TransportError("rate-limited", at, 60_000);
    case 400: case 422: return new TransportError("invalid", at);
    default: return new TransportError("unavailable", at);
  }
}

export class McpSession {
  private client?: Client;
  private connecting?: Promise<void>;
  private tools: Partial<Record<Capability, string>> = {};
  /** Every tool `tools/list` named, for status and tests. */
  listed: string[] = [];
  private readonly fetchFn: typeof fetch;

  constructor(private readonly o: SessionOptions) {
    this.fetchFn = wrapFetch(o.fetch ?? fetch, o.limiter);
  }

  get serverUrl(): URL {
    return new URL(this.o.url);
  }

  /** The fetch the SDK uses here, also for a sign-in's own requests. */
  get fetch(): typeof fetch {
    return this.fetchFn;
  }

  has(cap: Capability): boolean {
    return !!this.tools[cap];
  }

  toolFor(cap: Capability): string | undefined {
    return this.tools[cap];
  }

  /** Connect (once) and learn the tools. */
  connect(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async open(): Promise<void> {
    const client = new Client({ name: "hivemind", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.o.url), { authProvider: this.o.provider, fetch: this.fetchFn });
    try {
      await client.connect(transport);
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        names.push(...page.tools.map((t) => t.name));
        cursor = page.nextCursor;
      } while (cursor);
      this.listed = names;
      this.tools = resolveTools(names);
      this.client = client;
    } catch (e) {
      await client.close().catch(() => {});
      throw this.failure(e, "connect");
    }
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    await c?.close().catch(() => {});
  }

  private failure(e: unknown, tool: string): TransportError {
    if (e instanceof TransportError) {
      if (e.kind === "auth" || e.kind === "consent") this.o.onSignInNeeded?.(e.message);
      return e;
    }
    if (e instanceof UnauthorizedError) {
      this.o.onSignInNeeded?.("Atlassian refused the sign-in");
      return new TransportError("auth", `${tool}: sign in again (Atlassian refused the sign-in)`);
    }
    if (e instanceof StreamableHTTPError) {
      const code = e.code ?? 0;
      if (code === 401) return new TransportError("auth", `${tool}: sign in again (${e.message})`);
      if (code === 403) return new TransportError("forbidden", `${tool}: ${e.message}`);
      if (code === 404) return new TransportError("not-found", `${tool}: the MCP session ended (${e.message})`);
      return new TransportError("unavailable", `${tool}: the Atlassian MCP server answered ${code || "an error"} (${e.message})`);
    }
    return new TransportError("unavailable", `${tool}: ${(e as Error)?.message ?? String(e)}`);
  }

  /**
   * Call the tool for `cap` with `args`; its answer's `data`, checked against `schema`. Throws a
   * `TransportError`: `invalid` when the answer isn't what the schema says, naming the tool.
   */
  async call<S extends z.ZodType>(cap: Capability, args: Record<string, unknown>, schema: S, retried = false): Promise<z.infer<S>> {
    await this.connect();
    const name = this.tools[cap];
    if (!name) throw new TransportError("unavailable", `this Atlassian site offers no tool to ${cap} (looked for it in tools/list)`);
    if (NEVER.has(name)) throw new TransportError("invalid", `${name} costs Rovo credits and is never called`);
    let text: string;
    let isError: boolean;
    try {
      const r = await this.o.limiter.run(() => this.client!.callTool({ name, arguments: args }));
      text = ((r.content as { type: string; text?: string }[] | undefined) ?? []).find((c) => c.type === "text")?.text ?? "";
      isError = !!r.isError;
    } catch (e) {
      const f = this.failure(e, name);
      // The server forgot the session: open a new one and try once more.
      if (f.kind === "not-found" && /session/i.test(f.message) && !retried) {
        await this.close();
        return this.call(cap, args, schema, true);
      }
      throw f;
    }
    let body: unknown;
    try {
      body = JSON.parse(text.split("\n")[0] ?? "");
    } catch {
      throw isError ? toolFailure(name, text) : new TransportError("invalid", `${name} answered text that isn't JSON: ${text.slice(0, 120)}`);
    }
    if (isError || ToolErrorZ.safeParse(body).success) {
      const f = toolFailure(name, body);
      if (f.kind === "consent") this.o.onSignInNeeded?.(f.message);
      throw f;
    }
    const data = Array.isArray(body) ? body : (body as { data?: unknown }).data ?? body;
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new TransportError("invalid", `${name} answered a shape the Jira service doesn't know: ${prettifyError(parsed.error)}`);
    return parsed.data;
  }
}
