// The person's Atlassian connection, shared by every workspace the service syncs: the plugin's
// options, the kept sign-in (`mcpAuth`), one MCP session and one limiter, so the hourly budget is
// one budget whatever the number of workspaces; and the API-token connection (`apiToken`, with
// `restAuth` keeping the email, site and cloud ID it was made with) and its REST limits.
//
// Which transport syncs (design §9.0): REST when the person chose the API token (the Connect with
// setting, or connecting with a token in the wizard), else the Rovo MCP server — with REST behind
// it for what MCP can't do, when a token is also there (composite.ts).
import { TransportError, type JiraTransport } from "./transport.js";
import { Limiter } from "./limiter.js";
import { forget, remember, type Logger } from "./log.js";
import { CompositeTransport, servedBy, type Served } from "./composite.js";
import { RestLimits } from "./rest/limits.js";
import { RestTransport } from "./rest/transport.js";
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
  /** The site's cloud ID, for the API token when the site's tenant_info can't be read. */
  cloudId: string;
}

export const DEFAULT_OPTIONS: Options = { site: "", transport: "mcp", email: "", project: "", scope: "mine", jql: "", push: "status", mcpBudget: 400, cloudId: "" };

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
    cloudId: String(pick("cloudId")).trim(),
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
  /** Atlassian's API host for scoped tokens; a test points it at the fake. */
  restApiBase?: string;
  /** The REST limits' clock and waits (tests). */
  restLimits?: RestLimits;
}

/** The API-token connection the wizard made (`restAuth`): what the plugin's text settings can't
 *  keep, since a service can't write them. The settings win when set. */
export interface RestAuth {
  email: string;
  site: string;
  cloudId?: string;
  /** The person chose the token over Sign in with Atlassian. */
  primary: boolean;
  /** The day the token expires (`YYYY-MM-DD`), as the person read it off Atlassian's token page:
   *  the API can't tell a token's age (design §9.1). */
  expiresOn?: string;
}

/** What a REST connection check found (the wizard's API-token step, `test-connection`). */
export interface RestCheck {
  site: string;
  cloudId: string;
  siteUrl: string;
  /** `gateway` for a scoped token, `site` for a classic one. */
  via: "gateway" | "site";
  me: string;
  /** Granular scopes the token lacks for boards and sprints (empty: none). */
  missingScopes: string[];
}

/** The transport a workspace syncs through, with what the wizard and the tile ask of it. */
export type AccountTransport = JiraTransport & {
  site(): Promise<{ cloudId: string; siteUrl: string }>;
  projects(): Promise<{ key: string; name: string }[]>;
  /** Who the sign-in or the token speaks for. */
  me(): Promise<{ accountId: string; displayName: string }>;
};

const parseRestAuth = (v: string | null): RestAuth | undefined => {
  if (!v) return undefined;
  try {
    const o = JSON.parse(v) as Partial<RestAuth>;
    return typeof o.email === "string" && typeof o.site === "string" ? { email: o.email, site: o.site, ...(o.cloudId ? { cloudId: o.cloudId } : {}), primary: !!o.primary } : undefined;
  } catch {
    return undefined;
  }
};

export class Account {
  options: Options;
  readonly limiter: Limiter;
  readonly auth: StoredAuth;
  private session?: McpSession;
  private signing?: LoopbackSignIn;
  private pending?: Promise<void>;
  private readonly transports = new Map<string, AccountTransport>();
  readonly restLimits: RestLimits;
  private apiToken: string | null = null;
  private restAuth?: RestAuth;
  /** Why Atlassian refused the API token, until the token or the settings change. */
  private restRefused?: string;

  constructor(private readonly o: AccountOptions) {
    this.options = o.options;
    this.restLimits = o.restLimits ?? new RestLimits();
    this.limiter = new Limiter({ budget: () => this.options.mcpBudget, ...(o.now ? { now: o.now } : {}) });
    this.auth = new StoredAuth({ load: () => o.secrets.get("mcpAuth"), save: (v) => o.secrets.set("mcpAuth", v) }, o.log);
  }

  get mcpUrl(): string {
    return this.o.mcpUrl ?? DEFAULT_MCP_URL;
  }

  async init(): Promise<void> {
    await this.auth.load();
    await this.loadRest();
  }

  private async loadRest(): Promise<boolean> {
    const token = (await this.o.secrets.get("apiToken"))?.trim() || null;
    const auth = parseRestAuth(await this.o.secrets.get("restAuth"));
    const changed = token !== this.apiToken || JSON.stringify(auth) !== JSON.stringify(this.restAuth);
    if (this.apiToken !== token) forget(this.apiToken);
    remember(token);
    this.apiToken = token;
    this.restAuth = auth;
    if (changed) this.restRefused = undefined;
    return changed;
  }

