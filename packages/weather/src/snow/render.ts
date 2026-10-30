/**
 * Snowfall's picture, which the character pass turns into characters (chars.ts): the valley as
 * shapes, so the pass draws their outlines in lines (a roof's slopes `/` and `\`, a peak's ridge) and
 * their surfaces by their light.
 *
 * Painted once per size, look and village (`still`): the sky with the moon (or the sun) and its
 * glow; the far peaks, their faces toward the light lit and the others in shade, snow above the rock;
 * mist along their feet; the forested hills with their ragged top; the fields; the houses (wood
 * walls, steep roofs, chimneys, windows dark) and the pines in tiers, back row then front. Each frame
 * over a copy of it: the snow lying on each roof and pine (as deep as its ledges hold) and on the
 * ground (its height map), the lit windows with their glow and their light on the snow, the smoke,
 * the flakes (far ones a speck behind the village, nearer ones bigger) and a click's powder.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, rgbOf, type Oklch, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { PictureRenderer } from "../picture";
import { noise2 } from "../util";
import { SNOW_PALETTE, type SnowPalette } from "./palette";
import type { Valley } from "./valley";
import type { House, Layout, Pine } from "./village";

/** The flakes' own characters, and their numbers in a mark (1 the first). */
const MARKS = ["*", "+", "·", "."];
const [STAR, CROSS, DOT, SPECK] = [1, 2, 3, 4];

