// Archipelago's own buttons and the widget cards over it: where a new agent goes and finding it once its
// tile opens, worked out with no app; then the view as built, served as the app serves it and drawn by
// Chromium, told the workspace by the SDK's fake host. The SDK here is this repository's copy
// (types/view-sdk), the app's own, which speaks protocol 1.18's `widgetBand` whatever app HIVEMIND_APP is.
// Needs Playwright's Chromium: `npx playwright install chromium-headless-shell`.
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { ROOT, core } from "./app";
import { LOOSE } from "../packages/archipelago/views/archipelago/src/world";
import { START_WAIT, Starts, startChoices, startTarget } from "../packages/archipelago/views/archipelago/src/start";
import { WIDGET_COLUMN, clearLeft } from "../packages/archipelago/views/archipelago/src/band";

test("Archipelago: a new agent goes on the island chosen, else on the one in view as a guess; only a guess offers the islands to choose from, and never the agents in no frame", () => {
  const islands = new Map([["web", { id: "web", title: "web" }], ["api", { id: "api", title: "api" }], [LOOSE, { id: LOOSE, title: "Not in a frame" }]]);
  expect(startTarget(islands, "api", "web")).toEqual({ id: "api", title: "api", guessed: false });
  expect(startTarget(islands, undefined, "web")).toEqual({ id: "web", title: "web", guessed: true });
  // The agents in no frame have no folder to start in: there the app chooses.
  expect(startTarget(islands, LOOSE, "web")).toBe(null);
  expect(startTarget(islands, null, LOOSE)).toBe(null);
  const ids = (target: ReturnType<typeof startTarget>) => startChoices(islands.values(), target).map((i) => i.id);
  expect(ids(startTarget(islands, null, "web"))).toEqual(["web", "api"]);
  expect(ids(startTarget(islands, null, LOOSE))).toEqual(["web", "api"]);
  expect(ids(startTarget(islands, "api", "web"))).toEqual([]);
  // One island to start on is no choice.
  expect(startChoices([{ id: "web", title: "web" }, { id: LOOSE, title: "Not in a frame" }], startTarget(islands, null, "web"))).toEqual([]);
});

test("Archipelago: an agent its own buttons started is known when its tile opens: of the kind and on the island asked for, started by no other agent, within 15 s, and once", () => {
  const t0 = Date.parse("2026-10-27T10:00:00Z");
  setSystemTime(t0);
  try {
    const starts = new Starts();
    starts.ask("claude", "web");
    expect([
      starts.opened({ frameId: "web", agent: "codex" }),
      starts.opened({ frameId: "api", agent: "claude" }),
      starts.opened({ frameId: "web" }),
      starts.opened({ frameId: "web", agent: "claude", spawnedBy: "lead" }),
    ]).toEqual([false, false, false, false]);
    setSystemTime(t0 + START_WAIT - 1000);
    expect(starts.opened({ frameId: "web", agent: "claude" })).toBe(true);
    expect(starts.opened({ frameId: "web", agent: "claude" })).toBe(false);
    // The person's default, where the app chooses: any agent, on any island, until 15 s have gone.
    starts.ask(null, null);
    setSystemTime(t0 + 2 * START_WAIT);
    expect(starts.opened({ frameId: "api", agent: "codex" })).toBe(false);
    starts.ask(null, null);
    expect(starts.opened({ frameId: "api", agent: "codex" })).toBe(true);
  } finally {
    setSystemTime();
  }
});

test("Archipelago: the widget cards take as wide a strip down the left as the app says, none along the right; from an app that does not say, one column while any sits on a card", () => {
  expect([
    clearLeft({ edge: "left", width: 520 }, false),
    clearLeft({ edge: "left", width: 0 }, true),
    clearLeft({ edge: "right", width: 268 }, true),
    clearLeft(null, true),
    clearLeft(null, false),
  ]).toEqual([520, 0, 0, WIDGET_COLUMN, 0]);
});

// ── the view as built, in Chromium ──────────────────────────────────────────