  setOptions(next: Options): void {
    const changed = next.site !== this.options.site || next.transport !== this.options.transport || next.email !== this.options.email || next.cloudId !== this.options.cloudId;
    this.options = next;
    if (changed) { this.transports.clear(); this.restRefused = undefined; }
  }

  /** The secrets list moved (the person cleared `mcpAuth`, set a token, or a sign-in kept one): read them again. */
  async secretsChanged(): Promise<void> {
    const was = this.auth.signedIn;
    await this.auth.load();
    const rest = await this.loadRest();
    if (was !== this.auth.signedIn) await this.reset();
    else if (rest) this.transports.clear();
  }

  /** Which transport syncs: the API token when the person chose it, else Sign in with Atlassian. */
  get transportKind(): "mcp" | "rest" {
    return this.options.transport === "rest" || this.restAuth?.primary ? "rest" : "mcp";
  }

  /** The API-token credentials, when all of them are there: the settings, else what the wizard kept. */
  private restCreds(over: { site?: string; email?: string; cloudId?: string; apiToken?: string } = {}): { site: string; email: string; cloudId: string; token: string } | undefined {
    const site = over.site?.trim() || this.options.site || this.restAuth?.site || this.siteAsked;
    const email = over.email?.trim() || this.options.email || this.restAuth?.email || "";
    const cloudId = over.cloudId?.trim() || this.options.cloudId || this.restAuth?.cloudId || "";
    const token = over.apiToken?.trim() || this.apiToken;
    return token && email && (site || cloudId) ? { site, email, cloudId, token } : undefined;
  }

  /** Why nothing syncs, if something stops it: not signed in, signed out by Atlassian, or the token refused. */
  problem(): string | null {
    if (this.transportKind === "rest") {
      if (!this.apiToken) return "no API token: paste a scoped API token in the Jira settings, or Sign in with Atlassian";
      if (!this.restCreds()) return "the API token needs your Atlassian email and your Jira site: set them in the Jira settings";
      if (this.restRefused) return this.restRefused;
      return null;
    }
    if (this.auth.needed) return `${SIGN_IN_AGAIN}: ${this.auth.needed}`;
    if (!this.auth.signedIn) return "not signed in: Sign in with Atlassian";
    return null;
  }

  /** Which transport serves each capability now (the tile's "served by"). */
  served(): Served | undefined {
    if (this.problem()) return undefined;
    const t = this.transport();
    if (t instanceof CompositeTransport) return t.served();
    return servedBy(t.capabilities, undefined, t.kind);
  }

  /** Why a token next to the sign-in isn't used (another site's, or not checkable now). */
  /** A warning from 14 days before the API token's expiry date the person gave (design §9.1). */
  tokenExpiryProblem(now = new Date()): string | undefined {
    const on = this.restAuth?.expiresOn;
    if (!on || !this.apiToken) return undefined;
    const days = Math.ceil((Date.parse(`${on}T23:59:59Z`) - now.getTime()) / 86_400_000);
    if (Number.isNaN(days) || days > 14) return undefined;
    return days < 0
      ? `your Atlassian API token expired on ${on}: make a new one and connect again in the wizard`
      : `your Atlassian API token expires on ${on} (${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}): make a new one before then`;
  }

  fallbackProblem(): string | undefined {
    for (const t of this.transports.values()) if (t instanceof CompositeTransport && t.mismatch) return t.mismatch;
    return undefined;
  }

  /** When the REST limits pause everything (a quota 429), or the MCP limiter waits. */
  rateLimitedUntil(): number | undefined {
    const a = this.limiter.rateLimitedUntil(), b = this.restLimits.rateLimitedUntil();
    return a && b ? Math.max(a, b) : a ?? b;
  }

  private rest(c: { site: string; email: string; cloudId: string; token: string }): RestTransport {
    return new RestTransport({
      site: c.site, email: c.email, token: c.token, ...(c.cloudId ? { cloudId: c.cloudId } : {}),
      limits: this.restLimits, log: this.o.log,
      ...(this.o.restApiBase ? { apiBase: this.o.restApiBase } : {}),
      ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
      onRefused: (why) => { this.restRefused = why; },
    });
  }

  get signedIn(): boolean {
    return this.problem() === null;
  }

