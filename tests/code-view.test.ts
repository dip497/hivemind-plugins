// Code (VS Code's workbench) as the app runs it: drawn by Chromium, served as the app serves it, and
// told the workspace by the SDK's own fake host, which checks everything it sends as the app does.
// What it must get right is where the live terminals go: one in each editor group's body, none under
// a menu or the quick input it draws over them, and none for a tile that left.
// Needs Playwright's Chromium: `npx playwright install chromium-headless-shell`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { APP, ROOT, core } from "./app";

const { serveViewFile } = await core("view-files.ts");
const sdkBuild = async (file: string) =>
  (await build({ entryPoints: [path.join(APP, "packages/hive-view-sdk/src", file)], bundle: true, format: "esm", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const [SDK, HOST] = await Promise.all([sdkBuild("index.ts"), sdkBuild("testing.ts")]);

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/") return new Response(`<!doctype html><html><head><style>html, body { margin: 0; height: 100%; } iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }</style></head><body></body></html>`, { headers: { "content-type": "text/html" } });
    if (u.pathname === "/host.js") return new Response(HOST, { headers: { "content-type": "text/javascript" } });
    if (!u.pathname.startsWith("/view/")) return new Response(null, { status: 404 });
    const file = await serveViewFile(path.join(ROOT, "views/code/dist"), decodeURIComponent(u.pathname.slice("/view/".length)), { js: u.searchParams.get("js"), sdk: async () => SDK });
    if (file.status !== 200) return new Response(null, { status: file.status });
    return new Response("text" in file ? file.text : Bun.file(file.file), { headers: { "content-type": file.type, "content-security-policy": file.csp } });
  },
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); server.stop(true); });

type Rect = { tileId: string; x: number; y: number; w: number; h: number; chrome?: string; inert?: boolean };
type Host = { send(m: object): void; rects: Rect[]; refused: string[]; layout: unknown; commands: { name: string; args: unknown[] }[]; reveal(id: string): Promise<Rect | null> };
const host = <T,>(tab: Page, f: (h: Host) => T) => tab.evaluate(`(${f.toString()})(window.host)`) as Promise<Awaited<T>>;

const FRAMES = [{ id: "f1", title: "app", color: "#6d9eff" }];
const TILES = ["alpha", "beta", "gamma"].map((name) => ({ id: name, frameId: "f1", kind: "shell", name }));

/** Code in a page `w` x `h`, connected to a fake host with this saved layout, told `workspace`. */
async function open(layout: unknown, w = 1200, h = 800, workspace: { frames: object[]; tiles: object[] } = { frames: FRAMES, tiles: TILES }, code?: CodeAnswers) {
  const tab = await browser.newPage({ viewport: { width: w, height: h } });
  await tab.goto(server.url.href);
  await tab.evaluate(() => new Promise<void>((resolve) => {
    const f = document.createElement("iframe");
    f.onload = () => resolve();
    f.src = "/view/index.html";
    document.body.append(f);
  }));
  const frame = tab.frames().find((f) => f.url().includes("/view/"))!;
  await tab.evaluate(async ([layout, code]) => {
    const { fakeHost } = await import("/host.js" as string);
    // With `code`: an app of 1.19 that grants `workspace:code`, answering as `code` says and keeping each call.
    const calls: unknown[] = [];
    (window as unknown as { codeCalls: unknown[] }).codeCalls = calls;
    const answers = code ? { code: (c: { call: string }) => {
      calls.push(c);
      return c.call === "findFiles" ? { files: code.files, engine: "fff" } : c.call === "grep" ? { lines: code.lines, next: null, files: 1, engine: "fff" } : c.call === "open" ? { tileId: code.openIn } : null;
    } } : undefined;
    const host = fakeHost({ layout, viewport: { w: innerWidth, h: innerHeight }, capabilities: ["workspace:spawn", "workspace:close", "workspace:edit", "workspace:prompt", ...(code ? ["workspace:code"] : [])], ...(answers ? { answers } : {}) });
    (window as unknown as { host: unknown }).host = host;
    const view = document.querySelector("iframe")!.contentWindow!;
    while (!host.received.length) { host.handshake(view); await new Promise((r) => setTimeout(r, 20)); }
  }, [layout, code ?? null] as const);
  await send(tab, { type: "structure", ...workspace });
  await drawn(tab, frame);
  // Keys reach a view only once its page has them: a person clicks into it first.
  await frame.locator(".sidebar > .title").click();
  return { tab, frame };
}