const { serveViewFile } = await core("view-files.ts");
const sdkBuild = async (file: string) =>
  (await build({ entryPoints: [path.join(ROOT, "types/view-sdk", file)], bundle: true, format: "esm", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const [SDK, HOST] = await Promise.all([sdkBuild("index.ts"), sdkBuild("testing.ts")]);
const { VIEW_FEATURES } = await import("../types/view-sdk/protocol");
const DIST = path.join(ROOT, "packages/archipelago/views/archipelago/dist");

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/") return new Response("<!doctype html><html><head><style>html, body { margin: 0; height: 100%; background: #101114; } iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }</style></head><body></body></html>", { headers: { "content-type": "text/html" } });
    if (u.pathname === "/host.js") return new Response(HOST, { headers: { "content-type": "text/javascript" } });
    const file = await serveViewFile(DIST, decodeURIComponent(u.pathname.replace(/^\/view\//, "")), { js: null, sdk: async () => SDK });
    if (file.status !== 200) return new Response(null, { status: file.status });
    return new Response("text" in file ? file.text : Bun.file(file.file), { headers: { "content-type": file.type, "content-security-policy": file.csp } });
  },
});
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); server.stop(true); });

const AGENTS = [{ id: "standin", label: "Stand-in", default: true, turns: false, resumes: false, sessions: false }];
const FRAMES = [
  { id: "f1", title: "web", color: "#5b8def", branch: "main" },
  { id: "f2", title: "api", color: "#e0a050", branch: "main" },
  { id: "f3", title: "docs", color: "#6bbf6a", branch: "main" },
];
type Tile = { id: string; frameId: string; kind: "agent"; name: string; agent: string };
const SIZE = { width: 1280, height: 800 };

/** Archipelago in a window of `size` (SIZE), connected to a fake host that may start agents, lists AGENTS,
 *  holds still between frames (no motion, effects or shadows), and wired `features` (all there are,
 *  default); `more` goes to the host as it is (the widget band it says after hello, say). */
async function open(features: readonly string[] = VIEW_FEATURES, size = SIZE, more: object = {}) {
  const tab = await browser.newPage({ viewport: size });
  await tab.goto(server.url.href);
  await tab.evaluate(() => new Promise<void>((resolve) => {
    const f = document.createElement("iframe");
    f.onload = () => resolve();
    f.src = "/view/index.html";
    document.body.append(f);
  }));
  const frame = tab.frames().find((f) => f.url().includes("/view/"))!;
  await tab.evaluate(async ({ agents, features, size, more }) => {
    const { fakeHost } = await import("/host.js" as string);
    const host = fakeHost({ capabilities: ["workspace:spawn"], features, settings: { motion: "less", effects: false, shadows: false, sky: "day" }, viewport: { w: size.width, h: size.height }, answers: { agents: () => ({ agents }) }, ...more });
    (window as unknown as { host: unknown }).host = host;
    const view = document.querySelector("iframe")!.contentWindow!;
    while (!host.received.length) { host.handshake(view); await new Promise((r) => setTimeout(r, 20)); }
  }, { agents: AGENTS, features, size, more });
  return { tab, frame };
}
/** A key pressed in the view, as the keyboard does with nothing focused. */
const press = (frame: Frame, key: string) => frame.evaluate((k) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })), key);
/** The window the view is in, made `size`, as the app tells it. */
async function resize(tab: Page, size: { width: number; height: number }) {
  await tab.setViewportSize(size);
  await send(tab, { type: "resize", w: size.width, h: size.height });
}
/** The camera the view saved last, once what it saves (400 ms after a move, and the SDK's 250 ms after
 *  that) has had time to cross. */
