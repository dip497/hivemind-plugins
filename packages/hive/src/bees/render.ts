/**
 * Bees' drawing, in character cells on a canvas the size of the viewport times its pixel ratio,
 * always in its own colours: a summer meadow by day on a light theme, at dusk on a dark one.
 * Each frame starts from one still picture (the sky, the hills, the grass behind and the skep,
 * painted again only when the size or the theme changes), then the flowers swaying, the near grass
 * in front of them (its still part from a layer, only the tops of its tall blades drawn each
 * frame, swaying), the small bees, the colony, and the pollen of a click.
 */
import type { WallpaperLook, WallpaperViewport } from "@hivemind/view-sdk";
import { css, cssAlpha, mix, rgbOf, type Oklch, type Rgb } from "./colour";
import { gridOf, HEAD_CELLS, sway, tipSway, FLOWER_KINDS, type FlowerKind, type Grid, type Ground, type GroundCell } from "./ground";
import { PUFF, type Bee, type Meadow } from "./meadow";
import { BEE_PALETTE, type BeePalette } from "./palette";
import { PARTS, SHAPES, SPECIES, wingGlyphs, type Part, type SpeciesId } from "./species";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A colour as a block behind a character, as the character on it and as a character alone. */
interface Ink { block: string; glyph: string; bare: string }

