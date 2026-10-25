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
// Chromium can take longer than bun's 5 s hook limit to start on a busy machine, as the pictures' test allows for.
beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
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
async function open(view: string, page: string, backdrop: string, viewport = { width: 800, height: 600 }) {
  const tab = await browser.newPage({ viewport });
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
    // The agent's name is written where its pin stands, over it: read the place, then take the names away.
    const at = await frame.evaluate(() => {
      const b = document.querySelector(".label.calling")!.getBoundingClientRect();
      for (const el of document.querySelectorAll<HTMLElement>(".labels, .edges")) el.style.visibility = "hidden";
      return { x: b.x + b.width / 2, y: b.bottom };
    });
    await drawn(frame);
    // A calling agent's disc is 31px across, its middle 25px over the place (pins.ts).
    const png = (await tab.screenshot({ clip: { x: at.x - 19, y: at.y - 44, width: 38, height: 38 } })).toString("base64");
    const pin = await tab.evaluate((png) => (window as unknown as Helpers).pin(png), png);
    // A disc is there (one colour fills a sixth of the picture, at least) and its mark reads on it, in the shade named.
    expect({ disc: pin.area > 240, mark: pin.contrast >= 3 ? "reads" : `${pin.contrast.toFixed(2)}:1`, shade: pin.darker ? "black" : "white" })
      .toEqual({ disc: true, mark: "reads", shade: row.mark });
    await tab.close();
  }, 90_000);
}

