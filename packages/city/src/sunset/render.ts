/**
 * Sunset Drive's drawing, in half blocks: each character cell is two square pixels, an upper and a
 * lower, as a terminal draws a picture with the half-block character. The picture is made at that
 * resolution each frame, in a buffer of whole pixels (the sky laid once per size and look, its
 * gradient banded and dithered on a 4×4 pattern; then the stars, the sun and its glow, the ranges,
 * the grid floor, the palms and cacti, the pulses), put in a small canvas, and drawn up to the
 * window with no smoothing, so each pixel is a sharp half of its cell, with no seam between any two.
 */
import { SceneRenderer } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Oklch, type Rgb } from "../colour";
import { clamp, seeded } from "../util";
import { GRID_X, GRID_Z, LEAN_X, PULSE_LIFE, type Drive, type Roadside } from "./drive";
import { SUNSET_PALETTE, type SunsetPalette } from "./palette";


/** A 4×4 ordered dither: the threshold at each pixel of the pattern. */
const BAYER = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16);
/** The ranges, far to near: how far off (how much the lean moves them), how high they rise at most
 *  (a share of the window), and how low they dip in the middle where the sun goes down. */
export const RANGES = [{ z: 25, high: 0.21, dip: 0.5 }, { z: 6, high: 0.15, dip: 0.3 }, { z: 3, high: 0.095, dip: 0.14 }] as const;
/** Bands in the sky's gradient, the sun's, and the steps from the floor to its grid. */
const SKY_BANDS = 28;
const SUN_BANDS = 10;
const LEVELS = 8;

/** sRGB as one 32-bit pixel of an ImageData (little-endian RGBA). */
const pack = ([r, g, b]: Rgb) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
/** A pixel `k` of the way to `to`. */
function blend(p: number, to: Rgb, k: number) {
  const r = p & 255, g = (p >>> 8) & 255, b = (p >>> 16) & 255;
  return ((255 << 24) | (Math.round(b + (to[2] - b) * k) << 16) | (Math.round(g + (to[1] - g) * k) << 8) | Math.round(r + (to[0] - r) * k)) >>> 0;
}
/** `n` colours evenly along `stops`, mixed in OKLab. */
function bands(stops: Oklch[], n: number): Rgb[] {
  const rgb = stops.map(rgbOf);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(t));
    return mix(rgb[k]!, rgb[k + 1]!, t - k);
  });
}

/** The ranges' ridgelines from a seed: each a row of peaks, straight-sided and a little rough,
 *  higher toward the sides, low in the middle where the sun goes down. Over u from -0.3 to 1.3, so
 *  the lean never runs off its end. */
export function rangesOf(seed: number): Float32Array[] {
  const r = seeded(seed);
  return RANGES.map((range, layer) => {
    const n = 641;
    const h = new Float32Array(n);
    const count = 9 + layer * 3;
    const peaks = Array.from({ length: count }, (_, i) => ({ u: -0.3 + ((i + 0.2 + r() * 0.6) / count) * 1.6, top: 0.45 + r() * 0.55, half: 0.06 + r() * 0.08 }));
    // A roughness that is the same at every size: a few waves, small.
    const waves = Array.from({ length: 4 }, (_, i) => ({ f: 9 + i * 13 + r() * 6, p: r() * 6.3, a: 0.05 / (i + 1) }));
    for (let i = 0; i < n; i++) {
      const u = -0.3 + (i / (n - 1)) * 1.6;
      let top = 0;
      for (const pk of peaks) top = Math.max(top, pk.top * (1 - Math.abs(u - pk.u) / pk.half));
      for (const w of waves) top += Math.sin(u * w.f * Math.PI * 2 + w.p) * w.a;
      const away = clamp((Math.abs(u - 0.5) - 0.04) / 0.32, 0, 1);
      const env = range.dip + (1 - range.dip) * away * away * (3 - 2 * away);
      h[i] = range.high * clamp(0.18 + 0.82 * top, 0.12, 1) * env;
    }
    return h;
  });
}
const ridgeAt = (h: Float32Array, u: number) => {
  const t = clamp((u + 0.3) / 1.6, 0, 1) * (h.length - 1);
  const i = Math.min(h.length - 2, Math.floor(t));
  return h[i]! + (h[i + 1]! - h[i]!) * (t - i);
};

