// The pictures of the widgets under widgets/ that draw them, judged from their pixels as
// archipelago-widget-pictures.test.ts judges Archipelago's: drawn as the app draws them, in Chromium
// at one device pixel to the CSS pixel, on whole pixels and half a pixel off them.
// - CI light's lamps and the test meter's are drawn as images on the widget's card (WidgetBody's
//   <img>), where no theme colour reaches them: every shape in them is set off from Clean Light's
//   near-white card and from each dark preset's at 3:1, by its own colour or by what is round it.
// - A butterfly is a sprite with no card (`chrome: none`), so it flies over whatever is behind it: the
//   canvas of any preset, or a wallpaper, dark, light or in between. Every frame of every row has to
//   show as a shape on each of those grounds: what lies inside its edge is walled off from the ground
//   by pixels at 3:1 against it.
// Needs Playwright's Chromium: `npx playwright install chromium-headless-shell`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { APP, ROOT, core } from "./app";
import { flat, run, type Node } from "./helpers/widget";

const { PRESETS } = await core("settings-schema.ts");
type Preset = { mode: "dark" | "light"; palette: { bg: string; bg2: string } };
const presets = PRESETS as Record<string, Preset>;
// An app with no Clean Light (its latest release, until one ships it) skips that card by name,
// rather than passing with no light card to judge on.
const LIGHT = presets["clean-light"]?.mode === "light" ? presets["clean-light"] : null;
const SKIPPED = "skipped: the app at HIVEMIND_APP has no Clean Light preset";
if (!LIGHT) console.log(`${SKIPPED} (${APP} has ${Object.keys(presets).join(", ")})`);
const DARK = Object.keys(presets).filter((id) => presets[id]!.mode === "dark");
/** A widget's card, as the app paints it (styles.css, .hm-island): bg2 at 98% over the canvas's bg. */
const cardOf = (p: Preset) => `color-mix(in srgb, ${p.palette.bg2} 98%, ${p.palette.bg})`;

const WIDGETS = path.join(ROOT, "widgets");
type Run = ReturnType<typeof run>;
/** The widgets that draw pictures on their card, each taken through the states that show each one. */
const ON_A_CARD: Record<string, (w: Run) => Promise<void>> = {
  // No build yet, then each report a build can make.
  "ci-light": async (w) => { for (const state of ["passed", "failed", "running", "unknown"]) await w.command("set", { state }); },
  // A run with none failing, then one with one failing.
  "test-meter": async (w) => { await w.command("report", { passed: 12, failed: 0 }); await w.command("report", { passed: 11, failed: 1 }); },
};
/** Ones with no card: each of its colours, flying and then perched. */
const BARE = "butterflies";

type Picture = { file: string; w: number; h: number; svg: string; drawn: { w: number; h: number } };
const pictures: Picture[] = [];
/** Pictures in a widget's folder it was never seen to draw: they would go unjudged. */
const undrawn: string[] = [];
for (const [widget, drive] of Object.entries(ON_A_CARD)) {
  const dir = path.join(WIDGETS, widget);
  const w = run(dir);
  await drive(w);
  const images = w.posted.flatMap((m) => (m.type === "render" ? flat(m.tree as Node) : [])).filter((n) => n.type === "image");
  const seen = new Map(images.map((n) => [`${n.src}@${n.w ?? 64}x${n.h ?? 64}`, n]));
  for (const n of seen.values()) pictures.push({ file: `${widget}/${n.src}`, w: n.w ?? 64, h: n.h ?? 64, svg: readFileSync(path.join(dir, n.src!), "utf8"), drawn: { w: 0, h: 0 } });
  const { icon } = JSON.parse(readFileSync(path.join(dir, "widget.json"), "utf8"));
  for (const f of readdirSync(dir)) if (f.endsWith(".svg") && f !== icon && !images.some((n) => n.src === f)) undrawn.push(`${widget}/${f}`);
}

