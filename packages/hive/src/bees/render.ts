/**
 * Bees' drawing, in character cells on a canvas the size of the viewport times its pixel ratio.
 * Each frame starts from the sky (painted once per size and look), then the grass behind and the
 * skep (a layer painted again only when the ground, the look or the cells the tiles cover change),
 * the flowers swaying, the grass in front, the small bees, the agents' bees and a turn's pollen.
 * Nothing is drawn in a cell a tile covers; under a see-through tile an agent's bee shows soft,
 * one pixel a cell scaled up behind the glass.
 *
 * In the theme's colours every ink is a step from its page to its text: the ground low, so the
 * frosted panels' text over it reads, the bees high. In its own colours, its palette (palette.ts).
 * A bee that needs you pulses in the theme's "needs you" colour either way.
 */
import type { WallpaperLook, WallpaperTile, WallpaperViewport } from "@hivemind/view-sdk";
import { css, cssAlpha, mix, pixelOf, RAMP, rgbOf, rgbOfHex, type Oklch, type Rgb } from "./colour";
import { gridOf, HEAD_CELLS, sway, FLOWER_KINDS, type FlowerKind, type Grid, type Ground, type GroundCell } from "./ground";
import { PUFF, type Bee, type Meadow } from "./meadow";
import { BEE_PALETTE, MONO, type BeePalette } from "./palette";
import { PARTS, SHAPES, SPECIES, wingGlyphs, type Part, type SpeciesId } from "./species";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A colour as a block behind a character, as the character on it and as a character alone, and
 *  as one soft pixel. */
interface Ink { block: string; glyph: string; bare: string; soft: number }

/** A bee part's inks: as it is, the steps toward "needs you" as it pulses, and dimmed, resting. */
interface PartInks { call: Ink[]; dim: Ink }

/** How many steps a bee's colours take toward "needs you" as it pulses. */
const CALL_STEPS = 8;
/** How far toward its colour a bee under a see-through tile is drawn. */
const SOFT = 0.55;

/** The grid lines over the sky, as a tone: fainter on a light page, where ink shows more. */
const GRID_TONE = { light: 0.015, dark: 0.055 };