export class SnowRenderer extends PictureRenderer<SnowPalette, Valley> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = { version: -1, layout: null as Layout | null };
  private st = {} as Record<string, string>;
  private glow: OffscreenCanvas | null = null;

  private cellMarks = new Uint8Array(0);
  private flakeRgb: Rgb[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, SNOW_PALETTE);
  }

  protected extras() {
    return MARKS;
  }

  /** The flakes' characters: a far one a speck (not over the village, which stands in front of it),
   *  one among the houses a star or a cross by its size, a near one a star; a click's powder, a star
   *  going to a speck as it drifts. */
  protected marks(v: Valley) {
    const { cols, rows, cw, ch } = this;
    const l = v.layout;
    if (!l || l.cols !== cols || l.rows !== rows) return null;
    if (this.cellMarks.length !== cols * rows * 4) this.cellMarks = new Uint8Array(cols * rows * 4);
    const m = this.cellMarks;
    m.fill(0);
    const put = (x: number, y: number, code: number, colour: Rgb) => {
      const c = Math.floor(x / cw);
      const r = Math.floor(y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const i = r * cols + c;
      if (code === SPECK && (l.owner[i]! >= 0 || m[i * 4 + 3])) return;
      m.set(colour, i * 4);
      m[i * 4 + 3] = code;
    };
    for (const f of v.flakes) put(f.x, f.y, f.layer === 0 ? SPECK : f.layer === 2 || f.size > 0.55 ? STAR : CROSS, this.flakeRgb[f.layer]!);
    for (const p of v.powder) {
      const a = p.age / p.life;
      put(p.x, p.y, a < 0.25 ? STAR : a < 0.5 ? CROSS : a < 0.75 ? DOT : SPECK, this.flakeRgb[2]!);
    }
    return m;
  }

  protected styled() {
    const p = this.palette;
    const c = (o: Oklch) => css(rgbOf(o));
    this.st = {
      wall: c(p.wall), roof: c(p.roof), cap: c(p.cap), chimney: c(p.chimney), lit: c(p.lit), dark: c(p.dark), pine: c(p.pine),
      far: c(p.flake[0]), mid: c(p.flake[1]), near: c(p.flake[2]), snowTop: c(p.snow[1]), snowDeep: c(p.snow[2]),
    };
    this.glow = glowSprite(rgbOf(p.glow.colour));
    this.flakeRgb = p.flake.map(rgbOf);
  }

  private paintStill(l: Layout, peaks: { fx: number; top: number; slope: number }[]) {
    const g = this.layer(this.still);
    const { width: W, height: H, cw, ch } = this;
    const p = this.palette;
    const feet = (l.back + 1) * ch;
    const sky = g.createLinearGradient(0, 0, 0, feet);
    p.sky.forEach((c, i) => sky.addColorStop(i / (p.sky.length - 1), css(rgbOf(c))));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // The moon or the sun, and its glow over the sky.
    const lx = W * p.light.x;
    const ly = H * p.light.y;
    const halo = g.createRadialGradient(lx, ly, 0, lx, ly, H * 0.55);
    halo.addColorStop(0, cssAlpha(rgbOf(p.light.glow), p.light.alpha));
    halo.addColorStop(0.25, cssAlpha(rgbOf(p.light.glow), p.light.alpha * 0.35));
    halo.addColorStop(1, cssAlpha(rgbOf(p.light.glow), 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    g.fillStyle = css(rgbOf(p.light.disc));
    g.beginPath();
    g.arc(lx, ly, Math.max(cw * 2.2, H * 0.035), 0, Math.PI * 2);
    g.fill();
    this.paintPeaks(g, l, peaks);
    // Mist along the peaks' feet.
    const mist = g.createLinearGradient(0, feet - H * 0.22, 0, feet);
    mist.addColorStop(0, cssAlpha(rgbOf(p.mist.colour), 0));
    mist.addColorStop(1, cssAlpha(rgbOf(p.mist.colour), p.mist.alpha));
    g.fillStyle = mist;
    g.fillRect(0, feet - H * 0.22, W, H * 0.22);
    // The hills: forest, its top a ragged line of treetops.
    g.fillStyle = css(rgbOf(p.hills[0]));
    g.beginPath();
    g.moveTo(0, H);
    for (let c = 0; c <= l.cols; c++) {
      const x = c * cw;
      const y = l.hills[Math.min(l.cols - 1, c)]! * ch;
      g.lineTo(x, y + ch * 0.6);
      g.lineTo(x + cw * 0.5, y - ch * (0.2 + 0.6 * noise2(c * 0.7, 3.5, 91)));
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    // The fields under the back of the village.
    const field = g.createLinearGradient(0, feet, 0, H);
    field.addColorStop(0, css(rgbOf(p.snow[0])));
    field.addColorStop(1, css(rgbOf(p.snow[2])));
    g.fillStyle = field;
    g.fillRect(0, feet, W, H - feet);
    for (const t of l.things) {
      if ("w" in t) this.paintHouse(g, t as House);
      else this.paintPine(g, t as Pine);
    }
  }

  /** The far peaks, lowest first: each two faces from its apex, the one toward the light lit and the
   *  other in shade, snow down from the apex to a ragged line, rock under it. */
  private paintPeaks(g: Draw2D, l: Layout, peaks: { fx: number; top: number; slope: number }[]) {
    const { width: W, height: H, cw, ch } = this;
    const p = this.palette;
    const bottom = (l.back + 1) * ch;
    const lit = p.light.from;
    for (const k of [...peaks].sort((a, b) => b.top - a.top)) {
      const ax = k.fx * W;
      const ay = Math.max(H * 0.12, k.top * H);
      const run = ((bottom - ay) / (k.slope * ch)) * cw;
      for (const side of [-1, 1]) {
        const toward = side === lit;
        // The face, its outline a little ragged; the shaded one ends on a slant across the peak's
        // foot, not straight down from its apex.
        const split = toward ? 0 : -side * run * 0.28;
        g.fillStyle = css(rgbOf(toward ? p.peaks[2] : p.peaks[3]));
        g.beginPath();
        g.moveTo(ax, ay);
        for (let s = 1; s <= 12; s++) {
          const f = s / 12;
          g.lineTo(ax + side * run * f, ay + (bottom - ay) * f + (noise2(ax / W * 9 + side * f * 4, 2.5, 95) - 0.5) * ch * 1.5 * (1 - f));
        }
        g.lineTo(ax + split, bottom);
        g.closePath();
        g.fill();
        // Its snow, down to a ragged line, deeper in the gullies.
        const depth = (bottom - ay) * (0.38 + 0.12 * noise2(ax / W * 3, side, 97));
        g.fillStyle = css(rgbOf(toward ? p.peaks[0] : p.peaks[1]));
        g.beginPath();
        g.moveTo(ax, ay);
        const steps = 10;
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          g.lineTo(ax + side * run * f * (depth / (bottom - ay)), ay + depth * f + (noise2(ax / W * 9 + side * f * 4, 2.5, 95) - 0.5) * ch * 1.5 * (1 - f));
        }
        for (let s = steps; s >= 0; s--) {
          const f = s / steps;
          const gully = noise2(ax / W * 13 + f * 6, side * 3, 99);
          g.lineTo(ax + side * run * f * (depth / (bottom - ay)), ay + depth * (0.75 + 0.6 * gully) * Math.max(f, 0.3));
        }
        g.closePath();
        g.fill();
      }
    }
  }

  private paintHouse(g: Draw2D, h: House) {
    const { cw, ch, st } = this;
    const x0 = h.c0 * cw;
    const x1 = (h.c0 + h.w) * cw;
    g.fillStyle = st.wall!;
    g.fillRect(x0, h.wallTop * ch, x1 - x0, (h.base + 1 - h.wallTop) * ch);
    if (h.smoke) {
      g.fillStyle = st.chimney!;
      g.fillRect(Math.floor(h.smoke.x) * cw + cw * 0.15, h.smoke.y * ch, cw * 0.7, (h.wallTop - h.smoke.y) * ch);
    }
    g.fillStyle = st.roof!;
    g.beginPath();
    g.moveTo(x0 - cw * 1.2, h.wallTop * ch);
    g.lineTo((h.mid + 0.5) * cw, h.peak * ch);
    g.lineTo(x1 + cw * 1.2, h.wallTop * ch);
    g.closePath();
    g.fill();
    g.fillStyle = st.dark!;
    for (const w of h.windows) g.fillRect(w.c * cw + cw * 0.15, w.r * ch + ch * 0.2, cw * 0.7, ch * 0.6);
    if (h.front) g.fillRect(h.mid * cw + cw * 0.2, h.base * ch, cw * 0.6, ch);
  }

  /** A pine: tiers, each wider than the one above, a dark silhouette. */
  private paintPine(g: Draw2D, t: Pine) {
    const { cw, ch, st } = this;
    const x = (t.c + 0.5) * cw;
    const top = (t.base - t.h + 1) * ch;
    const h = (t.h - 1) * ch;
    g.fillStyle = st.pine!;
    this.tiers(t, (y0, y1, w0, w1) => {
      g.beginPath();
      g.moveTo(x - w0, y0);
      g.lineTo(x + w0, y0);
      g.lineTo(x + w1, y1);
      g.lineTo(x - w1, y1);
      g.closePath();
      g.fill();
    });
    g.fillRect(x - cw * 0.25, top + h, cw * 0.5, ch);
  }

  /** A pine's tiers, top to bottom: each its top and bottom (px) and half-widths there. */
  private tiers(t: Pine, each: (y0: number, y1: number, w0: number, w1: number) => void) {
    const { cw, ch } = this;
    const top = (t.base - t.h + 1) * ch;
    const h = (t.h - 1) * ch;
    const n = Math.max(2, Math.round(t.h / 3));
    for (let k = 0; k < n; k++) {
      const y0 = top + (h * k) / n;
      const y1 = top + (h * (k + 1.25)) / n;
      each(y0, Math.min(top + h, y1), k ? cw * (0.35 + 0.55 * k) : 0, cw * (1 + 0.75 * (k + 1)) * Math.min(1, t.h / 9 + 0.3));
    }
  }

  protected paint(v: Valley, g: Draw2D) {
    const l = v.layout;
    if (!l || l.cols !== this.cols || l.rows !== this.rows) return;
    if (this.stillFor.version !== this.version || this.stillFor.layout !== l) {
      this.paintStill(l, v.village!.far);
      this.stillFor = { version: this.version, layout: l };
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.still, 0, 0);
    g.setTransform(this.pic.width / this.width, 0, 0, this.pic.height / this.height, 0, 0);
    this.paintCaps(v, g, l);
    this.paintGround(v, g);
    this.paintWindows(v, g, l);
    this.paintSmoke(v, g);
  }

  /** The snow on each house's roof and each pine's tiers, as deep as its ledges hold on average. */
  private paintCaps(v: Valley, g: Draw2D, l: Layout) {
    const { cw, ch, st } = this;
    const depth = new Float32Array(l.things.length);
    const count = new Float32Array(l.things.length);
    l.ledges.forEach((e, k) => {
      const owner = e.key >> 7;
      depth[owner] = depth[owner]! + v.ledgeDepth[k]!;
      count[owner] = count[owner]! + 1;
    });
    g.fillStyle = st.cap!;
    l.things.forEach((t, k) => {
      const d = count[k] ? (depth[k]! / count[k]!) * ch * 0.6 : 0;
      if (d <= 0) return;
      if ("w" in t) {
        const h = t as House;
        const x0 = h.c0 * cw - cw * 1.2;
        const x1 = (h.c0 + h.w) * cw + cw * 1.2;
        const px = (h.mid + 0.5) * cw;
        g.beginPath();
        g.moveTo(x0, h.wallTop * ch);
        g.lineTo(px, h.peak * ch);
        g.lineTo(x1, h.wallTop * ch);
        g.lineTo(x1 - cw * 0.4, h.wallTop * ch - d * 0.3);
        g.lineTo(px, h.peak * ch - d * 1.1);
        g.lineTo(x0 + cw * 0.4, h.wallTop * ch - d * 0.3);
        g.closePath();
        g.fill();
      } else {
        const pine = t as Pine;
        const x = (pine.c + 0.5) * cw;
        this.tiers(pine, (y0, y1, w0, w1) => {
          // A thin lying of snow along the tier's lower edge, where its branches flatten.
          g.beginPath();
          g.moveTo(x - w1, y1);
          g.lineTo(x - w1 * 0.55, y1 - d * 0.5);
          g.lineTo(x + w1 * 0.55, y1 - d * 0.5);
          g.lineTo(x + w1, y1);
          g.closePath();
          g.fill();
          if (!w0) g.fillRect(x - cw * 0.2, y0, cw * 0.4, d * 0.4);
        });
      }
    });
  }

  /** The snow on the ground: its surface across the window, a little brighter along its top. */
  private paintGround(v: Valley, g: Draw2D) {
    const { width: W, height: H, cw, cols } = this;
    const p = this.palette;
    g.beginPath();
    g.moveTo(0, H);
    for (let c = 0; c < cols; c++) g.lineTo((c + 0.5) * cw, v.surface(c));
    g.lineTo(W, v.surface(cols - 1));
    g.lineTo(W, H);
    g.closePath();
    const top = Math.min(...Array.from({ length: Math.min(cols, 400) }, (_, c) => v.surface(Math.floor((c * cols) / Math.min(cols, 400)))));
    const grad = g.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, this.st.snowTop!);
    grad.addColorStop(1, this.st.snowDeep!);
    g.fillStyle = grad;
    g.fill();
    // Shade under the drifts.
    g.fillStyle = cssAlpha(rgbOf(p.shade.colour), p.shade.alpha);
    for (let k = 0; k < 3; k++) {
      const y = top + (H - top) * (0.35 + 0.22 * k);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += cw * 4) g.lineTo(x, y + (noise2(x / W * 5, k + 0.5, 93) - 0.5) * this.ch * 2);
      g.lineTo(W, y + this.ch * 0.8);
      g.lineTo(0, y + this.ch * 0.8);
      g.closePath();
      g.fill();
    }
  }

  /** The lit windows, their glow, and the light they throw on the snow in front of the house. */
  private paintWindows(v: Valley, g: Draw2D, l: Layout) {
    const { cw, ch, st } = this;
    const p = this.palette;
    g.save();
    g.globalCompositeOperation = this.light ? "source-over" : "lighter";
    g.globalAlpha = p.glow.alpha;
    l.houses.forEach((h, k) => h.windows.forEach((w, j) => {
      if (!v.lit[k]![j] || (w.r + 0.5) * ch > v.surface(w.c)) return;
      const x = (w.c + 0.5) * cw;
      const y = (w.r + 0.5) * ch;
      g.drawImage(this.glow!, x - cw * 3, y - cw * 3, cw * 6, cw * 6);
      if (h.front) g.drawImage(this.glow!, x - cw * 3, v.surface(w.c) - ch * 0.6, cw * 6, ch * 2.2);
    }));
    g.restore();
    g.fillStyle = st.lit!;
    l.houses.forEach((h, k) => h.windows.forEach((w, j) => {
      if (v.lit[k]![j] && (w.r + 0.5) * ch < v.surface(w.c)) g.fillRect(w.c * cw + cw * 0.15, w.r * ch + ch * 0.2, cw * 0.7, ch * 0.6);
    }));
  }

  private paintSmoke(v: Valley, g: Draw2D) {
    const p = this.palette;
    const c = rgbOf(p.smoke.colour);
    for (const puffs of v.smoke) {
      for (const s of puffs) {
        const a = s.age / s.life;
        g.fillStyle = cssAlpha(c, p.smoke.alpha * (1 - a) * Math.min(1, a * 6));
        g.beginPath();
        g.arc(s.x, s.y, this.cw * (0.5 + 1.8 * a), 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