const savedCamera = async (tab: Page) => {
  await new Promise((r) => setTimeout(r, 1000));
  return tab.evaluate(() => JSON.stringify((window as unknown as { host: { layout?: { camera?: unknown } } }).host.layout?.camera ?? null));
};
const send = (tab: Page, msg: object) => tab.evaluate((m) => (window as unknown as { host: { send(m: object): void } }).host.send(m), msg);
/** The workspace: the three frames, and these agents in them, each watched once the view has them. */
async function workspace(tab: Page, tiles: Tile[]) {
  await send(tab, { type: "structure", frames: FRAMES, tiles, links: { pipes: [], spawns: [] } });
  await tab.waitForFunction((n) => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === n, tiles.length, { timeout: 60_000 });
  for (const t of tiles) await send(tab, { type: "status", tileId: t.id, status: "idle" });
}
/** The command the view gives the app when `act` is done, once it has crossed. */
async function commandOn(tab: Page, act: () => Promise<unknown>) {
  const count = () => tab.evaluate(() => (window as unknown as { host: { commands: unknown[] } }).host.commands.length);
  const before = await count();
  await act();
  await tab.waitForFunction((n) => (window as unknown as { host: { commands: unknown[] } }).host.commands.length > n, before);
  return tab.evaluate(() => { const c = (window as unknown as { host: { commands: { name: string; args: unknown[] }[] } }).host.commands.at(-1)!; return { name: c.name, args: c.args }; });
}
/** Let the view draw a few frames. */
const drawn = (frame: Frame, frames = 4) => frame.evaluate((n) => new Promise<void>((resolve) => {
  let k = 0;
  const step = () => (++k >= n ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), frames);
/** The start menu, opened from the toolbar: its heading, the islands it offers (the checked one
 *  marked), and its agents. */
async function startMenu(frame: Frame) {
  await frame.click(".bar .start");
  await frame.waitForSelector(".menu.crew:not([hidden])");
  return frame.evaluate(() => {
    const m = document.querySelector(".menu.crew")!;
    return {
      head: m.querySelector(".menu-head")!.textContent,
      isles: [...m.querySelectorAll('[role="menuitemradio"]')].map((b) => `${b.getAttribute("aria-checked") === "true" ? "(•)" : "( )"} ${b.textContent}`),
      agents: [...m.querySelectorAll('[role="menuitem"]')].map((b) => b.firstChild!.textContent),
    };
  });
}
/** The agent's card: its name, what it says under it, and its buttons. */
const card = (frame: Frame) => frame.evaluate(() => {
  const c = document.querySelector<HTMLElement>(".card")!;
  return c.hidden ? null : { name: c.querySelector("h3")!.textContent, says: c.querySelector("p")!.textContent, buttons: [...c.querySelectorAll(".row button")].map((b) => b.textContent) };
});
/** Where the name of the agent picked stands, as shares of the window, once shown. */
const pickedAt = (frame: Frame) => frame.evaluate(() => {
  const l = document.querySelector<HTMLElement>(".label.agent.picked");
  if (!l || l.style.display === "none") return null;
  const b = l.getBoundingClientRect();
  return { x: (b.left + b.width / 2) / innerWidth, y: b.bottom / innerHeight };
});
const opened = (tileId: string, frameId: string, more: object = {}) =>
  ({ type: "events", events: [{ kind: "tileOpened", seq: Number(tileId.slice(1)), at: Date.now(), tileId, frameId, tileKind: "agent", agent: "standin", ...more }] });

test("Archipelago: an agent started from its toolbar or an island's card is flown to, its card open with Open its terminal and the name its kind has in the start menu; one another agent started is left alone", async () => {
  const { tab, frame } = await open();
  const tiles: Tile[] = [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }];
  await workspace(tab, tiles);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  // From the toolbar, the default agent on the island in view.
  const menu = await startMenu(frame);
  const asked = await commandOn(tab, () => frame.getByRole("menuitem", { name: /Stand-in/ }).click());
  expect(asked.name).toBe("spawnAgent");
  const [agent, on] = asked.args as [string, string];
  expect([agent, menu.head]).toEqual(["standin", `Start on ${FRAMES.find((f) => f.id === on)!.title}`]);
  // Its tile opens: the islands get its worker, then the event comes.
  tiles.push({ id: "t2", frameId: on, kind: "agent", name: "beta", agent: "standin" });
  await workspace(tab, tiles);
  await send(tab, opened("t2", on));
  await frame.waitForFunction(() => !document.querySelector<HTMLElement>(".card")!.hidden);
  expect(await card(frame)).toEqual({ name: "beta", says: "ready for work · Stand-in", buttons: ["Open its terminal", "Show it on the canvas"] });
  await drawn(frame);
  const at = await pickedAt(frame);
  expect(at && at.x > 0.3 && at.x < 0.7 && at.y > 0.25 && at.y < 0.75).toBe(true);

  // From an island's card: the default agent on that island.
  await send(tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "docs" } });
  expect(await commandOn(tab, () => frame.getByRole("button", { name: "Start an agent here" }).click())).toEqual({ name: "spawnAgent", args: [null, "f3"] });
  // First one another agent started there, while the person looks at every island: not theirs.
  await frame.click(".bar .overview");
  tiles.push({ id: "t3", frameId: "f3", kind: "agent", name: "gamma", agent: "standin" });
  await workspace(tab, tiles);
  await send(tab, opened("t3", "f3", { spawnedBy: "t2" }));
  await drawn(frame);
  expect(await card(frame)).toBe(null);
  // Then theirs, the event first this time and the islands after.
  await send(tab, opened("t4", "f3"));
  tiles.push({ id: "t4", frameId: "f3", kind: "agent", name: "delta", agent: "standin" });
  await workspace(tab, tiles);
  await frame.waitForFunction(() => document.querySelector(".card h3")?.textContent === "delta");
  expect((await card(frame))!.buttons).toEqual(["Open its terminal", "Show it on the canvas"]);
  await tab.close();
}, 120_000);

