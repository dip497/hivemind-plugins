/**
 * Koi Pond's drawing: the water and what swims in it (swim.ts), its koi by their varieties
 * (shapes.ts), pebbles on the bottom and each koi's shadow on it, and over them the surface
 * (pond.ts): rings where something touches it, food floating on it, lily pads, which the koi swim
 * under, and the reeds on the bank.
 *
 * A pad is drawn once into a sprite of its own cells and copied in each frame; it is drawn again
 * when it has turned a step or the look changed. A pad drifts a whole cell at a time, as
 * everything in the scene does. The reeds' cells that never sway are drawn once into a layer.
 */
import { leanGlyph, still, sway } from "../blades";
import { textCells, type Draw2D } from "../cells";
import { css, cssAlpha, mix, ramp as rampOf, rgbOf, type Oklch } from "../colour";
import { clamp, hash3, TAU } from "../math";
import { FLAG_EDGE } from "../spine";
import { SwimRenderer } from "../swim";
import type { World } from "../world";
import { KOI_PALETTE, type KoiPalette } from "./palette";
import { bankOf, padCell, PadPart, Pond, RIPPLE_LIFE, RIPPLE_SPEED, type Pad, type Reed } from "./pond";
import { KOI_KINDS, KOI_SHAPES } from "./shapes";

const LEAF_GLYPHS = "o08%t";
const RIM_GLYPHS = ":.";
const PEBBLE_GLYPHS = "o.,";
const RUSH_TIPS = "',`";
const MUD = "~,.'";
/** How far a pad turns before its sprite is drawn again. */
const TURN_STEP = 0.06;
const RIPPLE_LEVELS = 6;

type Style = { block: string; glyph: string };