type CodeAnswers = { files: { path: string }[]; lines: { path: string; line: number; col: number; text: string; ranges: [number, number][] }[]; openIn: string };
const codeCalls = (tab: Page) => tab.evaluate(() => (window as unknown as { codeCalls: unknown[] }).codeCalls);

const send = (tab: Page, msg: object) => tab.evaluate((m) => (window as unknown as { host: { send(m: object): void } }).host.send(m), msg);
/** Let the view draw and its messages cross. */
const drawn = async (tab: Page, frame: Frame) => {
  await frame.evaluate(() => new Promise<void>((r) => { let n = 0; const step = () => (++n >= 6 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step); }));
  await tab.evaluate(() => new Promise((r) => setTimeout(r, 60)));
};
/** Each editor group's body on screen: where its tile's terminal belongs. */
const bodies = (frame: Frame) => frame.evaluate(() => [...document.querySelectorAll<HTMLElement>(".group .body")].map((b) => {
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}));
const at = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x, y: r.y, w: r.w, h: r.h });

const TWO_GROUPS = { v: 1, groups: [{ id: "g1", tabs: ["alpha"], active: "alpha" }, { id: "g2", tabs: ["beta"], active: "beta" }], sizes: [0.5, 0.5], activeGroup: "g2" };

test("Code: each editor group's shown tile has its live terminal over that group's body, and it follows a resize, a side bar hidden with its key and a group closed", async () => {
  const { tab, frame } = await open(TWO_GROUPS);
  const check = async () => {
    const [rects, boxes] = [await host(tab, (h) => h.rects), await bodies(frame)];
    expect(rects.map((r) => r.tileId)).toEqual(["alpha", "beta"].slice(0, boxes.length));
    expect(rects.map(at)).toEqual(boxes);
    for (const r of rects) expect(r.chrome).toBe("none");
  };
  await check();
  const before = (await host(tab, (h) => h.rects))[1]!;

  await tab.setViewportSize({ width: 900, height: 700 });
  await send(tab, { type: "resize", w: 900, h: 700 });
  await drawn(tab, frame);
  await check();
  expect((await host(tab, (h) => h.rects))[1]!.w).toBeLessThan(before.w);

  // Ctrl+B hides the side bar, as in VS Code: the editors take its room.
  const left = (await host(tab, (h) => h.rects))[0]!.x;
  await frame.locator("body").press("Control+b");
  await drawn(tab, frame);
  await check();
  expect((await host(tab, (h) => h.rects))[0]!.x).toBeLessThan(left);

  // Closing beta's tab empties its group, which goes: alpha's terminal takes the whole width.
  await frame.locator('.group[data-group="g2"] .tab.active button[aria-label="Close beta"]').click();
  await drawn(tab, frame);
  await check();
  expect(await host(tab, (h) => h.rects.length)).toBe(1);
  expect(await host(tab, (h) => h.refused)).toEqual([]);
  await tab.close();
}, 30_000);

