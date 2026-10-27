// Views as a person sees them: drawn by Chromium over the backdrop the app paints behind them,
// served as the app serves them (its own serveViewFile and SDK), and told the app's presets by the
// SDK's own fake host. What a view paints has to read in every preset, dark or light, and after a
// live switch between them. Needs Playwright's Chromium: `npx playwright install chromium-headless-shell`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { APP, ROOT, core } from "./app";

const { serveViewFile } = await core("view-files.ts");
const { PRESETS, ACCENTS } = await core("settings-schema.ts");
type Preset = { mode: "dark" | "light"; accent: string; palette: Record<string, string> };
const PRESET_IDS = Object.keys(PRESETS);
/** The dark presets, each once: Clean sends a view the same colours as Signal. */
const DARK = PRESET_IDS.filter((id, i) => {
  const look = ({ mode, accent, palette }: Preset) => JSON.stringify([mode, accent, palette]);
  return (PRESETS[id] as Preset).mode === "dark" && PRESET_IDS.findIndex((other) => look(PRESETS[other]) === look(PRESETS[id])) === i;
});
// Light mode is most of what these guard, and an app from before Clean Light (the latest release,
// which CI tests against too) has no light preset. There the rows on Clean Light are skipped, under a
// name that says so, instead of passing without it; the rows on the dark presets run on either.
const LIGHT = (PRESETS["clean-light"] as Preset | undefined)?.mode === "light";
const NO_LIGHT = "skipped: the app at HIVEMIND_APP has no Clean Light preset";
const ON_LIGHT = LIGHT ? "on Clean Light" : `on Clean Light (${NO_LIGHT})`;
if (!LIGHT) console.log(`views-theme: ${NO_LIGHT} (${APP} has ${PRESET_IDS.join(", ")}), so the rows on Clean Light do not run.`);

// The SDK the app serves every view, built from the same entry, and the fake host from its testing module.
const sdkBuild = async (file: string) =>
  (await build({ entryPoints: [path.join(APP, "packages/hive-view-sdk/src", file)], bundle: true, format: "esm", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const [SDK, HOST] = await Promise.all([sdkBuild("index.ts"), sdkBuild("testing.ts")]);

/** The folder HiveHub lists for a view, of its own or in a package: a TypeScript view's build, a plain one's own folder. */
const packageOf = (name: string) => {
  const dir = [path.join(ROOT, "views", name), ...readdirSync(path.join(ROOT, "packages")).map((p) => path.join(ROOT, "packages", p, "views", name))].find((d) => existsSync(d))!;
  return existsSync(path.join(dir, "src")) ? path.join(dir, "dist") : dir;
};

// The app's side: a page whose ground is the backdrop, the view in an iframe that keeps the
// colour scheme normal (the app's styles.css), and helpers that read what reaches the screen.
const HOST_PAGE = `<!doctype html><html><head><style>
html, body { margin: 0; height: 100%; }
iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
</style><script>
const one = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
const rgb = (css) => { one.clearRect(0, 0, 1, 1); one.fillStyle = "#000"; one.fillStyle = css; one.fillRect(0, 0, 1, 1); return [...one.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
/** A CSS colour as [r, g, b, alpha]. */
const rgba = (css) => { one.clearRect(0, 0, 1, 1); one.fillStyle = "#000"; one.fillStyle = css; one.fillRect(0, 0, 1, 1); const d = one.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
/** A CSS colour as the app sends it to a view: #rrggbb. */
window.hex = (css) => "#" + rgb(css).map((v) => v.toString(16).padStart(2, "0")).join("");
/** What \`colour\`, at \`alpha\`, laid over \`under\` comes to on screen. */
window.over = (under, colour, alpha = 1) => { one.fillStyle = under; one.fillRect(0, 0, 1, 1); one.globalAlpha = alpha; one.fillStyle = colour; one.fillRect(0, 0, 1, 1); one.globalAlpha = 1; return [...one.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
window.lum = lum;
/** The WCAG contrast of two [r, g, b]. */
window.contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** A screenshot's pixels: its width, height and RGBA bytes. */
const pixels = async (png) => {
  const img = new Image();
  img.src = "data:image/png;base64," + png;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
};
/** A screenshot's pixels against the backdrop: the highest contrast any of them has with it, and how many differ from it. */
window.against = async (png, backdrop) => {
  const { d } = await pixels(png), ground = rgb(backdrop);
  let most = 1, differ = 0;
  for (let i = 0; i < d.length; i += 4) {
    const px = [d[i], d[i + 1], d[i + 2]];
    if (px.some((v, k) => Math.abs(v - ground[k]) > 2)) { differ++; most = Math.max(most, contrast(px, ground)); }
  }
  return { most, differ };
};
/** For each box of words on screen: the lowest contrast its ink, at its alpha, has with what is under
 *  the words, and over how many pixels. The words' pixels are those that differ between \`shown\` (a
 *  screenshot) and \`bare\` (one with the words taken out), and what is under them is \`bare\`'s. */
window.under = async (shown, bare, boxes) => {
  const [a, b] = await Promise.all([pixels(shown), pixels(bare)]);
  return boxes.map(({ ink, alpha, x, y, w, h }) => {
    const [r, g, bl, k] = rgba(ink), t = k * alpha;
    let least = Infinity, n = 0;
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(a.h, Math.ceil(y + h)); j++) {
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(a.w, Math.ceil(x + w)); i++) {
        const p = (j * a.w + i) * 4;
        if (Math.abs(a.d[p] - b.d[p]) + Math.abs(a.d[p + 1] - b.d[p + 1]) + Math.abs(a.d[p + 2] - b.d[p + 2]) < 6) continue;
        const ground = [b.d[p], b.d[p + 1], b.d[p + 2]];
        least = Math.min(least, contrast([r, g, bl].map((v, c) => v * t + ground[c] * (1 - t)), ground));
        n++;
      }
    }
    return { least: n ? least : 1, n };
  });
};
/** A pin's disc and mark in a screenshot of it: the colour most of it is, where that colour's middle
 *  is, and, well inside the disc (its dark rim left out), the pixel that differs from it most. */
window.pin = async (png) => {
  const { w, h, d } = await pixels(png);
  const count = new Map();
  for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; count.set(k, (count.get(k) ?? 0) + 1); }
  const [fill, area] = [...count].sort((p, q) => q[1] - p[1])[0];
  const disc = [fill >> 16, (fill >> 8) & 255, fill & 255];
  let cx = 0, cy = 0;
  for (let i = 0; i < d.length; i += 4) if (((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) === fill) { cx += (i / 4) % w; cy += Math.floor(i / 4 / w); }
  cx /= area; cy /= area;
  const inside = 0.8 * Math.sqrt(area / Math.PI);
  let mark = disc, most = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.hypot(x - cx, y - cy) > inside) continue;
    const p = (y * w + x) * 4, px = [d[p], d[p + 1], d[p + 2]], c = contrast(px, disc);
    if (c > most) { most = c; mark = px; }
  }
  return { disc, mark, area, contrast: most, darker: lum(mark) < lum(disc) };
};
</script></head><body></body></html>`;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/") return new Response(HOST_PAGE, { headers: { "content-type": "text/html" } });
    if (u.pathname === "/host.js") return new Response(HOST, { headers: { "content-type": "text/javascript" } });
    const [, name, rel] = /^\/view\/([\w-]+)\/(.*)$/.exec(u.pathname) ?? [];
    if (!name || rel === undefined) return new Response(null, { status: 404 });
    const file = await serveViewFile(packageOf(name), decodeURIComponent(rel), { js: u.searchParams.get("js"), sdk: async () => SDK });
    if (file.status !== 200) return new Response(null, { status: file.status });
    return new Response("text" in file ? file.text : Bun.file(file.file), { headers: { "content-type": file.type, "content-security-policy": file.csp } });
  },
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); server.stop(true); });

/** The theme the app sends a view for a preset, each token resolved to hex as the app resolves it:
 *  under glass or not, with another accent, or with colours of the palette the person changed. */
async function themeOf(page: Page, id: string, o: { glass?: boolean; accent?: string; palette?: Record<string, string> } = {}) {
  const p = PRESETS[id] as Preset;
  const a = ACCENTS[o.accent ?? p.accent] as { brand: string; accent: string };
  return page.evaluate(({ palette, mode, brand, accent, glass }) => {
    const hex = (window as unknown as { hex: (c: string) => string }).hex;
    const colors = Object.fromEntries(Object.entries({ ...palette, brand, accent }).map(([k, v]) => [k, hex(v)]));
    return { colors, mode, accent: colors.brand!, radius: 8, surface: colors.bg2!, glass };
  }, { palette: { ...p.palette, ...o.palette }, mode: p.mode, brand: a.brand, accent: a.accent, glass: o.glass ?? false });
}

/** The app with `view` open over `backdrop` (its page: `__entry.html?js=…` for a `.js` entry). */
async function open(view: string, page: string, backdrop: string, viewport = { width: 800, height: 600 }, init?: () => void) {
  const tab = await browser.newPage({ viewport });
  if (init) await tab.addInitScript(init);
  await tab.goto(`${server.url}`);
  await ground(tab, backdrop);
  await tab.evaluate((src) => new Promise<void>((resolve) => {
    const f = document.createElement("iframe");
    f.onload = () => resolve();
    f.src = src;
    document.body.append(f);
  }), `/view/${view}/${page}`);
  const frame = tab.frames().find((f) => f.url().includes(`/view/${view}/`))!;
  return { tab, frame };
}

/** The app's ground behind the view: the theme's own, or a wallpaper's. */
const ground = (tab: Page, backdrop: string) => tab.evaluate((c) => { document.body.style.background = c; }, backdrop);

/** Hand the view its port and hello, as the app does once the frame has loaded. */
const connectView = (tab: Page, hello: object) => tab.evaluate(async (opts) => {
  const { fakeHost } = await import("/host.js" as string);
  const host = fakeHost(opts);
  (window as unknown as { host: unknown }).host = host;
  const view = document.querySelector("iframe")!.contentWindow!;
  while (!host.received.length) { host.handshake(view); await new Promise((r) => setTimeout(r, 20)); }
}, hello);

const send = (tab: Page, msg: object) => tab.evaluate((m) => (window as unknown as { host: { send(m: object): void } }).host.send(m), msg);