/** The sprite rows the butterfly draws, in every colour, flying and perched: { row, frames }. */
type SpriteNode = Node & { frameW?: number; frameH?: number; frames?: number };
const sprites: SpriteNode[] = [];
const { options } = JSON.parse(readFileSync(path.join(WIDGETS, BARE, "widget.json"), "utf8"));
for (const colour of (options as { id: string; values: string[] }[]).find((o) => o.id === "colour")!.values.filter((v) => v !== "any")) {
  const w = run(path.join(WIDGETS, BARE), { options: { colour } });
  for (let i = 0; i < 600 && !String(w.tree().label).endsWith("resting"); i++) await w.wait(500);
  sprites.push(...w.posted.flatMap((m) => (m.type === "render" ? flat(m.tree as Node) : [])).filter((n) => n.type === "sprite"));
}
const SHEET = sprites[0]!.src!;
const SPRITE = readFileSync(path.join(WIDGETS, BARE, SHEET), "utf8");
const FW = sprites[0]!.frameW!, FH = sprites[0]!.frameH!;

/** The app's renderer imports Tailwind (styles.css), whose preflight gives every img `height: auto`:
 *  a picture is drawn at the width its widget asks for, and as tall as its own shape makes it there. */
const PREFLIGHT = readFileSync(createRequire(import.meta.url).resolve("tailwindcss/preflight.css"), "utf8");
let browser: Browser;
let page: Page;
let sheet = { w: 0, h: 0 };
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 800 } });
  await page.setContent(`<!doctype html><html><head><style>${PREFLIGHT}</style><style>html, body { margin: 0 } div { position: absolute } img { position: absolute; object-fit: contain }</style></head><body></body></html>`);
  const drawn = await page.evaluate((list) => Promise.all(list.map(async ({ w, h, svg }) => {
    const img = Object.assign(document.createElement("img"), { width: w, height: h, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
    document.body.append(img);
    await img.decode();
    const { width, height } = img.getBoundingClientRect();
    img.remove();
    return { w: width, h: height };
  })), pictures.map(({ w, h, svg }) => ({ w, h, svg })));
  pictures.forEach((p, i) => { p.drawn = drawn[i]!; });
  // The sheet's own size: the app draws a frame at the sheet's size, a pixel to a pixel.
  sheet = await page.evaluate(async (svg) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, SPRITE);
}, 60_000);
afterAll(async () => { await browser?.close(); });

/** Ground showing round each picture: every way in to a shape starts there. */
const M = 4;
type Pixels = { w: number; h: number; rgba: Uint8Array };
/** How far off the pixel grid each picture is drawn: on it, and half a pixel right of it and down. */
const OFFSETS = [0, 0.5] as const;
type Offset = (typeof OFFSETS)[number];
type Cell = { w: number; h: number; iw: number; ih: number; svg: string; ground: string };

/** Draws each cell's SVG as an <img> of the width and height given, under the preflight, on its own
 *  ground, `off` pixels right and down of the pixel grid (moved as the canvas moves a card or a
 *  widget, by a transform), and gives back each one's pixels with that ground round it. */