function glowSprite(colour: Rgb, size = 64) {
  const sprite = new OffscreenCanvas(size, size);
  const g = sprite.getContext("2d");
  if (!g) return sprite;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, cssAlpha(colour, 1));
  grad.addColorStop(0.3, cssAlpha(colour, 0.5));
  grad.addColorStop(0.65, cssAlpha(colour, 0.12));
  grad.addColorStop(1, cssAlpha(colour, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return sprite;
}

export class Painter {
  private ctx: Ctx;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private grid: Grid = { cw: 8, ch: 12, cols: 0, rows: 0 };
  private family = "ui-monospace, Menlo, Consolas, monospace";

  private tiles: readonly WallpaperTile[] = [];
  private seeThrough = false;
  /** The cells a tile covers, or that sit in a gap narrower than a cell between two. */
  private cover = new Uint8Array(0);
  private coverVersion = 0;

  private look: WallpaperLook | null = null;
  private palette: BeePalette | null = null;
  private light = false;
  /** Page to text, as colours: the theme's ramp. */
  private toneRgb: Rgb[] = [];
  private inks = {
    ground: {} as Record<string, Ink>,
    stem: "",
    flowers: {} as Record<FlowerKind, { petal: Ink; heart: Ink }[]>,
    bees: {} as Record<SpeciesId, Record<Part, PartInks>>,
    wing: "",
    drone: { block: "", glyph: "", bare: "", soft: 0 } as Ink,
    droneWing: "",
    pollen: "",
    leaf: "",
    grid: "",
  };
  private callGlow = new OffscreenCanvas(1, 1);
  private pollenGlow = new OffscreenCanvas(1, 1);
  private add = true;

  /** The sky, painted once per size and look (`skyVersion` counts its paintings). */
  private sky = new OffscreenCanvas(1, 1);
  private skyFresh = false;
  private skyVersion = 0;
  /** What each frame starts from: the sky with the hills, the grass behind and the skep on it,
   *  painted again only when the sky, the ground or the cells the tiles cover change. One copy a
   *  frame, not two. */
  private still = new OffscreenCanvas(1, 1);
  /** The grass in front of the flowers: a layer the height of the grass. */
  private front = { canvas: new OffscreenCanvas(1, 1), top: 0 };
  private stillOf: { ground: Ground | null; cover: number; sky: number } = { ground: null, cover: -1, sky: -1 };

  /** One pixel a cell: what is under the see-through tiles this frame, drawn scaled up over them. */
  private soft = new OffscreenCanvas(1, 1);
  private softCtx: OffscreenCanvasRenderingContext2D | null = null;
  private softData: ImageData | null = null;
  private softPixels = new Uint32Array(0);
  private softAny = false;
  private softSpan = { c0: 0, c1: 0, r0: 0, r1: 0 };

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Ctx | null;
    if (!ctx) throw new Error("Bees: no 2D canvas");
    this.ctx = ctx;
  }

  resize(v: WallpaperViewport) {
    const was = this.grid;
    this.width = v.w;
    this.height = v.h;
    this.dpr = v.dpr;
    this.grid = gridOf(v.w, v.h);
    this.canvas.width = Math.max(1, Math.round(v.w * v.dpr));
    this.canvas.height = Math.max(1, Math.round(v.h * v.dpr));
    this.sky.width = this.still.width = this.canvas.width;
    this.sky.height = this.still.height = this.canvas.height;
    const { cols, rows } = this.grid;
    if (cols !== was.cols || rows !== was.rows) {
      this.soft = new OffscreenCanvas(Math.max(1, cols), Math.max(1, rows));
      this.softCtx = this.soft.getContext("2d");
      this.softData = this.softCtx?.createImageData(Math.max(1, cols), Math.max(1, rows)) ?? null;
      this.softPixels = this.softData ? new Uint32Array(this.softData.data.buffer) : new Uint32Array(0);
    }
    this.coverCells();
    this.skyFresh = false;
  }

  setTiles(tiles: readonly WallpaperTile[], seeThrough: boolean) {
    const same = tiles.length === this.tiles.length && tiles.every((t, i) => {
      const o = this.tiles[i]!;
      return t.x0 === o.x0 && t.y0 === o.y0 && t.x1 === o.x1 && t.y1 === o.y1;
    });
    this.tiles = tiles;
    this.seeThrough = seeThrough;
    if (!same) this.coverCells();
  }

  /** Which cells the tiles cover: a cell whose middle is within half a cell of one. */
  private coverCells() {
    const { cols, rows, cw, ch } = this.grid;
    const out = new Uint8Array(cols * rows);
    for (const b of this.tiles) {
      const c0 = Math.max(0, Math.ceil(b.x0 / cw - 1));
      const c1 = Math.min(cols - 1, Math.floor(b.x1 / cw));
      const r0 = Math.max(0, Math.ceil(b.y0 / ch - 1));
      const r1 = Math.min(rows - 1, Math.floor(b.y1 / ch));
      for (let r = r0; r <= r1; r++) out.fill(1, r * cols + c0, r * cols + c1 + 1);
    }
    this.cover = out;
    this.coverVersion++;
  }

  setLook(look: WallpaperLook) {
    this.look = look;
    this.family = `${look.mono ? `${look.mono}, ` : ""}ui-monospace, Menlo, Consolas, monospace`;
    const page = rgbOfHex(look.page);
    const text = rgbOfHex(look.text);
    this.light = !look.dark;
    this.palette = look.colour ? BEE_PALETTE[look.dark ? "dark" : "light"] : null;
    this.toneRgb = Array.from({ length: RAMP + 1 }, (_, i) => mix(page, text, i / RAMP));
    this.inked(rgbOfHex(look.attention));
    this.skyFresh = false;
  }

  private tone(t: number): Rgb {
    return this.toneRgb[Math.max(0, Math.min(RAMP, Math.round(t * RAMP)))]!;
  }

  /** Every ink of this look, once. */
  private inked(attention: Rgb) {
    const p = this.palette;
    const skyMid = p ? rgbOf(p.sky[1]!) : this.tone(0);
    const skyLow = p ? rgbOf(p.sky[p.sky.length - 1]!) : this.tone(0);
    const ink = (glyph: Rgb, block: Rgb, bare = glyph): Ink => ({ glyph: css(glyph), block: css(block), bare: css(bare), soft: pixelOf(mix(skyMid, block, SOFT)) });
    // In colour a part's block is its colour part way out of the sky; in the theme's, two tones.
    const own = (c: Oklch, k = p?.block ?? 0.5) => ink(rgbOf(c), mix(skyLow, rgbOf(c), k));
    const toned = ([b, g]: readonly number[]) => ink(this.tone(g!), this.tone(b!));
    const i = this.inks;
    if (p) {
      i.ground = {
        hillFar: own(p.hillFar, 1), hillNear: own(p.hillNear, 1),
        far: own(p.far), near: own(p.near), straw: own(p.straw), coil: own(p.coil), shade: own(p.shade), rim: own(p.rim),
        door: ink(rgbOf(p.door), rgbOf(p.door)), board: own(p.board),
      };
      i.stem = css(rgbOf(p.stem));
      for (const k of FLOWER_KINDS) i.flowers[k] = p.flowers[k].map(([petal, heart]) => ({ petal: own(petal, 0.4), heart: own(heart, 0.5) }));
      i.wing = css(rgbOf(p.wing));
      i.drone = ink(rgbOf(p.bees.honey.b), rgbOf(p.drone));
      i.droneWing = css(mix(skyMid, rgbOf(p.wing), 0.6));
      i.pollen = css(rgbOf(p.pollen));
      i.leaf = css(rgbOf(p.leaf));
      i.grid = cssAlpha(rgbOf(p.grid.colour), p.grid.alpha);
      this.add = p.add;
    } else {
      i.ground = {
        hillFar: toned(MONO.hillFar), hillNear: toned(MONO.hillNear),
        far: toned(MONO.far), near: toned(MONO.near), straw: toned(MONO.straw), coil: toned(MONO.coil), shade: toned(MONO.shade), rim: toned(MONO.rim),
        door: toned(MONO.door), board: toned(MONO.board),
      };
      i.stem = css(this.tone(MONO.stem));
      for (const k of FLOWER_KINDS) i.flowers[k] = [0, 1, 2].map(() => ({ petal: toned(MONO.petal), heart: toned(MONO.heart) }));
      i.wing = css(this.tone(MONO.wing));
      // Its band cut darker into it, as a bee's is.
      i.drone = ink(this.tone(this.light ? MONO.drone + 0.26 : MONO.drone - 0.28), this.tone(MONO.drone));
      i.droneWing = css(this.tone(MONO.droneWing));
      i.pollen = css(this.tone(MONO.pollen));
      i.leaf = css(this.tone(MONO.leaf));
      i.grid = css(this.tone(this.light ? GRID_TONE.light : GRID_TONE.dark));
      this.add = !this.light;
    }
    // Each part of each bee, the steps it takes toward "needs you" as it pulses, and dimmed for a
    // bee at rest. In colour, the character on a block is its part's colour lifted (on a dark part)
    // or deepened (on a light one), so it shows; alone, a dark part is lifted a little off the sky.
    const lift = ([l, c, h]: Oklch, d: number): Oklch => [Math.max(0, Math.min(1, l + d)), c, h];
    const ground = p ? skyLow : this.tone(0);
    for (const s of SPECIES) {
      const parts = {} as Record<Part, PartInks>;
      for (const part of PARTS) {
        const c = p?.bees[s][part];
        const [b, cut] = MONO.parts[part];
        const [block, glyph, bare] = c
          ? [rgbOf(c), rgbOf(lift(c, c[0] < 0.55 ? 0.24 : -0.26)), rgbOf(lift(c, c[0] < 0.45 && !this.light ? 0.14 : 0))]
          : [this.tone(b), this.tone(this.light ? b + 0.24 : b - 0.32), this.tone(cut)];
        parts[part] = {
          call: Array.from({ length: CALL_STEPS + 1 }, (_, k) => {
            const t = (k / CALL_STEPS) * 0.7;
            return ink(mix(glyph, attention, t), mix(block, attention, t), mix(bare, attention, t));
          }),
          dim: ink(mix(glyph, ground, 0.4), mix(block, ground, 0.4), mix(bare, ground, 0.4)),
        };
      }
      this.inks.bees[s] = parts;
    }
    this.callGlow = glowSprite(attention);
    this.pollenGlow = glowSprite(p ? rgbOf(p.pollen) : this.tone(1));
  }

  /** The sky: a gradient with the low sun's glow in colour, the page in the theme's; the grid. */
  private paintSky() {
    this.skyFresh = true;
    this.skyVersion++;
    const g = this.sky.getContext("2d");
    if (!g) return;
    const { width: W, height: H, dpr } = this;
    const { cw, ch } = this.grid;
    const p = this.palette;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (p) {
      const grad = g.createLinearGradient(0, 0, 0, H);
      p.sky.forEach((c, i) => grad.addColorStop(i / Math.max(1, p.sky.length - 1), css(rgbOf(c))));
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // The sun just under the hills, its light wide and low along the horizon.
      const r = Math.max(W, H) * 0.7;
      const cx = W * 0.62;
      const cy = H * 0.86;
      const squash = 0.42;
      const glow = g.createRadialGradient(cx, cy / squash, 0, cx, cy / squash, r);
      glow.addColorStop(0, cssAlpha(rgbOf(p.glow.colour), p.glow.alpha));
      glow.addColorStop(0.45, cssAlpha(rgbOf(p.glow.colour), p.glow.alpha * 0.45));
      glow.addColorStop(1, cssAlpha(rgbOf(p.glow.colour), 0));
      g.fillStyle = glow;
      g.save();
      g.scale(1, squash);
      g.fillRect(0, 0, W, H / squash);
      g.restore();
    } else {
      g.fillStyle = css(this.tone(0));
      g.fillRect(0, 0, W, H);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = this.inks.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 0; c <= Math.ceil(W / cw); c++) {
      const x = Math.round(c * cw * dpr) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, H * dpr);
    }
    for (let r = 0; r <= Math.ceil(H / ch); r++) {
      const y = Math.round(r * ch * dpr) + 0.5;
      g.moveTo(0, y);
      g.lineTo(W * dpr, y);
    }
    g.stroke();
  }

  private font() {
    return `600 ${Math.round(this.grid.ch * 0.74)}px ${this.family}`;
  }

  /** A layer of still ground cells, from the topmost row they reach to the bottom. */
  private paintLayer(layer: { canvas: OffscreenCanvas; top: number }, cells: readonly GroundCell[][]) {
    const { dpr } = this;
    const { cols, rows, cw, ch } = this.grid;
    let top = rows;
    for (const list of cells) for (const c of list) top = Math.min(top, c.r);
    layer.top = top;
    const w = Math.max(1, Math.round(cols * cw * dpr));
    const h = Math.max(1, Math.round((rows - top) * ch * dpr));
    if (layer.canvas.width !== w || layer.canvas.height !== h) {
      layer.canvas.width = w;
      layer.canvas.height = h;
    }
    const g = layer.canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    this.paintCells(g, cells, top);
  }

  /** Still ground cells onto `g`, its top at row `top`; none under a tile. */
  private paintCells(g: OffscreenCanvasRenderingContext2D, cells: readonly GroundCell[][], top: number) {
    const { dpr } = this;
    const { cols, rows, cw, ch } = this.grid;
    g.setTransform(dpr, 0, 0, dpr, 0, -top * ch * dpr);
    g.font = this.font();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const list of cells) {
      for (const cell of list) {
        if (cell.c < 0 || cell.c >= cols || cell.r < 0 || cell.r >= rows || this.cover[cell.r * cols + cell.c]) continue;
        const ink = this.inks.ground[cell.colour]!;
        if (cell.block) {
          g.fillStyle = ink.block;
          g.fillRect(cell.c * cw + 1, cell.r * ch + 1, cw - 1, ch - 1);
        }
        if (cell.glyph === " ") continue;
        g.fillStyle = ink.glyph;
        g.fillText(cell.glyph, cell.c * cw + cw / 2, cell.r * ch + ch / 2 + 1);
      }
    }
  }

  draw(meadow: Meadow, _dt: number) {
    const ground = meadow.ground;
    if (!ground || !this.look || this.grid.cols === 0) return;
    const { ctx, dpr } = this;
    const { ch } = this.grid;
    if (!this.skyFresh) this.paintSky();
    const l = this.stillOf;
    if (l.ground !== ground || l.cover !== this.coverVersion || l.sky !== this.skyVersion) {
      this.stillOf = { ground, cover: this.coverVersion, sky: this.skyVersion };
      const g = this.still.getContext("2d");
      if (g) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(this.sky, 0, 0);
        this.paintCells(g, [ground.hills, ground.back, ground.hive], 0);
      }
      this.paintLayer(this.front, [ground.front]);
    }
    const t = meadow.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.still, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = this.font();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.drawFlowers(ground, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.front.canvas, 0, Math.round(this.front.top * ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawDrones(meadow, t);
    this.drawGlows(meadow, t);
    for (const b of meadow.bees) this.drawBee(b, t);
    this.drawGrains(meadow);
    if (this.softAny) this.drawSoft();
  }

  /** One cell: a block of its colour, its character over it; under a see-through tile, a soft
   *  pixel instead, when it has one. */
  private cell(c: number, r: number, glyph: string, glyphStyle: string, block: string | null, soft: number | null) {
    const { cols, rows, cw, ch } = this.grid;
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    if (this.cover[i]) {
      if (soft !== null && this.seeThrough) this.softPixel(i, soft);
      return;
    }
    const { ctx } = this;
    if (block) {
      ctx.fillStyle = block;
      ctx.fillRect(c * cw + 1, r * ch + 1, cw - 1, ch - 1);
    }
    if (glyph === " ") return;
    ctx.fillStyle = glyphStyle;
    ctx.fillText(glyph, c * cw + cw / 2, r * ch + ch / 2 + 1);
  }

  private drawFlowers(ground: Ground, t: number) {
    const stem = this.inks.stem;
    for (const f of ground.flowers) {
      let below = 0;
      for (let k = 0; k < f.height; k++) {
        const off = sway(f, k, t);
        const lean = off - below;
        below = off;
        const c = f.c + off;
        const r = f.foot - k;
        this.cell(c, r, lean < 0 ? "\\" : lean > 0 ? "/" : "|", stem, null, null);
        if (f.leaves && k === f.leaves) {
          this.cell(c - 1, r, "\\", stem, null, null);
          this.cell(c + 1, r, "/", stem, null, null);
        }
      }
      const off = sway(f, f.height, t);
      const ink = this.inks.flowers[f.kind][f.colour % 3]!;
      for (const h of HEAD_CELLS[f.kind]) {
        const part = h.heart ? ink.heart : ink.petal;
        this.cell(f.c + off + h.dx, f.foot - f.height + h.dy, h.glyph, part.glyph, h.block ? part.block : null, null);
      }
    }
  }

  /** The small bees: a body of one cell, banded, and in flight a wing over it. */
  private drawDrones(meadow: Meadow, t: number) {
    const { cw, ch } = this.grid;
    const ink = this.inks.drone;
    for (const d of meadow.drones) {
      if (d.inside) continue;
      const c = Math.floor(d.x / cw);
      const r = Math.floor(d.y / ch);
      this.cell(c, r, d.vx < 0 ? "(" : ")", ink.glyph, ink.block, null);
      if (!d.landed) this.cell(c, r - 1, Math.floor(t * 18 + d.phase * 7) % 2 ? "'" : "`", this.inks.droneWing, null, null);
    }
  }

  /** The pulse of a bee that needs you, 0 to 1. */
  private pulse(b: Bee, t: number) {
    return 0.5 + 0.5 * Math.sin((t + b.phase) * Math.PI * 2 / 1.2);
  }

  /** Behind the bees: the glow of each one that needs you, pulsing; a turn's burst. */
  private drawGlows(meadow: Meadow, t: number) {
    const { ctx } = this;
    const { cw, ch } = this.grid;
    let any = false;
    for (const b of meadow.bees) {
      if (b.call <= 0.01 && !b.loop) continue;
      if (!any) {
        any = true;
        ctx.save();
        ctx.globalCompositeOperation = this.add ? "lighter" : "source-over";
      }
      const box = meadow.boxOf(b);
      const x = (box.x0 + box.x1) / 2 + b.shake.x * cw;
      const y = (box.y0 + box.y1) / 2 + b.shake.y * ch;
      const pulse = this.pulse(b, t);
      if (b.call > 0.01) {
        const r = (box.x1 - box.x0) * (0.8 + 0.45 * pulse);
        ctx.globalAlpha = b.call * (0.18 + 0.62 * pulse) * (this.add ? 1 : 0.75);
        ctx.drawImage(this.callGlow, x - r, y - r, r * 2, r * 2);
      }
      if (b.loop) {
        const r = (box.x1 - box.x0) * 0.7;
        ctx.globalAlpha = 0.35;
        ctx.drawImage(this.pollenGlow, x - r, y - r, r * 2, r * 2);
      }
    }
    // A turn's puff of pollen light, spreading as it fades.
    for (const p of meadow.puffs) {
      if (!any) {
        any = true;
        ctx.save();
        ctx.globalCompositeOperation = this.add ? "lighter" : "source-over";
      }
      const k = p.age / PUFF;
      const r = cw * (3 + 6 * k);
      ctx.globalAlpha = (1 - k) * (this.add ? 0.55 : 0.4);
      ctx.drawImage(this.pollenGlow, p.x - r, p.y - r, r * 2, r * 2);
    }
    if (any) ctx.restore();
  }

  private drawBee(b: Bee, t: number) {
    const { cw, ch } = this.grid;
    const s = SHAPES[b.species];
    const cells = b.facing > 0 ? s.cells : s.left;
    const ax = b.facing > 0 ? s.anchor.dx : s.w - 1 - s.anchor.dx;
    const c0 = Math.floor(b.x / cw) - ax + b.shake.x;
    const r0 = Math.floor(b.y / ch) - s.anchor.dy + b.shake.y;
    const level = b.call > 0.01 ? Math.round(b.call * (0.35 + 0.65 * this.pulse(b, t)) * CALL_STEPS) : 0;
    // A bee at rest is dimmer: it says less.
    const dim = b.state === "resting" && b.landed && level === 0;
    const inks = this.inks.bees[b.species];
    for (const cell of cells) {
      const ink = dim ? inks[cell.part].dim : inks[cell.part].call[level]!;
      this.cell(c0 + cell.dx, r0 + cell.dy, cell.glyph, cell.block ? ink.glyph : ink.bare, cell.block ? ink.block : null, ink.soft);
    }
    // Its wings, beating over its back in flight, folded flat when it has landed.
    const [w1, w2] = wingGlyphs(!b.landed, t, b.phase);
    const mirror = (g: string) => (g === "/" ? "\\" : g === "\\" ? "/" : g);
    const wings = b.facing > 0 ? [w1, w2] : [mirror(w2), mirror(w1)];
    const spots = b.facing > 0 ? s.wings : s.wings.map((w) => ({ dx: s.w - 1 - w.dx, dy: w.dy })).reverse();
    spots.forEach((w, i) => this.cell(c0 + w.dx, r0 + w.dy, wings[i]!, this.inks.wing, null, null));
    // A load under it: pollen gathered, or a leafcutter's leaf.
    if (b.state === "working" && b.pollen > 0.15) {
      const lx = b.facing > 0 ? s.load.dx : s.w - 1 - s.load.dx;
      const leaf = b.species === "leafcutter";
      this.cell(c0 + lx, r0 + s.load.dy, leaf ? "~" : b.pollen > 0.6 ? "o" : ".", leaf ? this.inks.leaf : this.inks.pollen, null, null);
    }
  }

  private drawGrains(meadow: Meadow) {
    if (!meadow.grains.length) return;
    const { ctx } = this;
    const { cw, ch } = this.grid;
    ctx.fillStyle = this.inks.pollen;
    for (const p of meadow.grains) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      this.cellText(Math.floor(p.x / cw), Math.floor(p.y / ch), p.glyph);
    }
    ctx.globalAlpha = 1;
  }

  /** A bare character in the current fill, where no tile covers it. */
  private cellText(c: number, r: number, glyph: string) {
    const { cols, rows, cw, ch } = this.grid;
    if (c < 0 || r < 0 || c >= cols || r >= rows || this.cover[r * cols + c]) return;
    this.ctx.fillText(glyph, c * cw + cw / 2, r * ch + ch / 2 + 1);
  }

  private softPixel(i: number, pixel: number) {
    this.softPixels[i] = pixel;
    const { cols } = this.grid;
    const c = i % cols;
    const r = (i / cols) | 0;
    const s = this.softSpan;
    if (!this.softAny) {
      this.softAny = true;
      s.c0 = s.c1 = c;
      s.r0 = s.r1 = r;
      return;
    }
    if (c < s.c0) s.c0 = c;
    else if (c > s.c1) s.c1 = c;
    if (r < s.r0) s.r0 = r;
    else if (r > s.r1) s.r1 = r;
  }

  /** What is under the see-through tiles, one pixel a cell, scaled up smoothly over them: soft,
   *  with no characters for the tile's own text to run through. */
  private drawSoft() {
    const { ctx, soft, softCtx, softData } = this;
    const { cols, rows, cw, ch } = this.grid;
    this.softAny = false;
    if (!softCtx || !softData) return;
    const s = this.softSpan;
    const c0 = Math.max(0, s.c0 - 1);
    const r0 = Math.max(0, s.r0 - 1);
    const w = Math.min(cols, s.c1 + 2) - c0;
    const h = Math.min(rows, s.r1 + 2) - r0;
    softCtx.putImageData(softData, 0, 0, c0, r0, w, h);
    ctx.save();
    ctx.beginPath();
    for (const b of this.tiles) ctx.rect(b.x0 - cw / 2, b.y0 - ch / 2, b.x1 - b.x0 + cw, b.y1 - b.y0 + ch);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(soft, c0, r0, w, h, c0 * cw, r0 * ch, w * cw, h * ch);
    ctx.restore();
    for (let r = r0; r < r0 + h; r++) this.softPixels.fill(0, r * cols + c0, r * cols + c0 + w);
  }
}