/** Let the view draw a few frames. */
const drawn = (frame: Frame, frames = 8) => frame.evaluate((frames) => new Promise<void>((resolve) => {
  let n = 0;
  const step = () => (++n >= frames ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), frames);

type Words = { sel: string; ink: string; alpha: number; x: number; y: number; w: number; h: number };
type Helpers = {
  over(u: string, c: string, alpha?: number): number[];
  contrast(a: number[], b: number[]): number;
  against(png: string, backdrop: string): Promise<{ most: number; differ: number }>;
  under(shown: string, bare: string, boxes: Words[]): Promise<{ least: number; n: number }[]>;
  pin(png: string): Promise<{ disc: number[]; mark: number[]; area: number; contrast: number; darker: boolean }>;
};
const against = async (tab: Page, clip: { x: number; y: number; width: number; height: number } | undefined, backdrop: string) => {
  const png = (await tab.screenshot(clip ? { clip } : {})).toString("base64");
  return tab.evaluate(({ png, backdrop }) => (window as unknown as Helpers).against(png, backdrop), { png, backdrop });
};

/** The words in the view: the box each one's text fills on screen, its colour, and the alpha it is
 *  drawn with, which counts its own opacity and that of every element it sits in (the paper under it
 *  is in the screenshot already, at the opacity it is drawn with). */
const wordsOf = (frame: Frame, selectors: string[]) => frame.evaluate((sels) => sels.flatMap((sel) => [...document.querySelectorAll(sel)].flatMap((el) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const b = range.getBoundingClientRect();
  if (!b.width || !b.height) return [];
  let alpha = 1;
  for (let at: Element | null = el; at; at = at.parentElement) alpha *= Number(getComputedStyle(at).opacity);
  return [{ sel, ink: getComputedStyle(el).color, alpha, x: b.x, y: b.y, w: b.width, h: b.height }];
})), selectors);

/** How the words of each of `selectors` read on what the screen shows under them, from a screenshot
 *  with them and one without (their colour taken out, not their room): the lowest contrast any pixel
 *  they cover has with their ink. */
async function reads(tab: Page, frame: Frame, selectors: string[]) {
  const words = await wordsOf(frame, selectors);
  // A screenshot waits for a frame drawn after what came before it.
  const shown = (await tab.screenshot()).toString("base64");
  await frame.evaluate(() => {
    const hush = document.createElement("style");
    hush.id = "hush";
    hush.textContent = "*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-shadow: none !important; }";
    document.head.append(hush);
  });
  const bare = (await tab.screenshot()).toString("base64");
  await frame.evaluate(() => document.getElementById("hush")!.remove());
  const seen = await tab.evaluate((a) => (window as unknown as Helpers).under(a.shown, a.bare, a.words), { shown, bare, words });
  return words.map(({ sel }, i) => ({ sel, ...seen[i]! }));
}

/** Constellation opened in `from` and switched live through `ids`. */
async function constellation(from: string, ids: string[]) {
  const { tab, frame } = await open("constellation", "__entry.html?js=index.js", "#000");
  const first = await themeOf(tab, from);
  await ground(tab, first.colors.bg!);
  await connectView(tab, { theme: first, settings: { turn: false } });

  // Nothing but the far stars is drawn on the right half until there is a workspace: they have
  // to stand out from the backdrop (white specks on Clean Light came to 1.06:1, unseen).
  const dim: string[] = [];
  for (const id of ids) {
    const theme = await themeOf(tab, id);
    await ground(tab, theme.colors.bg!);
    await send(tab, { type: "theme", theme });
    await drawn(frame);
    const most = (await against(tab, { x: 400, y: 0, width: 400, height: 600 }, theme.colors.bg!)).most;
    if (most < 2) dim.push(`${id}: ${most.toFixed(2)}`);
  }
  expect(dim).toEqual([]);

  // Labels sit on the scene with a halo that lifts them off it: the ground's colour, never a
  // dark smudge under dark text on a light theme.
  await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "t", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }], links: { pipes: [], spawns: [] } });
  const smudged: string[] = [];
  for (const id of [...ids].reverse()) {
    const theme = await themeOf(tab, id);
    await ground(tab, theme.colors.bg!);
    await send(tab, { type: "theme", theme });
    await drawn(frame);
    const shadows = await frame.evaluate(() => [...document.querySelectorAll(".label")].map((el) => /^(.*?\))\s+-?[\d.]+px/.exec(getComputedStyle(el).textShadow)?.[1] ?? "none"));
    expect(shadows.length).toBe(2);
    const halo = Math.max(...await tab.evaluate(({ shadows, bg }) => {
      const h = window as unknown as Helpers;
      return shadows.map((s) => h.contrast(h.over(bg, s), h.over(bg, bg)));
    }, { shadows, bg: theme.colors.bg! }));
    if (halo > 1.5) smudged.push(`${id}: ${halo.toFixed(2)}`);
  }
  expect(smudged).toEqual([]);
  await tab.close();
}

test("Constellation: its far stars and the halo under each label are drawn for the backdrop, in every dark preset and after a live switch", () => constellation(DARK[0]!, DARK), 90_000);
test.skipIf(!LIGHT)(`Constellation: its far stars and the halo under each label are drawn for the backdrop ${ON_LIGHT}, switched live from a dark preset and back`, () => constellation(DARK[0]!, ["clean-light", DARK[0]!, "clean-light"]), 90_000);

// The darkest and the brightest of what the app's own wallpapers paint behind glass (styles.css:
// the mono scene's ground, the amber bloom).
const WALLPAPERS = ["#0b0d12", "#fbbf24"];

/** Agent board opened in `from` and switched live through `ids`, over each theme's ground and under
 *  glass over each wallpaper: its title and, with no notes, the line that says how to pin one; then,
 *  once an agent has pinned one, the note's text and its byline on its card. */
async function agentBoard(from: string, ids: string[]) {
  const { tab, frame } = await open("agent-board", "__entry.html?js=index.js", "#000");
  const first = await themeOf(tab, from);
  await ground(tab, first.colors.bg!);
  await connectView(tab, { theme: first });

  const low: string[] = [];
  const board = async (selectors: string[]) => {
    for (const id of ids) {
      const plain = await themeOf(tab, id);
      for (const [glass, backdrop] of [[false, plain.colors.bg!], ...WALLPAPERS.map((w) => [true, w] as const)] as const) {
        await ground(tab, backdrop);
        await send(tab, { type: "theme", theme: await themeOf(tab, id, { glass }) });
        await drawn(frame);
        const where = `${id}${glass ? ` over ${backdrop}` : ""}`;
        const words = await reads(tab, frame, selectors);
        // Every one was there to be read: one missing would pass unread.
        expect([where, selectors.filter((sel) => !words.some((w) => w.sel === sel))]).toEqual([where, []]);
        for (const { sel, least } of words) if (least < 4.5) low.push(`${where}: ${sel} ${least.toFixed(2)}`);
      }
    }
  };
  await board(["main > h1", "main > p"]);
  await send(tab, { type: "invoke", invokeId: 1, name: "post", args: { text: "Tests pass on main", from: "alpha", kind: "done" } });
  await board(["main > h1", "article[data-note] > :first-child", "article[data-note] > :last-child"]);
  expect(low).toEqual([]);
  await tab.close();
}

test("Agent board: its title, the line it shows with no notes, and a note's text and byline on its card read at 4.5:1 in every dark preset, over the theme's ground or a wallpaper under glass, and after a live switch", () => agentBoard(DARK[0]!, DARK), 120_000);
test.skipIf(!LIGHT)(`Agent board: its title, the line it shows with no notes, and a note's text and byline on its card read at 4.5:1 ${ON_LIGHT}, over its ground or a wallpaper under glass, switched live from a dark preset`, () => agentBoard(DARK[0]!, ["clean-light"]), 120_000);

for (const id of ["clean-light", "signal"]) {
  const on = id === "clean-light" ? ON_LIGHT : "on Signal";
  test.skipIf(id === "clean-light" && !LIGHT)(`Widgets: until the theme arrives the frame draws nothing over the backdrop ${on}, and its text reads once it has`, async () => {
    const { tab, frame } = await open("widgets", "index.html", "#000");
    const theme = await themeOf(tab, id);
    await ground(tab, theme.colors.bg!);
    await drawn(frame);
    expect(await frame.evaluate(() => document.querySelector("h1")?.textContent)).toBe("Widgets");
    // A dark canvas under Clean Light, or the browser's own black ink on Signal, both differ.
    expect((await against(tab, undefined, theme.colors.bg!)).differ).toBe(0);

    await connectView(tab, { theme, capabilities: ["workspace:widgets"] });
    await drawn(frame);
    const { ink, paper } = await frame.evaluate(() => ({ ink: getComputedStyle(document.querySelector("h1")!).color, paper: getComputedStyle(document.body).backgroundColor }));
    const c = await tab.evaluate(({ bg, ink, paper }) => {
      const h = window as unknown as Helpers;
      const under = `rgb(${h.over(bg, paper).join(",")})`;
      return h.contrast(h.over(under, ink), h.over(under, under));
    }, { bg: theme.colors.bg!, ink, paper });
    expect(c).toBeGreaterThanOrEqual(4.5);
    await tab.close();
  }, 60_000);
}

// What Island and Archipelago write: the header on their paper, with how many are calling you in the
// attention colour; the calls tray's title, in it too; an island's name with how many call from it; a
// calling agent's name, its "Answer" button and the bell's count on the attention colour; the primary
// buttons on the accent; Archipelago's "Start an agent" on the sail of its plank, which spills off it
// once folded onto three lines. Each read from the screen over the scene the view draws under its paper,
// by night and by day, since that paper lets the sky through. Inks worked out once, from the first theme,
// sat on the next one's colours after a live switch: Clean Light's deep attention takes white words and
// the dark presets' pale ones black, so each switch is read too.
const WRITTEN: Record<string, string[]> = {
  island: [".head h1", ".head .sum", ".head .sum b", ".calls h2", ".label.island small b", ".label.calling", ".label.calling span", ".card button.call", ".card button.primary"],
  archipelago: [".head h1", ".head .sum", ".head .sum b", ".calls h2", ".label.island small b", ".label.calling", ".label.calling span", ".card button.call", ".card button.primary", ".btn .count", ".bar .start span"],
};
// Two sizes of window, each theme read at one of them with a terminal docked (half the dark presets at
// each): a wide one, and a narrow one, where the header, the calls and the card share the strip left of
// the terminal and the toolbar is wider than half the window. Opened wide and resized live to narrow.
type Size = { width: number; height: number };
const NARROW: Size = { width: 800, height: 600 }, WIDE: Size = { width: 1024, height: 704 };
/** What the person set: no motion, so the scene holds still between two screenshots, and no effects pass
 *  or shadows, which a software renderer leaves out anyway. */
const STILL = { motion: "less", effects: false, shadows: false };
// Two accents, one that takes black words and one that takes white (island-archipelago-ink.test.ts works
// the ink out for every colour): Indigo takes black (white read on it at 4.2:1), Graphite white.
const ACCENT_ROWS = ["indigo", "graphite"];

/** `view` opened in `from`, by night, with alpha calling you and beta ready for work; then switched
 *  live through `ids`, each read by night and by day at the size of window paired with it (the window
 *  resized live between two), and through `accents`. */
async function written(view: string, from: string, ids: [string, Size][], accents: string[]) {
  const sels = WRITTEN[view]!;
  let size = ids[0]![1];
  const { tab, frame } = await open(view, "index.html", "#000", size);
  let theme = await themeOf(tab, from);
  await ground(tab, theme.colors.bg!);
  await connectView(tab, { theme, capabilities: ["workspace:spawn"], settings: { ...STILL, sky: "night" }, viewport: { w: size.width, h: size.height } });
  // One island, with alpha calling you and beta ready for work.
  await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }, { id: "b", frameId: "f", kind: "agent", name: "beta", agent: "claude" }], links: { pipes: [], spawns: [] } });
  await tab.waitForFunction(() => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === 2, undefined, { timeout: 60_000 });
  await send(tab, { type: "status", tileId: "a", status: "blocked" });
  await send(tab, { type: "status", tileId: "b", status: "idle" });
  await drawn(frame);

  /** The lowest each one read at, by where. */
  const least = new Map<string, number>();
  /** Read `which` with `tile`'s card open: alpha's answers it, beta's opens its terminal. */
  const check = async (state: string, tile: string, which: string[]) => {
    // The view paints the card before it answers, and draws the scene from where it looks next.
    await tab.evaluate((t) => (window as unknown as { host: { reveal(t: string): Promise<unknown> } }).host.reveal(t), tile);
    await drawn(frame, 2);
    const words = await reads(tab, frame, which);
    for (const r of words) least.set(`${state}: ${r.sel}`, Math.min(least.get(`${state}: ${r.sel}`) ?? Infinity, r.least));
    // Every one was there to be read: one missing would pass unread.
    expect([state, which.filter((sel) => !words.some((w) => w.sel === sel))]).toEqual([state, []]);
  };
  const resize = async (to: Size) => {
    size = to;
    await tab.setViewportSize(size);
    await send(tab, { type: "resize", w: size.width, h: size.height });
  };
  // Beta's primary button is drawn on the accent, which no sky shows through: read once a theme.
  const onAccent = [".card button.primary"], rest = sels.filter((sel) => !onAccent.includes(sel));
  for (const [id, at] of ids) {
    if (at !== size) await resize(at);
    const where = `${id} at ${size.width}x${size.height}`;
    theme = await themeOf(tab, id);
    await ground(tab, theme.colors.bg!);
    await send(tab, { type: "theme", theme });
    for (const sky of ["night", "day"]) {
      await send(tab, { type: "settings", settings: { ...STILL, sky } });
      await drawn(frame);
      await check(`${where} by ${sky}`, "a", rest);
    }
    await check(where, "b", onAccent);
  }
  const [last] = ids.at(-1)!;
  for (const accent of accents) {
    await send(tab, { type: "theme", theme: await themeOf(tab, last, { accent }) });
    await drawn(frame);
    await check(`${last}, ${accent}`, "b", onAccent);
  }
  expect([...least].filter(([, c]) => c < 4.5).map(([where, c]) => `${where} ${c.toFixed(2)}`)).toEqual([]);
  await tab.close();
}

