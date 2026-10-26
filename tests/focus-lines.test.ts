// Focus's line slots (protocol 1.17, `lineSlots`): on a host that draws them, one under each agent's
// name, at least 20px high, following the rows as the workspace changes and the view is resized; on
// a host that does not, none, and the rows as they were. Focus drawn by Chromium as the app serves
// it, told the workspace by the SDK's own fake host, which checks what it sends as the app does.
// Needs Playwright's Chromium: `npx playwright install chromium-headless-shell`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { APP, ROOT, core, viewSdk } from "./app";

const { serveViewFile } = await core("view-files.ts");
const { VIEW_FEATURES } = await viewSdk("protocol.ts");
const sdkBuild = async (file: string) =>
  (await build({ entryPoints: [path.join(APP, "packages/hive-view-sdk/src", file)], bundle: true, format: "esm", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const [SDK, HOST] = await Promise.all([sdkBuild("index.ts"), sdkBuild("testing.ts")]);
// The latest release has no line slots: there, only the row without them runs.
const HAS_LINES = (VIEW_FEATURES as string[]).includes("lineSlots");
const ON_117 = HAS_LINES ? "" : " (skipped: the app at HIVEMIND_APP has no lineSlots)";

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/") return new Response(`<!doctype html><html><head><style>html, body { margin: 0; height: 100%; } iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }</style></head><body></body></html>`, { headers: { "content-type": "text/html" } });
    if (u.pathname === "/host.js") return new Response(HOST, { headers: { "content-type": "text/javascript" } });
    if (!u.pathname.startsWith("/view/")) return new Response(null, { status: 404 });
    const file = await serveViewFile(path.join(ROOT, "views/focus/dist"), decodeURIComponent(u.pathname.slice("/view/".length)), { js: u.searchParams.get("js"), sdk: async () => SDK });
    if (file.status !== 200) return new Response(null, { status: file.status });
    return new Response("text" in file ? file.text : Bun.file(file.file), { headers: { "content-type": file.type, "content-security-policy": file.csp } });
  },
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); server.stop(true); });

type Rect = { tileId: string; x: number; y: number; w: number; h: number };
const agent = (id: string) => ({ id, frameId: null, kind: "terminal", name: id, agent: "claude" });

/** Focus open in a page of `height`, connected to a fake host with `features`. */
async function open(features: string[], height = 700) {
  const tab = await browser.newPage({ viewport: { width: 1000, height } });
  await tab.goto(server.url.href);
  await tab.evaluate(() => new Promise<void>((resolve) => {
    const f = document.createElement("iframe");
    f.onload = () => resolve();
    f.src = "/view/index.html";
    document.body.append(f);
  }));
  const frame = tab.frames().find((f) => f.url().includes("/view/"))!;
  await tab.evaluate(async (features) => {
    const { fakeHost } = await import("/host.js" as string);
    const host = fakeHost({ features, viewport: { w: innerWidth, h: innerHeight } });
    (window as unknown as { host: unknown }).host = host;
    const view = document.querySelector("iframe")!.contentWindow!;
    while (!host.received.length) { host.handshake(view); await new Promise((r) => setTimeout(r, 20)); }
  }, features);
  return { tab, frame };
}

const send = (tab: Page, msg: object) => tab.evaluate((m) => (window as unknown as { host: { send(m: object): void } }).host.send(m), msg);
const lines = (tab: Page) => tab.evaluate(() => (window as unknown as { host: { lines: Rect[] } }).host.lines);
const refused = (tab: Page) => tab.evaluate(() => (window as unknown as { host: { refused: string[] } }).host.refused);
const received = (tab: Page) => tab.evaluate(() => (window as unknown as { host: { received: { type: string }[] } }).host.received.map((m) => m.type));
const structure = (tab: Page, ids: string[]) => send(tab, { type: "structure", frames: [], tiles: ids.map(agent) });
/** Let the view draw and its messages cross. */
const drawn = async (tab: Page, frame: Frame) => {
  await frame.evaluate(() => new Promise<void>((r) => { let n = 0; const step = () => (++n >= 6 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step); }));
  await tab.evaluate(() => new Promise((r) => setTimeout(r, 50)));
};
/** Each listed agent's name as it is on screen, in list order, and the list's own box. */
const names = (frame: Frame) => frame.evaluate(() => ({
  rows: [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => {
    const b = row.querySelector(".text-row")!.getBoundingClientRect();
    return { name: row.dataset.agent!, left: b.left, bottom: b.bottom, height: row.getBoundingClientRect().height };
  }),
  list: (() => { const b = document.querySelector('[role="listbox"]')!.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; })(),
}));