test("Archipelago: with the island only the one in view, the start menu offers every island under Start on, the guess checked; choosing another starts the agent there and leaves the camera where it was", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  const menu = await startMenu(frame);
  const guess = menu.head!.replace("Start on ", "");
  expect(menu.isles).toEqual(FRAMES.map((f) => `${f.title === guess ? "(•)" : "( )"} ${f.title}`));
  // On the default agent, as before: Enter starts it.
  expect(await frame.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("menuitem");
  const other = FRAMES.find((f) => f.title !== guess)!;
  const camera = () => frame.evaluate(() => [...document.querySelectorAll<HTMLElement>(".label.island")].map((l) => l.style.transform).join(" "));
  const before = await camera();
  await frame.getByRole("menuitemradio", { name: other.title }).click();
  await drawn(frame);
  expect(await frame.evaluate(() => ({
    head: document.querySelector(".menu-head")!.textContent,
    checked: [...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map((b) => b.textContent),
    open: !document.querySelector<HTMLElement>(".menu.crew")!.hidden,
  }))).toEqual({ head: `Start on ${other.title}`, checked: [other.title], open: true });
  expect(await camera()).toBe(before);
  expect(await commandOn(tab, () => frame.getByRole("menuitem", { name: /Stand-in/ }).click())).toEqual({ name: "spawnAgent", args: ["standin", other.id] });
  // An island picked is no guess: no islands to choose.
  await send(tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "api" } });
  expect(await startMenu(frame)).toEqual({ head: "Start on api", isles: [], agents: ["Stand-in"] });
  await tab.close();
}, 120_000);

/** Where the header and the card stand, and the island names shown furthest left and highest up. */
const sides = (frame: Frame) => frame.evaluate(() => {
  const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
  const names = [...document.querySelectorAll<HTMLElement>(".label.island")].filter((l) => !l.classList.contains("away")).map((l) => l.getBoundingClientRect());
  return { head: { left: box(".head").left, bottom: box(".head").bottom }, card: box(".card").left, names: names.length, namesFrom: Math.min(...names.map((b) => b.left)) };
});