for (const view of Object.keys(WRITTEN)) {
  const View = `${view[0]!.toUpperCase()}${view.slice(1)}`;
  test(`${View}, a terminal docked at 1024x704, then at 800x600: its words on its paper, the attention colour and the accent read at 4.5:1 over its scene by night and by day, in every dark preset switched live, and in an accent that takes black words and one that takes white`, () => written(view, DARK[0]!, DARK.map((id, i) => [id, i < DARK.length / 2 ? WIDE : NARROW]), ACCENT_ROWS), 300_000);
  test.skipIf(!LIGHT)(`${View}, a terminal docked at 1024x704, then at 800x600: its words on its paper, the attention colour and the accent read at 4.5:1 over its scene by night and by day, ${ON_LIGHT}, opened in it and switched live to a dark preset and back`, () => written(view, "clean-light", [["clean-light", WIDE], [DARK[0]!, NARROW], ["clean-light", NARROW]], []), 180_000);
}

// Where the calls go in the room the window, the app's widget cards and a docked terminal leave them,
// with ten agents calling you, the tray opened, and an agent's card up: the tray open on the header's
// row or under it, as wide as it opens or as narrow as it still reads, titled "10 agents calling you";
// folded to how many are calling where it would not read, titled "10", which then goes to the next one
// calling (and opens no list, so it says neither that it is open nor which list); or gone where even
// that has no room. Wherever they are, they lie over none of the panels, nor under the widget cards or
// the terminal, inside the window, with no word over another, every name whole and the title on one
// line. Archipelago's toolbar too: inside the window, every button on it, and under neither the card
// nor the terminal; on one row where its icons have room, its labels given way to them as it needs,
// and at 400 px on one or two, as its buttons (the app's among them, in an app that puts them there)
// fit. How many labels it keeps depends on the interface font, the person's or the theme's: at 650 px
// it keeps two in Inter (or Liberation Sans, as wide, where Inter is not installed), and one in a wider
// font, DejaVu Sans (or a monospace font where that is not installed), which arrives with a theme
// while the window keeps its size. Each step changes what the one before it showed; the step into the
// last one changes only the size of the window, so the calls have to move of the view's own accord.
/** What the calls must keep clear of: they would cover or shade the words of the header, the tools, the
 *  card and the toolbar, and lie unseen under the docked terminal. */
const PANELS = [".head", ".tools", ".card:not([hidden])", ".bar", ".dock[data-open]"];
type Shows = "open" | "folded" | "away";
/** The interface font a theme gives the view: one as wide as Inter, and a wider one. */
const FONTS = { Inter: 'Inter, "Liberation Sans", sans-serif', "DejaVu Sans": '"DejaVu Sans", monospace' };
type Place = { size: Size; font?: keyof typeof FONTS; widgets?: true; docked: boolean; shows: Shows; oneRow?: true };
const PLACES: Record<string, Place[]> = {
  island: [
    { size: WIDE, docked: false, shows: "open" },
    { size: NARROW, docked: true, shows: "open" },
    { size: { width: 640, height: 560 }, docked: true, shows: "open" },
    { size: { width: 560, height: 560 }, docked: true, shows: "folded" },
  ],
  archipelago: [
    { size: { width: 650, height: 560 }, font: "Inter", docked: false, shows: "open", oneRow: true },
    { size: { width: 650, height: 560 }, font: "DejaVu Sans", docked: false, shows: "open", oneRow: true },
    { size: { width: 520, height: 560 }, font: "DejaVu Sans", docked: false, shows: "open", oneRow: true },
    { size: { width: 400, height: 560 }, font: "DejaVu Sans", docked: false, shows: "open" },
    { size: WIDE, font: "DejaVu Sans", widgets: true, docked: true, shows: "open", oneRow: true },
    { size: NARROW, font: "DejaVu Sans", widgets: true, docked: true, shows: "folded", oneRow: true },
    { size: { width: 600, height: 560 }, font: "DejaVu Sans", widgets: true, docked: true, shows: "away", oneRow: true },
  ],
};
// Where the app stacks widget cards over a view that asks for the left edge (`"widgets": "left"`). An app
// from before that (the latest release, which CI tests against too) stacks them on the right, and there
// the steps with the cards are left out, under a name that says so.
const { stackDownEdge, CARD_W } = await import(path.join(APP, "apps/desktop/src/renderer/src/board-objects/widget-stack.ts")) as {
  stackDownEdge?: (ids: string[], sizes: object, screen: { w: number; h: number }, edge: "left") => Record<string, { x: number; y: number }>;
  CARD_W: number;
};
const NO_LEFT = "the widget cards left out: the app at HIVEMIND_APP stacks them on the right";
/** Where the widget cards are, down the left: from the first card's place to the foot of the window. */
const cardsAt = (size: Size) => {
  const { x, y } = stackDownEdge!(["w"], {}, { w: size.width, h: size.height }, "left").w!;
  return { left: x, top: y, right: x + CARD_W, bottom: size.height };
};
const CALLERS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
const placesOf = (view: string) => PLACES[view]!.filter((p) => stackDownEdge || !p.widgets);
/** What the calls' toggle says, as it shows them: open, the sentence and the list it opens; folded, the
 *  count, and the sentence as its name; gone, nothing to read. */
const SAID_OPEN = `${CALLERS.length} agents calling you`;
const SAYS: Record<Shows, { title: string; expanded: string | null; controls: string | null; label: string | null } | null> = {
  open: { title: SAID_OPEN, expanded: "true", controls: "calls-list", label: null },
  folded: { title: String(CALLERS.length), expanded: null, controls: null, label: `${SAID_OPEN}: go to the next one` },
  away: null,
};

async function placed(view: string) {
  const places = placesOf(view);
  const { tab, frame } = await open(view, "index.html", "#000", places[0]!.size);
  const theme = await themeOf(tab, DARK[0]!);
  await ground(tab, theme.colors.bg!);
  // Allowed to start agents, so Archipelago's toolbar is whole.
  await connectView(tab, { theme, capabilities: ["workspace:spawn"], settings: { ...STILL, sky: "day" }, viewport: { w: places[0]!.size.width, h: places[0]!.size.height } });
  await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: CALLERS.map((name, i) => ({ id: `t${i}`, frameId: "f", kind: "agent", name, agent: "claude" })), links: { pipes: [], spawns: [] } });
  await tab.waitForFunction((n) => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === n, CALLERS.length, { timeout: 60_000 });
  for (let i = 0; i < CALLERS.length; i++) await send(tab, { type: "status", tileId: `t${i}`, status: "blocked" });
  // The tray opened, then alpha's card up and its terminal docked.
  const press = () => frame.evaluate(() => document.querySelector<HTMLElement>(".calls-toggle")!.click());
  await frame.waitForFunction(() => !document.querySelector<HTMLElement>(".calls")!.hidden);
  await press();
  const reveal = () => tab.evaluate(() => (window as unknown as { host: { reveal(t: string): Promise<unknown> } }).host.reveal("t0"));
  const docked = () => tab.evaluate(() => (window as unknown as { host: { rects: { tileId: string }[] } }).host.rects.map((r) => r.tileId));
  await reveal();
  let was: Place = { size: places[0]!.size, docked: true, shows: "open" }, release = 0;
  for (const place of places) {
    const where = `${place.size.width}x${place.size.height}${place.font ? `, in ${place.font}` : ""}${place.widgets ? ", the widget cards" : ""}${place.docked ? ", a terminal docked" : ""}`;
    if (place.font !== was.font) await send(tab, { type: "theme", theme: { ...theme, fonts: { ui: FONTS[place.font!], mono: "monospace" } } });
    if (place.size !== was.size) {
      await tab.setViewportSize(place.size);
      await send(tab, { type: "resize", w: place.size.width, h: place.size.height });
    }
    if (!!place.widgets !== !!was.widgets) await send(tab, { type: "widgets", widgets: place.widgets ? [{ id: "w", widget: "notes", name: "Notes", tree: null, card: true, images: {}, placement: "screen" }] : [] });
    if (place.docked !== was.docked) {
      if (place.docked) await reveal();
      else await send(tab, { type: "invoke", invokeId: ++release, name: "release", args: {} });
    }
    await drawn(frame, 2);
    const at = await frame.evaluate(({ panels, cards, oneRow }) => {
      type Box = { left: number; right: number; top: number; bottom: number };
      const hits = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const shown = (sel: string) => [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0);
      const box = document.querySelector<HTMLElement>(".calls")!, c = box.getBoundingClientRect();
      const title = document.querySelector(".calls-title")!.textContent ?? "";
      const shows = !c.width ? "away" : document.querySelector(".calls-list")!.getBoundingClientRect().height ? "open" : /^\d+$/.test(title) ? "folded" : "a chip";
      const toggle = document.querySelector(".calls-toggle")!;
      const says = c.width ? { title, expanded: toggle.getAttribute("aria-expanded"), controls: toggle.getAttribute("aria-controls"), label: toggle.getAttribute("aria-label") } : null;
      const wrong = c.width ? panels.filter((sel) => shown(sel).some((b) => hits(c, b))) : [];
      if (c.width && cards && hits(c, cards)) wrong.push("the widget cards");
      if (c.width && (c.left < 0 || c.top < 0 || c.right > innerWidth || c.bottom > innerHeight)) wrong.push("off the window");
      // Archipelago's own toolbar: inside the window, every button on it, under neither the card nor
      // the terminal, and on one row where it has room for that.
      const bar = document.querySelector(".bar")?.getBoundingClientRect();
      if (bar) {
        if (bar.left < 0 || bar.right > innerWidth) wrong.push("the toolbar off the window");
        for (const sel of [".card:not([hidden])", ".dock[data-open]"]) if (shown(sel).some((b) => hits(bar, b))) wrong.push(`the toolbar under ${sel}`);
        const buttons = [...document.querySelectorAll(".bar .btn")].filter((b) => b.getBoundingClientRect().width);
        for (const b of buttons) {
          const r = b.getBoundingClientRect();
          if (r.left < bar.left || r.right > bar.right || r.top < bar.top || r.bottom > bar.bottom) wrong.push(`${b.getAttribute("title")} off the toolbar`);
        }
        const rows = new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size;
        if (oneRow && rows > 1) wrong.push(`the toolbar on ${rows} rows`);
      }
      // Each run of words in the calls, as drawn: none may lie over another.
      const runs: { node: Node; text: string; r: DOMRect }[] = [];
      const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width && r.height) runs.push({ node: n, text: n.textContent!.trim(), r });
      }
      runs.forEach((a, i) => runs.slice(i + 1).forEach((b) => {
        if (a.node !== b.node && a.r.left < b.r.right - 0.5 && a.r.right > b.r.left + 0.5 && a.r.top < b.r.bottom - 0.5 && a.r.bottom > b.r.top + 0.5) wrong.push(`"${a.text}" over "${b.text}"`);
      }));
      const lines = new Set(runs.filter((w) => w.text === title.trim()).map((w) => Math.round(w.r.top))).size;
      if (lines > 1) wrong.push(`the title on ${lines} lines`);
      for (const b of document.querySelectorAll<HTMLElement>(".calls .who b")) if (b.scrollWidth > b.clientWidth) wrong.push(`"${b.textContent}" cut`);
      return { shows, says, wrong };
    }, { panels: PANELS, cards: place.widgets ? cardsAt(place.size) : null, oneRow: !!place.oneRow });
    expect([where, at]).toEqual([where, { shows: place.shows, says: SAYS[place.shows], wrong: [] }]);
    // Folded, the count goes to the next one calling.
    if (at.shows === "folded") {
      const before = await docked();
      await press();
      await tab.waitForFunction((t) => (window as unknown as { host: { rects: { tileId: string }[] } }).host.rects[0]?.tileId !== t, before[0], { timeout: 10_000 });
      expect([where, (await docked()).length]).toEqual([where, 1]);
    }
    was = place;
  }
  await tab.close();
}