/** One slot per agent in sight, each under its own name, in its column, and tall enough. */
async function expectUnderNames(tab: Page, frame: Frame, count: number) {
  const [got, seen] = await Promise.all([lines(tab), names(frame)]);
  const shown = seen.rows.filter((r) => r.bottom <= seen.list.bottom);
  expect(got).toHaveLength(count);
  for (const rect of got) {
    const row = seen.rows.find((r) => r.name === rect.tileId)!;
    expect(row).toBeDefined();
    expect(rect.h).toBeGreaterThanOrEqual(20);
    expect(Math.abs(rect.x - row.left)).toBeLessThanOrEqual(1);
    expect(rect.w).toBeGreaterThan(100);
    // Right under the name, and inside the list in sight.
    expect(rect.y).toBeGreaterThanOrEqual(row.bottom - 1);
    expect(rect.y - row.bottom).toBeLessThan(24);
    expect(rect.y).toBeGreaterThanOrEqual(seen.list.top);
    expect(rect.y + rect.h).toBeLessThanOrEqual(seen.list.bottom + 1);
  }
  expect(got.map((r) => r.tileId).sort()).toEqual(shown.map((r) => r.name).slice(0, count).sort());
}

test.skipIf(!HAS_LINES)(`Focus: on a host with line slots, one under each agent's name, and they follow the rows on structure and resize${ON_117}`, async () => {
  const { tab, frame } = await open([...VIEW_FEATURES], 700);
  await structure(tab, ["alpha", "beta", "gamma"]);
  await drawn(tab, frame);
  await expectUnderNames(tab, frame, 3);
  const first = await lines(tab);

  // A new agent: a slot for it too, and the others where their rows are now.
  await structure(tab, ["alpha", "beta", "gamma", "delta"]);
  await drawn(tab, frame);
  await expectUnderNames(tab, frame, 4);
  // One gone: its slot goes with it.
  await structure(tab, ["beta", "gamma", "delta"]);
  await drawn(tab, frame);
  await expectUnderNames(tab, frame, 3);
  expect((await lines(tab)).map((r) => r.tileId)).not.toContain("alpha");
  expect(first.find((r) => r.tileId === "beta")!.y).not.toBe((await lines(tab)).find((r) => r.tileId === "beta")!.y);

  // Resized so the list holds fewer rows: only the slots still in sight, and all of them again after.
  await structure(tab, Array.from({ length: 8 }, (_, i) => `agent${i}`));
  await drawn(tab, frame);
  await expectUnderNames(tab, frame, 8);
  await tab.setViewportSize({ width: 1000, height: 300 });
  await send(tab, { type: "resize", w: 1000, h: 300 });
  await drawn(tab, frame);
  const fewer = (await lines(tab)).length;
  expect(fewer).toBeGreaterThan(0);
  expect(fewer).toBeLessThan(8);
  await expectUnderNames(tab, frame, fewer);
  await tab.setViewportSize({ width: 1000, height: 900 });
  await send(tab, { type: "resize", w: 1000, h: 900 });
  await drawn(tab, frame);
  await expectUnderNames(tab, frame, 8);

  // Scrolled, the slots move with the rows.
  await tab.setViewportSize({ width: 1000, height: 300 });
  await drawn(tab, frame);
  const before = await lines(tab);
  await frame.evaluate(() => { document.querySelector('[role="listbox"]')!.scrollTop = 60; });
  await drawn(tab, frame);
  expect(await lines(tab)).not.toEqual(before);
  await expectUnderNames(tab, frame, (await lines(tab)).length);

  expect(await refused(tab)).toEqual([]);
  await tab.close();
});

test("Focus: on a host without line slots, it sends none and its rows are as they were", async () => {
  const { tab, frame } = await open(VIEW_FEATURES.filter((f: string) => f !== "lineSlots"));
  await structure(tab, ["alpha", "beta", "gamma"]);
  await drawn(tab, frame);
  expect(await received(tab)).not.toContain("lineRects");
  expect(await frame.locator("[data-line]").count()).toBe(0);
  for (const r of (await names(frame)).rows) expect(r.height).toBe(44);
  expect(await refused(tab)).toEqual([]);
  await tab.close();
});