async function draw(items: Cell[], off: Offset): Promise<Pixels[]> {
  const cells: (Cell & { x: number; y: number })[] = [];
  let x = 0, y = 0, row = 0;
  for (const c of items) {
    if (x + c.w > 1500) { x = 0; y += row; row = 0; }
    cells.push({ ...c, x, y });
    x += c.w;
    row = Math.max(row, c.h);
  }
  const height = y + row;
  await page.setViewportSize({ width: 1600, height: Math.max(400, height) });
  await page.evaluate(async ({ cells, M, off }) => {
    document.body.replaceChildren();
    await Promise.all(cells.map((c) => {
      const ground = Object.assign(document.createElement("div"), { style: `left: ${c.x}px; top: ${c.y}px; width: ${c.w}px; height: ${c.h}px; background: ${c.ground}` });
      const img = document.createElement("img");
      img.width = c.iw;
      img.height = c.ih;
      img.style.left = img.style.top = `${M}px`;
      img.style.transform = `translate(${off}px, ${off}px)`;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`;
      ground.append(img);
      document.body.append(ground);
      return img.decode();
    }));
  }, { cells, M, off });
  const png = (await page.screenshot({ clip: { x: 0, y: 0, width: 1500, height }, type: "png" })).toString("base64");
  const raw = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = "";
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: c.width, b64: btoa(s) };
  }, png);
  const all = Buffer.from(raw.b64, "base64");
  return cells.map((c) => {
    const rgba = new Uint8Array(c.w * c.h * 4);
    for (let r = 0; r < c.h; r++) all.copy(rgba, r * c.w * 4, ((c.y + r) * raw.w + c.x) * 4, ((c.y + r) * raw.w + c.x + c.w) * 4);
    return { w: c.w, h: c.h, rgba };
  });
}
const cellOf = (p: Picture, svg: string, ground: string): Cell => ({ w: Math.ceil(p.drawn.w) + 2 * M, h: Math.ceil(p.drawn.h) + 2 * M, iw: p.w, ih: p.h, svg, ground });

type Shape = { tag: string; fill: string; stroke: string; opacity: number };
const MAGENTA = "#ff00ff", GREEN = "#00ff00";
/** Each shape a picture paints, in order, with its paint as the browser resolves it, and the picture
 *  with that shape's fill, then its line, painted magenta and green: where the two differ, and by how
 *  much, is how much of each pixel that paint covers, under whatever is drawn over it. */
const shapes = () => page.evaluate(({ svgs, MAGENTA, GREEN }) => svgs.map((svg) => {
  const host = document.createElement("div");
  host.innerHTML = svg;
  document.body.append(host);
  const root = host.querySelector("svg")!;
  const SHAPES = "path, rect, circle, ellipse, polygon, polyline, line";
  const all = [...root.querySelectorAll<SVGElement>(SHAPES)].map((el) => {
    const cs = getComputedStyle(el);
    let opacity = 1;
    for (let e: Element | null = el; e && e !== host; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    return { tag: el.tagName, fill: cs.fill, stroke: cs.stroke, opacity };
  });
  host.remove();
  const paint = (i: number, part: "fill" | "stroke", colour: string) => {
    const c = root.cloneNode(true) as SVGElement;
    c.querySelectorAll<SVGElement>(SHAPES)[i]!.style.setProperty(part, colour);
    return new XMLSerializer().serializeToString(c);
  };
  return all.map((shape, i) => ({
    shape,
    fill: shape.fill === "none" ? null : [paint(i, "fill", MAGENTA), paint(i, "fill", GREEN)],
    line: shape.stroke === "none" ? null : [paint(i, "stroke", MAGENTA), paint(i, "stroke", GREEN)],
  }));
}), { svgs: pictures.map((p) => p.svg), MAGENTA, GREEN });

/** How much of each pixel a paint covers: its picture drawn magenta, then green. */
const coverage = (magenta: Pixels, green: Pixels) => Float32Array.from({ length: magenta.w * magenta.h }, (_, q) => (green.rgba[q * 4 + 1]! - magenta.rgba[q * 4 + 1]!) / 255);
const linear = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (r: number, g: number, b: number) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG 2 contrast of two luminances, worked out here and not by the app. */
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** Each pixel's contrast with the ground, the colour of the picture's first pixel. */
const againstGround = ({ w, h, rgba }: Pixels) => {
  const L = luminance(rgba[0]!, rgba[1]!, rgba[2]!);
  return Float32Array.from({ length: w * h }, (_, q) => contrast(luminance(rgba[q * 4]!, rgba[q * 4 + 1]!, rgba[q * 4 + 2]!), L));
};

type Drawn = { shapes: Shape[]; paints: string[]; covers: Float32Array[]; card: Float32Array };
/** Every picture's shapes, each with the pixels its paint covers, and how much of each pixel the card
 *  shows through, at each offset: drawn once, as they do not change with the card. */
const measured = new Map<Offset, Promise<Drawn[]>>();
const measure = (off: Offset) => measured.get(off) ?? measured.set(off, (async () => {
  const all = await shapes();
  const items = pictures.flatMap((p, i) => [
    cellOf(p, p.svg, MAGENTA), cellOf(p, p.svg, GREEN),
    ...all[i]!.flatMap((s) => [...(s.fill ?? []), ...(s.line ?? [])].map((svg) => cellOf(p, svg, "#ffffff"))),
  ]);
  const drawn = await draw(items, off);
  let k = 0;
  return all.map((list) => {
    const card = coverage(drawn[k]!, drawn[k + 1]!);
    k += 2;
    const out: Drawn = { shapes: [], paints: [], covers: [], card };
    for (const { shape, fill, line } of list) {
      const filled = fill ? coverage(drawn[k]!, drawn[k + 1]!) : null;
      if (fill) k += 2;
      const lined = line ? coverage(drawn[k]!, drawn[k + 1]!) : null;
      if (line) k += 2;
      // A shape is its fill; a line's fill (a path's default black) covers nothing, and it is its line.
      const byFill = !!filled && filled.reduce((a, v) => a + v, 0) >= 0.5;
      const cover = byFill ? filled : lined;
      if (!cover) continue;
      out.shapes.push(shape);
      out.paints.push(byFill ? shape.fill : shape.stroke);
      out.covers.push(cover);
    }
    return out;
  });
})()).get(off)!;

/** Each picture on `card`, drawn `off` the pixel grid: every shape it shows is set off from the card
 *  when every way in to the pixels it covers wholly (for a line thinner than a pixel, those it covers
 *  most), from the card round the picture or where the card shows through it, stepping up, down, left
 *  or right through any pixel at all, passes a pixel at 3:1 against the card: the shape's own, or its
 *  edge's. */
async function judge(card: string, off: Offset) {
  const all = await measure(off);
  const drawn = await draw(pictures.map((p) => cellOf(p, p.svg, card)), off);
  const unread: string[] = [], blank: string[] = [];
  let byWhatIsRound = 0;
  pictures.forEach((p, pi) => {
    const px = drawn[pi]!, { w, h, rgba } = px;
    const ground = [rgba[0]!, rgba[1]!, rgba[2]!] as const, L = luminance(...ground);
    const against = againstGround(px);
    const { shapes, paints, covers, card: through } = all[pi]!;
    const weakest = wayIn(w, h, against, (q) => q < w || q >= w * (h - 1) || q % w === 0 || q % w === w - 1 || through[q]! >= 0.5);
    let judged = 0;
    shapes.forEach((s, i) => {
      const cover = covers[i]!, most = cover.reduce((a, v) => Math.max(a, v), 0);
      if (most < 0.1) return; // hidden under what is drawn after it
      judged++;
      const core = Math.min(0.99, most - 0.05);
      let at = -1;
      for (let q = 0; q < w * h; q++) if (cover[q]! >= core && (at < 0 || weakest[q]! < weakest[at]!)) at = q;
      // Its paint over the card, at its opacity: under 3:1, it is set off by what is round it.
      const [r, g, b] = (paints[i]!.match(/[\d.]+/g) ?? []).map((v, j) => s.opacity * Number(v) + (1 - s.opacity) * ground[j]!);
      if (contrast(luminance(r!, g!, b!), L) < 3) byWhatIsRound++;
      if (weakest[at]! < 3) unread.push(`${p.file}, ${off} px off the grid: the ${s.tag} painted ${paints[i]} meets the card at (${at % w - M}, ${Math.floor(at / w) - M}), no pixel on the way in above ${weakest[at]!.toFixed(2)}:1`);
    });
    if (!judged) blank.push(`${p.file}, ${off} px off the grid`);
  });
  return { unread, blank, byWhatIsRound };
}
/** For each pixel, the least, over every way in to it from a pixel `from` picks, stepping up, down,
 *  left or right, of the most contrast met on the way, the pixel itself included. */
function wayIn(w: number, h: number, against: Float32Array, from: (q: number) => boolean) {
  const best = new Float32Array(w * h).fill(Infinity);
  // Pixels taken least first (a binary heap of [value, pixel]): each is settled when taken.
  const heap: [number, number][] = [];
  const add = (q: number, v: number) => {
    if (v >= best[q]!) return;
    best[q] = v;
    heap.push([v, q]);
    for (let k = heap.length - 1; k > 0;) {
      const up = (k - 1) >> 1;
      if (heap[up]![0] <= heap[k]![0]) break;
      [heap[up], heap[k]] = [heap[k]!, heap[up]!];
      k = up;
    }
  };
  const take = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        k = m;
      }
    }
    return top;
  };
  for (let q = 0; q < w * h; q++) if (from(q)) add(q, against[q]!);
  while (heap.length) {
    const [v, q] = take(), x = q % w;
    if (v > best[q]!) continue;
    for (const next of [x + 1 < w ? q + 1 : -1, x > 0 ? q - 1 : -1, q + w < w * h ? q + w : -1, q - w]) {
      if (next >= 0) add(next, Math.max(v, against[next]!));
    }
  }
  return best;
}

const each = (name: string) => `CI light's and the test meter's pictures on ${name}'s card, drawn at their size at 1x, on whole pixels and half a pixel off them: every shape in them is set off from the card at 3:1, by its own colour or by what is round it`;
async function expectReadOn(card: string) {
  // Every picture each widget draws, and only those, judged.
  expect(undrawn).toEqual([]);
  for (const off of OFFSETS) {
    const { unread, blank, byWhatIsRound } = await judge(card, off);
    expect(unread).toEqual([]);
    // Each picture shows shapes, and some needed more than their own colour: drawn or read wrong, it would pass with none judged.
    expect(blank).toEqual([]);
    expect([off, byWhatIsRound > 0]).toEqual([off, true]);
  }
}

test.skipIf(!LIGHT)(`${each("Clean Light")}${LIGHT ? "" : ` (${SKIPPED})`}`, async () => {
  await expectReadOn(cardOf(LIGHT!));
}, 60_000);
for (const id of DARK) {
  test(each(id), async () => {
    await expectReadOn(cardOf(presets[id]!));
  }, 60_000);
}

// Amber is the attention colour, kept for what waits on the person (the app's DESIGN.md, the One
// Voice Rule), and a build waits on nobody: running is the app's working look, near-white, not amber.
/** A pixel's chroma and hue in OKLCH. */
const oklch = (r: number, g: number, b: number) => {
  const [R, G, B] = [r, g, b].map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
};
test("CI light: none of its lights, a running build's among them, is drawn in any preset's attention colour", async () => {
  const lights = pictures.filter((p) => p.file.startsWith("ci-light/"));
  expect(lights.length).toBe(4);
  const amber: string[] = [];
  for (const [id, p] of Object.entries(presets)) {
    const warn = await page.evaluate((css) => { const g = document.createElement("canvas").getContext("2d")!; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; }, (p.palette as Record<string, string>).warn!);
    const tone = oklch(warn[0]!, warn[1]!, warn[2]!);
    const drawn = await draw(lights.map((l) => cellOf(l, l.svg, cardOf(p))), 0);
    lights.forEach((l, i) => {
      const { w, h, rgba } = drawn[i]!;
      let n = 0;
      for (let q = 0; q < w * h; q++) {
        const c = oklch(rgba[q * 4]!, rgba[q * 4 + 1]!, rgba[q * 4 + 2]!);
        // Its hue, and saturated enough to read as a colour.
        if (c.c >= 0.06 && Math.abs(((c.h - tone.h + 540) % 360) - 180) <= 25) n++;
      }
      if (n) amber.push(`${l.file} on ${id}'s card: ${n} pixels`);
    });
  }
  expect(amber).toEqual([]);
}, 60_000);

// A bare widget's grounds: each preset's canvas, the darkest and the brightest of the app's own
// wallpapers (styles.css: the mono scene's ground, the amber bloom), and greys from black to white,
// which stand for a photo's every lightness: the dark sea, the surf, the snow.
const GROUNDS = [...new Set([
  ...Object.values(presets).map((p) => p.palette.bg), "#0b0d12", "#fbbf24",
  ...Array.from({ length: 17 }, (_, i) => `rgb(${Math.min(255, i * 16)} ${Math.min(255, i * 16)} ${Math.min(255, i * 16)})`),
])];
/** A butterfly's edge: the three pixels in from where it stops, stepping in any of eight directions.
 *  A two-tone edge (a pale band outside a dark line) is about that wide, and on a ground as light as
 *  one of its bands, or as dark as the other, that band reads at under 3:1 while the other reads. */
const EDGE = 4;
/** The share of what is inside its edge that has to be set off: the rest is the pale band's reach
 *  into the narrow notches between its wings and round its feelers, which goes with the ground on a
 *  light one, as its edge does. */
const SHARE = 0.9;
type Frame = { inside: number; seen: number; worst: number; at: [number, number] };

/** Every frame of the sheet on `ground`, `off` the pixel grid: how many of its pixels lie inside its
 *  edge, and how many of those are set off from the ground: every way in to it from the ground,
 *  stepping up, down, left or right, passes a pixel at 3:1 against the ground. */
async function bare(ground: string, alpha: Float32Array, off: Offset) {
  const [px] = await draw([{ w: sheet.w + 2 * M, h: sheet.h + 2 * M, iw: sheet.w, ih: sheet.h, svg: SPRITE, ground }], off);
  const { w, h } = px!;
  const weakest = wayIn(w, h, againstGround(px!), (q) => alpha[q]! < 0.5);
  // How far each pixel is from the ground, stepping in any of eight directions.
  const depth = new Int32Array(w * h).fill(-1);
  let ring: number[] = [];
  for (let q = 0; q < w * h; q++) if (alpha[q]! < 0.5) { depth[q] = 0; ring.push(q); }
  for (let d = 1; ring.length; d++) {
    const next: number[] = [];
    for (const q of ring) {
      const x = q % w, y = Math.floor(q / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || depth[n]! >= 0) continue;
        depth[n] = d;
        next.push(n);
      }
    }
    ring = next;
  }
  const frames = new Map<string, Frame>();
  for (let q = 0; q < w * h; q++) {
    const x = q % w - M, y = Math.floor(q / w) - M;
    if (x < 0 || y < 0 || x >= sheet.w || y >= sheet.h) continue;
    const key = `row ${Math.floor(y / FH)} frame ${Math.floor(x / FW)}`;
    const f = frames.get(key) ?? frames.set(key, { inside: 0, seen: 0, worst: Infinity, at: [0, 0] }).get(key)!;
    if (alpha[q]! < 0.99 || depth[q]! < EDGE) continue;
    f.inside++;
    if (weakest[q]! >= 3) f.seen++;
    else if (weakest[q]! < f.worst) Object.assign(f, { worst: weakest[q]!, at: [x % FW, y % FH] });
  }
  return frames;
}

test(`Butterflies: every frame of every colour, flying and perched, drawn bare at 1x on whole pixels and half a pixel off them, shows as a shape set off at 3:1 on each preset's canvas, the app's darkest and brightest wallpaper and every grey from black to white`, async () => {
  // Every row of the sheet, and every frame along it, is one the widget draws.
  const rows = new Map(sprites.map((s) => [s.row!, s.frames!]));
  expect([...rows.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: sheet.h / FH }, (_, i) => i));
  expect([...new Set(rows.values())]).toEqual([sheet.w / FW]);
  const cell: Cell = { w: sheet.w + 2 * M, h: sheet.h + 2 * M, iw: sheet.w, ih: sheet.h, svg: SPRITE, ground: MAGENTA };
  const unseen: string[] = [];
  for (const off of OFFSETS) {
    const [magenta, green] = await draw([cell, { ...cell, ground: GREEN }], off);
    const alpha = coverage(magenta!, green!).map((v) => 1 - v);
    for (const ground of GROUNDS) {
      const frames = [...await bare(ground, alpha, off)];
      expect(frames.length).toBe((sheet.w / FW) * (sheet.h / FH));
      // One line for each ground: how many frames fail there, and the one with the most unseen.
      const low = frames.filter(([, f]) => f.seen < SHARE * f.inside || !f.inside);
      if (!low.length) continue;
      const [key, f] = low.reduce((a, b) => (b[1].inside - b[1].seen > a[1].inside - a[1].seen ? b : a));
      unseen.push(`${ground}, ${off} px off the grid: ${low.length} of ${frames.length} frames; most in ${key}, ${f.seen} of the ${f.inside} pixels inside its edge set off${f.worst < 3 ? `, one at (${f.at.join(", ")}) reached through none above ${f.worst.toFixed(2)}:1` : ""}`);
    }
  }
  expect(unseen).toEqual([]);
}, 240_000);
