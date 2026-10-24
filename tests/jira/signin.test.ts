// "Sign in with Atlassian" (design §9.2) against the fake Rovo MCP server: the service's own
// provider, loopback listener and kept secret, driven as the tile drives them. Each test is one
// way a sign-in starts, lasts or ends.
import { afterEach, expect, test } from "bun:test";
import { CLOUD, account, closeAll, memorySecrets, rovo, signIn, toolCalls } from "./harness";
import { TransportError } from "../../tools/jira/src/service/transport";

afterEach(closeAll);

const NOW = Date.parse("2026-10-24T08:00:00.000Z");

for (const site of CLOUD) {
  test(`${site}: signing in registers a client, sends the browser through PKCE to a loopback on 127.0.0.1, and keeps the tokens in mcpAuth`, async () => {
    const f = await rovo(site);
    const r = account(f);
    const url = await signIn(r);
    expect([url.searchParams.get("code_challenge_method"), !!url.searchParams.get("code_challenge"), !!url.searchParams.get("state")]).toEqual(["S256", true, true]);
    expect(new URL(url.searchParams.get("redirect_uri")!).hostname).toBe("127.0.0.1");
    expect(f.oauth.log.map((l: { endpoint: string; grant?: string; status: number }) => [l.endpoint, l.grant ?? null, l.status])).toEqual([["register", null, 201], ["authorize", null, 302], ["token", "authorization_code", 200]]);
    const kept = JSON.parse(r.secrets.values.get("mcpAuth")!);
    expect(kept.tokens.access_token).toMatch(/^at-/);
    expect(kept.tokens.refresh_token).toMatch(/^rt-/);
    expect(r.account.problem()).toBeNull();
    expect((await r.account.transport().site()).cloudId).toBe(f.site.cloudId);
  }, 30_000);
}

test("each sign-in registers a client of its own; nothing from the last one is reused", async () => {
  const f = await rovo("cloud-scrum-company");
  const r = account(f);
  await signIn(r);
  await signIn(r);
  const registered = f.oauth.log.filter((l: { endpoint: string }) => l.endpoint === "register").map((l: { client_id: string }) => l.client_id);
  expect(registered.length).toBe(2);
  expect(registered[0]).not.toBe(registered[1]);
  expect(JSON.parse(r.secrets.values.get("mcpAuth")!).client.client_id).toBe(registered[1]);
});

test("the kept sign-in works after a restart, without signing in again", async () => {
  const f = await rovo("cloud-kanban-team");
  const secrets = memorySecrets();
  await signIn(account(f, { secrets }));
  const again = account(f, { secrets });
  await again.account.init();
  expect((await again.account.transport().site()).cloudId).toBe(f.site.cloudId);
  expect(f.oauth.log.filter((l: { endpoint: string }) => l.endpoint === "register").length).toBe(1);
});

test("an expired access token is refreshed once for calls that meet it together, and the new tokens are kept", async () => {
  // No grace for a rotated-out refresh token: a second refresh with it would be refused.
  const f = await rovo("cloud-scrum-company", { refreshGraceS: 0 });
  const r = account(f);
  await signIn(r);
  const t = r.account.transport();
  await t.site();
  const before = JSON.parse(r.secrets.values.get("mcpAuth")!).tokens.access_token;
  f.oauth.expireAccessTokens();
  const got = await Promise.all(["PAY-322", "PAY-323", "PAY-324"].map((k) => t.comments(k)));
  expect(got.length).toBe(3);
  expect(f.oauth.log.filter((l: { grant?: string }) => l.grant === "refresh_token").length).toBe(1);
  expect(JSON.parse(r.secrets.values.get("mcpAuth")!).tokens.access_token).not.toBe(before);
}, 30_000);

test("a refresh Atlassian refuses (an idle refresh token) is 'sign in again': no new registration, no consent page, and no more calls", async () => {
  let clock = NOW;
  const f = await rovo("cloud-scrum-company", { now: () => new Date(clock), refreshIdleS: 60 });
  const r = account(f);
  await signIn(r);
  const t = r.account.transport();
  await t.site();
  clock += 5 * 60_000;
  f.oauth.expireAccessTokens();
  const err = await t.comments("PAY-322").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TransportError);
  expect([(err as TransportError).kind, /sign in again/.test((err as Error).message)]).toEqual(["auth", true]);
  expect(r.account.problem()).toMatch(/^sign in again/);
  expect(f.oauth.log.map((l: { endpoint: string; grant?: string; error?: string }) => `${l.endpoint}:${l.grant ?? ""}:${l.error ?? ""}`).slice(3)).toEqual(["token:refresh_token:unauthorized_client"]);
  const seen = f.requests.length;
  expect(() => r.account.transport()).toThrow(/sign in again: Atlassian refused to refresh/);
  expect(f.requests.length).toBe(seen);
}, 30_000);

test("a grant Atlassian calls 'app not installed' (#283) is 'sign in again', from a tool call and from the site lookup", async () => {
  const f = await rovo("cloud-jwm-noboard");
  const r = account(f);
  await signIn(r);
  const t = r.account.transport();
  await t.site();
  f.oauth.setAppInstalled(false);
  const err = await t.comments("MKT-1").catch((e: unknown) => e) as TransportError;
  expect([err.kind, /not installed/.test(err.message)]).toEqual(["consent", true]);
  expect(r.account.problem()).toMatch(/^sign in again/);

  const f2 = await rovo("cloud-jwm-noboard", { appNotInstalled: true });
  const r2 = account(f2);
  await signIn(r2);
  const err2 = await r2.account.transport().site().catch((e: unknown) => e) as TransportError;
  expect(err2.kind).toBe("consent");
  expect(toolCalls(f2).map((c) => c.tool)).toEqual(["getAccessibleAtlassianResources"]);
}, 30_000);

test("a declined consent leaves the service signed out; a loopback the org's allowlist refuses is said at once", async () => {
  const f = await rovo("cloud-scrum-company", { consent: false });
  const r = account(f);
  await signIn(r);
  expect(r.account.signedIn).toBe(false);
  expect(r.secrets.values.has("mcpAuth")).toBe(false);
  expect(r.logs.some((l) => /did not finish.*access_denied/.test(l))).toBe(true);

  const f2 = await rovo("cloud-scrum-company", { allowLoopback: false });
  const r2 = account(f2);
  await r2.account.init();
  const err = await r2.account.signIn().catch((e: unknown) => e) as TransportError;
  expect([err.kind, /allowlist/.test(err.message)]).toEqual(["consent", true]);
});

test("signing out forgets the sign-in: the secret is cleared and nothing is called", async () => {
  const f = await rovo("cloud-scrum-company");
  const r = account(f);
  await signIn(r);
  await r.account.signOut();
  expect(r.secrets.values.has("mcpAuth")).toBe(false);
  const seen = f.requests.length;
  expect(() => r.account.transport()).toThrow(/not signed in|sign in again/);
  expect(f.requests.length).toBe(seen);
});