/** The palms' shapes, and the tallest a palm is drawn: one passes a little under it, close by on a
 *  tall window. */
const PALM_SHAPES = 3;
const MAX_PALM = 120;
/** How tall on the screen (CSS px) a palm starts to show, and where it is clear of the haze:
 *  smaller, its leaves are too few pixels to be leaves. */
const PALM_FROM = 64;
const PALM_FULL = 88;
/** A palm's leaves: which way each leaves the crown, in degrees from level (up, then round over to
 *  the other side; below level, hanging), and how long, as a share of the longest. */
const PALM_LEAVES = [[176, 1], [142, 0.85], [114, 0.7], [64, 0.75], [34, 0.9], [2, 1], [-42, 0.5]] as const;

export class SunsetRenderer extends SceneRenderer<SunsetPalette> {
  private pw = 0;
  private ph = 0;
  private small = new OffscreenCanvas(1, 1);
  private img: ImageData | null = null;
  private buf = new Uint32Array(0);
  private sky = new Uint32Array(0);
  private skyFresh = false;
  private ridges: Float32Array[] = [];
  private ridgeSeed = -1;
  private col = {
    skyBands: [] as number[],
    sun: [] as number[],
    glow: [0, 0, 0] as unknown as Rgb,
    glowAlpha: 0,
    ranges: [] as number[],
    ridges: [] as number[],
    lit: [] as number[],
    floor: [] as Rgb[],
    grid: [0, 0, 0] as unknown as Rgb,
    line: 0,
    shades: [] as number[],
    star: 0,
    starRgb: [0, 0, 0] as unknown as Rgb,
    pulse: [0, 0, 0] as unknown as Rgb,
  };
  /** The floor's colours, by rows below the horizon and steps toward its grid. */
  private floorRamp = new Uint32Array(0);
  private at = { x: 0, y: 0 };
  /** Each palm's silhouette, by size and shape (palmOf), and the canvas each is drawn on first. */
  private palms = new Map<number, { w: number; h: number; ox: number; oy: number; on: Uint8Array }>();
  private palmPad = new OffscreenCanvas(1, 1);

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, SUNSET_PALETTE);
  }

  /** Cells twice as tall as wide, each two square pixels: finer than the other scenes' grid. */
  protected cellsOf(width: number, height: number) {
    const cw = clamp(Math.round(Math.min(width, height) / 140), 5, 10);
    return { cw, ch: cw * 2 };
  }

  protected styled() {
    const p = this.palette;
    this.col = {
      skyBands: bands(p.sky, SKY_BANDS).map(pack),
      sun: bands(p.sun, SUN_BANDS).map(pack),
      glow: rgbOf(p.glow.colour),
      glowAlpha: p.glow.alpha,
      ranges: p.ranges.map((c) => pack(rgbOf(c))),
      ridges: p.ridges.map((c) => pack(rgbOf(c))),
      lit: p.ranges.map((c, i) => pack(mix(rgbOf(c), rgbOf(p.ridges[i]!), 0.35))),
      floor: p.floor.map(rgbOf),
      grid: rgbOf(p.grid),
      line: pack(rgbOf(p.line)),
      shades: Array.from({ length: 8 }, (_, i) => pack(mix(rgbOf(p.shade), rgbOf(p.haze), (i / 7) ** 1.2))),
      star: pack(rgbOf(p.star)),
      starRgb: rgbOf(p.star),
      pulse: rgbOf(p.pulse),
    };
    this.skyFresh = false;
    this.floorRamp = new Uint32Array(0);
  }

  protected repaint() {
    this.pw = this.cols;
    this.ph = this.rows * 2;
    this.small.width = this.pw;
    this.small.height = this.ph;
    const g = this.small.getContext("2d");
    this.img = g ? g.createImageData(this.pw, this.ph) : null;
    this.buf = this.img ? new Uint32Array(this.img.data.buffer) : new Uint32Array(0);
    this.skyFresh = false;
    this.floorRamp = new Uint32Array(0);
  }

  /** The sky, top to the horizon, its gradient in bands dithered into each other. */
  private paintSky() {
    const { pw, ph, cw, height: H } = this;
    if (this.sky.length !== pw * ph) this.sky = new Uint32Array(pw * ph);
    for (let y = 0; y < ph; y++) {
      const v = clamp(((y + 0.5) * cw) / H / 0.62, 0, 1);
      const t = v * (SKY_BANDS - 1);
      const base = Math.floor(t);
      const frac = t - base;
      for (let x = 0; x < pw; x++) {
        const i = Math.min(SKY_BANDS - 1, base + (frac > BAYER[(y & 3) * 4 + (x & 3)]! ? 1 : 0));
        this.sky[y * pw + x] = this.col.skyBands[i]!;
      }
    }
    this.skyFresh = true;
  }

  /** The floor's colours: by how far below the horizon, from its far colour to its near one, and
   *  at each, the steps to the grid's. */
  private paintFloorRamp() {
    const { ph } = this;
    this.floorRamp = new Uint32Array((ph + 1) * (LEVELS + 1));
    const [far, near] = this.col.floor;
    for (let dy = 0; dy <= ph; dy++) {
      const base = mix(far!, near!, Math.min(1, (dy / (ph * 0.42)) ** 0.7));
      for (let l = 0; l <= LEVELS; l++) this.floorRamp[dy * (LEVELS + 1) + l] = pack(mix(base, this.col.grid, l / LEVELS));
    }
  }

  draw(d: Drive) {
    if (!this.cols || !this.img) return;
    if (!this.skyFresh) this.paintSky();
    if (!this.floorRamp.length) this.paintFloorRamp();
    if (this.ridgeSeed !== d.seed) {
      this.ridges = rangesOf(d.seed);
      this.ridgeSeed = d.seed;
    }
    const { buf, pw, ph, cw, width: W, height: H } = this;
    buf.set(this.sky);
    const hy = d.horizon() * (H / cw);
    const hRow = Math.ceil(hy);
    const dusk = d.dusk();
    this.drawStars(d, hRow, dusk);
    this.drawSun(d, hy);
    // The ranges, far to near, each leaned by how far off it is.
    // A slope facing the sun catches its light: a band under the ridge, deeper the steeper.
    const sunX = d.across(Infinity);
    for (let k = 0; k < RANGES.length; k++) {
      const shift = d.lean.x * LEAN_X * (1 - 1 / RANGES[k]!.z);
      const body = this.col.ranges[k]!;
      const ridge = this.col.ridges[k]!;
      const lit = this.col.lit[k]!;
      const h = this.ridges[k]!;
      const du = cw / W;
      for (let x = 0; x < pw; x++) {
        const u = ((x + 0.5) * cw) / W - shift;
        const here = ridgeAt(h, u);
        const top = Math.round(hy - (here * H) / cw);
        const toward = (x + 0.5) * du < sunX ? 1 : -1;
        const facing = clamp((((ridgeAt(h, u + toward * du * 2) - here) * H) / cw) * -0.9, 0, 1);
        const band = 1 + facing * 5;
        for (let y = Math.max(0, top); y < hRow; y++) {
          const into = y - top;
          buf[y * pw + x] = into === 0 ? ridge : into < band && (into < band - 1 || BAYER[(y & 3) * 4 + (x & 3)]! < 0.5) ? lit : body;
        }
      }
    }
    this.drawFloor(d, hRow);
    const sides = [...d.roadside].sort((a, b) => b.z - a.z);
    for (const t of sides) this.drawThing(d, t);
    this.drawPulses(d, hRow);

    // Up to the window, sharp: each pixel a clean half of its cell, no seams between them.
    const g = this.small.getContext("2d");
    if (!g) return;
    g.putImageData(this.img, 0, 0);
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.small, 0, 0, Math.round(pw * cw * dpr), Math.round(ph * cw * dpr));
  }

  /** How bright a star is now: none before the sky is dark enough for it, then twinkling. */
  private starLight(d: Drive, at: number, rate: number, phase: number, dusk: number) {
    return clamp((dusk - at * 0.95) * 3.5, 0, 1) * (0.6 + 0.4 * Math.sin(d.time * rate + phase)) * this.palette.stars;
  }

  private drawStars(d: Drive, hRow: number, dusk: number) {
    if (!this.palette.stars) return;
    const { buf, pw } = this;
    for (const s of d.stars) {
      const k = this.starLight(d, s.at, s.rate, s.phase, dusk);
      if (k <= 0.05) continue;
      const x = Math.floor(s.u * pw);
      const y = Math.floor(s.v * hRow * 0.9);
      if (y < 0 || y >= hRow) continue;
      const i = y * pw + x;
      buf[i] = k > BAYER[(y & 3) * 4 + (x & 3)]! * 0.9 ? this.col.star : blend(buf[i]!, this.col.starRgb, k * 0.5);
    }
  }

  /** The sun, striped in its lower half, its stripes drifting down; and its glow on the sky. */
  private drawSun(d: Drive, hy: number) {
    const { buf, pw, cw } = this;
    const sun = d.sun();
    const R = sun.r / cw;
    const cx = sun.x / cw;
    const cy = sun.y / cw;
    const reach = R * 2.3;
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(Math.ceil(hy), Math.ceil(cy + reach));
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(pw, Math.ceil(cx + reach));
    const period = Math.max(4, Math.round(R * 0.17));
    const drift = d.time * 3;
    const glow = this.col.glow;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy;
      const below = (y + 0.5 - (cy - R * 0.3)) / (R * 1.3);
      const gap = below > 0 ? 1 + Math.floor(below * (period - 2) * 0.85) : 0;
      const striped = gap > 0 && (((y - Math.floor(drift)) % period) + period) % period < gap;
      const t = clamp((y + 0.5 - (cy - R)) / (2 * R), 0, 1) * (SUN_BANDS - 1);
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        const i = y * pw + x;
        const th = BAYER[(y & 3) * 4 + (x & 3)]!;
        if (d2 <= R * R && !striped) {
          const base = Math.floor(t);
          buf[i] = this.col.sun[Math.min(SUN_BANDS - 1, base + (t - base > th ? 1 : 0))]!;
          continue;
        }
        const dist = Math.sqrt(d2);
        const k = dist <= R ? 1 : 1 - (dist - R) / (reach - R);
        if (k <= 0) continue;
        // Its glow, in steps dithered into each other.
        const level = Math.floor(k * k * 6 + th) / 6;
        if (level > 0) buf[i] = blend(buf[i]!, glow, level * this.col.glowAlpha);
      }
    }
  }

  /** The floor: below the horizon, its colour toward the near one, hazy where it meets the sky;
   *  its lines across, scrolling toward us, and along the way, meeting far off, each a line of
   *  whole pixels, fading into the distance until they are too close together to draw. */
  private drawFloor(d: Drive, hRow: number) {
    const { buf, pw, ph, cw, width: W, height: H } = this;
    const h = d.horizon();
    const sx = W / cw;
    const rowOf = (Z: number) => (h + (1 - h) / Z) * (H / cw);
    const zOf = (y: number) => (1 - h) / Math.max(1e-4, ((y + 0.5) * cw) / H - h);
    const level = (k: number, x: number, y: number) => {
      const l = Math.floor(k * LEVELS);
      return Math.min(LEVELS, l + (k * LEVELS - l > BAYER[(y & 3) * 4 + (x & 3)]! ? 1 : 0));
    };
    const fog = (Z: number) => Math.exp(-(Z - 1) * 0.07);
    // The ground, the haze over it near the horizon.
    for (let y = hRow; y < ph; y++) {
      const dy = y - hRow;
      if (dy === 0) {
        buf.fill(this.col.line, y * pw, y * pw + pw);
        continue;
      }
      const haze = 0.42 * Math.exp(-dy / 3);
      const ramp = Math.min(dy, ph) * (LEVELS + 1);
      for (let x = 0; x < pw; x++) buf[y * pw + x] = this.floorRamp[ramp + level(haze, x, y)]!;
    }
    // Across: each line on its row while lines lie two pixels apart or more.
    for (let k = Math.ceil(d.scroll + 1 / GRID_Z); ; k++) {
      const Z = GRID_Z * (k - d.scroll);
      const y = Math.round(rowOf(Z));
      const gap = rowOf(Z) - rowOf(Z + GRID_Z);
      if (y <= hRow + 1 || gap < 2.5) break;
      if (y >= ph) continue;
      const ramp = Math.min(y - hRow, ph) * (LEVELS + 1);
      const f = fog(Z) * clamp((gap - 2.5) / 4, 0, 1);
      for (let x = 0; x < pw; x++) buf[y * pw + x] = this.floorRamp[ramp + level(f, x, y)]!;
    }
    // Along: each line from the bottom up, joined row to row, while lines lie three pixels apart.
    const far = (GRID_X * sx) / 2 / 4;
    const lines = Math.ceil(far / GRID_X) + 1;
    for (let j = -lines; j <= lines; j++) {
      let prev = NaN;
      for (let y = ph - 1; y > hRow + 1; y--) {
        const Z = zOf(y);
        if (Z > far) break;
        const x = (d.across(Z) + (j * GRID_X) / Z / 2) * sx;
        const xi = Math.round(x);
        const from = Number.isNaN(prev) ? xi : Math.min(xi, prev);
        const to = Number.isNaN(prev) ? xi : Math.max(xi, prev);
        prev = xi;
        if (to < 0 || from >= pw) continue;
        const ramp = Math.min(y - hRow, ph) * (LEVELS + 1);
        const f = fog(Z) * clamp(((GRID_X * sx) / 2 / Z - 4) / 6, 0, 1);
        for (let xx = Math.max(0, from); xx <= Math.min(pw - 1, to); xx++) buf[y * pw + xx] = this.floorRamp[ramp + level(f, xx, y)]!;
      }
    }
  }

  private plot(x: number, y: number, c: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.pw || y >= this.ph) return;
    this.buf[y * this.pw + x] = c;
  }

  /** A palm or a cactus by the way, standing on the floor `z` ahead, darker the nearer. */
  private drawThing(d: Drive, t: Roadside) {
    const { cw, width: W, height: H } = this;
    d.project(t.side * t.lat, t.z, this.at);
    const bx = (this.at.x * W) / cw;
    const by = (this.at.y * H) / cw;
    const hp = ((1.05 * t.size * (1 - d.horizon())) / t.z) * (H / cw);
    // A palm too small to read as one is not drawn; from PALM_FROM px tall on the screen it comes
    // out of the haze as it nears, drawn in a farther shade until PALM_FULL.
    const shown = t.kind === "palm" ? clamp((hp * cw - PALM_FROM) / (PALM_FULL - PALM_FROM), 0, 1) : 1;
    if (shown <= 0) return;
    const c = this.col.shades[Math.min(7, clamp(Math.round(((t.z - 1) / 8) * 7), 0, 7) + Math.round((1 - shown) * 4))]!;
    if (hp < 2.5) {
      this.plot(bx, by - 1, c);
      this.plot(bx, by - 2, c);
      return;
    }
    const r = seeded(t.seed);
    if (t.kind === "cactus") {
      // A saguaro: a column with a round top, an arm or two bending up from it.
      const w = Math.max(2, Math.round(hp * 0.12));
      const left = Math.round(bx - w / 2);
      const column = (x0: number, y0: number, wide: number, up: number) => {
        for (let y = 0; y < up; y++) {
          const fromTop = up - 1 - y;
          const inset = wide > 3 && fromTop < wide / 3 ? Math.ceil((wide / 3 - fromTop) * 0.8) : wide > 2 && fromTop === 0 ? 1 : 0;
          for (let x = inset; x < wide - inset; x++) this.plot(x0 + x, y0 - y, c);
        }
      };
      column(left, by, w, Math.round(hp));
      for (const side of [-1, 1]) {
        if (side === 1 && r() < 0.35) continue;
        const at = Math.round(hp * (0.32 + r() * 0.2));
        const aw = Math.max(1, Math.round(w * 0.72));
        const out = Math.max(2, Math.round(w * (0.9 + r() * 0.5)));
        const up = Math.round(hp * (0.2 + r() * 0.16));
        const x0 = side < 0 ? left - out : left + w + out - aw;
        // Out from the column, then up.
        for (let x = 0; x < out; x++) for (let k = 0; k < aw; k++) this.plot(side < 0 ? left - 1 - x : left + w + x, by - at - k, c);
        column(x0, by - at, aw, up);
      }
      return;
    }
    // A palm: its silhouette at its size, leaning the way its seed says.
    const palm = this.palmOf(Math.min(MAX_PALM, Math.round(hp)), t.seed % PALM_SHAPES);
    const s = t.seed & 1 ? 1 : -1;
    for (let y = 0; y < palm.h; y++) {
      for (let x = 0; x < palm.w; x++) if (palm.on[y * palm.w + x]) this.plot(bx + s * (x - palm.ox), by + y - palm.oy, c);
    }
  }

  /** A palm's silhouette `hp` pixels tall, in one of a few shapes: a trunk curving up and
   *  tapering, a crown of seven leaves, each widest a third of its way out and arching up, over and
   *  down to a point, leaflets hanging from it on a big one, and coconuts under the crown. Drawn
   *  smooth, then taken as pixels where it covers half of one; kept for each size and shape. */
  private palmOf(hp: number, shape: number) {
    const key = hp * PALM_SHAPES + shape;
    const kept = this.palms.get(key);
    if (kept) return kept;
    const w = Math.ceil(hp * 1.4) + 4;
    const h = Math.ceil(hp * 1.1) + 4;
    const ox = Math.round(w * 0.45);
    const oy = h - 2;
    const pad = this.palmPad;
    if (pad.width < w || pad.height < h) {
      pad.width = Math.max(pad.width, w);
      pad.height = Math.max(pad.height, h);
    }
    const g = pad.getContext("2d", { willReadFrequently: true })!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#000";
    g.strokeStyle = "#000";
    const r = seeded(0x9a1 + shape * 7919);
    const lean = (0.12 + 0.07 * shape) * hp;
    const cx = ox + lean;
    const cy = oy - hp * 0.7;
    /** A band along a quadratic curve, its width at each point of the way. */
    const band = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, width: (k: number) => number, below = 0.5) => {
      const n = Math.max(8, Math.ceil(hp / 3));
      const top: number[] = [];
      const bottom: number[] = [];
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const x = (1 - k) * (1 - k) * x0 + 2 * k * (1 - k) * x1 + k * k * x2;
        const y = (1 - k) * (1 - k) * y0 + 2 * k * (1 - k) * y1 + k * k * y2;
        let tx = 2 * (1 - k) * (x1 - x0) + 2 * k * (x2 - x1);
        let ty = 2 * (1 - k) * (y1 - y0) + 2 * k * (y2 - y1);
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        // The side of the curve away from the sky.
        const [nx, ny] = tx >= 0 ? [-ty, tx] : [ty, -tx];
        const wk = width(k);
        top.push(x - nx * wk * (1 - below), y - ny * wk * (1 - below));
        bottom.push(x + nx * wk * below, y + ny * wk * below);
      }
      g.beginPath();
      g.moveTo(top[0]!, top[1]!);
      for (let i = 2; i < top.length; i += 2) g.lineTo(top[i]!, top[i + 1]!);
      for (let i = bottom.length - 2; i >= 0; i -= 2) g.lineTo(bottom[i]!, bottom[i + 1]!);
      g.closePath();
      g.fill();
    };
    // The trunk, from its foot up to the crown, bowed the way it leans.
    band(ox, oy, ox + lean * 0.1, oy - hp * 0.42, cx, cy, (k) => Math.max(1.2, hp * (0.075 - 0.03 * k)));
    // The leaves: which way each leaves the crown (degrees from level, up and round), how long.
    const widest = Math.max(1.3, hp * 0.062);
    for (const [deg, long] of PALM_LEAVES) {
      const a = ((deg + (r() - 0.5) * 14) * Math.PI) / 180;
      const L = hp * 0.56 * long * (0.9 + r() * 0.2);
      const dx = Math.cos(a);
      const dy = -Math.sin(a);
      const hangs = deg < 0;
      // Out and up from the crown, then over and down to its tip.
      const x1 = cx + dx * L * 0.55;
      const y1 = cy + (hangs ? dy * L * 0.5 : dy * L * 0.65 - L * 0.18);
      const x2 = cx + dx * L * (hangs ? 0.8 : 0.95);
      const y2 = cy + (hangs ? dy * L * 0.9 : dy * L * 0.25 + L * 0.55);
      band(cx, cy, x1, y1, x2, y2, (k) => widest * (k < 0.3 ? 0.45 + (0.55 * k) / 0.3 : Math.pow(1 - (k - 0.3) / 0.7, 0.8)), 0.7);
      // Leaflets hanging from a big palm's leaves, so their lower edges are feathered.
      if (hp >= 26) {
        g.lineWidth = Math.max(1, hp * 0.02);
        for (let k = 0.2; k < 0.92; k += 3.2 / L) {
          const x = (1 - k) * (1 - k) * cx + 2 * k * (1 - k) * x1 + k * k * x2;
          const y = (1 - k) * (1 - k) * cy + 2 * k * (1 - k) * y1 + k * k * y2;
          const drop = widest * (1.6 - k);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + dx * drop * 0.35, y + drop);
          g.stroke();
        }
      }
    }
    if (hp >= 14) {
      for (const [ax, ay] of [[-0.6, 0.9], [0.5, 1], [0, 1.5]] as const) {
        g.beginPath();
        g.arc(cx + ax * hp * 0.04, cy + ay * hp * 0.04, Math.max(1, hp * 0.035), 0, Math.PI * 2);
        g.fill();
      }
    }
    const alpha = g.getImageData(0, 0, w, h).data;
    const on = new Uint8Array(w * h);
    for (let i = 0; i < on.length; i++) on[i] = alpha[i * 4 + 3]! >= 115 ? 1 : 0;
    const palm = { w, h, ox, oy, on };
    this.palms.set(key, palm);
    return palm;
  }

  /** The pulses: on the floor, a comet of light along its line away toward the horizon, the grid
   *  line it crosses lit either side of it; in the sky, a streak down to the horizon; then a flash
   *  spreading along the horizon where it got to. */
  private drawPulses(d: Drive, hRow: number) {
    const { cw, width: W, height: H, pw } = this;
    const sx = W / cw;
    const sy = H / cw;
    const colour = this.col.pulse;
    for (const p of d.pulses) {
      const k = clamp(p.age / PULSE_LIFE, 0, 1);
      const fade = clamp(1 - k * 0.6, 0, 1);
      if (p.kind === "floor") {
        const head = p.z0 * Math.exp(k * 3.4);
        if (k < 1) {
          for (let i = 0; i <= 30; i++) {
            const t = i / 30;
            d.project(p.X, head / Math.pow(1.9, 1 - t), this.at);
            const x = this.at.x * sx;
            const y = this.at.y * sy;
            if (y < hRow) continue;
            const pi = Math.round(y) * pw + Math.round(x);
            for (const dx of t > 0.5 ? [-1, 0, 1] : [0]) {
              const xx = Math.round(x) + dx;
              if (xx >= 0 && xx < pw && pi >= 0 && pi < this.buf.length) this.buf[pi + dx] = blend(this.buf[pi + dx]!, colour, (dx ? 0.55 : 1) * t ** 1.1 * fade);
            }
          }
          // The grid line it is crossing, lit either side of it.
          const zk = GRID_Z * (Math.round(head / GRID_Z + d.scroll) - d.scroll);
          if (zk > 0.6) {
            d.project(p.X, zk, this.at);
            const y = Math.round(this.at.y * sy);
            const reachX = ((3.5 * GRID_X) / zk / 2) * sx;
            const mid = this.at.x * sx;
            for (let x = Math.floor(mid - reachX); x <= Math.ceil(mid + reachX); x++) {
              if (x < 0 || x >= pw || y < hRow || y >= this.ph) continue;
              const near = 1 - Math.abs(x - mid) / reachX;
              if (near > 0) this.buf[y * pw + x] = blend(this.buf[y * pw + x]!, colour, near * 0.85 * fade);
            }
          }
          d.project(p.X, head, this.at);
          for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]] as const) {
            const x = Math.round(this.at.x * sx) + dx;
            const y = Math.round(this.at.y * sy) + dy;
            if (x >= 0 && x < pw && y >= hRow && y < this.ph) this.buf[y * pw + x] = blend(this.buf[y * pw + x]!, colour, (dx || dy ? 0.7 : 1) * fade);
          }
        }
      } else if (k < 0.6) {
        d.pulseAt(p, this.at);
        const x = Math.round(this.at.x * sx);
        const y = this.at.y * sy;
        for (let i = 0; i < 14; i++) {
          const yy = Math.round(y - i);
          if (yy < 0 || yy >= hRow || x < 0 || x >= pw) continue;
          this.buf[yy * pw + x] = blend(this.buf[yy * pw + x]!, colour, 1 - i / 14);
        }
      }
      // Where it was clicked: a ring of light, widening and gone.
      if (p.age < 0.45) {
        const r = 1.5 + p.age * 26;
        const cx = p.x0 * sx;
        const cy = p.y0 * sy;
        const n = Math.ceil(r * 7);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = Math.round(cx + Math.cos(a) * r);
          const y = Math.round(cy + Math.sin(a) * r * 0.8);
          if (x >= 0 && x < pw && y >= 0 && y < this.ph) this.buf[y * pw + x] = blend(this.buf[y * pw + x]!, colour, 1 - p.age / 0.45);
        }
      }
      // At the horizon: a flash spreading along it.
      const reached = p.kind === "floor" ? 0.82 : 0.55;
      if (k >= reached) {
        const since = p.age - reached * PULSE_LIFE;
        const spread = (0.02 + since * 0.18) * sx;
        const strength = clamp(1 - since / 0.9, 0, 1);
        if (strength <= 0) continue;
        d.pulseAt(p, this.at);
        const mid = (p.kind === "floor" ? d.across(Infinity) + (p.X / (p.z0 * Math.exp(3.4))) / 2 : this.at.x) * sx;
        for (const y of [hRow - 1, hRow]) {
          if (y < 0 || y >= this.ph) continue;
          for (let x = Math.max(0, Math.floor(mid - spread)); x < Math.min(pw, Math.ceil(mid + spread)); x++) {
            const near = 1 - Math.abs(x - mid) / spread;
            this.buf[y * pw + x] = blend(this.buf[y * pw + x]!, colour, near * strength * (y === hRow ? 1 : 0.6));
          }
        }
      }
    }
  }
}