test("Code: the command palette and a menu take away the terminals they would cover while open, and each comes back as soon as nothing covers it", async () => {
  const { tab, frame } = await open(TWO_GROUPS);
  const shown = () => host(tab, (h) => h.rects.map((r) => r.tileId));
  expect(await shown()).toEqual(["alpha", "beta"]);

  // The palette lists every command, down over both groups' terminals.
  await frame.locator("body").press("Control+Shift+P");
  await drawn(tab, frame);
  expect(await frame.locator(".quick .item").count()).toBeGreaterThan(10);
  expect(await shown()).toEqual([]);
  // Narrowed to one command, it sits above the terminals, which come back while it is still open.
  await tab.keyboard.type("toggle panel visibility");
  await drawn(tab, frame);
  expect(await frame.locator(".quick .item").count()).toBe(1);
  expect(await shown()).toEqual(["alpha", "beta"]);
  // Enter runs it: the panel opens below the editors, and the terminals move up out of its way.
  const tall = (await host(tab, (h) => h.rects))[0]!.h;
  await tab.keyboard.press("Enter");
  await drawn(tab, frame);
  expect(await frame.locator(".quick").count()).toBe(0);
  expect(await frame.locator(".panel").count()).toBe(1);
  expect((await host(tab, (h) => h.rects))[0]!.h).toBeLessThan(tall);

  // The View menu drops over the first group's terminal only.
  await frame.locator('.menubar button:has-text("View")').click();
  await drawn(tab, frame);
  expect(await shown()).toEqual(["beta"]);
  await frame.locator(".menu").press("Escape");
  await drawn(tab, frame);
  expect(await shown()).toEqual(["alpha", "beta"]);
  expect(await host(tab, (h) => h.refused)).toEqual([]);
  await tab.close();
}, 30_000);

test("Code: the host's undock closes that tab, a tile closed elsewhere leaves its tab, and reveal opens a tile and answers where its terminal is", async () => {
  const { tab, frame } = await open(TWO_GROUPS);
  await send(tab, { type: "undock", tileId: "beta" });
  await drawn(tab, frame);
  expect(await frame.locator(".tab").allTextContents()).toEqual(["alpha"]);
  expect(await host(tab, (h) => h.rects.map((r) => r.tileId))).toEqual(["alpha"]);

  await send(tab, { type: "structure", frames: FRAMES, tiles: TILES.filter((t) => t.id !== "alpha") });
  await drawn(tab, frame);
  expect(await frame.locator(".tab").count()).toBe(0);
  expect(await frame.locator(".watermark").count()).toBe(1);
  expect(await host(tab, (h) => h.rects)).toEqual([]);

  const rect = await tab.evaluate(() => (window as unknown as { host: Host }).host.reveal("gamma"));
  await drawn(tab, frame);
  expect(await frame.locator(".tab.active").allTextContents()).toEqual(["gamma"]);
  const rects = await host(tab, (h) => h.rects);
  expect(rects.map((r) => r.tileId)).toEqual(["gamma"]);
  expect(rect).toEqual(at(rects[0]!));
  expect(await tab.evaluate(() => (window as unknown as { host: Host }).host.reveal("nobody"))).toBeNull();
  expect(await host(tab, (h) => h.refused)).toEqual([]);
  await tab.close();
}, 30_000);

test("Code: what is open comes back on the next mount from the layout it saved, a single click's preview replaced by the next, a double click's tab kept", async () => {
  const { tab, frame } = await open(null);
  const row = (id: string) => frame.locator(`[role="tree"][aria-label="Workspace"] [data-id="${id}"]`);
  await row("alpha").click();
  await row("beta").click();
  await drawn(tab, frame);
  expect(await frame.locator(".tab").allTextContents()).toEqual(["beta"]);
  expect(await frame.locator(".tab.preview").count()).toBe(1);
  await row("gamma").dblclick();
  await row("alpha").click();
  await frame.locator('button[aria-label="Split Editor Right"]').first().click();
  await tab.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  const saved = await host(tab, (h) => h.layout);
  await tab.close();

  const again = await open(saved);
  expect(await again.frame.locator(".group").evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll(".tab")].map((t) => t.textContent)))).toEqual([["gamma"], ["alpha"]]);
  expect(await host(again.tab, (h) => h.rects.map((r) => r.tileId))).toEqual(["gamma", "alpha"]);
  await again.tab.close();

  // A blob that is not a layout mounts the default: one empty group.
  const bad = await open({ v: 1, groups: [{ tabs: 42 }], sizes: "x" });
  expect(await bad.frame.locator(".watermark").count()).toBe(1);
  expect(await host(bad.tab, (h) => h.refused)).toEqual([]);
  await bad.tab.close();
}, 30_000);