/** What the calls do in `view`'s steps, as a test's name says it. */
const SAID: Record<Shows, string> = { open: `open, titled "${SAID_OPEN}"`, folded: `fold to their count, "${CALLERS.length}", which goes to the next one calling and opens no list`, away: "go where even that has no room" };
for (const view of Object.keys(PLACES)) {
  // Said from the steps that run: on an app without the widget cards down the left, those steps are left out.
  const View = `${view[0]!.toUpperCase()}${view.slice(1)}`, places = placesOf(view);
  const steps = places.map((p, i) => `${p.size.width}${p.font && p.font !== places[i - 1]?.font ? ` in ${p.font}` : ""}${p.widgets ? " with the widget cards" : ""}${p.docked ? " docked" : ""}`).join(", ");
  const does = [...new Set(places.map((p) => p.shows))].map((s) => SAID[s]).join(", ");
  const docks = places.some((p) => p.docked);
  const covers = [places.some((p) => p.widgets) && "the widget cards", docks && "the terminal"].filter((c): c is string => !!c);
  const clear = covers.length ? `, clear of ${covers.join(" and ")}` : "";
  const bar = view !== "archipelago" ? "" : `; and its toolbar inside the window, clear of the card${docks ? " and the terminal" : ""}, on one row where its icons have room${places.some((p) => p.font) ? ` in ${[...new Set(places.flatMap((p) => p.font ?? []))].join(" and in ")}` : ""}`;
  test(`${View}: with ten calling and an agent's card up, the calls ${does}, as the room left them allows (${steps}): over no panel${clear}, inside the window, with no word over another, each name whole and the title on one line${bar}${view === "archipelago" && !stackDownEdge ? ` (${NO_LEFT})` : ""}`, () => placed(view), 120_000);
}

// From afar the workers are specks, and each shows as a pin: a disc in its mood's colour with a mark
// on it, black on a pale colour and white on a deep one (pins.ts). Dracula's attention is pale, and a
// person may make theirs any colour, a dark one too.
const PINS = [
  { on: "Dracula's pale attention colour", preset: "dracula", palette: {}, mark: "black" },
  { on: "a dark attention colour the person gave", preset: "signal", palette: { warn: "#3a2a00" }, mark: "white" },
];
for (const row of PINS) {
  test(`Archipelago: from afar, a calling agent's pin draws its mark ${row.mark} on ${row.on}, at 3:1 or more`, async () => {
    const { tab, frame } = await open("archipelago", "index.html", "#000");
    const theme = await themeOf(tab, row.preset, { palette: row.palette });
    await ground(tab, theme.colors.bg!);
    // Pulled back until a worker is a few pixels tall, which is when the pins show.
    await connectView(tab, { theme, settings: { ...STILL, sky: "day" }, layout: { camera: { dist: 120 } } });
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }], links: { pipes: [], spawns: [] } });
    await tab.waitForFunction(() => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === 1, undefined, { timeout: 60_000 });
    await send(tab, { type: "status", tileId: "a", status: "blocked" });
    await drawn(frame);
    // The agent's name stands just above its pin: read where, then take the names away.
    const at = await frame.evaluate(() => {
      const b = document.querySelector(".label.calling")!.getBoundingClientRect();
      for (const el of document.querySelectorAll<HTMLElement>(".labels, .islands, .edges")) el.style.visibility = "hidden";
      return { x: b.x + b.width / 2, y: b.bottom };
    });
    await drawn(frame);
    // A calling agent's disc is 31px across, its middle 24px under the name: the name's foot stands 4px
    // over the top of the pin at its largest, 45.5px over the point it stands on, and the disc's middle
    // 25px over that point (pins.ts, scene.ts nameOverPin).
    const png = (await tab.screenshot({ clip: { x: at.x - 19, y: at.y + 5, width: 38, height: 38 } })).toString("base64");
    const pin = await tab.evaluate((png) => (window as unknown as Helpers).pin(png), png);
    // A disc is there (one colour fills a sixth of the picture, at least) and its mark reads on it, in the shade named.
    expect({ disc: pin.area > 240, mark: pin.contrast >= 3 ? "reads" : `${pin.contrast.toFixed(2)}:1`, shade: pin.darker ? "black" : "white" })
      .toEqual({ disc: true, mark: "reads", shade: row.mark });
    await tab.close();
  }, 90_000);
}

// Harbour, Archipelago's theme, and the status colours the app sends with a theme: an app that fits
// them to the palette (`statusInk`) sends those, 2026.10.5 the palette's own. Its wallpaper is drawn
// without glass, behind views that let it through; Focus does not, and Archipelago draws its own sky.
const { statusInk } = existsSync(path.join(APP, "packages/hive-core/src/theme-format.ts"))
  ? await core("theme-format.ts") as { statusInk?: (c: string, p: Record<string, string>) => string }
  : { statusInk: undefined };
const HARBOUR = JSON.parse(await Bun.file(path.join(ROOT, "packages/archipelago/themes/harbour/theme.json")).text()) as { mode: "dark"; palette: Record<string, string>; accent: { brand: string; accent: string; working?: string } };
/** The theme the app sends a view in `id` (a preset, or "harbour"), with its status colours. */
async function appTheme(tab: Page, id: string) {
  const p = id === "harbour" ? HARBOUR : PRESETS[id] as Preset;
  const a = id === "harbour" ? HARBOUR.accent : ACCENTS[(p as Preset).accent] as { brand: string; accent: string; working?: string };
  const light = p.mode === "light";
  const status = {
    attention: statusInk ? statusInk(p.palette.warn!, p.palette) : p.palette.warn!,
    failed: statusInk ? statusInk(p.palette.err!, p.palette) : p.palette.err!,
    working: a.working ? (light && statusInk ? p.palette.fg2! : a.working) : a.brand,
    done: p.palette.ok!, idle: p.palette.fg3!, exited: p.palette.fg3!,
  };
  return tab.evaluate(({ palette, mode, brand, accent, status }) => {
    const hex = (window as unknown as { hex: (c: string) => string }).hex;
    const of = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hex(v)]));
    const colors = of({ ...palette, brand, accent });
    return { colors, mode, accent: colors.brand!, radius: 12, surface: colors.bg2!, glass: false, status: of(status) };
  }, { palette: p.palette, mode: p.mode, brand: a.brand, accent: a.accent, status });
}