test("Archipelago: the header and the card start where the widget cards end, as wide as the app says they are; the overview frames every island beside them, and names and the arrow to a caller keep clear of them; from an app that does not say, one column; the header ends above the cards' first row", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  // Two columns of cards, 520px with the gap after them.
  await send(tab, { type: "widgetBand", edge: "left", width: 520 });
  await drawn(frame);
  const two = await sides(frame);
  expect(two.head.left).toBe(520);
  expect(two.names).toBe(FRAMES.length);
  expect(two.namesFrom).toBeGreaterThanOrEqual(520);
  // The camera moved along, the islands sliding up to the cards: a name stops at the cards' edge, never
  // under them (an island gone under them loses its name: islandInSight).
  const key = (k: string) => frame.evaluate((k) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })), k);
  for (let i = 0; i < 3; i++) await key("ArrowRight");
  await drawn(frame);
  const slid = await sides(frame);
  expect(slid.names).toBeGreaterThan(0);
  expect(slid.namesFrom).toBeGreaterThanOrEqual(520);
  // An agent calling from out of sight to the left: its arrow on the edge of the room, not under the cards.
  await send(tab, { type: "status", tileId: "t1", status: "blocked" });
  await send(tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "docs" } });
  await key("Escape");
  await drawn(frame);
  const arrows = await frame.evaluate(() => [...document.querySelectorAll(".edge")].map((b) => b.getBoundingClientRect().left));
  expect(arrows.length).toBe(1);
  expect(arrows[0]).toBeGreaterThanOrEqual(520);
  // None now.
  await send(tab, { type: "widgetBand", edge: "left", width: 0 });
  await drawn(frame);
  expect((await sides(frame)).head.left).toBe(16);
  await tab.close();

  // An app before protocol 1.18: one column wherever a widget sits on a card.
  const old = await open(VIEW_FEATURES.filter((f) => f !== "widgetBand"));
  await workspace(old.tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await send(old.tab, { type: "widgets", widgets: [{ id: "w", widget: "notes", name: "Notes", tree: null, card: true, images: {}, placement: "screen" }] });
  await send(old.tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "web" } });
  await drawn(old.frame);
  const one = await sides(old.frame);
  expect({ head: one.head.left, card: one.card }).toEqual({ head: WIDGET_COLUMN, card: WIDGET_COLUMN });
  // The app starts its cards 64px down.
  expect(one.head.bottom).toBeLessThan(64);
  await old.tab.close();
}, 120_000);

test("Archipelago: walking, the line says Esc flies you up beside the widget cards, the pressed Walk button says so and is underlined, and See every island flies you up", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  const walking = () => frame.evaluate(() => {
    const b = document.querySelector<HTMLElement>(".walk")!, line = getComputedStyle(b, "::after");
    return { on: document.documentElement.dataset.walk === "on", pressed: b.getAttribute("aria-pressed"), title: b.title, underline: line.content !== "none" ? line.backgroundColor : null };
  });
  // With two columns of widget cards, which reach past the walking line's place from the middle.
  await send(tab, { type: "widgetBand", edge: "left", width: 520 });
  await frame.click(".bar .walk");
  await drawn(frame);
  expect(await walking()).toEqual({ on: true, pressed: "true", title: "Fly back up (Esc)", underline: "rgb(251, 238, 214)" });
  expect(await frame.textContent(".walk-hint")).toBe("Esc to fly up · WASD or arrows to walk · drag to look round · Shift to run");
  expect(await frame.evaluate(() => document.querySelector(".walking")!.getBoundingClientRect().left)).toBeGreaterThanOrEqual(520);
  await frame.click(".bar .overview");
  await drawn(frame);
  expect(await walking()).toEqual({ on: false, pressed: "false", title: "Walk the islands yourself (J)", underline: null });
  await tab.close();
}, 120_000);

