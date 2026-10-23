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
// the terminal and the toolbar is wider than half the window. Opened wide, resized live to narrow, and
// back to wide at the end, where the calls have to move again of the view's own accord.
type Size = { width: number; height: number };
const NARROW: Size = { width: 800, height: 600 }, WIDE: Size = { width: 1024, height: 704 };
/** What the calls must keep clear of: they would cover or shade the words of the header, the tools, the
 *  card and the toolbar, and lie unseen under the docked terminal. */
const PANELS = [".head", ".tools", ".card:not([hidden])", ".bar", ".dock[data-open]"];
/** What the person set: no motion, so the scene holds still between two screenshots, and no effects pass
 *  or shadows, which a software renderer leaves out anyway. */
const STILL = { motion: "less", effects: false, shadows: false };
// Two accents, one that takes black words and one that takes white (island-archipelago-ink.test.ts works
// the ink out for every colour): Indigo takes black (white read on it at 4.2:1), Graphite white.
const ACCENT_ROWS = ["indigo", "graphite"];

/** `view` opened in `from`, by night, with alpha calling you and beta ready for work; then switched
 *  live through `ids`, each read by night and by day at the size of window paired with it (the window
 *  resized live between two), and through `accents`; then resized back to the size it opened at. */
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
    // The calls, shown (their title is read with the rest), lie over none of the panels.
    expect([state, await callsOver()]).toEqual([state, []]);
  };
  /** The panels the calls lie over. */
  const callsOver = () => frame.evaluate((panels) => {
    const c = document.querySelector(".calls")!.getBoundingClientRect();
    return panels.filter((sel) => [...document.querySelectorAll(sel)].some((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && c.left < b.right && c.right > b.left && c.top < b.bottom && c.bottom > b.top;
    }));
  }, PANELS);
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
  // Wide again, with nothing else said: the calls laid out for the narrow window would lie over the terminal.
  await resize(ids[0]![1]);
  await drawn(frame, 2);
  expect(["resized back", await callsOver()]).toEqual(["resized back", []]);
  expect([...least].filter(([, c]) => c < 4.5).map(([where, c]) => `${where} ${c.toFixed(2)}`)).toEqual([]);
  await tab.close();
}

for (const view of Object.keys(WRITTEN)) {
  const View = `${view[0]!.toUpperCase()}${view.slice(1)}`;
  test(`${View}, a terminal docked at 1024x704, then 800x600 and back: its words on its paper, the attention colour and the accent read at 4.5:1 over its scene by night and by day, with the calls clear of every panel, in every dark preset switched live, and in an accent that takes black words and one that takes white`, () => written(view, DARK[0]!, DARK.map((id, i) => [id, i < DARK.length / 2 ? WIDE : NARROW]), ACCENT_ROWS), 300_000);
  test.skipIf(!LIGHT)(`${View}, a terminal docked at 1024x704, then 800x600 and back: its words on its paper, the attention colour and the accent read at 4.5:1 over its scene by night and by day, with the calls clear of every panel, ${ON_LIGHT}, opened in it and switched live to a dark preset and back`, () => written(view, "clean-light", [["clean-light", WIDE], [DARK[0]!, NARROW], ["clean-light", NARROW]], []), 180_000);
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
