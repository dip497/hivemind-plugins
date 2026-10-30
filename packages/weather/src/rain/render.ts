/**
 * Rain on Glass's drawing. Behind the glass, the city's lights (city.ts) as soft discs, painted
 * twice per size and look: once as seen through clear glass, and once through condensation (wider,
 * softer, under a haze). On the glass, a cell at a time, a layer kept painted: each cell is the
 * clear view mixed with the fogged one by how fogged that cell is, under a grain of condensation or
 * the cell's bead of water. A step changes few cells (a drop's line, the finger's path fogging back),
 * so a frame paints only the cells whose look changed, copies the layer in, and draws the running
 * drops and their wet streaks over it, and a tap's ring.
 *
 * A drop is a lens: it shows the light behind it as a bright point of that light's colour (by
 * night) or as ink with that light's tint (by day), so the beads glitter amber by the lamps and pink
 * by the signs. Behind condensation a drop is dimmed toward the haze.
 */
import { textCells, type Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { SkyRenderer, paintSky } from "../sky";
import { clamp, hash3, smooth } from "../util";
import { cityOf, farEnd, lightIndex, type City } from "./city";
import { STREAK, TAP, type Glass } from "./glass";
import { LIGHTS, RAIN_PALETTE, type RainPalette } from "./palette";

/** Condensation levels a cell is drawn at: how much of the fogged view shows at each, and how much
 *  of a level's cells carry a grain. */
const FOG_MIX = [0, 0.42, 0.7, 0.9, 1];
const GRAIN_SHARE = [0, 0.16, 0.3, 0.44, 0.56];
const FOG_LEVELS = FOG_MIX.length;
/** How far a drop is dimmed toward the haze, by its cell's condensation. */
const FOG_DIM = [0, 0.1, 0.18, 0.26, 0.34];
/** Lens levels: how bright a light behind makes a drop. */
const LENS = 4;
const NEUTRAL = LIGHTS.indexOf("shade");
const FAMILIES = LIGHTS.length;
/** Bead sizes (px on 8 px cells) at which a drop is drawn bigger. */
const SIZES = [1.1, 2.0, 2.9];
const GLYPHS: readonly (readonly string[])[] = [[], [".", ".", "'", ","], ["·", "°", "·"], ["o", "o", "°"], ["o"]];
const GRAINS_THIN = [".", ",", "'", "."];
const GRAINS_THICK = [".", "·", ":", "'", ",", "·"];
const TRAIL_GLYPHS = ["|", "|", ":", ":", "'", "'", ".", "."];

const fogLevel = (f: number) => (f < 0.1 ? 0 : f < 0.3 ? 1 : f < 0.55 ? 2 : f < 0.8 ? 3 : 4);

export class RainRenderer extends SkyRenderer<RainPalette> {
  /** The city through condensation: the bg (CellRenderer's) is the city through clear glass. */
  private fogged = new OffscreenCanvas(1, 1);
  /** The glass as last painted, a cell at a time, and what each cell was painted as. */
  private glass = new OffscreenCanvas(1, 1);
  private glassFor = -1;
  private painted = new Uint8Array(0);
  private city: City = { lights: [], buildings: [] };
  /** The light behind each cell: which kind (or none), and how bright, as a drop would show it. */
  private lensKind = new Uint8Array(0);
  private lensLevel = new Uint8Array(0);
  private discs: OffscreenCanvas[] = [];
  private blobs: OffscreenCanvas[] = [];
  /** A drop's colour by its light, its brightness and its cell's condensation. */
  private dropStyles: string[] = [];
  private grainStyles: string[] = [];
  private blockStyles: string[] = [];
  private ringStyles: string[] = [];
  private buildingStyle = "";
  /** A frame's running drops, sorted by colour before they are drawn. */
  private q = { n: 0, style: new Int16Array(0), x: new Float32Array(0), y: new Float32Array(0), glyph: [] as string[], block: new Uint8Array(0), order: new Int32Array(0) };

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, RAIN_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.glassFor = -1;
    this.discs = LIGHTS.map((k) => disc(rgbOf(p.lights[k]), false));
    this.blobs = LIGHTS.map((k) => disc(rgbOf(p.lights[k]), true));
    const haze = rgbOf(p.veil.colour);
    const drop = rgbOf(p.drop);
    const glint = rgbOf(p.glint);
    this.dropStyles = [];
    for (let f = 0; f < FAMILIES; f++) {
      for (let l = 0; l < LENS; l++) {
        const base = f === NEUTRAL ? mix(drop, glint, l * 0.12) : mix(drop, rgbOf(p.lens[LIGHTS[f]!]), 0.35 + (0.65 * l) / (LENS - 1));
        for (let q = 0; q < FOG_LEVELS; q++) this.dropStyles.push(css(mix(base, haze, FOG_DIM[q]!)));
      }
    }
    const grain = rgbOf(p.grain.colour);
    this.grainStyles = FOG_MIX.map((_, q) => cssAlpha(grain, p.grain.alpha * [0, 0.5, 0.7, 0.85, 1][q]!));
    this.blockStyles = LIGHTS.map((k, f) => cssAlpha(f === NEUTRAL ? drop : mix(drop, rgbOf(p.lens[k]), 0.4), this.light ? 0.28 : 0.4));
    this.buildingStyle = css(rgbOf(p.building));
    this.ringStyles = [0.25, 0.5, 0.75, 1].map((a) => cssAlpha(glint, a * (this.light ? 0.9 : 0.75)));
  }

  /** The city through clear glass (into the bg), through condensation (into `fogged`), and what
   *  each cell's drop would show of it. */
  protected paintScenery(g: Draw2D) {
    const { width: W, height: H, dpr, cw, ch, cols, rows } = this;
    const p = this.palette;
    this.city = cityOf(W, H);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paintBuildings(g, 7);
    for (const b of this.city.lights) {
      g.globalAlpha = b.a * p.clearAlpha;
      g.drawImage(this.discs[lightIndex(b.kind)]!, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    g.globalAlpha = 1;
    if (this.fogged.width !== this.bg.width || this.fogged.height !== this.bg.height) {
      this.fogged.width = this.bg.width;
      this.fogged.height = this.bg.height;
    }
    const f = this.fogged.getContext("2d");
    if (f) {
      paintSky(f, W, H, cw, ch, dpr, p);
      f.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.paintBuildings(f, 18);
      for (const b of this.city.lights) {
        const r = b.r * 1.9;
        f.globalAlpha = b.a * p.fogAlpha;
        f.drawImage(this.blobs[lightIndex(b.kind)]!, b.x - r, b.y - r, r * 2, r * 2);
      }
      f.globalAlpha = p.veil.alpha;
      f.fillStyle = css(rgbOf(p.veil.colour));
      f.fillRect(0, 0, W, H);
      f.globalAlpha = 1;
    }
    // A drop shows the brightest light near enough behind it.
    const n = cols * rows;
    if (this.lensKind.length !== n) {
      this.lensKind = new Uint8Array(n);
      this.lensLevel = new Uint8Array(n);
      this.painted = new Uint8Array(n);
    }
    const strength = new Float32Array(n);
    this.lensKind.fill(NEUTRAL);
    this.lensLevel.fill(0);
    for (const b of this.city.lights) {
      if (b.kind === "shade") continue;
      const reach = b.r * 1.3;
      const c0 = Math.max(0, Math.floor((b.x - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((b.x + reach) / cw));
      const r0 = Math.max(0, Math.floor((b.y - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((b.y + reach) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const d = Math.hypot((c + 0.5) * cw - b.x, (r + 0.5) * ch - b.y) / reach;
          if (d >= 1) continue;
          const w = b.a * (1 - smooth(0.55, 1, d));
          const i = r * cols + c;
          if (w <= strength[i]!) continue;
          strength[i] = w;
          if (w < 0.15) continue;
          this.lensKind[i] = lightIndex(b.kind);
          this.lensLevel[i] = clamp(Math.floor(w * LENS), 0, LENS - 1);
        }
      }
    }
  }

  /** The buildings, as a lens out of focus shows them: soft-edged blocks, `blur` px soft. */
  private paintBuildings(g: Draw2D, blur: number) {
    const s = Math.min(this.width, this.height) / 900;
    g.save();
    g.filter = `blur(${(blur * s).toFixed(1)}px)`;
    g.fillStyle = this.buildingStyle;
    for (const b of this.city.buildings) g.fillRect(b.x0, b.top, b.x1 - b.x0, this.height * 1.1 - b.top);
    g.restore();
  }

  private dropStyle(i: number, boost: number, q: number) {
    const f = this.lensKind[i]!;
    const l = f === NEUTRAL ? clamp(boost, 0, LENS - 1) : clamp(this.lensLevel[i]! + boost, 0, LENS - 1);
    return (f * LENS + l) * FOG_LEVELS + q;
  }

  /** What a bead of radius `r` is drawn as: 0 none, up to 4 the biggest. */
  private sizeOf(r: number, scale: number) {
    if (!r) return 0;
    return r < SIZES[0]! * scale ? 1 : r < SIZES[1]! * scale ? 2 : r < SIZES[2]! * scale ? 3 : 4;
  }

  draw(sim: Glass) {
    const { ctx, dpr, cols, rows } = this;
    if (cols === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (sim.cols !== cols || sim.rows !== rows) {
      ctx.drawImage(this.bg, 0, 0);
      return;
    }
    this.paintGlass(sim);
    ctx.drawImage(this.glass, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawTraffic(sim);
    textCells(ctx, this.ch, this.fontFamily);
    this.drawRunners(sim);
    this.drawTaps(sim);
  }

  /** The glass layer: all of it after a new size or look, else only the cells whose condensation
   *  level or bead changed since they were painted. */
  private paintGlass(sim: Glass) {
    const { cols, rows, dpr, ch } = this;
    const n = cols * rows;
    const full = this.glassFor !== this.bgVersion;
    let g: Draw2D | null;
    if (full) {
      if (this.glass.width !== this.bg.width || this.glass.height !== this.bg.height) {
        this.glass.width = this.bg.width;
        this.glass.height = this.bg.height;
      }
      g = this.glass.getContext("2d");
      if (!g) return;
      this.glassFor = this.bgVersion;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(this.bg, 0, 0);
      // The fogged view over each level's cells at once, through a clip of their rectangles.
      const paths = FOG_MIX.map(() => new Path2D());
      for (let i = 0; i < n; i++) {
        const q = fogLevel(sim.fog[i]!);
        if (!q) continue;
        const { x, y, w, h } = this.cellRect(i % cols, Math.floor(i / cols));
        paths[q]!.rect(x, y, w, h);
      }
      for (let q = 1; q < FOG_LEVELS; q++) {
        g.save();
        g.clip(paths[q]!);
        g.globalAlpha = FOG_MIX[q]!;
        g.drawImage(this.fogged, 0, 0);
        g.restore();
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      textCells(g, ch, this.fontFamily);
      for (let q = 1; q < FOG_LEVELS; q++) {
        g.fillStyle = this.grainStyles[q]!;
        for (let i = 0; i < n; i++) if (!sim.bead[i] && fogLevel(sim.fog[i]!) === q) this.grain(g, i, q);
      }
      const style = new Int16Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const size = this.sizeOf(sim.bead[i]!, sim.scale);
        const q = fogLevel(sim.fog[i]!);
        this.painted[i] = q * 8 + size;
        if (size) style[i] = this.dropStyle(i, size - 2, q);
      }
      this.bucketed(style, (i) => this.bead(g!, i, this.sizeOf(sim.bead[i]!, sim.scale)), g);
      return;
    }
    g = this.glass.getContext("2d");
    if (!g) return;
    let font = false;
    for (let i = 0; i < n; i++) {
      const size = this.sizeOf(sim.bead[i]!, sim.scale);
      const q = fogLevel(sim.fog[i]!);
      const sig = q * 8 + size;
      if (sig === this.painted[i]) continue;
      this.painted[i] = sig;
      const { x, y, w, h } = this.cellRect(i % cols, Math.floor(i / cols));
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(this.bg, x, y, w, h, x, y, w, h);
      if (q) {
        g.globalAlpha = FOG_MIX[q]!;
        g.drawImage(this.fogged, x, y, w, h, x, y, w, h);
        g.globalAlpha = 1;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!font) {
        textCells(g, ch, this.fontFamily);
        font = true;
      }
      if (size) {
        g.fillStyle = this.dropStyles[this.dropStyle(i, size - 2, q)]!;
        this.bead(g, i, size);
      } else if (q) {
        g.fillStyle = this.grainStyles[q]!;
        this.grain(g, i, q);
      }
    }
  }

  /** Cells by their style, each style set once: `style[i]` is -1 for none. */
  private bucketed(style: Int16Array, each: (i: number) => void, g: Draw2D) {
    const counts = new Int32Array(this.dropStyles.length + 1);
    for (const s of style) if (s >= 0) counts[s + 1]!++;
    for (let s = 1; s < counts.length; s++) counts[s]! += counts[s - 1]!;
    const order = new Int32Array(counts[counts.length - 1]!);
    const at = counts.slice();
    style.forEach((s, i) => { if (s >= 0) order[at[s]!++] = i; });
    let last = -1;
    for (const i of order) {
      if (style[i] !== last) {
        last = style[i]!;
        g.fillStyle = this.dropStyles[last]!;
      }
      each(i);
    }
  }

  private grain(g: Draw2D, i: number, q: number) {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    const h = hash3(c, r, 21);
    if (h >= GRAIN_SHARE[q]!) return;
    const set = q >= 3 ? GRAINS_THICK : GRAINS_THIN;
    g.fillText(set[Math.floor((h / GRAIN_SHARE[q]!) * set.length)]!, (c + 0.5) * this.cw, (r + 0.5) * this.ch + 1);
  }

  private bead(g: Draw2D, i: number, size: number) {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    const set = GLYPHS[size]!;
    g.fillText(set[Math.floor(hash3(c, r, 9) * set.length)]!, (c + 0.5) * this.cw, (r + 0.5) * this.ch + 1);
  }

  /** The running drops: each its wet streak up the cells it came down, brightest nearest it, and
   *  its head, a block of its body under the biggest; a drop shivering after a tap jumps a cell side
   *  to side. Sorted by colour, each colour set once. */
  private drawRunners(sim: Glass) {
    const { ctx, cols, cw, ch } = this;
    const most = sim.runners.length * (STREAK + 1);
    const q = this.q;
    if (q.style.length < most) {
      const m = Math.max(most, 512);
      q.style = new Int16Array(m);
      q.x = new Float32Array(m);
      q.y = new Float32Array(m);
      q.block = new Uint8Array(m);
      q.order = new Int32Array(m);
    }
    q.n = 0;
    const push = (style: number, x: number, y: number, glyph: string, block: number) => {
      q.style[q.n] = style;
      q.x[q.n] = x;
      q.y[q.n] = y;
      q.glyph[q.n] = glyph;
      q.block[q.n] = block;
      q.n++;
    };
    for (const d of sim.runners) {
      const shake = d.shiver > 0 ? (Math.floor(sim.time * 26 + d.id) % 2 ? 1 : -1) : 0;
      const c = clamp(Math.floor(d.x / cw) + shake, 0, cols - 1);
      const r = Math.floor(d.y / ch);
      if (r < 0 || r >= this.rows) continue;
      const i = r * cols + c;
      const big = d.r > cw * 0.55 ? 1 + this.lensKind[i]! : 0;
      push(this.dropStyle(i, 2, fogLevel(sim.fog[i]!)), (c + 0.5) * cw, (r + 0.5) * ch + 1, "o", big);
      for (let k = 1; k < d.pathN; k++) {
        const j = d.path[k]!;
        if (j === i || sim.bead[j]) continue;
        push(this.dropStyle(j, 1 - (k >> 1), fogLevel(sim.fog[j]!)), ((j % cols) + 0.5) * cw, (Math.floor(j / cols) + 0.5) * ch + 1, TRAIL_GLYPHS[k - 1]!, 0);
      }
    }
    for (let k = 0; k < q.n; k++) {
      if (!q.block[k]) continue;
      ctx.fillStyle = this.blockStyles[q.block[k]! - 1]!;
      ctx.fillRect(q.x[k]! - cw / 2 + 1, q.y[k]! - 1 - ch / 2 + 1, cw - 1, ch - 1);
    }
    // A counting sort of the frame's characters by colour.
    const counts = new Int32Array(this.dropStyles.length + 1);
    for (let k = 0; k < q.n; k++) counts[q.style[k]! + 1]!++;
    for (let s = 1; s < counts.length; s++) counts[s]! += counts[s - 1]!;
    for (let k = 0; k < q.n; k++) q.order[counts[q.style[k]!]!++] = k;
    let last = -1;
    for (let o = 0; o < q.n; o++) {
      const k = q.order[o]!;
      if (q.style[k] !== last) {
        last = q.style[k]!;
        ctx.fillStyle = this.dropStyles[last]!;
      }
      ctx.fillText(q.glyph[k]!, q.x[k]!, q.y[k]!);
    }
  }

  /** The cars down the street: a pair of soft lights each, headlights coming nearer and growing,
   *  tail lights going away and shrinking, at the street's level, blurred behind the glass. */
  private drawTraffic(sim: Glass) {
    const { ctx, width: W, height: H } = this;
    const end = farEnd(W, H);
    const s = Math.min(W, H) / 900;
    const p = this.palette;
    for (const c of sim.cars) {
      const k = Math.pow(c.z, 0.7);
      const x = W * (0.5 + c.lane * (1 - k)) * (1 - k) + end.x * k;
      const y = H * 0.84 * (1 - k) + (end.y + 6 * s) * k;
      const r = (30 * (1 - k) + 6 * k) * s * 1.4;
      ctx.globalAlpha = p.clearAlpha * 0.75 * (0.5 + 0.5 * (1 - k)) * Math.min(1, (1 - c.z) * 8, c.z * 12 + 0.3);
      const sprite = this.blobs[lightIndex(c.coming ? "warm" : "red")]!;
      for (const side of [-1, 1]) ctx.drawImage(sprite, x + side * r * 0.8 - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  /** A tap's ring: the glass trembling outward from it, fading. */
  private drawTaps(sim: Glass) {
    const { ctx, cw, ch } = this;
    for (const t of sim.taps) {
      const k = t.age / (TAP.life * 0.6);
      if (k >= 1) continue;
      const rho = TAP.reach * sim.scale * (1 - (1 - k) ** 2);
      ctx.fillStyle = this.ringStyles[clamp(Math.floor((1 - k) * 4), 0, 3)]!;
      const n = Math.max(8, Math.ceil((Math.PI * 2 * rho) / cw));
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2;
        const c = Math.floor((t.x + Math.cos(a) * rho) / cw);
        const r = Math.floor((t.y + Math.sin(a) * rho * 0.85) / ch);
        ctx.fillText(k < 0.4 ? "·" : ".", (c + 0.5) * cw, (r + 0.5) * ch + 1);
      }
    }
  }
}

/** A light out of focus, in one colour: through clear glass a disc, even across with a soft edge and
 *  a faintly brighter rim, as a lens blurs a point of light; through condensation a soft blob. */
function disc(colour: Rgb, soft: boolean, size = 128): OffscreenCanvas {
  const sprite = new OffscreenCanvas(size, size);
  const g = sprite.getContext("2d");
  if (!g) return sprite;
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  if (soft) {
    grad.addColorStop(0, cssAlpha(colour, 0.9));
    grad.addColorStop(0.35, cssAlpha(colour, 0.62));
    grad.addColorStop(0.7, cssAlpha(colour, 0.2));
    grad.addColorStop(1, cssAlpha(colour, 0));
  } else {
    grad.addColorStop(0, cssAlpha(colour, 0.78));
    grad.addColorStop(0.72, cssAlpha(colour, 0.86));
    grad.addColorStop(0.88, cssAlpha(colour, 1));
    grad.addColorStop(0.95, cssAlpha(colour, 0.55));
    grad.addColorStop(1, cssAlpha(colour, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return sprite;
}
