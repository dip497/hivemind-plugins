// The person's Atlassian connection, shared by every workspace the service syncs: the plugin's
// options, the kept sign-in (`mcpAuth`), one MCP session and one limiter, so the hourly budget is
// one budget whatever the number of workspaces.
import { TransportError } from "./transport.js";
import { Limiter } from "./limiter.js";
import type { Logger } from "./log.js";
import { LoopbackSignIn, StoredAuth, SIGN_IN_AGAIN } from "./mcp/auth.js";
import { DEFAULT_MCP_URL, McpSession, wrapFetch } from "./mcp/session.js";
import { McpTransport } from "./mcp/transport.js";

/** The plugin's settings (hivemind-tool.json), as `plugin.options` gives them. */
export interface Options {
  site: string;
  transport: "mcp" | "rest";
  email: string;
  project: string;
  scope: "mine" | "mine+unassigned" | "all" | "jql";
  jql: string;
  push: "off" | "status" | "status+comments" | "full";
  mcpBudget: number;
}

export const DEFAULT_OPTIONS: Options = { site: "", transport: "mcp", email: "", project: "", scope: "mine", jql: "", push: "status", mcpBudget: 400 };

export function readOptions(o: { values?: Record<string, unknown> } | undefined): Options {
  const v = o?.values ?? {};
  const pick = <K extends keyof Options>(k: K): Options[K] => (v[k] === undefined || v[k] === null ? DEFAULT_OPTIONS[k] : (v[k] as Options[K]));
  return {
    site: String(pick("site")).trim(),
    transport: pick("transport") === "rest" ? "rest" : "mcp",
    email: String(pick("email")),
    project: String(pick("project")).trim().toUpperCase(),
    scope: pick("scope"),
    jql: String(pick("jql")),
    push: pick("push"),
    mcpBudget: Math.max(1, Number(pick("mcpBudget")) || DEFAULT_OPTIONS.mcpBudget),
  };
}

/** The plugin's own secrets, through the drive (`secret.get` / `secret.set`). */
export interface Secrets {
  get(name: string): Promise<string | null>;
  set(name: string, value: string | null): Promise<void>;
}

export interface AccountOptions {
  secrets: Secrets;
  options: Options;
  log: Logger;
  /** The MCP endpoint; Atlassian's unless a test points elsewhere. */
  mcpUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Told when a sign-in finished, so workspaces waiting on it sync. */
  onSignedIn?: () => void;
}

export class Account {
  options: Options;
  readonly limiter: Limiter;
  readonly auth: StoredAuth;
  private session?: McpSession;
  private signing?: LoopbackSignIn;
  private pending?: Promise<void>;
  private readonly transports = new Map<string, McpTransport>();

  constructor(private readonly o: AccountOptions) {
    this.options = o.options;
    this.limiter = new Limiter({ budget: () => this.options.mcpBudget, ...(o.now ? { now: o.now } : {}) });
    this.auth = new StoredAuth({ load: () => o.secrets.get("mcpAuth"), save: (v) => o.secrets.set("mcpAuth", v) }, o.log);
  }

  get mcpUrl(): string {
    return this.o.mcpUrl ?? DEFAULT_MCP_URL;
  }

  async init(): Promise<void> {
    await this.auth.load();
  }

  setOptions(next: Options): void {
    const siteChanged = next.site !== this.options.site;
    this.options = next;
    if (siteChanged) this.transports.clear();
  }

  /** The secrets list moved (the person cleared `mcpAuth`, or a sign-in kept it): read it again. */
  async secretsChanged(): Promise<void> {
    const was = this.auth.signedIn;
    await this.auth.load();
    if (was !== this.auth.signedIn) await this.reset();
  }

  /** Why nothing syncs, if something stops it: not signed in, or signed out by Atlassian. */
  problem(): string | null {
    if (this.options.transport === "rest") return "the API-token transport comes in a later version of the Jira service: pick Sign in with Atlassian";
    if (this.auth.needed) return `${SIGN_IN_AGAIN}: ${this.auth.needed}`;
    if (!this.auth.signedIn) return "not signed in: Sign in with Atlassian";
    return null;
  }

  get signedIn(): boolean {
    return this.problem() === null;
  }

  /** The transport for `site` (the workspace's, else the plugin's setting). */
  transport(site?: string): McpTransport {
    const p = this.problem();
    if (p) throw new TransportError("auth", p);
    this.session ??= new McpSession({
      url: this.mcpUrl,
      provider: this.auth,
      limiter: this.limiter,
      log: this.o.log,
      ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
      onSignInNeeded: (why) => {
        if (!this.auth.needed) this.auth.needed = why;
      },
    });
    const key = site || this.site;
    let t = this.transports.get(key);
    if (!t) this.transports.set(key, (t = new McpTransport(this.session, { site: key })));
    return t;
  }

  private async reset(): Promise<void> {
    this.transports.clear();
    const s = this.session;
    this.session = undefined;
    await s?.close();
  }

  /** The site named at sign-in, used when the plugin's setting names none. */
  private siteAsked = "";

  /** The site to sync: the plugin's setting, else the one named at sign-in, else the first the sign-in reaches. */
  get site(): string {
    return this.options.site || this.siteAsked;
  }

  /** Start "Sign in with Atlassian": the authorize URL to open; the loopback listener waits. */
  async signIn(site?: string): Promise<{ authorizeUrl: string }> {
    if (site?.trim()) { this.siteAsked = site.trim(); this.transports.clear(); }
    if (this.options.transport === "rest") throw new TransportError("invalid", "this plugin is set to connect with an API token; set Connect with to Sign in with Atlassian");
    this.signing?.close();
    const signing = new LoopbackSignIn({ serverUrl: new URL(this.mcpUrl), fetchFn: wrapFetch(this.o.fetch ?? fetch, this.limiter), log: this.o.log });
    this.signing = signing;
    const url = await signing.start();
    this.pending = signing.done
      .then(async ({ client, tokens, redirectUrl }) => {
        await this.auth.keep(client, tokens, redirectUrl);
        await this.reset();
        this.o.log("signed in to Atlassian");
        this.o.onSignedIn?.();
      })
      .catch((e: unknown) => this.o.log("Atlassian sign-in did not finish", e))
      .finally(() => { if (this.signing === signing) this.signing = undefined; });
    return { authorizeUrl: url.toString() };
  }

  /** Settles once the sign-in started last finished and was kept, or failed. */
  signInDone(): Promise<void> | undefined {
    return this.pending;
  }

  async signOut(): Promise<void> {
    this.signing?.close();
    await this.auth.signOut();
    await this.reset();
  }

  close(): Promise<void> {
    this.signing?.close();
    return this.reset();
  }
}