/** A line out from a pad's middle, drawn along its direction. */
function veinGlyph(dx: number, dy: number) {
  const a = ((Math.atan2(dy, dx) % Math.PI) + Math.PI) % Math.PI;
  return a < Math.PI / 8 || a > (7 * Math.PI) / 8 ? "-" : a < (3 * Math.PI) / 8 ? "\\" : a < (5 * Math.PI) / 8 ? "|" : "/";
}

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
  /** Cells a ring has lit this frame: two rings meeting light a cell once. */
  private rung = new Uint32Array(0);
  private ringFrame = 0;
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
    this.rung = new Uint32Array(n);
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

  /** Each koi's shadow on the bottom: down and right of it, by a cell. */
  protected drawUnder() {
    const { ctx, dpr, cols, rows, cw, ch } = this;
    const flag = this.raster.flag;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.shadeStyle;
    const last = cols * (rows - 1) - 1;
    for (let i = 0; i < last; i++) {
      const f = flag[i];
      if (!f || f === FLAG_EDGE || i % cols === cols - 1) continue;
      const j = i + cols + 1;
      if (flag[j]) continue;
      ctx.fillRect((j % cols) * cw, ((j / cols) | 0) * ch, cw, ch);
    }
  }

  protected drawOver(t: number, world: World) {
    this.drawRipples();
    this.drawFood(world);
    this.drawPads();
    this.drawReeds(t);
  }

  private drawRipples() {
    const { ctx, cw, rung } = this;
    const frame = ++this.ringFrame;
    for (const r of this.pond.ripples) {
      const fade = Math.pow(1 - r.age / RIPPLE_LIFE, 1.4) * (0.45 + 0.55 * r.strength);
      if (fade < 0.06) continue;
      ctx.fillStyle = this.rippleStyles[clamp(Math.floor(fade * RIPPLE_LEVELS), 0, RIPPLE_LEVELS - 1)]!;
      const glyph = fade > 0.5 ? "o" : ".";
      const radius = 4 + RIPPLE_SPEED * r.age * (0.6 + 0.4 * r.strength);
      // A strong ring has another inside it.
      for (const R of r.strength > 0.6 ? [radius, radius * 0.62] : [radius]) {
        const steps = Math.max(8, Math.ceil((TAU * R) / (cw * 0.8)));
        for (let s = 0; s < steps; s++) {
          const a = (s / steps) * TAU;
          const i = this.cellIndex(r.x + Math.cos(a) * R, r.y + Math.sin(a) * R);
          if (i < 0 || rung[i] === frame) continue;
          rung[i] = frame;
          ctx.fillText(glyph, (i % this.cols) * cw + cw / 2, ((i / this.cols) | 0) * this.ch + this.ch / 2 + 1);
        }
      }
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
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = (i - rc) * cw;
        const dy = (j - rr) * ch;
        const part = padCell(shape, dx, dy, cw);
        if (part === PadPart.None) continue;
        const style = this.padStyles[part]!;
        g.fillStyle = style.block;
        g.fillRect(i * cw + 1, j * ch + 1, cw - 1, ch - 1);
        const glyph =
          part === PadPart.Vein ? veinGlyph(dx, dy)
          : part === PadPart.Rim ? RIM_GLYPHS[Math.floor(hash3(i - rc, j - rr, p.seed) * RIM_GLYPHS.length)]!
          : part === PadPart.Petal ? "*"
          : part === PadPart.Heart ? "o"
          : hash3(i - rc, j - rr, p.seed + 1) < 0.55 ? LEAF_GLYPHS[Math.floor(hash3(i - rc, j - rr, p.seed) * LEAF_GLYPHS.length)]! : "";
        if (!glyph) continue;
        g.fillStyle = style.glyph;
        g.fillText(glyph, i * cw + cw / 2, j * ch + ch / 2 + 1);
      }
    }
    return { canvas, key };
  }

  /** The reeds on the bank: their cells that never sway from their layer, drawn again first if
   *  anything changed, and the rest where the breeze has them. */
  private drawReeds(t: number) {
    const { ctx, dpr, ch } = this;
    if (!this.bankFresh) this.paintBank();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bank, 0, Math.round(this.bankTop * ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const reed of this.reeds) {
      const from = still(reed);
      let below = sway(reed, from - 1, t);
      for (let k = from; k < reed.height; k++) {
        const off = sway(reed, k, t);
        this.reedCell(ctx, reed, k, reed.c + off, off - below);
        below = off;
      }
    }
  }

  /** The `k`th cell up a plant on the bank, in column `c`, `lean` cells over from the cell below:
   *  its stem bare, its tip fine; a reed's leaves arching out from it, a cattail's standing by it;
   *  and a cattail's head, a dark block three cells long, a little below its tip. */
  private reedCell(g: Draw2D, reed: Reed, k: number, c: number, lean: number) {
    const { cols, cw, ch } = this;
    const r = reed.foot - k;
    if (r < 0 || c < 0 || c >= cols || r >= this.rows) return;
    const x = c * cw;
    const y = r * ch;
    const styles = this.reedStyles;
    if (reed.kind === "cattail" && k < reed.height - 1 && k >= reed.height - 4) {
      g.fillStyle = styles.head;
      g.fillRect(x + 2, y + 1, cw - 3, ch - 1);
      g.fillStyle = styles.headGlyph;
      g.fillText(k === reed.height - 2 ? "\"" : ":", x + cw / 2, y + ch / 2 + 1);
      return;
    }
    g.fillStyle = reed.far ? styles.far : styles.near;
    const glyph = k === reed.height - 1 ? (reed.kind === "cattail" ? "|" : RUSH_TIPS[(reed.c + reed.height) % RUSH_TIPS.length]!) : leanGlyph(lean, reed.kind === "rush" ? "!" : "|");
    g.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
    if (reed.far) return;
    g.fillStyle = styles.leaf;
    for (const leaf of reed.leaves) {
      if (leaf.k !== k) continue;
      // Out and up from the stem, a cell further each cell along, its tip bending over.
      for (let n = 1; n <= leaf.length; n++) {
        const lc = c + leaf.side * n;
        const lr = r - n + 1;
        if (lc < 0 || lc >= cols || lr < 0) continue;
        g.fillText(n === leaf.length && leaf.length > 1 ? (leaf.side > 0 ? "," : ".") : leaf.side > 0 ? "/" : "\\", lc * cw + cw / 2, lr * ch + ch / 2 + 1);
      }
    }
  }

  private paintBank() {
    const { dpr, cols, cw, ch } = this;
    this.bankFresh = true;
    let top = this.rows - 3;
    for (const reed of this.reeds) top = Math.min(top, reed.foot - still(reed) + 1);
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
    // The mud the plants stand in, in the corners: a block in each cell, a character on some.
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < this.mud[c]!; k++) {
        const r = this.rows - 1 - k;
        g.fillStyle = this.reedStyles.mud;
        g.fillRect(c * cw + 1, r * ch + 1, cw - 1, ch - 1);
        const h = hash3(c, r, 0x3ad);
        if (h > 0.45) continue;
        g.fillStyle = this.reedStyles.mudGlyph;
        g.fillText(MUD[Math.floor((h / 0.45) * MUD.length)]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
      }
    }
    for (const reed of this.reeds) {
      let below = 0;
      for (let k = 0; k < still(reed); k++) {
        const off = sway(reed, k, 0);
        this.reedCell(g, reed, k, reed.c + off, off - below);
        below = off;
      }
    }
  }
}