test("Archipelago: from the keyboard, the start menu rings the agent Enter starts, its default tag reads at 4.5:1, and the toolbar has no Settings of its own beside the app's", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await frame.focus(".bar .start");
  await tab.keyboard.press("Enter");
  await frame.waitForSelector(".menu.crew:not([hidden])");
  const look = await frame.evaluate(() => {
    const on = document.activeElement as HTMLElement, s = getComputedStyle(on), tag = on.querySelector("small")!;
    // Read on the fill of the row the keyboard is on, the lighter of the two under it.
    return { focus: on.matches(":focus-visible"), ring: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, tag: getComputedStyle(tag).color, paper: s.backgroundColor };
  });
  expect({ focus: look.focus, ring: look.ring }).toEqual({ focus: true, ring: "2px solid rgb(138, 90, 34)" });
  const lum = (c: string) => { const [r, g, b] = c.match(/\d+/g)!.slice(0, 3).map((v) => { const x = Number(v) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
  const [hi, lo] = [lum(look.tag), lum(look.paper)].sort((a, b) => b - a);
  expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(await frame.getByRole("button", { name: /settings/i }).count()).toBe(0);
  await tab.close();
}, 120_000);

test("Archipelago: opened with two columns of widget cards up, every island is framed beside them; a camera the person moved stays where it is as the cards' width changes, while at the overview a new width or a smaller window frames every island again beside them", async () => {
  // The cards already up when the view opens: the app says how wide right after hello.
  const { tab, frame } = await open(VIEW_FEATURES, { width: 1440, height: 900 }, { widgetBand: { edge: "left", width: 520 } });
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  await drawn(frame);
  const start = await sides(frame);
  expect({ head: start.head.left, names: start.names, clear: start.namesFrom >= 520 }).toEqual({ head: 520, names: FRAMES.length, clear: true });
  // Closer and to the side, nothing picked; then a card goes and the cards take one column, and comes back.
  for (const k of ["+", "+", "ArrowRight"]) await press(frame, k);
  const moved = await savedCamera(tab);
  for (const width of [268, 520]) {
    await send(tab, { type: "widgetBand", edge: "left", width });
    await drawn(frame);
    expect([width, await savedCamera(tab)]).toEqual([width, moved]);
  }
  // Every island again (Home): a new width frames them again.
  await press(frame, "Home");
  const home = await savedCamera(tab);
  await send(tab, { type: "widgetBand", edge: "left", width: 268 });
  expect(await savedCamera(tab)).not.toBe(home);
  await send(tab, { type: "widgetBand", edge: "left", width: 520 });
  const wide = await savedCamera(tab);
  // The window made smaller, the cards still two columns 520 wide, so the app says nothing new.
  await resize(tab, { width: 960, height: 640 });
  await drawn(frame);
  const small = await sides(frame);
  expect({ names: small.names, clear: small.namesFrom >= 520 }).toEqual({ names: FRAMES.length, clear: true });
  expect(await savedCamera(tab)).not.toBe(wide);
  await tab.close();
}, 120_000);

/** Boxes of what is shown, by selector: left, top, right, bottom; null where it is not shown. */
const boxes = (frame: Frame, sels: string[]) => frame.evaluate((sels) => Object.fromEntries(sels.map((sel) => {
  const e = document.querySelector<HTMLElement>(sel), r = e?.getBoundingClientRect();
  return [sel, r && r.width && !e!.closest("[hidden]") ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null];
})), sels);
const meet = (a: number[] | null, b: number[] | null) => !!a && !!b && a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
/** Rows of window size and widget band the layout round the card is checked at. */
const ROWS = [
  { size: { width: 960, height: 640 }, band: 268 },
  { size: { width: 1280, height: 720 }, band: 268 },
  { size: { width: 960, height: 640 }, band: 520 },
  { size: { width: 1280, height: 720 }, band: 520 },
  { size: { width: 1440, height: 900 }, band: 520 },
];

test("Archipelago: walking, the line says first how to fly up, and with an island's card open its switch keeps off the card: every button on the card takes its own click, beside one column of widget cards or two", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  for (const { size, band } of ROWS) {
    const where = `${size.width}x${size.height}, cards ${band} wide`;
    await resize(tab, size);
    await send(tab, { type: "widgetBand", edge: "left", width: band });
    await press(frame, "j");
    await drawn(frame);
    // Just landed: the words that say how to stop walking are shown whole, not cut off by the ellipsis.
    const esc = await frame.evaluate(() => {
      const hint = document.querySelector<HTMLElement>(".walk-hint")!, words = "Esc to fly up", at = hint.textContent!.indexOf(words);
      const r = document.createRange();
      r.setStart(hint.firstChild!, at);
      r.setEnd(hint.firstChild!, at + words.length);
      return at >= 0 && r.getBoundingClientRect().right <= hint.getBoundingClientRect().right - parseFloat(getComputedStyle(hint).paddingRight);
    });
    expect([where, esc]).toEqual([where, true]);
    await send(tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "web" } });
    await frame.waitForFunction(() => !document.querySelector<HTMLElement>(".card")!.hidden);
    await drawn(frame);
    const hits = await frame.evaluate(() => [...document.querySelectorAll<HTMLElement>(".card button")].map((b) => {
      const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return `${b.textContent}: ${at && b.contains(at) ? "its own" : `under ${at?.className || at?.tagName}`}`;
    }));
    expect([where, hits]).toEqual([where, ["alphaready for work", "Start an agent here", "Select the frame"].map((b) => `${b}: its own`)]);
    const at = await boxes(frame, [".card", ".walking", ".pov"]);
    expect([where, meet(at[".card"]!, at[".walking"]!), at[".pov"]![2]! <= size.width]).toEqual([where, false, true]);
    // Back up, for the next row.
    await press(frame, "Escape");
  }
  await tab.close();
}, 180_000);