test("Code: watching, the frame's code opens beside the agent shown, asked of the app once per frame, and follows to another agent's frame", async () => {
  const frames = [{ id: "web", title: "web", color: "#6d9eff", folder: { name: "web", kind: "folder" } }, { id: "api", title: "api", color: "#3fb950", folder: { name: "api", kind: "folder" } }, { id: "notes", title: "notes", color: "#d29922" }];
  const agents = [
    { id: "w1", frameId: "web", kind: "claude", name: "w1", agent: "claude" },
    { id: "a1", frameId: "api", kind: "claude", name: "a1", agent: "claude" },
    { id: "n1", frameId: "notes", kind: "claude", name: "n1", agent: "claude" },
    { id: "apicode", frameId: "api", kind: "editor", name: "Code" },
  ];
  const { tab, frame } = await open({ v: 1, groups: [{ id: "g1", tabs: ["w1"], active: "w1" }], watch: true }, 1200, 800, { frames, tiles: agents });
  const spawns = () => host(tab, (h) => h.commands.filter((c) => c.name === "spawnTile").map((c) => c.args));
  expect(await spawns()).toEqual([["editor", "web"]]);
  // Before the app opens it, someone else opens a terminal: the app is not asked again, and that
  // terminal is not taken for the code.
  const shell = { id: "sh", frameId: "web", kind: "shell", name: "sh" };
  await send(tab, { type: "structure", frames, tiles: [...agents, shell] });
  await drawn(tab, frame);
  expect(await spawns()).toEqual([["editor", "web"]]);
  expect(await frame.locator(".group").count()).toBe(1);
  // The app opens it: it goes beside the agent, whose group keeps the keyboard.
  await send(tab, { type: "structure", frames, tiles: [...agents, shell, { id: "webcode", frameId: "web", kind: "diff", name: "Code" }] });
  await drawn(tab, frame);
  const groups = () => frame.locator(".group").evaluateAll((gs) => gs.map((g) => ({ tabs: [...g.querySelectorAll(".tab")].map((t) => (t as HTMLElement).dataset.tile), focused: g.classList.contains("focused") })));
  expect(await groups()).toEqual([{ tabs: ["w1"], focused: true }, { tabs: ["webcode"], focused: false }]);
  expect(await host(tab, (h) => h.rects.map((r) => r.tileId))).toEqual(["w1", "webcode"]);
  expect(await spawns()).toEqual([["editor", "web"]]);

  // Another agent, in a frame whose code is open already: that code is shown beside it, nothing asked.
  await frame.locator('[role="tree"][aria-label="Workspace"] [data-id="a1"]').dblclick();
  await drawn(tab, frame);
  expect(await groups()).toEqual([{ tabs: ["w1", "a1"], focused: true }, { tabs: ["webcode", "apicode"], focused: false }]);
  expect(await host(tab, (h) => h.rects.map((r) => r.tileId))).toEqual(["a1", "apicode"]);
  // An agent in a frame with no folder of its own: its code is the workspace's, asked for that frame.
  await frame.locator('[role="tree"][aria-label="Workspace"] [data-id="n1"]').dblclick();
  await drawn(tab, frame);
  expect(await spawns()).toEqual([["editor", "web"], ["editor", "notes"]]);
  // Asking puts no question to the person.
  expect(await frame.locator(".dialog").count()).toBe(0);
  expect(await host(tab, (h) => h.refused)).toEqual([]);
  await tab.close();
}, 30_000);

