// "Sign in with Atlassian" (design §9.2): OAuth 2.1 against the Rovo MCP server's authorization
// server, through the MCP SDK's `auth()` — dynamic client registration, PKCE S256 and a redirect
// to a loopback listener on 127.0.0.1 (Atlassian's default allowlist has `http://127.0.0.1:*/**`).
//
// - Each sign-in registers a new client. Nothing from one sign-in's discovery or registration is
//   reused for the next (CHANGE-3170 moved DCR; a cached client_id goes stale).
// - What a sign-in yields (the client and its tokens) is kept in the plugin's own `mcpAuth` secret,
//   so the service starts signed in.
// - In the background the provider refreshes (the SDK does it on a 401) but never starts a new
//   authorization: an idle refresh token (`unauthorized_client`), a revoked grant or a stale
//   one all end as "sign in again", shown in the tile, never retried in a loop.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { TransportError } from "../transport.js";
import { forget, remember, type Logger } from "../log.js";

/** What the service asks for: Jira read, write and JQL search, and a refresh token. */
export const SCOPES = ["read:jira:agent-interface", "write:jira:agent-interface", "search:jira:agent-interface", "offline_access", "read:me"].join(" ");

export const SIGN_IN_AGAIN = "sign in again";

/** Where a sign-in is kept: the plugin's `mcpAuth` secret. */
export interface AuthStore {
  load(): Promise<string | null>;
  save(value: string | null): Promise<void>;
}

interface Kept {
  v: 1;
  client: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  redirectUrl: string;
  at: string;
}

const metadata = (redirectUrl: string): OAuthClientMetadata => ({
  client_name: "Hivemind",
  redirect_uris: [redirectUrl],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: SCOPES,
});

/** Thrown where the person has to sign in again; the transport reports it as `auth`. */
export class SignInNeeded extends TransportError {
  constructor(why: string) {
    super("auth", `${SIGN_IN_AGAIN}: ${why}`);
  }
}

/**
 * The background provider: the kept sign-in, refreshed by the SDK when the server says the access
 * token expired. It never opens a browser; anything that would is "sign in again".
 */
export class StoredAuth implements OAuthClientProvider {
  private kept: Kept | null = null;
  /** Why the person must sign in again, while they must. */
  needed: string | null = null;

  constructor(private readonly store: AuthStore, private readonly log: Logger) {}

  /** Read the kept sign-in. False when there is none. */
  async load(): Promise<boolean> {
    const raw = await this.store.load();
    this.kept = null;
    if (!raw) return false;
    try {
      const k = JSON.parse(raw) as Kept;
      if (k?.v !== 1 || !k.client || !k.tokens?.access_token || !k.redirectUrl) throw new Error("not a sign-in this service kept");
      this.kept = k;
      remember(k.tokens.access_token);
      remember(k.tokens.refresh_token);
      this.needed = null;
      return true;
    } catch (e) {
      this.log("the kept Atlassian sign-in can't be read; sign in again", e);
      this.needed = "the kept sign-in can't be read";
      return false;
    }
  }

  get signedIn(): boolean {
    return !!this.kept && !this.needed;
  }

  /** Keep a sign-in a `LoopbackSignIn` finished. */
  async keep(client: OAuthClientInformationMixed, tokens: OAuthTokens, redirectUrl: string): Promise<void> {
    this.kept = { v: 1, client, tokens, redirectUrl, at: new Date().toISOString() };
    remember(tokens.access_token);
    remember(tokens.refresh_token);
    this.needed = null;
    await this.store.save(JSON.stringify(this.kept));
  }

  async signOut(): Promise<void> {
    forget(this.kept?.tokens.access_token);
    this.kept = null;
    this.needed = "signed out";
    await this.store.save(null);
  }

  private stop(why: string): never {
    if (!this.needed) this.log(`Atlassian sign-in stopped working (${why}); the person has to sign in again`);
    this.needed = why;
    throw new SignInNeeded(why);
  }

  // ── OAuthClientProvider ─────────────────────────────────────────────────────────────────────
  get redirectUrl(): string | undefined {
    // Set, so the SDK refreshes rather than trying a client-credentials grant; never redirected to.
    return this.kept?.redirectUrl ?? "http://127.0.0.1/";
  }
  get clientMetadata(): OAuthClientMetadata {
    return metadata(this.redirectUrl!);
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.needed ? undefined : this.kept?.client;
  }
  saveClientInformation(): void {
    // Only a new authorization registers, and the background never starts one (redirect throws).
  }
  tokens(): OAuthTokens | undefined {
    if (this.needed) this.stop(this.needed);
    return this.kept?.tokens;
  }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (!this.kept) return;
    forget(this.kept.tokens.access_token);
    this.kept = { ...this.kept, tokens: { ...tokens, refresh_token: tokens.refresh_token ?? this.kept.tokens.refresh_token }, at: new Date().toISOString() };
    remember(tokens.access_token);
    remember(tokens.refresh_token);
    await this.store.save(JSON.stringify(this.kept));
  }
  redirectToAuthorization(): void {
    this.stop(this.kept?.tokens.refresh_token ? "Atlassian refused to refresh the sign-in" : "the sign-in expired");
  }
  saveCodeVerifier(): void {}
  codeVerifier(): string {
    return "";
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    // The SDK's answer to `unauthorized_client` / `invalid_grant` on refresh is to register again and
    // send the person to consent; stop here instead.
    if (scope === "all" || scope === "client" || scope === "tokens") this.stop("Atlassian refused to refresh the sign-in");
  }
}