/** A bee part's inks: as it is, and dimmed, resting. */
interface PartInks { lit: Ink; dim: Ink }

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
  private palette: BeePalette | null = null;
  private inks = {
    ground: {} as Record<string, Ink>,
    stem: "",
    flowers: {} as Record<FlowerKind, { petal: Ink; heart: Ink }[]>,
    bees: {} as Record<SpeciesId, Record<Part, PartInks>>,
    wing: "",
    drone: { block: "", glyph: "", bare: "" } as Ink,
    droneWing: "",
    pollen: "",
    leaf: "",
    grid: "",
  };
  private pollenGlow = new OffscreenCanvas(1, 1);
  /** Light adds to dusk; by day it tints. */
  private add = true;

  /** What each frame starts from: the sky with the hills, the grass behind and the skep on it,
   *  painted when the size, the theme or the ground changes. One copy a frame. */
  private still = new OffscreenCanvas(1, 1);
  private stillFresh = false;
  private stillOf: Ground | null = null;
  /** The grass in front of the flowers: a layer the height of the grass. */
  private front = { canvas: new OffscreenCanvas(1, 1), top: 0 };

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Ctx | null;
    if (!ctx) throw new Error("Bees: no 2D canvas");
    this.ctx = ctx;
  }

  resize(v: WallpaperViewport) {
    this.width = v.w;
    this.height = v.h;
    this.dpr = v.dpr;
    this.grid = gridOf(v.w, v.h);
    this.canvas.width = Math.max(1, Math.round(v.w * v.dpr));
    this.canvas.height = Math.max(1, Math.round(v.h * v.dpr));
    this.still.width = this.canvas.width;
    this.still.height = this.canvas.height;
    this.stillFresh = false;
  }

  setLook(look: WallpaperLook) {
    this.family = `${look.mono ? `${look.mono}, ` : ""}ui-monospace, Menlo, Consolas, monospace`;
    this.palette = BEE_PALETTE[look.dark ? "dark" : "light"];
    this.inked(this.palette);
    this.stillFresh = false;
  }

  /** Every ink of this look, once. */
  private inked(p: BeePalette) {
    const skyMid = rgbOf(p.sky[1]!);
    const skyLow = rgbOf(p.sky[p.sky.length - 1]!);
    const ink = (glyph: Rgb, block: Rgb, bare = glyph): Ink => ({ glyph: css(glyph), block: css(block), bare: css(bare) });
    // A part's block is its colour part way out of the sky.
    const own = (c: Oklch, k = p.block) => ink(rgbOf(c), mix(skyLow, rgbOf(c), k));
    const i = this.inks;
    i.ground = {
      hillFar: own(p.hillFar, 1), hillNear: own(p.hillNear, 1),
      far: own(p.far), mid: own(p.mid), near: own(p.near), tip: own(p.tip), seed: own(p.seed), straw: own(p.straw), coil: own(p.coil), shade: own(p.shade), rim: own(p.rim),
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
    // Each part of each bee, and dimmed for a bee at rest. The character on a block is its part's
    // colour lifted (on a dark part) or deepened (on a light one), so it shows; alone, a dark part
    // is lifted a little off the dusk sky.
    const lift = ([l, c, h]: Oklch, d: number): Oklch => [Math.max(0, Math.min(1, l + d)), c, h];
    for (const s of SPECIES) {
      const parts = {} as Record<Part, PartInks>;
      for (const part of PARTS) {
        const c = p.bees[s][part];
        const block = rgbOf(c);
        const glyph = rgbOf(lift(c, c[0] < 0.55 ? 0.24 : -0.26));
        const bare = rgbOf(lift(c, c[0] < 0.45 && p.add ? 0.14 : 0));
        parts[part] = { lit: ink(glyph, block, bare), dim: ink(mix(glyph, skyLow, 0.4), mix(block, skyLow, 0.4), mix(bare, skyLow, 0.4)) };
      }
      this.inks.bees[s] = parts;
    }
    this.pollenGlow = glowSprite(rgbOf(p.pollen));
  }

  /** The still picture: the sky's gradient and the low sun's glow, the grid, then the hills, the
   *  grass behind and the skep. */
  private paintStill(ground: Ground) {
    this.stillFresh = true;
    this.stillOf = ground;
    const g = this.still.getContext("2d");
    const p = this.palette;
    if (!g || !p) return;
    const { width: W, height: H, dpr } = this;
    const { cw, ch } = this.grid;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = this.inks.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 0; c <= Math.ceil(W / cw); c++) {
      const x = Math.round(c * cw * dpr) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, H * dpr);
    }
    for (let row = 0; row <= Math.ceil(H / ch); row++) {
      const y = Math.round(row * ch * dpr) + 0.5;
      g.moveTo(0, y);
      g.lineTo(W * dpr, y);
    }
    g.stroke();
    this.paintCells(g, [ground.hills, ground.back, ground.hive], 0);
    this.paintLayer(this.front, [ground.front]);
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

  /** Still ground cells onto `g`, its top at row `top`. */
  private paintCells(g: OffscreenCanvasRenderingContext2D, cells: readonly GroundCell[][], top: number) {
    const { dpr } = this;
    const { cols, rows, cw, ch } = this.grid;
    g.setTransform(dpr, 0, 0, dpr, 0, -top * ch * dpr);
    g.font = this.font();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const list of cells) {
      for (const cell of list) {
        if (cell.c < 0 || cell.c >= cols || cell.r < 0 || cell.r >= rows) continue;
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
    if (!ground || !this.palette || this.grid.cols === 0) return;
    const { ctx, dpr } = this;
    const { ch } = this.grid;
    if (!this.stillFresh || this.stillOf !== ground) this.paintStill(ground);
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
    this.drawTips(ground, t);
    this.drawDrones(meadow, t);
    this.drawPuffs(meadow);
    for (const b of meadow.bees) this.drawBee(meadow, b, t);
    this.drawGrains(meadow);
  }

  /** One cell: a block of its colour, its character over it. */
  private cell(c: number, r: number, glyph: string, glyphStyle: string, block: string | null) {
    const { cols, rows, cw, ch } = this.grid;
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
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
        this.cell(c, r, lean < 0 ? "\\" : lean > 0 ? "/" : "|", stem, null);
        if (f.leaves && k === f.leaves) {
          this.cell(c - 1, r, "\\", stem, null);
          this.cell(c + 1, r, "/", stem, null);
        }
      }
      const off = sway(f, f.height, t);
      const ink = this.inks.flowers[f.kind][f.colour % 3]!;
      for (const h of HEAD_CELLS[f.kind]) {
        const part = h.heart ? ink.heart : ink.petal;
        this.cell(f.c + off + h.dx, f.foot - f.height + h.dy, h.glyph, part.glyph, h.block ? part.block : null);
      }
    }
  }

  /** The tops of the near grass's tall blades, swaying: each cell's character follows the way the
   *  blade bends there, its tip or seed head on top. */
  private drawTips(ground: Ground, t: number) {
    const g = this.inks.ground;
    for (const tip of ground.tips) {
      let below = 0;
      const last = tip.glyphs.length - 1;
      for (let j = 0; j <= last; j++) {
        const off = tipSway(tip, j, t);
        const glyph = j === last ? tip.glyphs[j]! : off > below ? "/" : off < below ? "\\" : tip.glyphs[j]!;
        below = off;
        this.cell(tip.c + off, tip.r - j, glyph, g[tip.colours[j]!]!.glyph, null);
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
      this.cell(c, r, d.vx < 0 ? "(" : ")", ink.glyph, ink.block);
      if (!d.landed) this.cell(c, r - 1, Math.floor(t * 18 + d.phase * 7) % 2 ? "'" : "`", this.inks.droneWing, null);
    }
  }

  /** A click's puff of pollen light, spreading as it fades. */
  private drawPuffs(meadow: Meadow) {
    if (!meadow.puffs.length) return;
    const { ctx } = this;
    const { cw } = this.grid;
    ctx.save();
    ctx.globalCompositeOperation = this.add ? "lighter" : "source-over";
    for (const p of meadow.puffs) {
      const k = p.age / PUFF;
      const r = cw * (3 + 6 * k);
      ctx.globalAlpha = (1 - k) * (this.add ? 0.55 : 0.65);
      ctx.drawImage(this.pollenGlow, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private drawBee(meadow: Meadow, b: Bee, t: number) {
    const s = SHAPES[b.species];
    const cells = b.facing > 0 ? s.cells : s.left;
    const box = meadow.boxOf(b);
    const c0 = Math.round(box.x0 / this.grid.cw);
    const r0 = Math.round(box.y0 / this.grid.ch);
    // A bee at rest is dimmer: it says less.
    const dim = b.doing === "rest" && b.landed;
    const inks = this.inks.bees[b.species];
    for (const cell of cells) {
      const ink = dim ? inks[cell.part].dim : inks[cell.part].lit;
      this.cell(c0 + cell.dx, r0 + cell.dy, cell.glyph, cell.block ? ink.glyph : ink.bare, cell.block ? ink.block : null);
    }
    // Its wings, beating over its back in flight, folded flat when it has landed.
    const [w1, w2] = wingGlyphs(!b.landed, t, b.phase);
    const mirror = (g: string) => (g === "/" ? "\\" : g === "\\" ? "/" : g);
    const wings = b.facing > 0 ? [w1, w2] : [mirror(w2), mirror(w1)];
    const spots = b.facing > 0 ? s.wings : s.wings.map((w) => ({ dx: s.w - 1 - w.dx, dy: w.dy })).reverse();
    spots.forEach((w, i) => this.cell(c0 + w.dx, r0 + w.dy, wings[i]!, this.inks.wing, null));
    // A load under it: pollen gathered, or a leafcutter's leaf.
    if (b.pollen > 0.15 && (b.doing === "forage" || b.doing === "home" || b.was === "forage")) {
      const lx = b.facing > 0 ? s.load.dx : s.w - 1 - s.load.dx;
      const leaf = b.species === "leafcutter";
      this.cell(c0 + lx, r0 + s.load.dy, leaf ? "~" : b.pollen > 0.6 ? "o" : ".", leaf ? this.inks.leaf : this.inks.pollen, null);
    }
  }

  private drawGrains(meadow: Meadow) {
    if (!meadow.grains.length) return;
    const { ctx } = this;
    const { cols, rows, cw, ch } = this.grid;
    ctx.fillStyle = this.inks.pollen;
    for (const p of meadow.grains) {
      const c = Math.floor(p.x / cw);
      const r = Math.floor(p.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillText(p.glyph, c * cw + cw / 2, r * ch + ch / 2 + 1);
    }
    ctx.globalAlpha = 1;
  }
}
