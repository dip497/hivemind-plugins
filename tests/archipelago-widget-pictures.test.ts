// Archipelago's widgets show their state as pictures: SVG files the app draws as images on the
// widget's card (WidgetBody's <img>, at the width the widget's code gives and as tall as the
// picture's own shape makes it there), where no theme colour reaches them. The same picture sits on
// Clean Light's near-white card and on each dark preset's dark one, so every shape in it must be set
// off from the card at 3:1 on each: by its own colour, or by what is round it, as a sun's dark rim
// does on the light card while its yellow does on a dark one. So each picture is drawn as the app
// draws it, in Chromium at one device pixel to the CSS pixel, where a band thinner than a pixel
// blurs into the card, and judged by its pixels: on whole pixels, and half a pixel off them, where
// the canvas's pan and zoom can put a card, and a band one pixel wide covers no pixel wholly.
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
// An app with no Clean Light (its latest release, until one ships it) skips that check by name,
// rather than passing it with no light card to judge on.
const LIGHT = presets["clean-light"]?.mode === "light" ? presets["clean-light"] : null;
const SKIPPED = "skipped: the app at HIVEMIND_APP has no Clean Light preset";
if (!LIGHT) console.log(`${SKIPPED} (${APP} has ${Object.keys(presets).join(", ")})`);
const DARK = Object.keys(presets).filter((id) => presets[id]!.mode === "dark");
/** A widget's card, as the app paints it (styles.css, .hm-island): bg2 at 98% over the canvas's bg. */
const cardOf = (p: Preset) => `color-mix(in srgb, ${p.palette.bg2} 98%, ${p.palette.bg})`;

const WIDGETS = path.join(ROOT, "packages/archipelago/widgets");
type Run = ReturnType<typeof run>;
const agent = { id: "a", agent: "claude", name: "tests" };
/** Each widget taken through the states that show each of its pictures. */
const STATES: Record<string, { replies?: Record<string, unknown>; drive: (w: Run) => Promise<void> }> = {
  // A calm harbour before anyone sails; a boat calling you; one back in port after its turn.
  harbour: { drive: async (w) => {
    await w.fire("on:structure", { frames: [], tiles: [agent] });
    for (const [status, state] of [["blocked", "waiting"], ["working", "working"], ["idle", "done"]]) await w.fireNth("subscribeStatus", 0, status, { agent: { state } });
  } },
  // Each day of the week the same turns: none in "well", one in "windmill", two in "church" and four
  // in "castle", which raises each to its own town.
  "town-ledger": {
    replies: { history: { tiles: [{ frameId: "windmill", turns: [1] }, { frameId: "church", turns: [1, 2] }, { frameId: "castle", turns: [1, 2, 3, 4] }] } },
    drive: async (w) => {
      await w.wait(0); // its week's history answered first
      await w.fire("on:structure", { frames: ["well", "windmill", "church", "castle"].map((id) => ({ id, title: id })), tiles: [] });
    },
  },
  // Becalmed before anyone works, then fair, a squall when one calls you, a storm when it fails.
  weather: { drive: async (w) => {
    await w.fire("on:structure", { tiles: [agent] });
    for (const [status, state] of [["working", "working"], ["blocked", "waiting"], ["idle", "failed"]]) await w.fireNth("subscribeStatus", 0, status, { agent: { state } });
  } },
  // Its log's picture heads it from the start.
  "ships-log": { drive: async () => {} },
};

/** A picture as its widget draws it: its file, the width and height its code asks for, and the size
 *  it is drawn at (`drawn`, measured in beforeAll). */
type Picture = { file: string; w: number; h: number; svg: string; drawn: { w: number; h: number } };
/** Widgets this test does not drive, and pictures in a widget's folder it never saw drawn: either
 *  would go unjudged. A widget's icon is drawn as a one-colour mask, unless its code draws it too. */
const undriven: string[] = [], undrawn: string[] = [];
const pictures: Picture[] = [];
for (const widget of readdirSync(WIDGETS)) {
  const dir = path.join(WIDGETS, widget), how = STATES[widget];
  if (!how) { undriven.push(widget); continue; }
  const w = run(dir, { replies: how.replies });
  await how.drive(w);
  const images = w.posted.flatMap((m) => (m.type === "render" ? flat(m.tree as Node) : [])).filter((n) => n.type === "image");
  const seen = new Map(images.map((n) => [`${n.src}@${n.w ?? 64}x${n.h ?? 64}`, n]));
  for (const n of seen.values()) pictures.push({ file: `${widget}/${n.src}`, w: n.w ?? 64, h: n.h ?? 64, svg: readFileSync(path.join(dir, n.src!), "utf8"), drawn: { w: 0, h: 0 } });
  const { icon } = JSON.parse(readFileSync(path.join(dir, "widget.json"), "utf8"));
  for (const f of readdirSync(dir)) if (f.endsWith(".svg") && f !== icon && !images.some((n) => n.src === f)) undrawn.push(`${widget}/${f}`);
}