test("Archipelago: a terminal docked while walking beside two columns of widget cards keeps clear of the card, the walking line and its switch, the island name the keyboard is on, and the cards; the app draws it where the view left it room", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island"));
  for (const { size, band } of ROWS.filter((r) => r.band === 520)) {
    const where = `${size.width}x${size.height}`;
    await resize(tab, size);
    await send(tab, { type: "widgetBand", edge: "left", width: band });
    await press(frame, "j");
    await send(tab, { type: "invoke", invokeId: 1, name: "show", args: { name: "alpha" } });
    await frame.waitForSelector(".dock[data-open]");
    await frame.focus(".label.island[data-id='f2']");
    await drawn(frame);
    const at = await boxes(frame, [".dock", ".card", ".walking", ".pov", ".label.island[data-id='f2']"]);
    const dock = at[".dock"]!, name = at[".label.island[data-id='f2']"];
    const drawnAt = await tab.evaluate(() => (window as unknown as { host: { rects: { x: number; y: number; w: number; h: number }[] } }).host.rects[0]);
    expect([where, {
      card: meet(dock, at[".card"]!), walking: meet(dock, at[".walking"]!), pov: meet(dock, at[".pov"]!) || at[".pov"]![2]! > size.width,
      name: !name ? "not shown" : meet(dock, name) ? "under the terminal" : name[0]! < band ? "under the cards" : name[2]! > size.width ? "off the window" : "shown",
      cards: dock[0]! < band, wide: dock[2]! - dock[0]! >= 300, app: drawnAt && [drawnAt.x, drawnAt.y, drawnAt.x + drawnAt.w, drawnAt.y + drawnAt.h],
    }]).toEqual([where, { card: false, walking: false, pov: false, name: "shown", cards: false, wide: true, app: dock }]);
    // Undocked and back up, for the next row.
    await press(frame, "Escape");
    await press(frame, "Escape");
  }
  await tab.close();
}, 180_000);

test("Archipelago: the islands' names do not take the mouse: a scroll over one comes closer as beside it, and a click on one leaves the keyboard where it was", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await tab.waitForFunction(() => document.querySelector("iframe")!.contentDocument!.querySelector(".label.island:not(.away)"));
  await press(frame, "Home");
  const overview = JSON.parse(await savedCamera(tab));
  const name = await frame.evaluate(() => {
    const b = document.querySelector<HTMLElement>(".label.island:not(.away)")!.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await tab.mouse.move(name.x, name.y);
  await tab.mouse.wheel(0, -400);
  expect(JSON.parse(await savedCamera(tab)).dist).toBeLessThan(overview.dist);
  await tab.mouse.click(name.x, name.y);
  expect(await frame.evaluate(() => document.activeElement?.className ?? null)).not.toContain("label");
  await tab.close();
}, 120_000);

test("Archipelago: on an island's card, the agent the keyboard is on is ringed on every side, inside the list, which scrolls and cuts off what lies outside it", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [{ id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" }]);
  await send(tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "web" } });
  await frame.waitForSelector(".card .agents button");
  await drawn(frame);
  const box = await frame.evaluate(() => { const r = document.querySelector(".card .agents button")!.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; });
  const shot = async () => (await tab.screenshot({ clip: box })).toString("base64");
  const bare = await shot();
  await frame.focus(".card .agents button");
  expect(await frame.evaluate(() => document.activeElement!.matches(".agents button:focus-visible"))).toBe(true);
  await drawn(frame);
  const ringed = await shot();
  // Which sides change: the two pixels nearest each edge, along the middle half of it.
  const sides = await tab.evaluate(async ({ a, b }) => {
    const read = async (png: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height }), g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    };
    const [p, q] = await Promise.all([read(a), read(b)]);
    const differs = (x: number, y: number) => { const i = (y * p.w + x) * 4; return Math.abs(p.d[i]! - q.d[i]!) + Math.abs(p.d[i + 1]! - q.d[i + 1]!) + Math.abs(p.d[i + 2]! - q.d[i + 2]!) > 60; };
    const along = (n: number, at: (k: number) => [number, number][]) => Array.from({ length: Math.floor(n / 2) }, (_, k) => at(Math.floor(n / 4) + k)).every((pts) => pts.some(([x, y]) => differs(x, y)));
    return {
      left: along(p.h, (y) => [[0, y], [1, y]]), right: along(p.h, (y) => [[p.w - 1, y], [p.w - 2, y]]),
      top: along(p.w, (x) => [[x, 0], [x, 1]]), bottom: along(p.w, (x) => [[x, p.h - 1], [x, p.h - 2]]),
    };
  }, { a: bare, b: ringed });
  expect(sides).toEqual({ left: true, right: true, top: true, bottom: true });
  await tab.close();
}, 120_000);