// views-a
// Timeline and Workspace map, each with today's agents in it: idle, waiting on you, exited; a worktree
// under a frame, a pipe and an agent started by another; issues, one read and one under the pointer. A
// theme's wallpaper is drawn behind a view with glass off too (Harbour's is), so each is read over its
// theme's ground and over the darkest and brightest wallpaper, glass on and off. Inside a block, so its
// helpers keep to it.
{
  type Box = { x: number; y: number; w: number; h: number };
  type Seen = { n: number; most: number };
  /** What these read off a screenshot, beside the page's own helpers. */
  const helpers = (tab: Page) => tab.evaluate(() => {
    const pixels = async (png: string) => {
      const img = new Image();
      img.src = "data:image/png;base64," + png;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    };
    const { contrast } = window as unknown as Helpers;
    const inBox = (b: Box, w: number, h: number, f: (i: number, j: number) => void) => {
      for (let j = Math.max(0, Math.floor(b.y)); j < Math.min(h, Math.ceil(b.y + b.h)); j++) for (let i = Math.max(0, Math.floor(b.x)); i < Math.min(w, Math.ceil(b.x + b.w)); i++) f(i, j);
    };
    const oklch = ([r, g, b]: number[]) => {
      const [R, G, B] = [r!, g!, b!].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      const l = Math.cbrt(0.4122214708 * R! + 0.5363325363 * G! + 0.0514459929 * B!), m = Math.cbrt(0.2119034982 * R! + 0.6806995451 * G! + 0.1073969566 * B!), s = Math.cbrt(0.0883024619 * R! + 0.2817188376 * G! + 0.6299787005 * B!);
      const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      return { c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
    };
    (window as unknown as { viewsA: unknown }).viewsA = {
      /** In each box, the pixels that differ between two screenshots, and the most contrast any of them has with what is there without it. */
      async seen(shown: string, bare: string, boxes: Box[]) {
        const [a, b] = await Promise.all([pixels(shown), pixels(bare)]);
        return boxes.map((box) => {
          let n = 0, most = 1;
          inBox(box, a.w, a.h, (i, j) => {
            const p = (j * a.w + i) * 4;
            if (Math.abs(a.d[p]! - b.d[p]!) + Math.abs(a.d[p + 1]! - b.d[p + 1]!) + Math.abs(a.d[p + 2]! - b.d[p + 2]!) < 6) return;
            n++;
            most = Math.max(most, contrast([a.d[p]!, a.d[p + 1]!, a.d[p + 2]!], [b.d[p]!, b.d[p + 1]!, b.d[p + 2]!]));
          });
          return { n, most };
        });
      },
      /** The most contrast between a pixel of one box and the same pixel of another as big. */
      async apart(png: string, one: Box, other: Box) {
        const a = await pixels(png);
        let most = 1;
        inBox(one, a.w, a.h, (i, j) => {
          const p = (j * a.w + i) * 4, q = ((j - one.y + other.y) * a.w + (i - one.x + other.x)) * 4;
          most = Math.max(most, contrast([a.d[p]!, a.d[p + 1]!, a.d[p + 2]!], [a.d[q]!, a.d[q + 1]!, a.d[q + 2]!]));
        });
        return most;
      },
      /** How many pixels in a box are of `tone`'s colour: its hue within 25 degrees, as saturated as a colour reads. */
      async toned(png: string, box: Box, tone: string) {
        const a = await pixels(png);
        const one = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        one.fillStyle = tone;
        one.fillRect(0, 0, 1, 1);
        const t = oklch([...one.getImageData(0, 0, 1, 1).data.slice(0, 3)]);
        let n = 0;
        inBox(box, a.w, a.h, (i, j) => {
          const p = (j * a.w + i) * 4, c = oklch([a.d[p]!, a.d[p + 1]!, a.d[p + 2]!]);
          if (c.c >= 0.06 && Math.abs(((c.h - t.h + 540) % 360) - 180) <= 25) n++;
        });
        return n;
      },
    };
  });
  type ViewsA = {
    seen(shown: string, bare: string, boxes: Box[]): Promise<Seen[]>;
    apart(png: string, one: Box, other: Box): Promise<number>;
    toned(png: string, box: Box, tone: string): Promise<number>;
  };
  const shot = async (tab: Page) => (await tab.screenshot()).toString("base64");
  /** Two screenshots: as shown, and with `css` laid over the view. */
  async function without(tab: Page, frame: Frame, css: string) {
    const shown = await shot(tab);
    await frame.evaluate((css) => { const s = document.createElement("style"); s.id = "views-a"; s.textContent = css; document.head.append(s); }, css);
    await drawn(frame, 2);
    const bare = await shot(tab);
    await frame.evaluate(() => document.getElementById("views-a")!.remove());
    await drawn(frame, 2);
    return { shown, bare };
  }
  const seen = (tab: Page, s: { shown: string; bare: string }, boxes: Box[]) => tab.evaluate(({ s, boxes }) => (window as unknown as { viewsA: ViewsA }).viewsA.seen(s.shown, s.bare, boxes), { s, boxes });
  const boxOf = (frame: Frame, sel: string) => frame.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }), sel);

  /** Words in the view, an SVG's too (its ink is its fill), read as `reads` reads them: each glyph
   *  pixel's ink, at its alpha, against what is under it with the words taken out. */
  async function readAll(tab: Page, frame: Frame, selectors: string[]) {
    const words = await frame.evaluate((sels) => sels.flatMap((sel) => [...document.querySelectorAll(sel)].flatMap((el) => {
      const svg = el instanceof SVGElement;
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = svg ? el.getBoundingClientRect() : range.getBoundingClientRect();
      if (!b.width || !b.height) return [];
      let alpha = 1;
      for (let at: Element | null = el; at; at = at.parentElement) alpha *= Number(getComputedStyle(at).opacity);
      return [{ sel, ink: svg ? getComputedStyle(el).fill : getComputedStyle(el).color, alpha, x: b.x, y: b.y, w: b.width, h: b.height }];
    })), selectors);
    const { shown, bare } = await without(tab, frame, "*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-shadow: none !important; } text { fill: transparent !important; }");
    const read = await tab.evaluate((a) => (window as unknown as Helpers).under(a.shown, a.bare, a.words), { shown, bare, words });
    return words.map(({ sel }, i) => ({ sel, ...read[i]! }));
  }

  /** `view` opened in `from` at `size`, connected with `hello` and the answers its data gives: the
   *  day's history, and issues to read. At `time`, if given, so the axis falls the same each run. */
  async function openA(view: string, from: string, size: Size, hello: object, data: { history?: object; issues?: object[] }, time?: Date) {
    const tab = await browser.newPage({ viewport: size });
    if (time) await tab.clock.setFixedTime(time);
    await tab.goto(`${server.url}`);
    const theme = await themeOf(tab, from);
    await ground(tab, theme.colors.bg!);
    await tab.evaluate((src) => new Promise<void>((resolve) => {
      const f = document.createElement("iframe");
      f.onload = () => resolve();
      f.src = src;
      document.body.append(f);
    }), `/view/${view}/__entry.html?js=index.js`);
    const frame = tab.frames().find((f) => f.url().includes(`/view/${view}/`))!;
    await helpers(tab);
    await tab.evaluate(async ({ hello, data }) => {
      const { fakeHost } = await import("/host.js" as string);
      const answers: Record<string, (a: { args: unknown[] }) => unknown> = {};
      if (data.history) answers.history = () => data.history;
      if (data.issues) answers.issue = (a) => ({ ...(data.issues as { id: string }[]).find((i) => i.id === a.args[0]), sections: { description: "Sign in fails after a refresh.", acceptanceCriteria: [], activity: [] } });
      const host = fakeHost({ ...hello, answers });
      (window as unknown as { host: unknown }).host = host;
      const view = document.querySelector("iframe")!.contentWindow!;
      while (!host.received.length) { host.handshake(view); await new Promise((r) => setTimeout(r, 20)); }
    }, { hello: { ...hello, theme }, data });
    return { tab, frame };
  }
  /** Each look in `ids`, switched live: over its theme's ground, then each wallpaper under glass and without it. */
  async function* looks(tab: Page, frame: Frame, ids: string[]) {
    for (const id of ids) {
      const plain = await themeOf(tab, id);
      for (const [glass, backdrop] of [[false, plain.colors.bg!], ...WALLPAPERS.flatMap((w) => [[true, w], [false, w]] as const)] as const) {
        await ground(tab, backdrop);
        const theme = await themeOf(tab, id, { glass });
        await send(tab, { type: "theme", theme });
        await drawn(frame);
        yield { where: `${id}${backdrop === plain.colors.bg ? "" : ` over ${backdrop}${glass ? " under glass" : " without glass"}`}`, theme };
      }
    }
  }

  // Today in the Timeline, at a time fixed so its axis's times fall the same each run: alpha worked,
  // sat idle, waited on you, worked and has sat idle since; zed worked, sat idle and exited.
  const NOW = new Date(2026, 9, 21, 20, 10);
  const M = 60_000, now = NOW.getTime();
  const DAY = {
    day: "2026-10-21", frames: { f: "web" },
    tiles: [
      { id: "a", name: "alpha", frameId: "f", agent: "claude", turns: [now - 90 * M], intervals: [[now - 120 * M, now - 100 * M, "working"], [now - 100 * M, now - 70 * M, "idle"], [now - 70 * M, now - 65 * M, "blocked"], [now - 65 * M, now - 40 * M, "working"], [now - 40 * M, now, "idle"]] },
      { id: "z", name: "zed", frameId: "f", agent: "claude", turns: [now - 85 * M], intervals: [[now - 110 * M, now - 80 * M, "working"], [now - 80 * M, now - 60 * M, "idle"], [now - 60 * M, now - 30 * M, "exited"]] },
    ],
  };
  async function timeline(from: string) {
    const opened = await openA("timeline", from, WIDE, {}, { history: DAY }, NOW);
    await send(opened.tab, { type: "structure", frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }], tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }], links: { pipes: [], spawns: [] } });
    await opened.frame.waitForFunction(() => document.querySelectorAll(".seg").length >= 8);
    return opened;
  }

  /** The now line's name, in each look switched live: what is drawn on the axis by the line's top. */
  async function nowNamed(from: string, ids: string[]) {
    const { tab, frame } = await timeline(from);
    const low: string[] = [];
    for await (const { where } of looks(tab, frame, ids)) {
      const at = await frame.evaluate(() => {
        const line = document.querySelector(".now")!.getBoundingClientRect(), axis = document.querySelector(".axis")!.getBoundingClientRect();
        return { x: line.x + 1, y: axis.y, w: 30, h: axis.height };
      });
      const words = await without(tab, frame, "*, *::before, *::after { -webkit-text-fill-color: transparent !important; color: transparent !important; }");
      const [{ n, most }] = await seen(tab, words, [at]) as [Seen];
      // The word is there, and its letters stand off what is under them: covered by the axis, they came to 1.04:1.
      if (n < 20 || most < 4.5) low.push(`${where}: ${n} pixels, the strongest ${most.toFixed(2)}:1`);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  test("Timeline: the now line's name, at its top on the axis, reads at 4.5:1 in every dark preset switched live, over the theme's ground and a wallpaper with glass on or off", () => nowNamed(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Timeline: the now line's name, at its top on the axis, reads at 4.5:1 ${ON_LIGHT}, switched live from a dark preset and back`, () => nowNamed(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);

  /** Timeline's words in each look switched live: the header, the frame, each agent and how long it worked, the axis's times. */
  async function timelineWords(from: string, ids: string[]) {
    const { tab, frame } = await timeline(from);
    const sels = ["header h1", ".sum", ".sum b", ".legend > span", ".group h2 span", ".name span", ".name small", ".axis span:not([hidden])"];
    const low: string[] = [];
    for await (const { where } of looks(tab, frame, ids)) {
      const words = await readAll(tab, frame, sels);
      expect([where, sels.filter((sel) => !words.some((w) => w.sel === sel))]).toEqual([where, []]);
      for (const { sel, least } of words) if (least < 4.5) low.push(`${where}: ${sel} ${least.toFixed(2)}`);
    }
    expect([...new Set(low)]).toEqual([]);
    await tab.close();
  }
  test("Timeline: its header, its rows and its axis read at 4.5:1 in every dark preset switched live, over the theme's ground and a wallpaper with glass on or off", () => timelineWords(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Timeline: its header, its rows and its axis read at 4.5:1 ${ON_LIGHT}, over its ground and a wallpaper with glass on or off, switched live from a dark preset and back`, () => timelineWords(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);

  /** Timeline's idle and exited stretches in each look: each marked at 3:1 against the track, the two
   *  told apart, and each named in the legend with its mark at 3:1. */
  async function idleStopped(from: string, ids: string[]) {
    const { tab, frame } = await timeline(from);
    const low: string[] = [];
    for await (const { where } of looks(tab, frame, ids)) {
      const spans = await frame.evaluate(() => Object.fromEntries(["idle", "exited"].map((s) => {
        const b = document.querySelector(`.track [data-s="${s}"]`)!.getBoundingClientRect();
        return [s, { x: Math.round(b.x) + 2, y: Math.round(b.y), w: Math.round(b.width) - 4, h: Math.round(b.height) }];
      })) as Record<"idle" | "exited", Box>);
      const legend = await frame.evaluate(() => [...document.querySelectorAll(".legend > span")].map((s) => { const b = s.querySelector("i")!.getBoundingClientRect(); return { word: s.textContent!.trim(), x: b.x, y: b.y, w: b.width, h: b.height }; }));
      const named = Object.fromEntries(legend.map(({ word, ...b }) => [word, b]));
      for (const word of ["idle", "exited"]) if (!named[word]) low.push(`${where}: no "${word}" in the legend`);
      const marks = await without(tab, frame, ".seg, .legend i { visibility: hidden !important; }");
      const each = ([["an idle stretch", spans.idle], ["an exited one", spans.exited], ["the legend's idle", named.idle], ["the legend's exited", named.exited]] as const).filter((m): m is readonly [string, Box] => !!m[1]);
      const read = await seen(tab, marks, each.map(([, b]) => b)) as Seen[];
      each.forEach(([what], i) => { if (read[i]!.most < 3) low.push(`${where}: ${what} ${read[i]!.most.toFixed(2)}`); });
      // Side by side, the same size, an exited stretch and an idle one differ at 3:1 somewhere: faded to a third and a quarter, they came to 1.09:1.
      const size = { w: Math.min(spans.idle.w, spans.exited.w, 40), h: spans.idle.h };
      const apart = await tab.evaluate(({ png, a, b }) => (window as unknown as { viewsA: ViewsA }).viewsA.apart(png, a, b), { png: marks.shown, a: { ...spans.idle, ...size }, b: { ...spans.exited, ...size } });
      if (apart < 3) low.push(`${where}: idle and exited differ by ${apart.toFixed(2)}`);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  test("Timeline: an idle stretch and an exited one are marked at 3:1 on the track, apart from each other, and named in the legend with marks at 3:1, in every dark preset switched live, over the theme's ground and a wallpaper with glass on or off", () => idleStopped(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Timeline: an idle stretch and an exited one are marked at 3:1 on the track, apart from each other, and named in the legend ${ON_LIGHT}, switched live from a dark preset and back`, () => idleStopped(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);

  // The Workspace map, in a window wide enough for all of it: a frame with a worktree under it, four agents, alpha's output piped to gamma and
  // delta started by beta, nobody waiting on you; and three issues, WEB-1 read and WEB-2 under the pointer.
  const LARGE: Size = { width: 1440, height: 900 };
  const ISSUES = [
    { id: "WEB-1", title: "Fix the login page", state: "in_progress", parent: null, labels: [], assignee: { type: "agent", id: "alpha" }, created: "2026-10-01", updated: "2026-10-02" },
    { id: "WEB-2", title: "Add dark mode", state: "in_progress", parent: null, labels: [], assignee: { type: "person", id: "dip" }, created: "2026-10-01", updated: "2026-10-02" },
    { id: "WEB-3", title: "Write the docs", state: "todo", parent: null, labels: [], assignee: null, created: "2026-10-01", updated: "2026-10-02" },
  ];
  async function workspaceMap(from: string) {
    const opened = await openA("workspace-map", from, LARGE, { capabilities: ["workspace:issues"], viewport: { w: LARGE.width, h: LARGE.height } }, { issues: ISSUES });
    const { tab, frame } = opened;
    await send(tab, {
      type: "structure",
      frames: [{ id: "f", title: "web", color: "#5b8def", branch: "main" }, { id: "w", title: "login fix", color: "#3fb950", branch: "fix/login", parentId: "f", folder: { kind: "worktree" } }],
      tiles: [{ id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" }, { id: "b", frameId: "f", kind: "agent", name: "beta", agent: "codex" }, { id: "c", frameId: "w", kind: "agent", name: "gamma", agent: "claude" }, { id: "d", frameId: "w", kind: "agent", name: "delta", agent: "claude" }],
      links: { pipes: [{ src: "a", dst: "c" }], spawns: [{ parent: "b", child: "d" }] },
    });
    await tab.waitForFunction(() => (window as unknown as { host: { subscribed: { issues: boolean; status: Set<string> } } }).host.subscribed.issues, undefined, { timeout: 30_000 });
    await send(tab, { type: "issues", issues: ISSUES });
    for (const id of ["a", "b", "c", "d"]) await send(tab, { type: "status", tileId: id, status: "idle" });
    await frame.click(".issue");
    await frame.waitForFunction(() => document.querySelector(".read h3")?.textContent?.startsWith("WEB-1"));
    // All of it in view, the ties out to the right of the tiles among it.
    expect(await frame.evaluate(() => { const m = document.querySelector(".map")!; return m.scrollWidth <= m.clientWidth; })).toBe(true);
    return opened;
  }

  /** The map's and the issues' words in each look: titles, sums, each frame's and agent's second line, the issues. */
  async function mapWords(from: string, ids: string[]) {
    const { tab, frame } = await workspaceMap(from);
    await tab.mouse.move(2, LARGE.height - 2);
    const sels = [".map h1", ".map p.sum", ".issues h1", ".issues p.sum", ".node text", ".node text.sub", ".list h2", ".issue:not([aria-current]) code", ".issue:not([aria-current]) span", ".issue:not([aria-current]) small", ".read h3", ".read p"];
    const low: string[] = [];
    for await (const { where } of looks(tab, frame, ids)) {
      const words = await readAll(tab, frame, sels);
      expect([where, sels.filter((sel) => !words.some((w) => w.sel === sel))]).toEqual([where, []]);
      for (const { sel, least } of words) if (least < 4.5) low.push(`${where}: ${sel} ${least.toFixed(2)}`);
    }
    expect([...new Set(low)]).toEqual([]);
    await tab.close();
  }
  test("Workspace map: its words, each frame's and agent's second line among them, read at 4.5:1 on its panels in every dark preset switched live, over the theme's ground and a wallpaper with glass on or off", () => mapWords(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Workspace map: its words, each frame's and agent's second line among them, read at 4.5:1 on its panels ${ON_LIGHT}, over its ground and a wallpaper with glass on or off, switched live from a dark preset and back`, () => mapWords(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);

  /** The pipe from alpha to gamma, in each look: its line against the map under it (the tie it crosses taken out). */
  async function pipe(from: string, ids: string[]) {
    const { tab, frame } = await workspaceMap(from);
    await frame.evaluate(() => { const s = document.createElement("style"); s.textContent = ".tie:not(.pipe) { visibility: hidden !important; }"; document.head.append(s); });
    const low: string[] = [];
    for await (const { where } of looks(tab, frame, ids)) {
      const line = await frame.evaluate(() => { const el = document.querySelector(".tie.pipe")!, cs = getComputedStyle(el); let alpha = Number(cs.strokeOpacity); for (let at: Element | null = el; at; at = at.parentElement) alpha *= Number(getComputedStyle(at).opacity); const b = el.getBoundingClientRect(); return { sel: ".tie.pipe", ink: cs.stroke, alpha, x: b.x - 2, y: b.y - 2, w: b.width + 4, h: b.height + 4 }; });
      const { shown, bare } = await without(tab, frame, ".tie.pipe { visibility: hidden !important; }");
      const [{ least, n }] = await tab.evaluate((a) => (window as unknown as Helpers).under(a.shown, a.bare, [a.line]), { shown, bare, line }) as [{ least: number; n: number }];
      if (n < 30 || least < 3) low.push(`${where}: ${n} pixels, ${least.toFixed(2)}:1`);
    }
    expect(low).toEqual([]);
    await tab.close();
  }
  test("Workspace map: a pipe between agents reads at 3:1 on the map in every dark preset switched live, over the theme's ground and a wallpaper with glass on or off", () => pipe(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Workspace map: a pipe between agents reads at 3:1 on the map ${ON_LIGHT}, switched live from a dark preset and back`, () => pipe(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);

  /** With nobody waiting, nothing on the map is in the attention colour: an agent started by another is a fact, not a call. */
  async function noCall(from: string, ids: string[]) {
    const { tab, frame } = await workspaceMap(from);
    const called: string[] = [];
    const inside = async () => { const b = (await boxOf(frame, ".map"))[0]!; return { x: b.x + 14, y: b.y + 14, w: b.w - 28, h: b.h - 28 }; };
    for await (const { where, theme } of looks(tab, frame, ids)) {
      const map = await inside();
      const png = await shot(tab);
      const n = await tab.evaluate(({ png, map, tone }) => (window as unknown as { viewsA: ViewsA }).viewsA.toned(png, map, tone), { png, map, tone: theme.colors.warn! });
      if (n) called.push(`${where}: ${n} pixels`);
    }
    expect(called).toEqual([]);
    // Its own check: alpha waiting on you is in it.
    await send(tab, { type: "status", tileId: "a", status: "blocked" });
    await drawn(frame);
    const map = await inside();
    expect(await tab.evaluate(async ({ png, map, tone }) => (window as unknown as { viewsA: ViewsA }).viewsA.toned(png, map, tone), { png: await shot(tab), map, tone: (await themeOf(tab, ids.at(-1)!)).colors.warn! })).toBeGreaterThan(20);
    await tab.close();
  }
  test("Workspace map: with nobody waiting on the person, nothing on it is in the attention colour, an agent started by another included, in every dark preset switched live", () => noCall(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Workspace map: with nobody waiting on the person, nothing on it is in the attention colour ${ON_LIGHT}, switched live from a dark preset and back`, () => noCall(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);

  /** The issue being read and the one under the pointer, in each look: their id and who is on it at
   *  4.5:1 on the row's tint, and the one being read marked at 3:1. */
  async function issueRows(from: string, ids: string[]) {
    const { tab, frame } = await workspaceMap(from);
    const low: string[] = [];
    for await (const { where } of looks(tab, frame, ids)) {
      const over = (await boxOf(frame, ".issue:not([aria-current])"))[0]!;
      await tab.mouse.move(over.x + over.w / 2, over.y + over.h / 2);
      await drawn(frame, 2);
      const sels = [".issue[aria-current] code", ".issue[aria-current] small", ".issue:hover code", ".issue:hover small"];
      const words = await readAll(tab, frame, sels);
      expect([where, sels.filter((sel) => !words.some((w) => w.sel === sel))]).toEqual([where, []]);
      for (const { sel, least } of words) if (least < 4.5) low.push(`${where}: ${sel} ${least.toFixed(2)}`);
      // The row being read, against itself not being read.
      const row = (await boxOf(frame, ".issue[aria-current]"))[0]!;
      const read = await without(tab, frame, ".issue[aria-current] { box-shadow: none !important; background: transparent !important; outline: none !important; border-color: transparent !important; }");
      const [{ most }] = await seen(tab, read, [row]) as [Seen];
      if (most < 3) low.push(`${where}: the issue being read is marked at ${most.toFixed(2)}`);
      await tab.mouse.move(2, LARGE.height - 2);
    }
    expect([...new Set(low)]).toEqual([]);
    await tab.close();
  }
  test("Workspace map: the issue being read and the one under the pointer keep their id and who is on it at 4.5:1, and the one being read is marked at 3:1, in every dark preset switched live, over the theme's ground and a wallpaper with glass on or off", () => issueRows(DARK[0]!, DARK), 180_000);
  test.skipIf(!LIGHT)(`Workspace map: the issue being read and the one under the pointer keep their id and who is on it at 4.5:1, and the one being read is marked at 3:1, ${ON_LIGHT}, switched live from a dark preset and back`, () => issueRows(DARK[0]!, ["clean-light", DARK[0]!]), 120_000);
}
