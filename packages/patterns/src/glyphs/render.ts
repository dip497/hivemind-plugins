/**
 * Glyph Rain drawn in characters, far depth first: each stream's head, and its tail fading behind
 * it, brighter where a ring or the pointer has lit it; in the nearest depth, the characters lit
 * where no stream is (in every depth at once they pile up into a muddle of sizes); all of them
 * pushed aside where the pointer parts the columns. The sky is painted once per size and look and
 * copied in each frame; the characters are drawn each frame, grouped by depth and colour, so each
 * depth's font and each colour is set once.
 */
import { PatternCanvas } from "../canvas";
import { css, cssAlpha, mix, rgbOf, type Oklch } from "../colour";
import { RAIN_PALETTE, type RainPalette } from "./palette";
import { DEPTHS, GLYPHS, type Rain } from "./rain";

/** Levels of light: 0 not drawn, 1 … HEAD − 1 a tail from its faint end up, HEAD a head. */
const LEVELS = 16;
const HEAD = LEVELS - 1;

export class RainRenderer extends PatternCanvas<Rain, RainPalette> {
  private sky = new OffscreenCanvas(1, 1);
  private painted = false;
  /** Each depth's fill style at each level. */
  private styles: string[][] = [];
  /** What a frame draws, by level: x, y and character, in device pixels, one depth at a time. */
  private items = Array.from({ length: LEVELS }, () => ({ x: [] as number[], y: [] as number[], g: [] as number[] }));

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, RAIN_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    const sky = p.ground[1]!;
    const tailAt = (t: number): Oklch => (t > 0.5 ? lerp(p.tail[1], p.tail[0], (t - 0.5) * 2) : lerp(p.tail[2], p.tail[1], t * 2));
    this.styles = DEPTHS.map((d) => {
      const out: string[] = [""];
      for (let level = 1; level < HEAD; level++) {
        const t = level / (HEAD - 1);
        // The faintest end fades into the sky.
        const colour = rgbOf(tailAt(t));
        const faded = mix(rgbOf(sky), colour, Math.min(1, 0.25 + t * 1.5) * d.light);
        out.push(css(faded));
      }
      out.push(css(mix(rgbOf(sky), rgbOf(p.head), d.light)));
      return out;
    });
    this.painted = false;
  }

  protected sized() {
    this.painted = false;
  }

  /** The sky: its gradient top to bottom, and a soft light low in its middle. */
  private paintSky() {
    const { width: W, height: H, dpr } = this;
    if (this.sky.width !== this.canvas.width || this.sky.height !== this.canvas.height) {
      this.sky.width = this.canvas.width;
      this.sky.height = this.canvas.height;
    }
    const g = this.sky.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = this.palette;
    const grad = g.createLinearGradient(0, 0, 0, H);
    p.ground.forEach((c, i) => grad.addColorStop(i / (p.ground.length - 1), css(rgbOf(c))));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, Math.max(W, H) * 0.75);
    glow.addColorStop(0, cssAlpha(rgbOf(p.glow.colour), p.glow.alpha));
    glow.addColorStop(1, cssAlpha(rgbOf(p.glow.colour), 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    this.painted = true;
  }

  draw(rain: Rain) {
    if (!rain.layers.length || !this.width) return;
    if (!this.painted || this.stale) this.paintSky();
    this.stale = false;
    const g = this.ctx;
    const dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.sky, 0, 0);
    g.textAlign = "center";
    g.textBaseline = "middle";
    rain.layers.forEach((layer, k) => {
      const { cw, ch, cols, rows, glyphs, lit } = layer;
      for (const it of this.items) it.x.length = it.y.length = it.g.length = 0;
      const add = (c: number, r: number, level: number) => {
        const i = r * cols + c;
        const x = (c + 0.5) * cw;
        const y = (r + 0.5) * ch;
        const it = this.items[level]!;
        it.x.push((x + rain.push(x, y)) * dpr);
        it.y.push(y * dpr);
        it.g.push(glyphs[i]!);
      };
      // What a ring or the pointer lit where no stream is, in the nearest depth: drawn first, under
      // the streams.
      if (k === rain.layers.length - 1) for (const i of layer.litCells) {
        const level = Math.round(lit[i]! * (HEAD - 3));
        if (level > 0) add(i % cols, Math.floor(i / cols), level);
      }
      for (const s of layer.streams) {
        const top = Math.floor(s.head);
        for (let d = 0; d < s.length; d++) {
          const r = top - d;
          if (r < 0) break;
          if (r >= rows) continue;
          const glow = lit[r * cols + s.col]!;
          const level = d === 0 ? HEAD : Math.min(HEAD - 1, Math.max(1, Math.round((HEAD - 2) * Math.pow(1 - d / s.length, 1.25)) + 1 + Math.round(glow * 6)));
          add(s.col, r, level);
        }
      }
      g.font = `600 ${Math.round(layer.size * dpr)}px ${this.family}`;
      const styles = this.styles[k]!;
      for (let level = 1; level < LEVELS; level++) {
        const it = this.items[level]!;
        if (!it.x.length) continue;
        g.fillStyle = styles[level]!;
        for (let j = 0; j < it.x.length; j++) g.fillText(GLYPHS[it.g[j]!]!, it.x[j]!, it.y[j]!);
      }
    });
  }
}

/** `t` of the way from `a` to `b` in OKLCH, the short way round the hue. */
function lerp(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = b[2] - a[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + dh * t + 360) % 360];
}