test("Archipelago: as other agents change status, the keyboard stays on the row of the calls it is on, and goes to the next one calling once that one is answered; an island's card with nothing new to say is not drawn again, and one with something new keeps the keyboard on its button", async () => {
  const { tab, frame } = await open();
  await workspace(tab, [
    { id: "t1", frameId: "f1", kind: "agent", name: "alpha", agent: "standin" },
    { id: "t2", frameId: "f2", kind: "agent", name: "beta", agent: "standin" },
    { id: "t3", frameId: "f3", kind: "agent", name: "gamma", agent: "standin" },
    { id: "t4", frameId: "f3", kind: "agent", name: "delta", agent: "standin" },
  ]);
  // alpha calls, then delta.
  await send(tab, { type: "status", tileId: "t1", status: "blocked" });
  await send(tab, { type: "status", tileId: "t4", status: "blocked" });
  await frame.waitForFunction(() => !document.querySelector<HTMLElement>(".calls")!.hidden);
  await frame.click(".calls-toggle");
  await frame.waitForSelector(".calls-list li button");
  await frame.focus(".calls-list li button");
  const mark = (sel: string) => frame.evaluate((sel) => { (document.querySelector(sel) as unknown as { kept: boolean }).kept = true; }, sel);
  const kept = (sel: string) => frame.evaluate((sel) => (document.querySelector(sel) as unknown as { kept?: boolean } | null)?.kept === true, sel);
  const gamma = async (...statuses: string[]) => { for (const status of statuses) { await send(tab, { type: "status", tileId: "t3", status }); await drawn(frame, 2); } };
  await mark(".calls-list li button");
  await gamma("working", "idle");
  expect(await frame.evaluate(() => (document.activeElement as unknown as { kept?: boolean }).kept === true)).toBe(true);
  // alpha answered: its row goes, and the keyboard with it to delta's.
  await send(tab, { type: "status", tileId: "t1", status: "idle" });
  await drawn(frame, 2);
  expect(await frame.evaluate(() => (document.activeElement as HTMLElement).closest("li")?.dataset.id ?? document.activeElement!.tagName)).toBe("t4");
  // api's card, the keyboard on Start an agent here; gamma, on docs, works and stops again.
  await send(tab, { type: "invoke", invokeId: 1, name: "island", args: { name: "api" } });
  await frame.waitForFunction(() => document.querySelector(".card h3")?.textContent === "api");
  await frame.focus(".card [data-key='start']");
  await mark(".card h3");
  await frame.evaluate(() => { const w = window as unknown as { focusins: number }; w.focusins = 0; document.querySelector(".card")!.addEventListener("focusin", () => w.focusins++); });
  const card = () => frame.evaluate(() => ({ says: document.querySelector(".card p")!.textContent, on: (document.activeElement as HTMLElement).dataset.key, focusins: (window as unknown as { focusins: number }).focusins }));
  await gamma("working", "idle");
  expect({ ...(await card()), same: await kept(".card h3") }).toEqual({ says: "1 agent · main", on: "start", focusins: 0, same: true });
  // beta, on api, starts working: the card says so, the keyboard back on the same button.
  await send(tab, { type: "status", tileId: "t2", status: "working" });
  await drawn(frame, 2);
  expect({ ...(await card()), same: await kept(".card h3") }).toEqual({ says: "1 agent · 1 working · main", on: "start", focusins: 1, same: false });
  await tab.close();
}, 120_000);