// Focus, a list people work in, on the theme's flat ground ("wallpaper": false), with every kind of
// row in it: an agent waiting on you, one working, ready ones (nine agents in all, so the search box
// shows), and each way of stopping (an error, a usage limit, exited, asleep), in every preset and in
// Harbour. Inside a block, so its helpers keep to it.
{
  const M = 60_000;
  const AGENTS: { id: string; status: string; agent?: object; ago: number; asleep?: true }[] = [
    { id: "alpha", status: "blocked", agent: { state: "waiting", waitingFor: "permission" }, ago: 5 },
    { id: "beta", status: "working", agent: { state: "working" }, ago: 1 },
    { id: "gamma", status: "idle", agent: { state: "idle" }, ago: 7 },
    { id: "theta", status: "idle", agent: { state: "idle" }, ago: 9 },
    { id: "iota", status: "idle", agent: { state: "idle" }, ago: 11 },
    { id: "delta", status: "idle", agent: { state: "failed" }, ago: 20 },
    { id: "epsilon", status: "idle", agent: { state: "limited" }, ago: 25 },
    { id: "zeta", status: "exited", ago: 30 },
    { id: "eta", status: "idle", agent: { state: "idle" }, ago: 40, asleep: true },
  ];
  const SIZE = { width: 1000, height: 1000 };

  /** Focus opened in `from`, its pulse held still, with AGENTS in it. */
  async function focus(from: string) {
    const tab = await browser.newPage({ viewport: SIZE, reducedMotion: "reduce" });
    await tab.goto(`${server.url}`);
    const theme = await appTheme(tab, from);
    await ground(tab, theme.colors.bg!);
    await tab.evaluate((src) => new Promise<void>((resolve) => {
      const f = document.createElement("iframe");
      f.onload = () => resolve();
      f.src = src;
      document.body.append(f);
    }), "/view/focus/index.html");
    const frame = tab.frames().find((f) => f.url().includes("/view/focus/"))!;
    await connectView(tab, { theme, capabilities: ["workspace:prompt"], viewport: { w: SIZE.width, h: SIZE.height } });
    const now = Date.now();
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def" }], tiles: AGENTS.map((a) => ({ id: a.id, frameId: "f", kind: "agent", name: a.id, agent: "claude", ...(a.asleep ? { asleep: { since: now - a.ago * M } } : {}) })), links: { pipes: [], spawns: [] } });
    await tab.waitForFunction((n) => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === n, AGENTS.length, { timeout: 30_000 });
    for (const a of AGENTS) await send(tab, { type: "status", tileId: a.id, status: a.status, since: now - a.ago * M, ...(a.agent ? { agent: { subagents: 0, background: 0, compacting: false, ...a.agent } } : {}) });
    await frame.waitForFunction((n) => document.querySelectorAll('[role="option"]').length === n, AGENTS.length);
    return { tab, frame };
  }
  /** Each look in `ids`, switched live, over its ground. */
  async function* looksOf(tab: Page, frame: Frame, ids: string[]) {
    for (const id of ids) {
      const theme = await appTheme(tab, id);
      await ground(tab, theme.colors.bg!);
      await send(tab, { type: "theme", theme });
      await drawn(frame);
      yield { id, theme };
    }
  }
  const rowBox = (frame: Frame, name: string) => frame.evaluate((n) => { const b = document.querySelector(`[data-agent="${n}"]`)!.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, name);
  /** Open `name`'s terminal, as a click does, and put the pointer over `over` (or off the list). */
  async function state(tab: Page, frame: Frame, name: string, over: string | null) {
    await frame.evaluate((n) => document.querySelector<HTMLElement>(`[data-agent="${n}"]`)!.click(), name);
    if (over) { const b = await rowBox(frame, over); await tab.mouse.move(b.x + b.w / 2, b.y + b.h / 2); }
    else await tab.mouse.move(SIZE.width - 4, SIZE.height - 4);
    // The rows' fills change over 150 ms.
    await drawn(frame, 2);
    await tab.waitForTimeout(250);
  }
  const shot = async (tab: Page) => (await tab.screenshot()).toString("base64");

  /** Every row's name, time and line, and its mark: ink, alpha and box, as `reads` measures words. */
  const rowParts = (frame: Frame) => frame.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="option"], [role="group"] > h2, [data-finding]')].flatMap((row) => {
    const who = row.dataset.agent ?? (row.matches("h2") ? row.firstChild!.textContent : "the header's line");
    const alphaOf = (el: Element) => { let a = 1; for (let at: Element | null = el; at; at = at.parentElement) a *= Number(getComputedStyle(at).opacity); return a; };
    const parts: { sel: string; mark: boolean; ink: string; alpha: number; x: number; y: number; w: number; h: number }[] = [];
    // A row's name, time and line; a group's name and count; the header's line.
    const words: [string, Node][] = row.matches("[data-finding]") ? [["words", row]]
      : row.matches("h2") ? [["name", row.firstChild!], ["count", row.querySelector(".text-count")!]]
      : [["name", row.querySelector(".text-row")!], ["time", row.querySelector(".text-count")!], ["line", row.querySelector("div.text-label")!]];
    for (const [what, node] of words) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const b = range.getBoundingClientRect(), el = node instanceof Element ? node : node.parentElement!;
      if (b.width && b.height) parts.push({ sel: `${who}: ${what}`, mark: false, ink: getComputedStyle(el).color, alpha: alphaOf(el), x: b.x, y: b.y, w: b.width, h: b.height });
    }
    for (const m of row.querySelectorAll("svg[data-status]")) {
      const b = m.getBoundingClientRect();
      parts.push({ sel: `${who}: ${m.getAttribute("data-status")} mark`, mark: true, ink: getComputedStyle(m).color, alpha: alphaOf(m), x: b.x, y: b.y, w: b.width, h: b.height });
    }
    return parts;
  }));
  /** How each part reads on what is under it: words and marks taken out for a second screenshot. */
  async function readRows(tab: Page, frame: Frame) {
    const parts = await rowParts(frame);
    const shown = await shot(tab);
    await frame.evaluate(() => {
      const hush = document.createElement("style");
      hush.id = "hush";
      hush.textContent = "*, *::before, *::after { -webkit-text-fill-color: transparent !important; } svg[data-status] { visibility: hidden !important; }";
      document.head.append(hush);
    });
    const bare = await shot(tab);
    await frame.evaluate(() => document.getElementById("hush")!.remove());
    const seen = await tab.evaluate((a) => (window as unknown as Helpers).under(a.shown, a.bare, a.parts), { shown, bare, parts });
    return parts.map((p, i) => ({ ...p, ...seen[i]! }));
  }

  /** Every row's words read at 4.5:1 and its mark at 3:1, with each kind of row open and each under
   *  the pointer in turn, in each look of `ids` switched live from `from`. */
  async function focusRows(from: string, ids: string[]) {
    const { tab, frame } = await focus(from);
    const low = new Map<string, number>();
    // Each kind of row open, with the next under the pointer, and once with the pointer off the list.
    const turns: [string, string | null][] = [["alpha", "beta"], ["beta", "gamma"], ["gamma", "delta"], ["delta", "zeta"], ["zeta", "eta"], ["eta", "alpha"], ["alpha", null]];
    for await (const { id } of looksOf(tab, frame, ids)) {
      for (const [open, over] of turns) {
        await state(tab, frame, open, over);
        const parts = await readRows(tab, frame);
        // Every row and group, each read: one missing would pass unread.
        expect([id, open, parts.filter((p) => p.sel.endsWith(": time")).length]).toEqual([id, open, AGENTS.length]);
        for (const p of parts) {
          const where = `${id}: ${p.sel}${p.sel.startsWith(`${open}:`) ? " (open)" : ""}${over && p.sel.startsWith(`${over}:`) ? " (under the pointer)" : ""}`;
          if (p.n && p.least < (p.mark ? 3 : 4.5)) low.set(where, Math.min(low.get(where) ?? Infinity, p.least));
        }
      }
    }
    expect([...low].map(([where, c]) => `${where} ${c.toFixed(2)}`)).toEqual([]);
    await tab.close();
  }
  test(`Focus: every row's name, time and line read at 4.5:1 and its mark at 3:1, at rest, under the pointer and open, a stopped agent's too, and each group's name and count, in every dark preset and Harbour, switched live`, () => focusRows(DARK[0]!, [...DARK, "harbour"]), 240_000);
  test.skipIf(!LIGHT)(`Focus: every row's name, time and line read at 4.5:1 and its mark at 3:1, at rest, under the pointer and open, a stopped agent's too, and each group's name and count, ${ON_LIGHT}, switched live from a dark preset and back`, () => focusRows(DARK[0]!, ["clean-light", DARK[0]!, "clean-light"]), 120_000);

  /** The open agent's row is marked at 3:1 where a row under the pointer is not, and the pointer's step
   *  goes from the ground toward the words' ink, as far as the open row's fill; each text field's edge
   *  stands at 3:1 on the ground. */
  async function focusMarks(from: string, ids: string[]) {
    const { tab, frame } = await focus(from);
    const wrong: string[] = [];
    for await (const { id, theme } of looksOf(tab, frame, ids)) {
      // gamma open with the pointer on it, and only under the pointer: what open adds, pixel by pixel.
      await state(tab, frame, "gamma", "gamma");
      const open = await shot(tab);
      const box = await rowBox(frame, "gamma");
      // The search box and gamma's task box, while gamma is open.
      const fields = await frame.evaluate(() => [...document.querySelectorAll("input")].map((el) => { const b = el.getBoundingClientRect(); return { name: el.getAttribute("aria-label")!, x: b.x, y: b.y, w: b.width, h: b.height }; }));
      await state(tab, frame, "alpha", "gamma");
      const hovered = await shot(tab);
      const seen = await tab.evaluate(async ({ open, hovered, box, fields, bg, fg }) => {
        const h = window as unknown as Helpers;
        const pixels = async (png: string) => {
          const img = new Image();
          img.src = "data:image/png;base64," + png;
          await img.decode();
          const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          return (x: number, y: number) => { const p = (Math.round(y) * c.width + Math.round(x)) * 4; return [d[p]!, d[p + 1]!, d[p + 2]!]; };
        };
        const [a, b] = await Promise.all([pixels(open), pixels(hovered)]);
        let marked = 0;
        for (let y = Math.ceil(box.y); y < box.y + box.h - 1; y++) for (let x = Math.ceil(box.x); x < box.x + box.w - 1; x++) if (h.contrast(a(x, y), b(x, y)) >= 3) marked++;
        // Under the pointer: the fill inside its left padding, beside it the ground.
        const lum = (c: number[]) => h.contrast(c, [0, 0, 0]) * 0.05 - 0.05;
        const fill = b(box.x + 5, box.y + box.h / 2), floor = b(box.x - 4, box.y + box.h / 2), ink = h.over(bg, fg);
        const toward = (lum(fill) - lum(floor)) * (lum(ink) - lum(floor)) > 0 && Math.abs(lum(fill) - lum(floor)) < Math.abs(lum(ink) - lum(floor));
        // The open row's fill, past its bar: the pointer shows as plainly as it.
        const step = h.contrast(fill, floor), openStep = h.contrast(a(box.x + 5, box.y + box.h / 2), floor);
        // Each side of each field, from 4 px out to 4 px in: the step most unlike the ground outside.
        const edges = fields.map((f) => {
          const sides = [
            (t: number) => [f.x + f.w / 2, f.y - 4 + t], (t: number) => [f.x + f.w / 2, f.y + f.h + 3 - t],
            (t: number) => [f.x - 4 + t, f.y + f.h / 2], (t: number) => [f.x + f.w + 3 - t, f.y + f.h / 2],
          ].map((at) => {
            const out = a(...(at(0) as [number, number]));
            let most = 1;
            for (let t = 1; t <= 8; t++) most = Math.max(most, h.contrast(a(...(at(t) as [number, number])), out));
            return most;
          });
          return { name: f.name, least: Math.min(...sides) };
        });
        return { marked, toward, fill, floor, step, openStep, edges };
      }, { open, hovered, box, fields, bg: theme.colors.bg!, fg: theme.colors.fg! });
      // A 2 px line down the row at least, at 3:1 against the row under the pointer.
      if (seen.marked < 2 * (box.h - 16)) wrong.push(`${id}: open gamma differs from gamma under the pointer at 3:1 in ${seen.marked} pixels`);
      if (!seen.toward) wrong.push(`${id}: under the pointer the row is rgb(${seen.fill}) on the ground rgb(${seen.floor}), not a step toward the words' ink`);
      if (seen.step < seen.openStep - 0.01) wrong.push(`${id}: under the pointer the row steps ${seen.step.toFixed(2)}:1 from the ground, the open row ${seen.openStep.toFixed(2)}:1`);
      expect([id, seen.edges.length]).toEqual([id, 2]);
      for (const e of seen.edges) if (e.least < 3) wrong.push(`${id}: ${e.name}'s edge ${e.least.toFixed(2)}`);
    }
    expect(wrong).toEqual([]);
    await tab.close();
  }
  test(`Focus: the open agent's row is marked at 3:1 where a row under the pointer is not, the pointer's step goes toward the words' ink as far as the open row's fill, and the search and task boxes' edges stand at 3:1 on the ground, in every dark preset and Harbour, switched live`, () => focusMarks(DARK[0]!, [...DARK, "harbour"]), 120_000);
  test.skipIf(!LIGHT)(`Focus: the open agent's row is marked at 3:1 where a row under the pointer is not, the pointer's step goes toward the words' ink as far as the open row's fill, and the search and task boxes' edges stand at 3:1 on the ground, ${ON_LIGHT}, switched live from a dark preset and back`, () => focusMarks(DARK[0]!, ["clean-light", DARK[0]!, "clean-light"]), 90_000);
}

