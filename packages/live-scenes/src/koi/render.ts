/**
 * Koi Pond's drawing: the water and what swims in it (swim.ts), its koi by their varieties
 * (shapes.ts), pebbles on the bottom and each koi's shadow on it, and over them the surface
 * (pond.ts): rings where something touches it, food floating on it, lily pads, which the koi swim
 * under, and the reeds on the bank.
 *
 * A pad is drawn once into a sprite of its own cells and copied in each frame; it is drawn again
 * when it has turned a step or the look changed. A pad drifts a whole cell at a time, as
 * everything in the scene does. Its round outline and its notch are in the cells' parts, its rim
 * a ring of them in the rim's colour, its veins fine lines out from its middle, and a flower's
 * petals two rings round its heart. The reeds, rushes and cattails are lines from the mud,
 * swaying from the root; the mud is drawn once into a layer.
 */
import { bend, ribbon } from "../blades";
import { fillParts, PART_X, PART_Y, textCells, WHOLE } from "../cells";
import { css, cssAlpha, mix, ramp as rampOf, rgbOf, type Oklch } from "../colour";
import { clamp, hash3, TAU } from "../math";
import { SwimRenderer } from "../swim";
import type { World } from "../world";
import { KOI_PALETTE, type KoiPalette } from "./palette";
import { bankOf, padCell, PadPart, Pond, RIPPLE_LIFE, RIPPLE_SPEED, type Pad, type Reed } from "./pond";
import { KOI_KINDS, KOI_SHAPES } from "./shapes";

/** A pad's grain: sparse, so it reads as a leaf's surface and not as text. */
const LEAF_GLYPHS = ".:'";
const PEBBLE_GLYPHS = "o.,";
const MUD = "~,.'";
/** How far a pad turns before its sprite is drawn again. */
const TURN_STEP = 0.06;
const RIPPLE_LEVELS = 6;

type Style = { block: string; glyph: string };
/** The veins: this many, evenly round the pad from its notch (as `padCell` has them). */
const VEINS = 6;