/** The app's renderer imports Tailwind (styles.css), whose preflight gives every img `height: auto`:
 *  a picture is drawn at the width its widget asks for, and as tall as its own shape makes it there
 *  (boat-calling.svg's 64 × 52 at 40 wide is 32.5 tall, where its code asks for 32). The same
 *  preflight here, from this repo's Tailwind, so each picture is drawn at the size the app draws it. */
const PREFLIGHT = readFileSync(createRequire(import.meta.url).resolve("tailwindcss/preflight.css"), "utf8");
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 400 } });
  await page.setContent(`<!doctype html><html><head><style>${PREFLIGHT}</style><style>html, body { margin: 0 } div { position: absolute } img { position: absolute; object-fit: contain }</style></head><body></body></html>`);
  // The size each picture is drawn at, as the app sizes its <img>.
  const drawn = await page.evaluate((list) => Promise.all(list.map(async ({ w, h, svg }) => {
    const img = Object.assign(document.createElement("img"), { width: w, height: h, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
    document.body.append(img);
    await img.decode();
    const { width, height } = img.getBoundingClientRect();
    img.remove();
    return { w: width, h: height };
  })), pictures.map(({ w, h, svg }) => ({ w, h, svg })));
  pictures.forEach((p, i) => { p.drawn = drawn[i]!; });
}, 60_000);
afterAll(async () => { await browser?.close(); });

/** Ground showing round each picture: every way in to a shape starts there. */
const M = 4;
type Pixels = { w: number; h: number; rgba: Uint8Array };
/** How far off the pixel grid each picture is drawn: on it, and half a pixel right of it and down. */
const OFFSETS = [0, 0.5] as const;
type Offset = (typeof OFFSETS)[number];
/** Draws each SVG as WidgetBody does, an <img> given the width and height its widget's code gives,
 *  under the preflight, on its own ground, `off` pixels right and down of the pixel grid (moved as
 *  the canvas moves a card, by a transform: a left or top of half a pixel is rounded to a whole one),
 *  and gives back each one's pixels with that ground round it, on every pixel the picture is drawn over. */
async function draw(items: { p: Picture; svg: string; ground: string }[], off: Offset): Promise<Pixels[]> {
  const cells: { x: number; y: number; w: number; h: number; iw: number; ih: number; svg: string; ground: string }[] = [];
  let x = 0, y = 0, row = 0;
  for (const { p, svg, ground } of items) {
    const w = Math.ceil(p.drawn.w) + 2 * M, h = Math.ceil(p.drawn.h) + 2 * M;
    if (x + w > 1500) { x = 0; y += row; row = 0; }
    cells.push({ x, y, w, h, iw: p.w, ih: p.h, svg, ground });
    x += w;
    row = Math.max(row, h);
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
  // Its pixels, read back by the page that drew them.
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

type Drawn = { shapes: Shape[]; paints: string[]; covers: Float32Array[]; card: Float32Array };
/** Every picture's shapes, each with the pixels its paint covers (its fill, or for a line its line),
 *  and how much of each pixel the card shows through, at each offset: drawn once, as they do not
 *  change with the card. */
const measured = new Map<Offset, Promise<Drawn[]>>();
const measure = (off: Offset) => measured.get(off) ?? measured.set(off, (async () => {
  const all = await shapes();
  const items = pictures.flatMap((p, i) => [
    { p, svg: p.svg, ground: MAGENTA }, { p, svg: p.svg, ground: GREEN },
    ...all[i]!.flatMap((s) => [...(s.fill ?? []), ...(s.line ?? [])].map((svg) => ({ p, svg, ground: "#ffffff" }))),
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
  const drawn = await draw(pictures.map((p) => ({ p, svg: p.svg, ground: card })), off);
  const unread: string[] = [], blank: string[] = [];
  let byWhatIsRound = 0;
  pictures.forEach((p, pi) => {
    const { w, h, rgba } = drawn[pi]!;
    const ground = [rgba[0]!, rgba[1]!, rgba[2]!] as const, L = luminance(...ground);
    const against = Float32Array.from({ length: w * h }, (_, q) => contrast(luminance(rgba[q * 4]!, rgba[q * 4 + 1]!, rgba[q * 4 + 2]!), L));
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

const each = (name: string) => `Archipelago's widget pictures on ${name}'s card, drawn at their size at 1x, on whole pixels and half a pixel off them: every shape in them is set off from the card at 3:1, by its own colour or by what is round it`;
async function expectReadOn(card: string) {
  // Every picture each widget draws, and only those, judged.
  expect({ undriven, undrawn }).toEqual({ undriven: [], undrawn: [] });
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