// Archipelago's marks over its scene: focus on the "Through your eyes" switch and on the arrow to a caller
// out of sight, and the ring round the picked agent's name, calling or not. The scene behind them is
// anything (sunlit grass under a pale ink, night grass under a dark one, the night sea between), so each
// is read over a backdrop in place of the scene: the theme's ground, the mark's own ink (its strongest
// pixel over the ground), and the grey as far in contrast from the one as from the other, the worst a
// scene can put behind those two tones. All round it, the picture has to change by 3:1 between the mark
// shown and not. A mark of one colour is lost on its own colour, and two tones less than 9:1 apart on
// that grey. Then the light over an agent calling you, by night, and the words on the plank. Inside a
// block, so its helpers keep to it.
{
  type Box = { x: number; y: number; w: number; h: number; r: number };
  const SCENE = (backdrop: string) => `.stage { visibility: hidden !important; } .sky { background: ${backdrop} !important; }`;
  const style = (frame: Frame, id: string, css: string | null) => frame.evaluate(({ id, css }) => {
    document.getElementById(id)?.remove();
    if (css === null) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.append(s);
  }, { id, css });
  /** Round `box` (its corners rounded by `r`), from a pixel out to 12 px: in each of 36 sectors whether
   *  a pixel changes by 3:1 between `on` and `off`, and the colour of the pixel that changes most. */
  const round = (tab: Page, on: string, off: string, box: Box) => tab.evaluate(async ({ on, off, box }) => {
    const h = window as unknown as Helpers;
    const pixels = async (png: string) => {
      const img = new Image();
      img.src = "data:image/png;base64," + png;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    };
    const [a, b] = await Promise.all([pixels(on), pixels(off)]);
    const reads = new Array<boolean>(36).fill(false);
    let most = 1, ink = [0, 0, 0];
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    for (let y = Math.max(0, Math.floor(box.y - 12)); y < Math.min(a.h, box.y + box.h + 12); y++) for (let x = Math.max(0, Math.floor(box.x - 12)); x < Math.min(a.w, box.x + box.w + 12); x++) {
      // Outside the control and the half pixel its edge blends into: the ring, not what it holds.
      const dx = Math.max(Math.abs(x + 0.5 - cx) - (box.w / 2 - box.r), 0), dy = Math.max(Math.abs(y + 0.5 - cy) - (box.h / 2 - box.r), 0);
      if (Math.hypot(dx, dy) <= box.r + 0.5 && Math.abs(x + 0.5 - cx) <= box.w / 2 + 0.5 && Math.abs(y + 0.5 - cy) <= box.h / 2 + 0.5) continue;
      const p = (y * a.w + x) * 4, p1 = [a.d[p]!, a.d[p + 1]!, a.d[p + 2]!], p0 = [b.d[p]!, b.d[p + 1]!, b.d[p + 2]!];
      const c = h.contrast(p1, p0);
      if (c > most) { most = c; ink = p1; }
      if (c >= 3) reads[Math.floor(((Math.atan2(y + 0.5 - cy, x + 0.5 - cx) / Math.PI + 1) * 18)) % 36] = true;
    }
    return { sectors: reads.filter(Boolean).length, ink: `rgb(${ink.join(",")})` };
  }, { on, off, box });
  /** The grey as far in contrast from `a` as from `b` (each an rgb()): on it, each reads at the square
   *  root of what they read at on each other. */
  const between = (tab: Page, a: string, b: string) => tab.evaluate(({ a, b }) => {
    const h = window as unknown as Helpers & { lum(c: number[]): number };
    const [x, y] = [h.over(a, a), h.over(b, b)];
    const goal = Math.sqrt((h.lum(x) + 0.05) * (h.lum(y) + 0.05)) - 0.05;
    let v = 0;
    while (v < 255 && h.lum([v + 1, v + 1, v + 1]) <= goal) v++;
    if (v < 255 && Math.abs(h.lum([v + 1, v + 1, v + 1]) - goal) < Math.abs(h.lum([v, v, v]) - goal)) v++;
    return `rgb(${v},${v},${v})`;
  }, { a, b });
  /** What a mark (a control's focus, a picked name's ring) does all round `sel`: over the ground, over
   *  its own ink, and over the grey between them. `show` puts it on, `hide` takes it off. */
  async function readsAllRound(tab: Page, frame: Frame, sel: string, ground: string, show: () => Promise<void>, hide: () => Promise<void>) {
    const at = await frame.evaluate((sel) => {
      const el = document.querySelector(sel)!, b = el.getBoundingClientRect(), r = getComputedStyle(el).borderTopLeftRadius;
      return { x: b.x, y: b.y, w: b.width, h: b.height, r: Math.min(r.endsWith("%") ? (parseFloat(r) / 100) * b.width : parseFloat(r) || 0, b.width / 2, b.height / 2) };
    }, sel);
    const clip = { x: Math.max(0, Math.floor(at.x - 16)), y: Math.max(0, Math.floor(at.y - 16)), width: Math.ceil(at.w + 32), height: Math.ceil(at.h + 32) };
    const box = { x: at.x - clip.x, y: at.y - clip.y, w: at.w, h: at.h, r: at.r };
    // A screenshot waits for a frame drawn after what came before it.
    const pair = async () => {
      await show();
      const on = (await tab.screenshot({ clip })).toString("base64");
      await hide();
      return { on, off: (await tab.screenshot({ clip })).toString("base64") };
    };
    await style(frame, "scene", SCENE(ground));
    const one = await pair();
    const overGround = await round(tab, one.on, one.off, box);
    await style(frame, "scene", SCENE(overGround.ink));
    const two = await pair();
    const overInk = await round(tab, two.on, two.off, box);
    await style(frame, "scene", SCENE(await between(tab, ground, overGround.ink)));
    const three = await pair();
    const overMiddle = await round(tab, three.on, three.off, box);
    await style(frame, "scene", null);
    return { overGround: overGround.sectors, overInk: overInk.sectors, overMiddle: overMiddle.sectors };
  }

  async function marksRead(from: string, ids: string[]) {
    const size = { width: 1024, height: 704 };
    const { tab, frame } = await open("archipelago", "index.html", "#000", size);
    let theme = await appTheme(tab, from);
    await ground(tab, theme.colors.bg!);
    // At 15 frames a second, the slowest the person may set: the scene behind is not what is read.
    await connectView(tab, { theme, capabilities: ["workspace:spawn"], settings: { ...STILL, sky: "day", frameRate: 15 }, viewport: { w: size.width, h: size.height } });
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }, { id: "b", frameId: "f", kind: "agent", name: "beta", agent: "claude" }], links: { pipes: [], spawns: [] } });
    await tab.waitForFunction(() => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === 2, undefined, { timeout: 60_000 });
    await send(tab, { type: "status", tileId: "a", status: "blocked" });
    await send(tab, { type: "status", tileId: "b", status: "idle" });
    await drawn(frame);
    const low: string[] = [];
    const check = async (what: string, sel: string, show: () => Promise<void>, hide: () => Promise<void>) => {
      for (const id of ids) {
        theme = await appTheme(tab, id);
        await ground(tab, theme.colors.bg!);
        await send(tab, { type: "theme", theme });
        await drawn(frame, 2);
        const r = await readsAllRound(tab, frame, sel, theme.colors.bg!, show, hide);
        if (r.overGround < 36 || r.overInk < 36 || r.overMiddle < 36) low.push(`${id}: ${what} reads all round in ${r.overGround} of 36 sectors over the ground, ${r.overInk} over its own ink, ${r.overMiddle} over the grey between`);
      }
    };
    let invokeId = 0;
    const invoke = (name: string, args: object) => send(tab, { type: "invoke", invokeId: ++invokeId, name, args });
    const blur = () => frame.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    /** Focus `sel` as a person does, by Tab, after `from`. */
    const focusBy = async (sel: string, from: () => Promise<unknown>) => {
      await from();
      for (let i = 0; i < 40 && !(await frame.evaluate((sel) => !!document.activeElement?.matches(sel), sel)); i++) await tab.keyboard.press("Tab");
      expect(await frame.evaluate((sel) => document.activeElement!.matches(`${sel}:focus-visible`), sel)).toBe(true);
    };
    // Walking through your own eyes: the switch, reached by Tab from the toolbar's last button.
    await invoke("walk", { on: true, pov: "first" });
    await drawn(frame, 12);
    const fromBar = () => frame.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".bar .btn")].filter((b) => b.getBoundingClientRect().width && !b.disabled).at(-1)!.focus());
    await check("focus on the switch to your own eyes", ".pov", () => focusBy(".pov", fromBar), blur);
    // Turned away from alpha, calling you, by ←: an arrow on the edge points at it.
    for (let i = 0; i < 16 && !(await frame.evaluate(() => !!document.querySelector(".edge"))); i++) {
      await tab.keyboard.down("ArrowLeft");
      await tab.waitForTimeout(300);
      await tab.keyboard.up("ArrowLeft");
      await drawn(frame, 4);
    }
    expect(await frame.evaluate(() => document.querySelectorAll(".edge").length)).toBe(1);
    await check("focus on the arrow to alpha", ".edge", () => focusBy(".edge", blur), blur);
    await invoke("walk", { on: false });
    // Beta picked, ready for work; then alpha, calling you.
    const labelsOff = () => style(frame, "labels", ".labels { visibility: hidden !important; }"), labelsOn = () => style(frame, "labels", null);
    for (const [tile, name] of [["b", "beta's"], ["a", "alpha's, calling,"]] as const) {
      await tab.evaluate((t) => (window as unknown as { host: { reveal(t: string): Promise<unknown> } }).host.reveal(t), tile);
      await drawn(frame);
      expect(await frame.evaluate(() => document.querySelectorAll(".label.picked").length)).toBe(1);
      await check(`the ring round ${name} picked name`, ".label.picked", labelsOn, labelsOff);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  test("Archipelago: the ring round the picked agent's name, calling or not, and focus on the switch to your own eyes and on the arrow to a caller out of sight read all round over a backdrop of the ground, of their own ink and of the grey between, whatever the scene shows, in every dark preset and Harbour, switched live", () => marksRead(DARK[0]!, [...DARK, "harbour"]), 600_000);
  test.skipIf(!LIGHT)(`Archipelago: the ring round the picked agent's name, calling or not, and focus on the switch to your own eyes and on the arrow to a caller out of sight read all round over a backdrop of the ground, of their own ink and of the grey between, whatever the scene shows, ${ON_LIGHT}, switched live from a dark preset and back`, () => marksRead(DARK[0]!, ["clean-light", DARK[0]!, "clean-light"]), 300_000);

  /** In forced colours (Windows' contrast themes), which drop shadows: the ring round the picked name,
   *  calling or not, shows all round in the system's colours. */
  async function pickedForced() {
    const size = { width: 1024, height: 704 };
    const { tab, frame } = await open("archipelago", "index.html", "#000", size);
    await tab.emulateMedia({ forcedColors: "active" });
    const theme = await appTheme(tab, DARK[0]!);
    await ground(tab, theme.colors.bg!);
    await connectView(tab, { theme, capabilities: ["workspace:spawn"], settings: { ...STILL, sky: "day", frameRate: 15 }, viewport: { w: size.width, h: size.height } });
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }, { id: "b", frameId: "f", kind: "agent", name: "beta", agent: "claude" }], links: { pipes: [], spawns: [] } });
    await tab.waitForFunction(() => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === 2, undefined, { timeout: 60_000 });
    await send(tab, { type: "status", tileId: "a", status: "blocked" });
    await send(tab, { type: "status", tileId: "b", status: "idle" });
    await drawn(frame);
    expect(await frame.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    const low: string[] = [];
    const labelsOff = () => style(frame, "labels", ".labels { visibility: hidden !important; }"), labelsOn = () => style(frame, "labels", null);
    for (const [tile, name] of [["b", "beta's"], ["a", "alpha's, calling,"]] as const) {
      await tab.evaluate((t) => (window as unknown as { host: { reveal(t: string): Promise<unknown> } }).host.reveal(t), tile);
      await drawn(frame);
      const at = await frame.evaluate(() => {
        const el = document.querySelector(".label.picked")!, b = el.getBoundingClientRect(), r = getComputedStyle(el).borderTopLeftRadius;
        return { x: b.x, y: b.y, w: b.width, h: b.height, r: Math.min(parseFloat(r) || 0, b.width / 2, b.height / 2) };
      });
      const clip = { x: Math.max(0, Math.floor(at.x - 16)), y: Math.max(0, Math.floor(at.y - 16)), width: Math.ceil(at.w + 32), height: Math.ceil(at.h + 32) };
      // Over the ground in place of the scene, which forced colours paint the system's own.
      await style(frame, "scene", SCENE(theme.colors.bg!));
      await labelsOn();
      const on = (await tab.screenshot({ clip })).toString("base64");
      await labelsOff();
      const off = (await tab.screenshot({ clip })).toString("base64");
      await labelsOn();
      await style(frame, "scene", null);
      const r = await round(tab, on, off, { x: at.x - clip.x, y: at.y - clip.y, w: at.w, h: at.h, r: at.r });
      if (r.sectors < 36) low.push(`${name} picked name: ${r.sectors} of 36 sectors`);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  test("Archipelago: in forced colours, which drop shadows, the ring round the picked agent's name, calling or not, still shows all round", pickedForced, 90_000);

  /** The effects pass (bloom, the tilt that blurs all but a band of the picture, filmic colour), as a
   *  hardware GPU draws it: the view leaves it out on a software one, so it is told the GPU's name is a
   *  hardware one (the pixels are still SwiftShader's). The view also draws less while its frames come
   *  slowly (no blur, then no effects pass), and SwiftShader's come at a few a second, fewer on a busy
   *  machine: so the view's frame clock moves on a sixtieth of a second each frame, as a hardware GPU's
   *  does at 60 Hz however long SwiftShader takes over it, and the view holds the quality that GPU holds.
   *  (A clock slowed tenfold instead still let it step down at a load average of 4.) */
  const HARDWARE = () => {
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const get = C.prototype.getParameter;
      C.prototype.getParameter = function (p: number) { return p === 0x9246 ? "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)" : get.call(this, p); };
    }
    if (location.pathname.includes("/view/")) {
      // Every callback of one frame is handed the same time, as the browser does.
      const raf = window.requestAnimationFrame.bind(window), t0 = performance.now();
      let at = -1, frames = 0;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => raf((t) => { if (t !== at) { at = t; frames++; } cb(t0 + (frames * 1000) / 60); });
    }
  };

  /** By night, walking from behind beside alpha calling you, the light over it, row by row up its column:
   *  its pixels are those that change when alpha stops calling, each row's best set against what is
   *  behind it there, the same picture with alpha no longer calling. With `effects`, through the effects
   *  pass (HARDWARE). */
  async function beamReads(from: string, ids: string[], effects = false) {
    const size = { width: 1024, height: 704 };
    const { tab, frame } = await open("archipelago", "index.html", "#000", size, effects ? HARDWARE : undefined);
    let theme = await appTheme(tab, from);
    await ground(tab, theme.colors.bg!);
    await connectView(tab, { theme, capabilities: ["workspace:spawn"], settings: { ...STILL, effects, sky: "night", frameRate: 15 }, viewport: { w: size.width, h: size.height } });
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }, { id: "b", frameId: "f", kind: "agent", name: "beta", agent: "claude" }], links: { pipes: [], spawns: [] } });
    await tab.waitForFunction(() => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === 2, undefined, { timeout: 180_000 });
    await send(tab, { type: "status", tileId: "a", status: "blocked" });
    await send(tab, { type: "status", tileId: "b", status: "idle" });
    await tab.evaluate(() => (window as unknown as { host: { reveal(t: string): Promise<unknown> } }).host.reveal("a"));
    await send(tab, { type: "invoke", invokeId: 1, name: "walk", args: { on: true, pov: "third" } });
    await drawn(frame, 6);
    await tab.waitForTimeout(2500);
    // Where alpha's name stands, over its head; then only the scene, the names, panels and toolbar taken away.
    const head = await frame.evaluate(() => { const b = document.querySelector(".label.calling")!.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.bottom }; });
    await frame.evaluate(() => { const s = document.createElement("style"); s.textContent = "body > :not(.stage):not(.sky) { visibility: hidden !important; }"; document.head.append(s); });
    const low: string[] = [];
    // The view draws every fourth frame at 15 a second: through the effects pass, wait for two of them.
    const settled = () => drawn(frame, effects ? 8 : 2);
    for (const id of ids) {
      theme = await appTheme(tab, id);
      await ground(tab, theme.colors.bg!);
      await send(tab, { type: "theme", theme });
      await settled();
      const lit = (await tab.screenshot()).toString("base64");
      await send(tab, { type: "status", tileId: "a", status: "idle" });
      await settled();
      const behind = (await tab.screenshot()).toString("base64");
      await send(tab, { type: "status", tileId: "a", status: "blocked" });
      await settled();
      // Drawn as that GPU draws it, nothing stepped down (from behind you, with the blur).
      if (effects) expect([id, await frame.evaluate(() => (globalThis as unknown as { archipelagoStats: { quality: number } }).archipelagoStats.quality)]).toEqual([id, 0]);
      const rows = await tab.evaluate(async ({ lit, behind, head }) => {
        const h = window as unknown as Helpers;
        const pixels = async (png: string) => {
          const img = new Image();
          img.src = "data:image/png;base64," + png;
          await img.decode();
          const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(img, 0, 0);
          return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
        };
        const [a, c] = await Promise.all([pixels(lit), pixels(behind)]);
        const at = (img: typeof a, p: number) => [img.d[p]!, img.d[p + 1]!, img.d[p + 2]!];
        const beam = (p: number) => Math.abs(a.d[p]! - c.d[p]!) + Math.abs(a.d[p + 1]! - c.d[p + 1]!) + Math.abs(a.d[p + 2]! - c.d[p + 2]!) > 24;
        // The column over alpha's head: in each row above it, the runs of light within 40 px of its middle,
        // from 3 px wide (a stray pixel of a ship's lamp is not it) to 30 (nor the ring on the ground).
        const out: { y: number; best: number }[] = [];
        const x0 = Math.max(0, Math.floor(head.x - 40)), x1 = Math.min(a.w, Math.ceil(head.x + 40));
        for (let y = 0; y < Math.min(a.h, head.y); y++) {
          let best = 0, run = 0;
          for (let x = x0; x <= x1; x++) {
            const p = (y * a.w + x) * 4;
            if (x < x1 && beam(p)) { run++; continue; }
            if (run >= 3 && run <= 30) for (let i = x - run; i < x; i++) { const q = (y * a.w + i) * 4; best = Math.max(best, h.contrast(at(a, q), at(c, q))); }
            run = 0;
          }
          if (best) out.push({ y, best });
        }
        return out;
      }, { lit, behind, head });
      const under = rows.filter((r) => r.best < 3);
      // The light is there, a column of rows, and every row of it reads.
      if (rows.length < 60 || under.length) low.push(`${id}: ${rows.length - under.length} of ${rows.length} rows at 3:1, the least ${Math.min(...rows.map((r) => r.best)).toFixed(2)}`);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  test("Archipelago: by night the light over an agent calling you stands at 3:1 against what is behind it on every row of its column, over the moonlit sea and the foam, in every dark preset and Harbour, switched live", () => beamReads(DARK[0]!, [...DARK, "harbour"]), 300_000);
  test.skipIf(!LIGHT)(`Archipelago: by night the light over an agent calling you stands at 3:1 against what is behind it on every row of its column, over the moonlit sea and the foam, ${ON_LIGHT}, switched live from a dark preset and back`, () => beamReads(DARK[0]!, ["clean-light", DARK[0]!, "clean-light"]), 180_000);
  test("Archipelago: by night, through the effects pass a hardware GPU draws (bloom and the tilt's blur), the light over an agent calling you stands at 3:1 against what is behind it on every row of its column, over the moonlit sea and the foam, in every dark preset and Harbour, switched live", () => beamReads(DARK[0]!, [...DARK, "harbour"], true), 600_000);
  test.skipIf(!LIGHT)(`Archipelago: by night, through the effects pass a hardware GPU draws (bloom and the tilt's blur), the light over an agent calling you stands at 3:1 against what is behind it on every row of its column, over the moonlit sea and the foam, ${ON_LIGHT}, switched live from a dark preset and back`, () => beamReads(DARK[0]!, ["clean-light", DARK[0]!, "clean-light"], true), 600_000);

  /** The plank's words, wide enough that it keeps every label, in `font`: at rest, and each under the pointer. */
  async function plankReads(font: keyof typeof FONTS) {
    const size = { width: 1280, height: 800 };
    const { tab, frame } = await open("archipelago", "index.html", "#000", size);
    const theme = await appTheme(tab, DARK[0]!);
    await ground(tab, theme.colors.bg!);
    await connectView(tab, { theme: { ...theme, fonts: { ui: FONTS[font], mono: "monospace" } }, capabilities: ["workspace:spawn"], settings: { ...STILL, sky: "day", frameRate: 15 }, viewport: { w: size.width, h: size.height } });
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }], links: { pipes: [], spawns: [] } });
    await drawn(frame, 8);
    // The labels it shows: "New island", and "Archipelago" where the app puts its own buttons on the plank.
    const sels = await frame.evaluate(() => [".bar .new-island span", ".bar .views span"].filter((sel) => document.querySelector(sel)?.getBoundingClientRect().width));
    expect(sels).toContain(".bar .new-island span");
    const low: string[] = [];
    for (const over of [null, ...sels]) {
      if (over) { const b = await frame.evaluate((sel) => { const r = document.querySelector(sel)!.closest(".btn")!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, over); await tab.mouse.move(b.x, b.y); }
      else await tab.mouse.move(size.width / 2, 40);
      await drawn(frame, 2);
      await tab.waitForTimeout(200);
      for (const r of await reads(tab, frame, over ? [over] : sels)) if (r.least < 4.5) low.push(`${r.sel}${over ? " under the pointer" : ""} ${r.least.toFixed(2)}`);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  for (const font of Object.keys(FONTS) as (keyof typeof FONTS)[]) {
    test(`Archipelago: the plank's words read at 4.5:1 on its wood, the same in every theme, at rest and under the pointer, in ${font}`, () => plankReads(font), 90_000);
  }
}


// Archipelago's names and pins from afar, and its islands from the keyboard: two islands, web with
// alpha calling you, beta and delta ready for work and gamma working, and docs with eps ready and zeta
// working, seen from far enough that the pins are in. Inside a block, so its helpers keep to it.
{
  const AGENTS = [["alpha", "f", "blocked"], ["beta", "f", "idle"], ["gamma", "f", "working"], ["delta", "f", "idle"], ["eps", "g", "idle"], ["zeta", "g", "working"]] as const;
  type Theme = Awaited<ReturnType<typeof appTheme>>;
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  /** The view from afar in Signal by day, holding still; the pin of an agent ready for work pale, so
   *  its mark is black (pins.ts). */
  async function islands(calling = true) {
    const size = { width: 1024, height: 704 };
    const { tab, frame } = await open("archipelago", "index.html", "#000", size);
    const signal = await appTheme(tab, DARK[0]!);
    const theme: Theme = { ...signal, status: { ...signal.status, idle: "#c8c8c8" } };
    await ground(tab, theme.colors.bg!);
    await connectView(tab, { theme, capabilities: ["workspace:spawn"], settings: { ...STILL, sky: "day", frameRate: 15 }, viewport: { w: size.width, h: size.height }, layout: { camera: { dist: 120 } } });
    await send(tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }, { id: "g", title: "docs", color: "#e0a050", branch: "main" }], tiles: AGENTS.map(([id, frameId]) => ({ id, frameId, kind: "agent", name: id, agent: "claude" })), links: { pipes: [], spawns: [] } });
    await tab.waitForFunction((n) => (window as unknown as { host: { subscribed: { status: Set<string> } } }).host.subscribed.status.size === n, AGENTS.length, { timeout: 60_000 });
    for (const [id, , status] of AGENTS) await send(tab, { type: "status", tileId: id, status: calling ? status : status === "blocked" ? "idle" : status });
    await drawn(frame, 8);
    return { tab, frame, theme };
  }
  /** The names on screen: what each says and its box. */
  const namesShown = (frame: Frame) => frame.evaluate(() => [...document.querySelectorAll<HTMLElement>(".label")]
    .filter((e) => getComputedStyle(e).display !== "none" && !e.classList.contains("away"))
    .map((e) => { const b = e.getBoundingClientRect(); return { text: e.textContent!, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }; }));
  /** Which pixels the pins drawn in the status tones `to` names cover: those that change when those tones
   *  change to `to`'s, with every name and panel out of sight (nothing else in this scene is drawn in
   *  them). A string a row, "#" where a pin is. The theme is put back after. */
  async function pinMask(tab: Page, frame: Frame, theme: Theme, to: Record<string, string>): Promise<string[]> {
    const bare = (on: boolean) => frame.evaluate((on) => {
      document.getElementById("bare")?.remove();
      if (on) document.head.append(Object.assign(document.createElement("style"), { id: "bare", textContent: "body > :not(.stage):not(.sky) { visibility: hidden !important; }" }));
    }, on);
    await bare(true);
    await drawn(frame, 8);
    const before = (await tab.screenshot()).toString("base64");
    await send(tab, { type: "theme", theme: { ...theme, status: { ...theme.status, ...to } } });
    await drawn(frame, 8);
    const after = (await tab.screenshot()).toString("base64");
    await send(tab, { type: "theme", theme });
    await bare(false);
    await drawn(frame, 8);
    return tab.evaluate(async ({ before, after }) => {
      const pixels = async (png: string) => {
        const img = new Image();
        img.src = "data:image/png;base64," + png;
        await img.decode();
        const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
      };
      const [a, b] = await Promise.all([pixels(before), pixels(after)]);
      return Array.from({ length: a.h }, (_, y) => Array.from({ length: a.w }, (_, x) => {
        const p = (y * a.w + x) * 4;
        return Math.abs(a.d[p]! - b.d[p]!) + Math.abs(a.d[p + 1]! - b.d[p + 1]!) + Math.abs(a.d[p + 2]! - b.d[p + 2]!) > 24 ? "#" : ".";
      }).join(""));
    }, { before, after });
  }
  /** The longest run of pin pixels along a row inside `r`. */
  const widest = (mask: string[], r: Rect) => {
    let most = 0;
    for (let y = Math.max(0, Math.floor(r.y0)); y < Math.min(mask.length, Math.ceil(r.y1)); y++) {
      for (const run of mask[y]!.slice(Math.max(0, Math.floor(r.x0)), Math.ceil(r.x1)).split(".")) most = Math.max(most, run.length);
    }
    return most;
  };
  /** The mask's pieces, each pixel joined to those beside it: how many pixels and its box. */
  const pieces = (mask: string[]) => {
    const seen = mask.map((row) => new Uint8Array(row.length)), out: (Rect & { n: number })[] = [];
    for (let y = 0; y < mask.length; y++) for (let x = 0; x < mask[y]!.length; x++) {
      if (mask[y]![x] !== "#" || seen[y]![x]) continue;
      const p = { x0: x, y0: y, x1: x, y1: y, n: 0 }, todo = [[x, y]];
      seen[y]![x] = 1;
      while (todo.length) {
        const [i, j] = todo.pop()!;
        p.n++; p.x0 = Math.min(p.x0, i!); p.x1 = Math.max(p.x1, i!); p.y0 = Math.min(p.y0, j!); p.y1 = Math.max(p.y1, j!);
        for (const [u, v] of [[i! + 1, j!], [i! - 1, j!], [i!, j! + 1], [i!, j! - 1]]) if (mask[v!]?.[u!] === "#" && !seen[v!]![u!]) { seen[v!]![u!] = 1; todo.push([u!, v!]); }
      }
      out.push(p);
    }
    return out;
  };

  test("Archipelago: from afar a name does not cover the pin it names: an island's stands above the pins on it, and an agent's calling you just above its own, where the island keeps its name, directly above the agent's", async () => {
    const { tab, frame, theme } = await islands(false);
    // No one calling: every pin, under neither island's name.
    const all = await pinMask(tab, frame, theme, { idle: "#ff80ff", working: "#00ff00" });
    expect((await namesShown(frame)).map((n) => [n.text, widest(all, n)])).toEqual([["web4 agents · 1 working · main", 0], ["docs2 agents · 1 working · main", 0]]);
    // alpha calls you: its pin, the one in the attention colour, stands just under its name, 20 px
    // across and more, and only the light over it, a pixel or two wide, passes behind the name.
    await send(tab, { type: "status", tileId: "alpha", status: "blocked" });
    await drawn(frame, 8);
    const names = await namesShown(frame);
    const alpha = names.find((n) => n.text.startsWith("alpha"))!, web = names.find((n) => n.text.startsWith("web"));
    const calling = await pinMask(tab, frame, theme, { attention: "#0000ff" });
    const behind = widest(calling, alpha), under = widest(calling, { ...alpha, y0: alpha.y1, y1: alpha.y1 + 50 });
    expect({ behind: behind <= 3 ? "only the light" : `${behind} px of its pin`, under: under >= 20 ? "its pin" : `${under} px` }).toEqual({ behind: "only the light", under: "its pin" });
    // web keeps its name, over alpha's, which stands where web's would.
    expect(web && { above: web.y1 <= alpha.y0 + 1, across: web.x0 < alpha.x1 && web.x1 > alpha.x0 }).toEqual({ above: true, across: true });
    await tab.close();
  }, 90_000);

  test("Archipelago: with widget cards down the left edge, an island's name stops at their edge, and one whose island goes under them goes too; past the top of the window it stops there while its island is in sight", async () => {
    const { tab, frame } = await islands(false);
    // The app's widget cards down the left edge, 268 px wide.
    await send(tab, { type: "widgets", widgets: [{ id: "w1", widget: "harbour", card: true }] });
    await drawn(frame, 4);
    await tab.focus("iframe");
    /** The names at each of `n` presses of `key`, from before the first. */
    const steps = async (key: string, n: number) => {
      const out = [];
      for (let i = 0; i <= n; i++) {
        if (i) { await tab.keyboard.press(key); await drawn(frame, 3); }
        out.push(await namesShown(frame));
      }
      return out;
    };
    // The islands slide left under the cards, docs first: each name stops at their edge, then goes.
    const sliding = await steps("ArrowRight", 5);
    expect(sliding.flatMap((names, i) => names.filter((n) => n.x0 < 267.5).map((n) => `${i}: ${n.text} from ${Math.round(n.x0)}`))).toEqual([]);
    expect(["web", "docs"].map((t) => sliding.some((names) => names.some((n) => n.text.startsWith(t) && n.x0 < 278)))).toEqual([true, true]);
    expect(sliding.at(-1)!.map((n) => n.text).filter((t) => t.startsWith("docs"))).toEqual([]);
    // Back, then the islands slide up past the top: web's name stops 12 px below it.
    await steps("ArrowLeft", 5);
    const rising = await steps("ArrowDown", 6);
    expect(rising.flatMap((names, i) => names.filter((n) => n.y0 < 11.5).map((n) => `${i}: ${n.text} at ${Math.round(n.y0)}`))).toEqual([]);
    expect(rising.filter((names) => names.some((n) => n.text.startsWith("web") && n.y0 < 13)).length).toBeGreaterThanOrEqual(2);
    await tab.close();
  }, 90_000);

  test("Archipelago: from afar an agent ready for work wears a closed ring on its pin, where three dots read as one typing: the pin's colour shows in the ring's middle, cut off all round from the colour outside it", async () => {
    const { tab, frame, theme } = await islands();
    // The ready agents' pins, in a pale colour of their own: the colour round the mark changes, the
    // black mark does not.
    const mask = await pinMask(tab, frame, theme, { idle: "#ff80ff" });
    // Each pin's colour outside its mark (the disc within its dark rim, and the point under it), and the
    // pieces of it inside that, cut off from it by the mark all round.
    const all = pieces(mask), pins = all.filter((p) => p.n > 100);
    expect(pins.length).toBe(3);
    const marks = pins.map((p) => {
      const inside = all.filter((q) => q !== p && q.x0 > p.x0 && q.x1 < p.x1 && q.y0 > p.y0 && q.y1 < p.y1);
      // The disc's colour reaches 9.9 px out from its middle (0.76 of a pin's radius), the ring's 3.
      const cx = (p.x0 + p.x1) / 2, cy = p.y0 + (p.x1 - p.x0) / 2;
      return inside.map((q) => ({ middle: Math.hypot((q.x0 + q.x1) / 2 - cx, (q.y0 + q.y1) / 2 - cy) < 2, across: q.x1 - q.x0 + 1 }));
    });
    // One piece in each, in the middle, 5 to 8 px across.
    expect(marks.map((m) => m.map((q) => ({ middle: q.middle, across: q.across >= 5 && q.across <= 8 })))).toEqual(pins.map(() => [{ middle: true, across: true }]));
    await tab.close();
  }, 90_000);

  test("Archipelago: Tab goes from the calls to every island's name, a button even where its name has no room, shown once focused; Enter flies to the island and opens its card, whose agents are buttons to their own cards; the keyboard stays on the card's button as statuses change, and a card put away leaves the Tab order", async () => {
    const { tab, frame } = await islands();
    // Each island's name is a button a screen reader reads, out of the layer hidden from it; docs's has
    // no room on screen (it meets alpha's name, and above that web's).
    expect(await frame.evaluate(() => [...document.querySelectorAll(".islands button")].map((b) => [b.getAttribute("aria-label"), !!b.closest("[aria-hidden='true']"), b.classList.contains("away") ? "no room" : "shown"])))
      .toEqual([["web, 4 agents · 1 working · 1 calling · main", false, "shown"], ["docs, 2 agents · 1 working · main", false, "no room"]]);
    const focused = () => frame.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const b = e.getBoundingClientRect();
      return { what: e.dataset.id ?? e.dataset.key ?? e.className, visible: e.matches(":focus-visible") && !e.classList.contains("away") && getComputedStyle(e).opacity === "1" && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight };
    });
    // Tab: the calls, then each island's name in turn, every one shown as the keyboard comes to it.
    const order = [];
    for (let i = 0; i < 3; i++) { await tab.keyboard.press("Tab"); await drawn(frame, 2); order.push(await focused()); }
    expect(order).toEqual([{ what: "calls-toggle", visible: true }, { what: "f", visible: true }, { what: "g", visible: true }]);
    // Enter on docs: the camera comes down to it (the place the view keeps), and its card lists its agents.
    await tab.keyboard.press("Enter");
    await drawn(frame, 4);
    await tab.waitForTimeout(600);
    const camera = await tab.evaluate(() => (window as unknown as { host: { received: { type: string; data?: { camera?: { dist: number } } }[] } }).host.received.filter((m) => m.type === "layout").at(-1)?.data?.camera?.dist);
    expect(camera).toBeLessThan(60);
    const card = () => frame.evaluate(() => ({ title: document.querySelector(".card h3")!.textContent, agents: [...document.querySelectorAll(".card .agents button")].map((b) => b.textContent) }));
    expect(await card()).toEqual({ title: "docs", agents: ["epsready for work", "zetaworking"] });
    // On to eps's button; while it has the keyboard, zeta calls you and the card is drawn again.
    await tab.keyboard.press("Tab");
    expect(await focused()).toEqual({ what: "agent:eps", visible: true });
    await send(tab, { type: "status", tileId: "zeta", status: "blocked" });
    await drawn(frame, 2);
    expect([await focused(), (await card()).agents]).toEqual([{ what: "agent:eps", visible: true }, ["epsready for work", "zetaneeds you"]]);
    // Enter: eps's card, the keyboard on its first button.
    await tab.keyboard.press("Enter");
    await drawn(frame, 2);
    expect([(await card()).title, await focused(), await frame.evaluate(() => document.activeElement!.textContent)]).toEqual(["eps", { what: "open", visible: true }, "Open its terminal"]);
    // Esc puts the card away, and Shift+Tab back from the toolbar passes it by.
    await tab.keyboard.press("Escape");
    await drawn(frame, 2);
    await frame.evaluate(() => document.querySelector<HTMLElement>(".bar .btn")!.focus());
    await tab.keyboard.press("Shift+Tab");
    expect(await frame.evaluate(() => [getComputedStyle(document.querySelector(".card")!).visibility, (document.activeElement as HTMLElement).dataset.id])).toEqual(["hidden", "g"]);
    await tab.close();
  }, 90_000);
}