export class KoiRenderer extends SwimRenderer {
  private pond = new Pond();
  private sprites: ({ canvas: OffscreenCanvas; key: string } | undefined)[] = [];
  private padStyles: Style[] = [];
  private rippleStyles: string[] = [];
  private pebbleStyle = "";
  private shadeStyle = "";
  private pelletStyle = "";
  private reedStyles = { near: "", far: "", leaf: "", head: "", headGlyph: "", mud: "", mudGlyph: "" };
  /** Counted, so a pad's sprite knows it was drawn for another look. */
  private lookVersion = 0;
  private reeds: Reed[] = [];
  /** How many rows deep the bank's mud is in each column. */
  private mud: Uint8Array = new Uint8Array(0);
  /** The reeds' cells that never sway, drawn once into a layer the height of the tallest, again
   *  only when the grid or the look change. */
  private bank = new OffscreenCanvas(1, 1);
  private bankTop = 0;
  private bankFresh = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, { shapes: KOI_SHAPES, kinds: KOI_KINDS, palette: KOI_PALETTE });
  }

  protected looked() {
    this.lookVersion++;
    this.bankFresh = false;
    const palette = this.palette as KoiPalette;
    const p = palette.pond;
    const c = (o: Oklch) => css(rgbOf(o));
    const style = (block: Oklch, glyph: Oklch): Style => ({ block: c(block), glyph: c(glyph) });
    this.padStyles = [
      style(p.pad, p.pad),
      style(p.pad, p.padGlyph),
      { block: c(p.rim), glyph: css(mix(rgbOf(p.rim), rgbOf(p.padGlyph), 0.55)) },
      style(p.pad, p.vein),
      style(p.petal, p.petalGlyph),
      { block: c(p.heart), glyph: css(mix(rgbOf(p.heart), rgbOf(p.petal), 0.6)) },
    ];
    const ring = rampOf(rgbOf(palette.water[1]!), rgbOf(p.ripple));
    this.rippleStyles = Array.from({ length: RIPPLE_LEVELS }, (_, l) => this.tone((0.25 + (0.75 * (l + 1)) / RIPPLE_LEVELS), ring));
    this.pebbleStyle = c(p.pebble);
    this.shadeStyle = cssAlpha(rgbOf(p.shade), p.shadeAlpha);
    this.pelletStyle = c(p.pellet);
    this.reedStyles = {
      near: c(p.reed), far: c(p.reedFar), leaf: c(p.leaf), head: c(p.cattail), headGlyph: css(mix(rgbOf(p.cattail), rgbOf(palette.water[2]!), 0.45)),
      mud: c(p.mud[0]), mudGlyph: c(p.mud[1]),
    };
  }

  protected allocate(n: number) {
    super.allocate(n);
    ({ reeds: this.reeds, mud: this.mud } = bankOf(this.cols, this.rows));
    this.bankFresh = false;
  }

  resize(width: number, height: number, dpr: number) {
    const was = [this.width, this.height];
    super.resize(width, height, dpr);
    if (was[0] !== width || was[1] !== height) this.pond.build(width, height);
    this.sprites = [];
    this.bankFresh = false;
  }

  /** The water, and pebbles on the bottom, here and there, faint. */
  protected paintBackground() {
    super.paintBackground();
    const g = this.bg.getContext("2d");
    if (!g || !this.pebbleStyle) return;
    const { dpr, cols, rows, cw, ch } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(g, ch, this.fontFamily);
    g.fillStyle = this.pebbleStyle;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = hash3(c, r, 0x9eb);
        if (h < 0.022) g.fillText(PEBBLE_GLYPHS[Math.floor((h / 0.022) * PEBBLE_GLYPHS.length)]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
      }
    }
  }

  /** A ring where food lands, where a koi mouths at the surface, and where it eats. */
  protected consumeEvents(world: World) {
    for (const e of world.events) this.pond.ripple(e.x, e.y, e.kind === "mouth" ? 0.6 : e.kind === "drop" ? 0.45 : 0.4);
    super.consumeEvents(world);
  }

  protected advance(dt: number) {
    this.pond.step(dt);
  }

  /** Each koi's shadow on the bottom: down and right of it, by a cell, in the koi's own outline. */
  protected drawUnder() {
    const { ctx, dpr, cols, rows, cw, ch } = this;
    const { flag, parts } = this.raster;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.shadeStyle;
    const last = cols * (rows - 1) - 1;
    for (let i = 0; i < last; i++) {
      if (!flag[i] || i % cols === cols - 1) continue;
      const j = i + cols + 1;
      if (flag[j]) continue;
      fillParts(ctx, j % cols, (j / cols) | 0, cw, ch, dpr, parts[i]!);
    }
  }

  protected drawOver(t: number, world: World) {
    this.drawRipples();
    this.drawFood(world);
    this.drawPads();
    this.drawReeds(t);
  }

  /** Each ring on the water: a fine circle widening and fading, and inside a strong one another. */
  private drawRipples() {
    const { ctx, cw } = this;
    for (const r of this.pond.ripples) {
      const fade = Math.pow(1 - r.age / RIPPLE_LIFE, 1.4) * (0.45 + 0.55 * r.strength);
      if (fade < 0.06) continue;
      ctx.strokeStyle = this.rippleStyles[clamp(Math.floor(fade * RIPPLE_LEVELS), 0, RIPPLE_LEVELS - 1)]!;
      ctx.lineWidth = Math.max(1, cw * 0.15) * (0.6 + 0.4 * fade);
      const radius = 4 + RIPPLE_SPEED * r.age * (0.6 + 0.4 * r.strength);
      ctx.beginPath();
      for (const R of r.strength > 0.6 ? [radius, radius * 0.62] : [radius]) {
        ctx.moveTo(r.x + R, r.y);
        ctx.arc(r.x, r.y, R, 0, TAU);
      }
      ctx.stroke();
    }
  }

  /** The pellets floating where they landed, a koi's mouthful each. */
  private drawFood(world: World) {
    if (!world.food.length) return;
    const { ctx, cw, ch, cols } = this;
    ctx.fillStyle = this.pelletStyle;
    for (const p of world.food) {
      const i = this.cellIndex(p.x, p.y);
      if (i >= 0) ctx.fillText("o", (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
    }
  }

  private drawPads() {
    const { ctx, cw, ch } = this;
    this.pond.pads.forEach((p, k) => {
      const cx = Math.floor(p.x / cw);
      const cy = Math.floor(p.y / ch);
      const rc = Math.ceil(p.r / cw) + 1;
      const rr = Math.ceil(p.r / ch) + 1;
      const w = 2 * rc + 1;
      const h = 2 * rr + 1;
      const turn = Math.round(p.turn / TURN_STEP);
      const key = `${turn}|${this.lookVersion}`;
      let sprite = this.sprites[k];
      if (!sprite || sprite.key !== key) sprite = this.sprites[k] = this.paintPad(p, turn * TURN_STEP, w, h, key, sprite?.canvas);
      ctx.drawImage(sprite.canvas, (cx - rc) * cw, (cy - rr) * ch, w * cw, h * ch);
    });
  }

  private paintPad(p: Pad, turn: number, w: number, h: number, key: string, reuse?: OffscreenCanvas) {
    const { dpr, cw, ch } = this;
    const canvas = reuse ?? new OffscreenCanvas(1, 1);
    const W = Math.ceil(w * cw * dpr);
    const H = Math.ceil(h * ch * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const g = canvas.getContext("2d");
    if (!g) return { canvas, key };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(g, ch, this.fontFamily);
    const shape = { ...p, turn };
    const rc = (w - 1) / 2;
    const rr = (h - 1) / 2;
    const [leaf, grain, rim, vein, petal, heart] = this.padStyles;
    // The leaf and its rim, cell by cell: each of a cell's parts on the pad takes the leaf's colour
    // or the rim's, so the outline, the notch and the ring of the rim are all finer than the cells.
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let on = 0;
        let edge = 0;
        for (let k = 0; k < 6; k++) {
          const part = padCell(shape, (i - rc + PART_X[k]! - 0.5) * cw, (j - rr + PART_Y[k]! - 0.5) * ch, cw);
          if (part === PadPart.None) continue;
          on |= 1 << k;
          if (part === PadPart.Rim) edge |= 1 << k;
        }
        if (!on) continue;
        if (on & ~edge) {
          g.fillStyle = leaf!.block;
          fillParts(g, i, j, cw, ch, dpr, on & ~edge);
        }
        if (edge) {
          g.fillStyle = rim!.block;
          fillParts(g, i, j, cw, ch, dpr, edge);
        }
        // A little grain on the leaf, never on its rim.
        if (on !== WHOLE || edge || hash3(i - rc, j - rr, p.seed + 1) > 0.3) continue;
        g.fillStyle = grain!.glyph;
        g.fillText(LEAF_GLYPHS[Math.floor(hash3(i - rc, j - rr, p.seed) * LEAF_GLYPHS.length)]!, i * cw + cw / 2, j * ch + ch / 2 + 1);
      }
    }
    // The middle of the pad, in the sprite.
    const ox = (rc + 0.5) * cw;
    const oy = (rr + 0.5) * ch;
    // Its veins: fine lines out from near the middle to the rim, between the notch's edges.
    const step = TAU / VEINS;
    g.strokeStyle = vein!.glyph;
    g.lineWidth = Math.max(1, cw * 0.13);
    g.lineCap = "round";
    g.beginPath();
    for (let n = 0; n < VEINS; n++) {
      const a = turn + step / 2 + n * step;
      g.moveTo(ox + Math.cos(a) * cw * 0.9, oy + Math.sin(a) * cw * 0.9);
      g.lineTo(ox + Math.cos(a) * (p.r - cw * 0.9), oy + Math.sin(a) * (p.r - cw * 0.9));
    }
    g.stroke();
    if (p.flower !== null) {
      // A water lily seen from above: an outer ring of petals, an inner one between them, paler,
      // and its golden heart.
      const fx = ox + Math.cos(p.flower) * p.r * 0.45;
      const fy = oy + Math.sin(p.flower) * p.r * 0.45;
      const R = cw * 2;
      const spin = p.seed % 7;
      for (const [ring, colour, reach, size] of [[0, petal!.block, 0.56, 0.5], [0.5, petal!.glyph, 0.34, 0.36]] as const) {
        g.fillStyle = colour;
        g.beginPath();
        for (let n = 0; n < 8; n++) {
          const a = spin + (n + ring) * (TAU / 8);
          g.ellipse(fx + Math.cos(a) * R * reach, fy + Math.sin(a) * R * reach, R * size, R * size * 0.42, a, 0, TAU);
          g.closePath();
        }
        g.fill();
      }
      g.fillStyle = heart!.block;
      g.beginPath();
      g.arc(fx, fy, R * 0.22, 0, TAU);
      g.fill();
    }
    return { canvas, key };
  }

  /** The reeds on the bank: the mud from its layer, drawn again first if anything changed, and
   *  every plant where the breeze has it: a stem from the mud, thinning to its tip; a reed's leaves
   *  arching out from it, a cattail's standing by it; a cattail's head, a dark spike a little below
   *  its tip. Those further back first, paler and thinner. One fill a colour. */
  private drawReeds(t: number) {
    const { ctx, dpr, cw, ch } = this;
    if (!this.bankFresh) this.paintBank();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bank, 0, Math.round(this.bankTop * ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const far = new Path2D();
    const near = new Path2D();
    const leaves = new Path2D();
    const heads = new Path2D();
    const at = (reed: Reed, k: number) => [(reed.c + 0.5 + bend(reed, k, t)) * cw, (reed.foot + 1 - k) * ch] as const;
    for (const reed of this.reeds) {
      ribbon(reed.far ? far : near, reed, t, cw, ch, cw * (reed.far ? 0.16 : 0.24), cw * 0.04);
      if (reed.kind === "cattail") {
        const [x0, y0] = at(reed, reed.height - 4);
        const [x1, y1] = at(reed, reed.height - 1.3);
        heads.moveTo(x0, y0);
        heads.lineTo(x1, y1);
      }
      if (reed.far) continue;
      for (const l of reed.leaves) {
        const [x, y] = at(reed, l.k);
        const len = l.length;
        // A cattail's leaf stands close up by its stalk; a reed's arches out and bends over.
        const [ex, ey, cx, cy] = reed.kind === "cattail"
          ? [x + l.side * cw * 0.9, y - ch * 2.6, x + l.side * cw * 0.2, y - ch * 1.4]
          : [x + l.side * len * cw * 1.25, y - len * ch * 0.45, x + l.side * len * cw * 0.35, y - len * ch * 1.25];
        bladeLeaf(leaves, x, y, cx, cy, ex, ey, cw * 0.22);
      }
    }
    ctx.fillStyle = this.reedStyles.far;
    ctx.fill(far);
    ctx.fillStyle = this.reedStyles.near;
    ctx.fill(near);
    ctx.fillStyle = this.reedStyles.leaf;
    ctx.fill(leaves);
    ctx.strokeStyle = this.reedStyles.head;
    ctx.lineWidth = cw * 0.62;
    ctx.lineCap = "round";
    ctx.stroke(heads);
  }

  private paintBank() {
    const { dpr, cols, cw, ch } = this;
    this.bankFresh = true;
    let top = this.rows - 1;
    for (let c = 0; c < cols; c++) top = Math.min(top, this.rows - this.mud[c]!);
    this.bankTop = top = Math.max(0, top);
    const w = Math.max(1, Math.round(cols * cw * dpr));
    const h = Math.max(1, Math.round((this.rows - top) * ch * dpr));
    if (this.bank.width !== w || this.bank.height !== h) {
      this.bank.width = w;
      this.bank.height = h;
    }
    const g = this.bank.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, -top * ch * dpr);
    textCells(g, ch, this.fontFamily);
    // The mud the plants stand in, in the corners: blocks meeting with no seam, its top a step
    // down where the next column's is lower, a character on some.
    for (let c = 0; c < cols; c++) {
      const deep = this.mud[c]!;
      for (let k = 0; k < deep; k++) {
        const r = this.rows - 1 - k;
        const lower = Math.min(this.mud[c - 1] ?? deep, this.mud[c + 1] ?? deep) <= k;
        g.fillStyle = this.reedStyles.mud;
        fillParts(g, c, r, cw, ch, dpr, k === deep - 1 && lower ? 60 : WHOLE);
        const h = hash3(c, r, 0x3ad);
        if (h > 0.35 || k === deep - 1) continue;
        g.fillStyle = this.reedStyles.mudGlyph;
        g.fillText(MUD[Math.floor((h / 0.35) * MUD.length)]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
      }
    }
  }
}

/** A leaf into `path`: from its foot (`x`, `y`) along a curve bowed toward (`cx`, `cy`) to its tip
 *  (`ex`, `ey`), widest a third of the way, `wide` across. */
function bladeLeaf(path: Path2D, x: number, y: number, cx: number, cy: number, ex: number, ey: number, wide: number) {
  const dx = ex - x;
  const dy = ey - y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * wide;
  const ny = (dx / len) * wide;
  path.moveTo(x, y);
  path.quadraticCurveTo(cx + nx, cy + ny, ex, ey);
  path.quadraticCurveTo(cx - nx, cy - ny, x, y);
  path.closePath();
}
