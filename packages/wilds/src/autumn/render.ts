/**
 * Autumn Wood's drawing, in cells. Painted once per window and look: the sky, the far treeline in
 * the haze, the mist's soft body, the forest floor (the backdrop), and each tree in two layers of
 * its own, its trunk and limbs and its crown, so a shaken crown sways over a trunk that stands
 * still. Every frame: the stars twinkling, the trees copied in (back to front, the mist's
 * characters between), a few of each crown's leaves turning in the wind to show their paler side,
 * more where a gust is and all over a shaken crown; the lantern; the pile (each column painted again
 * only when it changes); the beast crossing; the falling leaves; the fireflies.
 */
import { textCells, sizeLayer, type Draw2D } from "../cells";
import { css, cssAlpha, mix, ramp as rampOf, rgbOf, RAMP, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { LookRenderer } from "../look";
import { clamp, fbm2, hash, noise2 } from "../num";
import { SPRITES } from "./beasts";
import { PILE_ROWS, type Beast, type Wood } from "./forest";
import { AUTUMN_PALETTE, LEAF_COLOURS, type AutumnPalette } from "./palette";
import type { TreeShape, WoodLayout } from "./wood";

/** A crown's leaves, densest in its shade and sparest in the light. */
const LEAVES = "@#&8%§*o+'";
/** A leaf turned in the wind, its paler side up. */
const TURNED = "*'o,`";
/** The ragged edge of a crown: leaves alone. */
const EDGE = "',`.*";
/** Bark: grooves running up the trunk. */
const BARK = "||!|:|{}[]|";
/** The litter on the floor. */
const LITTER = ".,'`~°\"";
/** The shapes a falling leaf tumbles through: face on, turning, edge on, turning. */
const TUMBLE = [["&", "%", "|", "%"], ["@", "o", "-", "o"], ["§", "s", "/", "s"], ["*", "+", "'", "+"]];
const STAR_LEVELS = 3;
/** How often the mist, and what holds still with it, is laid again (s). */
const MIST_EVERY = 0.5;
const SEED = 0x0a17;

interface TreeLayers {
  shape: TreeShape;
  trunk: OffscreenCanvas;
  crown: OffscreenCanvas;
  /** Per crown cell: its block's style and the style of its leaf turned in the wind ("" for an
   *  edge cell, which is never turned). */
  block: string[];
  turned: string[];
}

export class AutumnRenderer extends LookRenderer<AutumnPalette> {
  /** Per leaf colour: shadow to full light, and full light to the sun's warm light. */
  private leafRamps: string[][] = [];
  private rimRamps: string[][] = [];
  private leafRgb: Rgb[] = [];
  private starStyles: string[] = [];
  private mistStyles: string[] = [];
  private beastStyles: Record<Beast, string[]> = { fox: [], deer: [] };
  private beastInk = "";
  private lanternStyles = ["", "", ""];
  private lanternGlow: OffscreenCanvas | null = null;
  private flyGlow: OffscreenCanvas | null = null;
  private flyStyle = "";
  private trees: TreeLayers[] = [];
  /** The layout and look the trees were baked for. */
  private bakedFor: WoodLayout | null = null;
  private bakedLook = -1;
  private look = 0;
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];
  private pileLayer = new OffscreenCanvas(1, 1);
  private pileDrawn = new Int16Array(0);
  private pileTop = 0;
  private mistLayer = new OffscreenCanvas(1, 1);
  private mistAt = -Infinity;
  private mistTop = 0;
  /** What holds still, drawn together: the backdrop, the stars, and the trees and mist up to the
   *  first that is shaking (`stillLive`), as at `stillAt`. */
  private still = new OffscreenCanvas(1, 1);
  private stillAt = -Infinity;
  private stillKey = "";
  /** The layout the backdrop (far trees, floor) was painted for. */
  private layout: WoodLayout | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, AUTUMN_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.look++;
    const shadow = rgbOf(p.shadow);
    const rim = rgbOf(p.rim);
    this.leafRgb = LEAF_COLOURS.map((k) => rgbOf(p.leaves[k]));
    this.leafRamps = this.leafRgb.map((c) => rampOf(shadow, c));
    this.rimRamps = this.leafRgb.map((c) => rampOf(c, rim));
    const top = rgbOf(p.sky[0]!);
    const star = rgbOf(p.star);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, star, (p.stars * (l + 1)) / STAR_LEVELS))) : [];
    const mist = rgbOf(p.mist);
    this.mistStyles = [0.4, 0.7, 1].map((a) => cssAlpha(mist, Math.min(1, p.mistAlpha * 1.6 * a)));
    const tones = (cs: [number, number, number][]) => cs.map((c) => css(rgbOf(c)));
    this.beastStyles = this.light
      ? { fox: tones([[0.64, 0.17, 45], [0.96, 0.02, 80], [0.32, 0.05, 40]]), deer: tones([[0.62, 0.08, 62], [0.96, 0.02, 80], [0.34, 0.04, 50]]) }
      : { fox: tones([[0.58, 0.16, 44], [0.86, 0.03, 80], [0.2, 0.03, 300]]), deer: tones([[0.52, 0.07, 58], [0.84, 0.03, 80], [0.2, 0.03, 300]]) };
    this.beastInk = css(rgbOf(this.light ? [0.3, 0.05, 45] : [0.17, 0.03, 300]));
    if (p.lantern) {
      const l = rgbOf(p.lantern);
      this.lanternStyles = [css(l), css(mix(l, [255, 250, 230], 0.65)), css(rgbOf(p.bark[0]))];
      this.lanternGlow = glowSprite(l);
    } else this.lanternGlow = null;
    if (p.firefly) {
      const f = rgbOf(p.firefly);
      this.flyGlow = glowSprite(f);
      this.flyStyle = css(f);
    } else this.flyGlow = null;
  }

  /** The sky's colour at row `r`, as its gradient has it. */
  private skyAt(r: number): Rgb {
    const s = this.palette.sky.map(rgbOf);
    const t = clamp((r + 0.5) / this.rows, 0, 1) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(t));
    return mix(s[i]!, s[i + 1]!, t - i);
  }

  /** The far treeline, the mist's body and the floor, over the sky, for the layout last drawn. */
  protected paintScenery(g: Draw2D) {
    const layout = this.layout;
    if (!layout || layout.grid.cols !== this.cols || layout.grid.rows !== this.rows) return;
    const p = this.palette;
    const { cols, rows, cw, ch } = this;
    const { floor, far } = layout;
    textCells(g, ch, this.fontFamily);
    // The far treeline: round crowns, darker than the sky at dusk and hazed toward it by day, their
    // rounded tops leaves alone against it, a trunk showing here and there under them.
    const farBase = rgbOf(p.far);
    const shadow = rgbOf(p.shadow);
    const farLeaves = [1, 2, 3, 4, 6].map((k) => this.leafRgb[k]!);
    const farTop = Math.min(...far);
    for (let r = farTop; r < floor; r++) {
      const sky = this.skyAt(r);
      for (let c = 0; c < cols; c++) {
        if (r < far[c]!) continue;
        const down = (r - far[c]!) / Math.max(1, floor - farTop);
        const leaf = farLeaves[Math.floor(noise2(c * 0.09, r * 0.2, SEED) * 4.99)]!;
        const tint = mix(mix(farBase, leaf, 0.3), sky, p.haze);
        const shade = mix(tint, shadow, this.light ? down * 0.25 : 0.25 + down * 0.45);
        const h = hash(c, r, SEED);
        if (r === far[c]!) {
          const left = (far[c - 1] ?? r) > r;
          const right = (far[c + 1] ?? r) > r;
          g.fillStyle = css(mix(tint, sky, 0.2));
          this.glyph(g, left && right ? "^" : left ? "(" : right ? ")" : h < 0.5 ? "*" : "%", c, r);
          continue;
        }
        g.fillStyle = css(shade);
        this.block(g, c, r);
        if (down > 0.45 && hash(c, 0, SEED) < 0.2) {
          g.fillStyle = css(mix(shade, rgbOf(p.bark[0]), 0.6));
          this.glyph(g, "|", c, r);
        } else if (h < 0.5) {
          g.fillStyle = css(mix(shade, this.light ? shadow : tint, this.light ? 0.22 : 0.55));
          this.glyph(g, "*%&o'"[Math.floor(h * 9.99)]!, c, r);
        }
      }
    }
    // The mist's body, low between the trees: a soft band; its characters drift over it each frame.
    const top = (floor - Math.round(rows * 0.14)) * ch;
    const band = g.createLinearGradient(0, top, 0, (floor + 1) * ch);
    const mist = rgbOf(p.mist);
    band.addColorStop(0, cssAlpha(mist, 0));
    band.addColorStop(0.8, cssAlpha(mist, p.mistAlpha * 0.4));
    band.addColorStop(1, cssAlpha(mist, p.mistAlpha * 0.2));
    g.fillStyle = band;
    g.fillRect(0, top, cols * cw, (floor + 1) * ch - top);
    // The floor: earth under a litter of fallen leaves, in the shade of the pile on it.
    const [earth, litter] = p.floor.map(rgbOf) as [Rgb, Rgb];
    for (let r = floor; r < rows; r++) {
      const down = (r - floor) / Math.max(1, rows - floor);
      for (let c = 0; c < cols; c++) {
        const h = hash(c, r, SEED + 4);
        const e = mix(earth, this.light ? litter : shadow, this.light ? 0.06 + down * 0.08 + h * 0.06 : 0.1 + down * 0.25 + h * 0.1);
        g.fillStyle = css(e);
        this.block(g, c, r);
        if (h > 0.45) continue;
        const leaf = this.leafRgb[[1, 2, 6, 3, 0, 4][Math.floor(hash(r, c, SEED + 5) * 5.99)]!]!;
        g.fillStyle = css(mix(mix(litter, leaf, 0.5), e, this.light ? 0.25 : 0.5));
        this.glyph(g, LITTER[Math.floor(h * 15.5) % LITTER.length]!, c, r);
      }
    }
  }

  /** The trees' layers for `layout`, in the palette now. */
  private bake(layout: WoodLayout) {
    this.bakedFor = layout;
    this.bakedLook = this.look;
    const glow = this.palette.glow!;
    const sun = { c: (glow.x * this.width) / this.cw, r: (glow.y * this.height) / this.ch };
    this.trees = layout.trees.map((shape, i) => {
      const prev = this.trees[i];
      const t: TreeLayers = { shape, trunk: prev?.trunk ?? new OffscreenCanvas(1, 1), crown: prev?.crown ?? new OffscreenCanvas(1, 1), block: [], turned: [] };
      this.bakeTree(t, sun);
      return t;
    });
  }

  private bakeTree(t: TreeLayers, sun: { c: number; r: number }) {
    const { dpr, cw, ch } = this;
    const s = t.shape;
    const { c0, r0, c1, r1 } = s.box;
    const w = (c1 - c0 + 1) * cw * dpr;
    const h = (r1 - r0 + 1) * ch * dpr;
    const light = this.light;
    // Further back, hazed a little toward the sky.
    const haze = s.near ? 0 : light ? 0.18 : 0.2;
    const sky = this.skyAt(Math.round(s.cy));
    const hazed = (rgb: Rgb) => css(haze ? mix(rgb, sky, haze) : rgb);
    const toSun = Math.sign(sun.c - s.c) || 1;

    const g = sizeLayer(t.trunk, w, h)!;
    g.setTransform(dpr, 0, 0, dpr, -c0 * cw * dpr, -r0 * ch * dpr);
    textCells(g, ch, this.fontFamily);
    const [dark, face, lit] = this.palette.bark.map(rgbOf) as [Rgb, Rgb, Rgb];
    const barkAt = (v: number) => (v < 0.5 ? mix(dark, face, v * 2) : mix(face, lit, (v - 0.5) * 2));
    const ink = (rgb: Rgb, v: number) => (light ? mix(rgb, dark, 0.6) : v > 0.55 ? mix(rgb, dark, 0.55) : mix(rgb, lit, 0.35));
    // The trunk: grooved bark, tapering as it rises, lit on the side toward the sun, roots spreading
    // at its foot.
    for (let r = s.top; r <= s.foot; r++) {
      const up = (s.foot - r) / Math.max(1, s.foot - s.top);
      const mid = s.c + (s.foot - r) * s.lean;
      const flare = r >= s.foot - 1 ? (r === s.foot ? 2 : 1) : 0;
      const width = Math.round(s.base + (s.width - s.base) * up) + flare * 2;
      const left = Math.round(mid - width / 2);
      for (let k = 0; k < width; k++) {
        const c = left + k;
        const u = ((k + 0.5) / width) * 2 - 1;
        const v = clamp(0.48 + 0.38 * u * toSun - 0.2 * u * u + (hash(c - Math.round(mid), Math.floor(r / 3), 7) - 0.5) * 0.18, 0, 1);
        const rgb = barkAt(v);
        g.fillStyle = hazed(rgb);
        this.block(g, c, r);
        const root = flare && (k < flare || k >= width - flare);
        const glyph = root ? (k < flare ? (r === s.foot ? "_" : "/") : r === s.foot ? "_" : "\\") : k === flare ? "(" : k === width - 1 - flare ? ")" : BARK[Math.floor(hash(c - Math.round(mid), Math.floor(r / 2), 11) * BARK.length)]!;
        g.fillStyle = hazed(ink(rgb, v));
        this.glyph(g, glyph, c, r);
      }
    }
    // Limbs: blocks of bark from the trunk, thinning to a line of characters toward the tip.
    for (const l of s.limbs) {
      const dc = l.c1 - l.c0;
      const dr = l.r1 - l.r0;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dc), Math.abs(dr) * 1.45)));
      const glyph = Math.abs(dc) > Math.abs(dr) * 2.6 ? "_" : Math.abs(dr) * 1.45 > Math.abs(dc) * 2.6 ? "|" : dc * dr > 0 ? "\\" : "/";
      for (let i = 1; i <= n; i++) {
        const c = Math.round(l.c0 + (dc * i) / n);
        const r = Math.round(l.r0 + (dr * i) / n);
        const along = i / n;
        const rgb = barkAt(0.3 + 0.35 * (1 - along));
        if (along < (l.thick > 1 ? 0.75 : 0.3)) {
          g.fillStyle = hazed(rgb);
          this.block(g, c, r);
          if (l.thick > 1 && along < 0.4) this.block(g, c + (Math.abs(dc) > Math.abs(dr) * 1.45 ? 0 : 1), r + (Math.abs(dc) > Math.abs(dr) * 1.45 ? 1 : 0));
          g.fillStyle = hazed(ink(rgb, 0.4));
        } else g.fillStyle = hazed(light ? ink(rgb, 0.4) : barkAt(0.7));
        this.glyph(g, glyph, c, r);
      }
    }

    // The crown: each clump lit on the side toward the sun and shaded on the other, the ones behind
    // darker; a block of leaves in shade under a leaf in the light, warm at the sunward edge; the
    // ragged edge leaves alone.
    const cg = sizeLayer(t.crown, w, h)!;
    cg.setTransform(dpr, 0, 0, dpr, -c0 * cw * dpr, -r0 * ch * dpr);
    textCells(cg, ch, this.fontFamily);
    const cr = s.crown;
    let lx = sun.c - s.cx;
    let ly = (sun.r - s.cy) * 1.45;
    const lz = Math.hypot(lx, ly) * (light ? 0.9 : 0.35);
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll;
    ly /= ll;
    const lzn = lz / ll;
    t.block = new Array(cr.n);
    t.turned = new Array(cr.n);
    for (let i = 0; i < cr.n; i++) {
      const c = cr.c[i]!;
      const r = cr.r[i]!;
      const k = cr.colour[i]!;
      const facing = cr.nx[i]! * lx + cr.ny[i]! * ly + cr.nz[i]! * lzn;
      const hh = hash(c, r, s.id);
      const litv = clamp(0.44 + 0.6 * facing + (hh - 0.5) * 0.14 - 0.34 * cr.back[i]!, 0, 1);
      const rimmed = !light && cr.nx[i]! * lx + cr.ny[i]! * ly > 0.55 && cr.back[i]! < 0.6 ? 0.45 * this.palette.rimAlpha * 2 : light && facing > 0.75 ? this.palette.rimAlpha : 0;
      const leaf = (at: number) => (rimmed > 0 ? this.rimRamps[k]![clamp(Math.round(rimmed * RAMP), 0, RAMP)]! : this.leafRamps[k]![clamp(Math.round(at * RAMP), 0, RAMP)]!);
      const hz = (style: string) => (haze ? hazed(this.parse(style)) : style);
      if (cr.edge[i]) {
        cg.fillStyle = hz(leaf(light ? 0.4 + 0.45 * litv : 0.5 + 0.5 * litv));
        this.glyph(cg, EDGE[Math.floor(hh * EDGE.length)]!, c, r);
        t.block[i] = "";
        t.turned[i] = "";
        continue;
      }
      const block = hz(this.leafRamps[k]![Math.round((light ? 0.6 + 0.4 * litv : 0.08 + 0.5 * litv) * RAMP)]!);
      cg.fillStyle = block;
      this.block(cg, c, r);
      const idx = clamp(Math.floor((1 - litv) * (LEAVES.length - 0.01)) + Math.floor(hh * 3) - 1, 0, LEAVES.length - 1);
      cg.fillStyle = hz(leaf(light ? 0.12 + 0.42 * litv : 0.42 + 0.58 * litv));
      this.glyph(cg, LEAVES[idx]!, c, r);
      t.block[i] = block;
      t.turned[i] = hz(this.leafRamps[k]![Math.round((light ? 0.25 + 0.4 * litv : 0.7 + 0.3 * litv) * RAMP)]!);
    }
  }

  /** A style string back to its colour (only at baking, never per frame). */
  private parse(style: string): Rgb {
    const n = parseInt(style.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  draw(wood: Wood) {
    const { ctx, dpr, cols, rows } = this;
    if (cols === 0 || !wood.layout) return;
    const layout = wood.layout;
    if (layout.grid.cols !== cols || layout.grid.rows !== rows) return;
    if (layout !== this.layout) {
      // A new window: the backdrop is painted again with its far trees and floor.
      this.layout = layout;
      this.placeStars(layout);
      this.pileDrawn = new Int16Array(cols).fill(-1);
      this.paintBackground();
      this.stillAt = -Infinity;
    }
    if (this.bakedFor !== layout || this.bakedLook !== this.look) {
      this.bake(layout);
      this.pileDrawn.fill(-1);
      this.mistAt = -Infinity;
      this.stillAt = -Infinity;
    }
    const t = wood.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // Back to front: the trees further back, the mist between them, the big trees in front. What of
    // it holds still is drawn into one layer, again four times a second (the mist drifts, the stars
    // twinkle) and when a tree starts or stops shaking; from the first shaking tree on, it is drawn
    // each frame.
    // The big trees stand apart at the two edges: one shaking is drawn last, so only it is live.
    const shaking = (x: TreeLayers) => wood.shake(x.shape.id).hard > 0;
    const near = this.trees.filter((x) => x.shape.near);
    const order: (TreeLayers | null)[] = [...this.trees.filter((x) => !x.shape.near), null, ...near.filter((x) => !shaking(x)), ...near.filter(shaking)];
    let live = order.findIndex((x) => x && shaking(x));
    if (live < 0) live = order.length;
    const key = order.slice(0, live).map((x) => x?.shape.id ?? "m").join();
    if (key !== this.stillKey || Math.abs(t - this.stillAt) >= MIST_EVERY) {
      this.stillKey = key;
      this.stillAt = t;
      const g = sizeLayer(this.still, this.canvas.width, this.canvas.height)!;
      g.drawImage(this.bg, 0, 0);
      for (let i = 0; i < live; i++) {
        const x = order[i];
        if (x) this.drawTree(g, wood, x, t, false);
        else this.drawMist(g, wood, t);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.still, 0, 0);
    // The stars, never over a tree, twinkling.
    this.drawStars(ctx, t);
    // The big trees' leaves turning in the wind, over them where they stand still.
    for (let i = 0; i < live; i++) if (order[i]?.shape.near) this.turn(ctx, wood, order[i]!, t);
    for (let i = live; i < order.length; i++) {
      const x = order[i];
      if (x) this.drawTree(ctx, wood, x, t, true);
      else this.drawMist(ctx, wood, t);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(ctx, this.ch, this.fontFamily);
    this.drawLantern(wood, t);
    this.drawPile(wood);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(ctx, this.ch, this.fontFamily);
    this.drawWalker(wood);
    this.drawLeaves(wood);
    this.drawFireflies(wood);
  }

  /** The stars, in the sky clear of every tree. */
  private placeStars(layout: WoodLayout) {
    const { width: W, height: H, cw, ch } = this;
    let s = 0x5a7;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    this.stars = [];
    for (let i = Math.round((W * H) / 14000); i > 0; i--) {
      const x = r() * W;
      const y = r() * H * 0.55;
      const rate = 0.5 + r() * 1.6;
      const phase = r() * 6.28;
      const c = x / cw;
      const row = y / ch;
      if (layout.trees.some((t) => c >= t.box.c0 - 1 && c <= t.box.c1 + 1 && row >= t.box.r0 - 1)) continue;
      this.stars.push({ x, y, rate, phase });
    }
  }

  private drawStars(g: Draw2D, t: number) {
    if (!this.starStyles.length) return;
    const { dpr } = this;
    const size = Math.max(1, Math.round(dpr * 1.5));
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let l = 0; l < STAR_LEVELS; l++) {
      g.fillStyle = this.starStyles[l]!;
      for (const s of this.stars) {
        const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
        if (Math.min(STAR_LEVELS - 1, Math.floor(b * STAR_LEVELS)) === l) g.fillRect(Math.round(s.x * dpr), Math.round(s.y * dpr), size, size);
      }
    }
  }

  /** A tree into `g`: its trunk where it stands, its crown swayed by a shake; with `turning`, some
   *  of its leaves turned in the wind too. */
  private drawTree(g: Draw2D, wood: Wood, tree: TreeLayers, t: number, turning: boolean) {
    const { dpr, cw, ch } = this;
    const s = tree.shape;
    const x = s.box.c0 * cw * dpr;
    const y = s.box.r0 * ch * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(tree.trunk, x, y);
    g.drawImage(tree.crown, x + wood.shake(s.id).dx * cw * dpr, y);
    if (turning) this.turn(g, wood, tree, t);
  }

  /** Some of a tree's leaves turned in the wind to show their paler side: more where a gust is, all
   *  over a shaken crown. */
  private turn(g: Draw2D, wood: Wood, tree: TreeLayers, t: number) {
    const { dpr, cw, ch } = this;
    const s = tree.shape;
    const { dx, hard } = wood.shake(s.id);
    g.setTransform(dpr, 0, 0, dpr, dx * cw * dpr, 0);
    textCells(g, ch, this.fontFamily);
    const cr = s.crown;
    const gust = clamp((wood.wind - 16) / 50, 0, 1);
    const slot = t * 2.2;
    for (let i = 0; i < cr.n; i++) {
      if (!tree.block[i]) continue;
      const h = hash(i, s.id, 3);
      // The gust runs across the window: the crowns it is over turn more of their leaves.
      const local = 0.5 + 0.5 * Math.sin(cr.c[i]! * 0.05 - t * 1.3);
      const p = 0.015 + 0.08 * gust * local + 0.45 * hard;
      if (hash(i, Math.floor(slot + h * 9), s.id) >= p) continue;
      g.fillStyle = tree.block[i]!;
      this.block(g, cr.c[i]!, cr.r[i]!);
      g.fillStyle = tree.turned[i]!;
      this.glyph(g, TURNED[Math.floor(h * TURNED.length)]!, cr.c[i]!, cr.r[i]!);
    }
  }

  /** The mist's characters drifting low between the trees, laid again four times a second. */
  private drawMist(g0: Draw2D, wood: Wood, t: number) {
    const { dpr, cols, cw, ch } = this;
    const floor = wood.layout.floor;
    const depth = Math.max(4, Math.round(this.rows * 0.14));
    if (Math.abs(t - this.mistAt) >= MIST_EVERY) {
      this.mistAt = t;
      this.mistTop = floor - depth;
      const g = sizeLayer(this.mistLayer, cols * cw * dpr, (depth + 2) * ch * dpr)!;
      g.setTransform(dpr, 0, 0, dpr, 0, -this.mistTop * ch * dpr);
      textCells(g, ch, this.fontFamily);
      for (let level = 0; level < 3; level++) {
        g.fillStyle = this.mistStyles[level]!;
        for (let r = this.mistTop; r < floor + 2; r++) {
          // Thickest a little above the floor, thinning up and down.
          const v = 1 - Math.abs((r - (floor - depth * 0.3)) / (depth * 0.72));
          if (v <= 0) continue;
          for (let c = 0; c < cols; c++) {
            const d = fbm2(c * 0.055 - t * 0.06, r * 0.3 + t * 0.012, SEED) * (0.55 + 0.45 * v);
            const l = d > 0.52 ? 2 : d > 0.44 ? 1 : d > 0.37 ? 0 : -1;
            if (l === level) this.glyph(g, level === 2 ? "~" : level === 1 ? "-" : ".", c, r);
          }
        }
      }
    }
    g0.setTransform(1, 0, 0, 1, 0, 0);
    g0.drawImage(this.mistLayer, 0, Math.round(this.mistTop * ch * dpr));
  }

  /** At dusk, a lantern hanging from the right-hand tree's low limb, glowing, flickering a little. */
  private drawLantern(wood: Wood, t: number) {
    if (!this.lanternGlow) return;
    const { ctx, cw, ch } = this;
    const { c, r } = wood.layout.lantern;
    const flicker = 0.82 + 0.1 * Math.sin(t * 9.1) + 0.08 * Math.sin(t * 23.7 + 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.6 * flicker;
    const R = cw * 10;
    const x = (c + 0.5) * cw;
    const y = (r + 1.6) * ch;
    ctx.drawImage(this.lanternGlow, x - R, y - R, R * 2, R * 2);
    ctx.restore();
    const [glass, flame, frame] = this.lanternStyles;
    ctx.fillStyle = frame!;
    this.glyph(ctx, "|", c, r);
    this.glyph(ctx, "^", c, r + 1);
    ctx.fillStyle = glass!;
    this.block(ctx, c, r + 2);
    ctx.fillStyle = frame!;
    this.glyph(ctx, "[", c - 1, r + 2);
    this.glyph(ctx, "]", c + 1, r + 2);
    ctx.fillStyle = flame!;
    this.glyph(ctx, flicker > 0.86 ? "*" : "+", c, r + 2);
    ctx.fillStyle = frame!;
    this.glyph(ctx, "-", c, r + 3);
  }

  /** The pile on the floor: each column painted again only when it has changed. */
  private drawPile(wood: Wood) {
    const { ctx, dpr, cols, cw, ch } = this;
    const floor = wood.layout.floor;
    const top = floor - PILE_ROWS;
    if (this.pileTop !== top || this.pileLayer.width !== Math.round(cols * cw * dpr)) {
      this.pileTop = top;
      sizeLayer(this.pileLayer, cols * cw * dpr, PILE_ROWS * ch * dpr);
      this.pileDrawn.fill(-1);
    }
    const g = this.pileLayer.getContext("2d")!;
    let set = false;
    for (let c = 0; c < cols; c++) {
      const halves = Math.round(wood.pile[c]! * 2);
      if (halves === this.pileDrawn[c]) continue;
      this.pileDrawn[c] = halves;
      if (!set) {
        g.setTransform(dpr, 0, 0, dpr, 0, -top * ch * dpr);
        textCells(g, ch, this.fontFamily);
        set = true;
      }
      g.clearRect(c * cw, top * ch, cw, PILE_ROWS * ch);
      for (let k = 0; k * 2 < halves; k++) {
        const r = floor - 1 - k;
        const colour = wood.pileColour[c * PILE_ROWS + k]!;
        const h = hash(c, k, 0x9a1e);
        const ramp = this.leafRamps[colour]!;
        const full = (k + 1) * 2 <= halves;
        // Deeper in the pile, in its own shade; its top catching the light.
        const up = (k + 1) / Math.max(1, halves / 2);
        if (full) {
          g.fillStyle = ramp[Math.round((this.light ? 0.5 + 0.25 * h + 0.1 * up : 0.26 + 0.2 * h + 0.16 * up) * RAMP)]!;
          this.block(g, c, r);
        }
        g.fillStyle = ramp[Math.round((this.light ? 0.15 + 0.25 * h : 0.66 + 0.2 * h + 0.14 * up) * RAMP)]!;
        this.glyph(g, full ? LEAVES[Math.floor(h * 7)]! : EDGE[Math.floor(h * EDGE.length)]!, c, r);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.pileLayer, 0, Math.round(top * ch * dpr));
  }

  /** The fox or deer crossing on the floor, its legs stepping as it goes. */
  private drawWalker(wood: Wood) {
    const w = wood.walker;
    if (!w) return;
    const { ctx, cw, cols, rows } = this;
    const sprite = SPRITES[w.kind];
    const [coat, pale, dark] = this.beastStyles[w.kind];
    const width = Math.max(...sprite.rows.map((r) => r.length));
    const left = Math.round(w.x / cw - width / 2);
    const top = Math.min(rows - 1, wood.layout.floor + 2) - sprite.rows.length + 1;
    const stride = Math.floor(w.gait) % 2 === 1;
    const mirror: Record<string, string> = { "/": "\\", "\\": "/", "(": ")", ")": "(", "<": ">", ">": "<", ",": "," };
    const flip = (g: string) => (w.dir > 0 ? g : mirror[g] ?? g);
    const legRows = sprite.rows.filter((r) => r.includes("L")).length;
    sprite.rows.forEach((row, k) => {
      let leg = 0;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        if (ch === " ") continue;
        const c = left + (w.dir > 0 ? i : width - 1 - i);
        const r = top + k;
        if (ch === "L") leg++;
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const cell = sprite.cells[ch];
        if (cell) {
          ctx.fillStyle = [coat, pale, dark][cell[0]]!;
          this.block(ctx, c, r);
          ctx.fillStyle = cell[1] === "o" ? this.beastInk : this.light ? dark! : this.beastInk;
          this.glyph(ctx, cell[1], c, r);
        } else if (ch === "L") {
          // The lowest row of each leg swings as it strides, the fore and hind legs opposite.
          const lowest = k === sprite.rows.length - 1;
          const g = stride && lowest ? (leg % 2 ? "/" : "\\") : !stride && lowest && legRows > 2 ? "|" : "|";
          ctx.fillStyle = this.light ? dark! : coat!;
          this.glyph(ctx, flip(g), c, r);
        } else {
          ctx.fillStyle = ch === "." || ch === "=" ? this.beastInk : ch === "'" && w.kind === "fox" ? pale! : this.light ? dark! : coat!;
          this.glyph(ctx, flip(ch), c, r);
        }
      }
    });
  }

  /** The leaves in the air, tumbling: grouped by colour, so each colour is set once. */
  private drawLeaves(wood: Wood) {
    const { ctx, cw, ch } = this;
    const leaves = wood.leaves;
    for (let k = 0; k < LEAF_COLOURS.length; k++) {
      ctx.fillStyle = this.leafRamps[k]![Math.round((this.light ? 0.72 : 0.92) * RAMP)]!;
      for (const l of leaves) {
        if (l.colour !== k) continue;
        const frames = TUMBLE[l.shape]!;
        const f = Math.floor((((l.spin % 6.2832) + 6.2832) % 6.2832) / 1.5708) % 4;
        ctx.fillText(frames[f]!, Math.floor(l.x / cw) * cw + cw / 2, Math.floor(l.y / ch) * ch + ch / 2 + 1);
      }
    }
  }

  private drawFireflies(wood: Wood) {
    if (!this.flyGlow) return;
    const { ctx, cw, ch } = this;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of wood.fireflies) {
      const l = wood.fireflyLight(f);
      if (l < 0.05) continue;
      const R = cw * (1.2 + 2.4 * l);
      ctx.globalAlpha = 0.75 * l;
      ctx.drawImage(this.flyGlow, f.x - R, f.y - R, R * 2, R * 2);
    }
    ctx.restore();
    ctx.fillStyle = this.flyStyle;
    for (const f of wood.fireflies) {
      if (wood.fireflyLight(f) < 0.3) continue;
      ctx.fillText(".", Math.floor(f.x / cw) * cw + cw / 2, Math.floor(f.y / ch) * ch + ch / 2 + 1);
    }
  }
}