/** One sign-in in progress: a fresh client, PKCE, and the loopback listener its redirect lands on. */
class SignInProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  authorizeUrl?: URL;
  readonly expectedState = randomBytes(16).toString("base64url");
  constructor(readonly redirectUrl: string) {}
  get clientMetadata() { return metadata(this.redirectUrl); }
  state() { return this.expectedState; }
  clientInformation() { return this.info; }
  saveClientInformation(i: OAuthClientInformationMixed) { this.info = i; }
  tokens() { return this.saved; }
  saveTokens(t: OAuthTokens) { this.saved = t; }
  redirectToAuthorization(url: URL) { this.authorizeUrl = url; }
  saveCodeVerifier(v: string) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
}

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;margin:3em"><h1>${title}</h1><p>${text}</p></body>`;

export interface SignInOptions {
  /** The MCP endpoint whose authorization server signs in. */
  serverUrl: URL;
  fetchFn?: typeof fetch;
  /** How long the loopback listener waits for the browser. Default 10 minutes. */
  waitMs?: number;
  log: Logger;
}

/**
 * Start a sign-in: register a client, build the authorize URL (PKCE S256, a state), and listen on
 * 127.0.0.1 for the redirect. Answers the URL to open; `done` settles once the browser came back
 * and the code was exchanged, with the client and tokens to keep.
 */
export class LoopbackSignIn {
  private server?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  done!: Promise<{ client: OAuthClientInformationMixed; tokens: OAuthTokens; redirectUrl: string }>;

  constructor(private readonly o: SignInOptions) {}

  async start(): Promise<URL> {
    const server = createServer();
    this.server = server;
    await new Promise<void>((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", () => r()); });
    const redirectUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    const provider = new SignInProvider(redirectUrl);
    let settle!: { resolve(v: { client: OAuthClientInformationMixed; tokens: OAuthTokens; redirectUrl: string }): void; reject(e: unknown): void };
    this.done = new Promise((resolve, reject) => (settle = { resolve, reject }));
    this.done.catch(() => {}); // a caller that never waits isn't an unhandled rejection
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirectUrl);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const finish = (status: number, title: string, text: string) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }); res.end(page(title, text)); };
      const error = u.searchParams.get("error");
      if (u.searchParams.get("state") !== provider.expectedState) { finish(400, "Sign-in not recognised", "This page doesn't belong to the sign-in Hivemind started. Start it again from the Jira tile."); return; }
      if (error) {
        finish(200, "Sign-in cancelled", "Atlassian didn't sign you in. You can close this window and try again from the Jira tile.");
        settle.reject(new TransportError(error === "access_denied" ? "consent" : "auth", `Atlassian sign-in ended: ${error}`));
        this.close();
        return;
      }
      const code = u.searchParams.get("code");
      if (!code) { finish(400, "Sign-in incomplete", "Atlassian sent no code."); return; }
      void auth(provider, { serverUrl: this.o.serverUrl, authorizationCode: code, fetchFn: this.o.fetchFn })
        .then(() => {
          if (!provider.info || !provider.saved) throw new Error("the sign-in gave no tokens");
          finish(200, "Signed in to Atlassian", "Hivemind is connected to Jira. You can close this window.");
          settle.resolve({ client: provider.info, tokens: provider.saved, redirectUrl });
        })
        .catch((e: unknown) => {
          finish(500, "Sign-in failed", "Atlassian refused the sign-in. Start it again from the Jira tile.");
          settle.reject(e instanceof TransportError ? e : new TransportError("auth", `Atlassian sign-in failed: ${(e as Error).message}`));
        })
        .finally(() => this.close());
    });
    try {
      const r = await auth(provider, { serverUrl: this.o.serverUrl, scope: SCOPES, fetchFn: this.o.fetchFn });
      if (r !== "REDIRECT" || !provider.authorizeUrl) throw new Error("the authorization server gave no page to sign in on");
    } catch (e) {
      this.close();
      const msg = (e as Error).message;
      throw new TransportError(/redirect|allowlist/i.test(msg) ? "consent" : "auth", `Atlassian sign-in could not start: ${msg}`);
    }
    this.timer = setTimeout(() => { settle.reject(new TransportError("auth", "nobody finished the Atlassian sign-in in the browser")); this.close(); }, this.o.waitMs ?? 600_000);
    this.timer.unref?.();
    return provider.authorizeUrl;
  }

  close(): void {
    clearTimeout(this.timer);
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = undefined;
  }
}