  /** The transport for `site` (the workspace's, else the plugin's setting). */
  transport(site?: string): AccountTransport {
    const p = this.problem();
    if (p) throw new TransportError("auth", p);
    // The token is for one site: its own (the settings, or what the wizard kept), whatever the workspace names.
    const key = this.transportKind === "rest" ? "rest:" : site || this.site;
    const kept = this.transports.get(key);
    if (kept) return kept;
    if (this.transportKind === "rest") {
      const t = this.rest(this.restCreds()!);
      this.transports.set(key, t);
      return t;
    }
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
    const mcp = new McpTransport(this.session, { site: key });
    // A token next to the sign-in serves what MCP can't (design §9.0), on the same site alone.
    const creds = this.restCreds();
    const t: AccountTransport = creds ? new CompositeTransport(mcp, this.rest(creds)) : mcp;
    this.transports.set(key, t);
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
    return this.options.site || (this.transportKind === "rest" ? this.restAuth?.site ?? "" : "") || this.siteAsked;
  }

  /** Check an API-token connection without keeping anything: the cloud ID (tenant_info, or the one
   *  given), the token taken, and the board scopes it lacks. Unset values are the configured ones. */
  async testRest(a: { site?: string; email?: string; apiToken?: string; cloudId?: string; project?: string }): Promise<RestCheck> {
    await this.loadRest(); // the token as the settings have it now
    const c = this.restCreds(a);
    if (!c) throw new TransportError("invalid", "connecting with an API token needs the Jira site, your Atlassian email and the token");
    // Its own limits' quota pause is the account's: a check is no way around it.
    const t = new RestTransport({
      site: c.site, email: c.email, token: c.token, ...(c.cloudId ? { cloudId: c.cloudId } : {}), limits: this.restLimits, log: this.o.log,
      ...(this.o.restApiBase ? { apiBase: this.o.restApiBase } : {}), ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
    });
    const conn = await t.connection();
    const { siteUrl } = await t.site();
    const me = await t.discoverMe();
    return { site: new URL(siteUrl).host, cloudId: conn.cloudId, siteUrl, via: conn.via, me, missingScopes: await t.missingScopes(a.project?.trim() || this.options.project || undefined) };
  }

  /** Connect with an API token (the wizard's alternative to Sign in with Atlassian): checked first,
   *  then the token kept in `apiToken` (when given here) and the email, site and cloud ID in
   *  `restAuth`; from then on the token syncs. A missing board scope is reported, not refused: a
   *  project without boards doesn't need it. */
  async signInRest(a: { site?: string; email?: string; apiToken?: string; cloudId?: string; project?: string; expiresOn?: string }): Promise<RestCheck> {
    const check = await this.testRest(a);
    const c = this.restCreds(a)!;
    if (a.apiToken?.trim()) await this.o.secrets.set("apiToken", a.apiToken.trim());
    const expiresOn = a.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(a.expiresOn) ? a.expiresOn : undefined;
    await this.o.secrets.set("restAuth", JSON.stringify({ email: c.email, site: c.site, cloudId: check.cloudId, primary: true, ...(expiresOn ? { expiresOn } : {}) } satisfies RestAuth));
    await this.loadRest();
    await this.reset();
    this.o.log(`connected to ${check.site} with an API token (${check.via === "gateway" ? "scoped" : "classic"})${check.missingScopes.length ? `; it lacks ${check.missingScopes.join(", ")}` : ""}`);
    this.o.onSignedIn?.();
    return check;
  }

  /** Start "Sign in with Atlassian": the authorize URL to open; the loopback listener waits. */
  async signIn(site?: string): Promise<{ authorizeUrl: string }> {
    if (site?.trim()) { this.siteAsked = site.trim(); this.transports.clear(); }
    if (this.options.transport === "rest") throw new TransportError("invalid", "this plugin is set to connect with an API token; set Connect with to Sign in with Atlassian");
    // Signing in with Atlassian after connecting with a token: the sign-in syncs, the token stays
    // behind it for what MCP can't do.
    if (this.restAuth?.primary) {
      await this.o.secrets.set("restAuth", JSON.stringify({ ...this.restAuth, primary: false }));
      await this.loadRest();
      this.transports.clear();
    }
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

  /** Forget every way in: the Atlassian sign-in, and the API token with its connection. */
  async signOut(): Promise<void> {
    this.signing?.close();
    await this.auth.signOut();
    if (this.apiToken) await this.o.secrets.set("apiToken", null);
    if (this.restAuth) await this.o.secrets.set("restAuth", null);
    await this.loadRest();
    await this.reset();
  }

  close(): Promise<void> {
    this.signing?.close();
    return this.reset();
  }
}