const CODE: CodeAnswers = {
  files: [{ path: "src/checkout/cart.ts" }, { path: "src/checkout/tax.ts" }],
  lines: [
    { path: "src/checkout/tax.ts", line: 3, col: 13, text: "export const TAX_RATE = 0.2;", ranges: [[13, 21]] },
    { path: "src/checkout/tax.ts", line: 9, col: 18, text: "  return total * TAX_RATE;", ranges: [[17, 25]] },
  ],
  openIn: "gamma",
};

test("Code: Search finds lines in the workspace's files, grouped by file with each match marked, and a line opens its file in the frame's editor at that line, as a tab here", async () => {
  const { tab, frame } = await open(TWO_GROUPS, 1200, 800, { frames: FRAMES, tiles: TILES }, CODE);
  await frame.locator("body").press("Control+Shift+F");
  await frame.getByRole("textbox", { name: "Search" }).fill("TAX_RATE");
  await frame.getByRole("button", { name: "Use Regular Expression" }).click();
  const line = frame.locator('[data-code-line="src/checkout/tax.ts:3"]');
  await line.waitFor({ timeout: 5_000 });
  expect(await frame.locator('[data-code-file="src/checkout/tax.ts"]').innerText()).toContain("tax.ts");
  expect(await line.locator("mark.find").innerText()).toBe("TAX_RATE");
  expect(await frame.locator("[data-code-summary]").innerText()).toContain("2 results in 1 file");
  await line.click();
  await drawn(tab, frame);
  const calls = await codeCalls(tab);
  // The typing settled before it asked, and the regex switch asked again: the last ask is regex.
  expect(calls.filter((c) => (c as { call: string }).call === "grep").at(-1)).toEqual({ call: "grep", frameId: null, query: "TAX_RATE", mode: "regex", caseSensitive: false });
  expect(calls.at(-1)).toEqual({ call: "open", frameId: null, file: "src/checkout/tax.ts", line: 3, col: 13 });
  // The app said which tile the file opened in: it is the tab shown.
  expect(await frame.locator('.group[data-group="g2"] .tab.active').innerText()).toContain("gamma");
  expect(await host(tab, (h) => h.refused)).toEqual([]);
  await tab.close();
}, 30_000);

test("Code: Ctrl+P lists files by name as the app finds them, the tiles after; a file picked is told to the app and opens", async () => {
  const { tab, frame } = await open(TWO_GROUPS, 1200, 800, { frames: FRAMES, tiles: TILES }, CODE);
  await frame.locator("body").press("Control+p");
  await tab.keyboard.type("chkcart");
  await frame.locator('.quick .item:has-text("cart.ts")').first().waitFor({ timeout: 5_000 });
  const labels = await frame.locator(".quick .item .label").allInnerTexts();
  expect(labels.slice(0, 2)).toEqual(["cart.ts", "tax.ts"]);
  await tab.keyboard.press("Enter");
  await drawn(tab, frame);
  const calls = await codeCalls(tab);
  expect(calls.slice(-2)).toEqual([{ call: "picked", frameId: null, query: "chkcart", file: "src/checkout/cart.ts" }, { call: "open", frameId: null, file: "src/checkout/cart.ts" }]);
  expect(await frame.locator('.group[data-group="g2"] .tab.active').innerText()).toContain("gamma");
  await tab.close();
}, 30_000);

test("Code: on an app that does not find code, Search and Ctrl+P find tiles by name, as before", async () => {
  const { tab, frame } = await open(TWO_GROUPS);
  await frame.locator("body").press("Control+Shift+F");
  await frame.getByRole("textbox", { name: "Search" }).fill("gam");
  await drawn(tab, frame);
  expect(await frame.locator("[data-code-summary]").count()).toBe(0);
  expect(await frame.getByRole("tree", { name: "Search results" }).innerText()).toContain("gamma");
  expect(await host(tab, (h) => h.refused)).toEqual([]);
  await tab.close();
}, 30_000);
