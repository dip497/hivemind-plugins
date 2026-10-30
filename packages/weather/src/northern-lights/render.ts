/**
 * Northern Lights' picture, which the character pass turns into characters: the sky above the
 * spruce in braille dots (each cell two columns of four), the land below in characters.
 *
 * Painted once per size and look (`still`): the sky, the Milky Way and the stars by night or the low
 * sun with its halo and sun dogs by day, the spruce along the horizon (narrow spires in tiers, a
 * silhouette), the snow, and a cabin with a lit window by the trees. Each frame over a copy of it:
 * the aurora, worked out a texel at a time from the curtains (`Tundra`'s edge, rays, strength and
 * the pointer's pull) and coloured by how far up its rays a texel is; its light on the snow; a few
 * stars brighter as they twinkle; a shooting star's streak; snow blowing along the ground.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { PictureRenderer } from "../picture";
import { clamp, hash3, noise2 } from "../util";
import { SPRUCE, STARS, starsFor } from "./land";
import { NORTHERN_LIGHTS_PALETTE, type NorthernLightsPalette } from "./palette";
import { HORIZON, PULL, Tundra } from "./tundra";

/** A curtain's light up its rays, tabled: u from -0.3 to 1.1. */
const PROFILE = Float32Array.from({ length: 281 }, (_, i) => Tundra.profile(-0.3 + i / 200));
/** Its colour up its rays, tabled the same way. */
const HUES = 64;

export class NorthernLightsRenderer extends PictureRenderer<NorthernLightsPalette, Tundra> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = -1;
  /** The aurora, a texel at a time: its light and colour summed, then made an image. */
  private auroraCanvas = new OffscreenCanvas(1, 1);
  private auroraImage: ImageData | null = null;
  private sum = new Float32Array(0);
  private hue: Rgb[] = [];
  private rayTable: Float32Array[] = [];
  private st = {} as Record<string, string>;
  /** The topmost row of the spruce: the braille rows end there. */
  private treeTop = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, NORTHERN_LIGHTS_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    const stops = p.aurora.map(rgbOf);
    // Under the edge, the edge, then up: u at -0.15, 0, 0.25, 0.5, 0.75, 1.
    const at = [-0.15, 0, 0.25, 0.5, 0.75, 1];
    this.hue = Array.from({ length: HUES }, (_, k) => {
      const u = -0.3 + (1.4 * k) / (HUES - 1);
      let i = 0;
      while (i < at.length - 2 && u > at[i + 1]!) i++;
      return mix(stops[i]!, stops[i + 1]!, clamp((u - at[i]!) / (at[i + 1]! - at[i]!), 0, 1));
    });
    this.st = { meteor: css(rgbOf(p.meteor)), drift: p.drift ? css(rgbOf(p.drift)) : "", star: p.stars ? css(rgbOf(p.stars)) : "" };
  }

  protected laidOut() {
    let top = this.rows;
    for (const s of SPRUCE) top = Math.min(top, Math.floor(((HORIZON * this.height) - s.h * this.ch) / this.ch));
    this.treeTop = Math.max(0, top);
  }

  protected brailleRows() {
    return this.treeTop;
  }

  protected timeOf(t: Tundra) {
    return t.time;
  }

  /** The sky, the stars or the sun, the spruce, the snow and the cabin. */
  private paintStill() {
    const g = this.layer(this.still);
    const { width: W, height: H } = this;
    const p = this.palette;
    const y0 = H * HORIZON;
    const sky = g.createLinearGradient(0, 0, 0, y0);
    p.sky.forEach((c, i) => sky.addColorStop(i / (p.sky.length - 1), css(rgbOf(c))));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, y0 + 2);
    if (p.milky) {
      // The Milky Way: a faint band across the sky, from low on the left to high on the right.
      g.save();
      g.translate(W * 0.5, H * 0.3);
      g.rotate(-0.42);
      const band = g.createLinearGradient(0, -H * 0.14, 0, H * 0.14);
      band.addColorStop(0, cssAlpha(rgbOf(p.milky.colour), 0));
      band.addColorStop(0.5, cssAlpha(rgbOf(p.milky.colour), p.milky.alpha));
      band.addColorStop(1, cssAlpha(rgbOf(p.milky.colour), 0));
      g.fillStyle = band;
      g.fillRect(-W, -H * 0.14, W * 2, H * 0.28);
      g.restore();
    }
    if (p.stars) {
      const star = rgbOf(p.stars);
      const tx = W / this.pic.width;
      const ty = H / this.pic.height;
      for (const s of STARS.slice(0, starsFor(W, H) * 2)) {
        const x = s.fx * W;
        const y = s.fy * H;
        // More of them along the Milky Way.
        const inBand = Math.abs((y - H * 0.3) * Math.cos(0.42) + (x - W * 0.5) * Math.sin(0.42)) < H * 0.12;
        if (!inBand && s.mag < 0.05 && hash3(Math.round(x), Math.round(y), 3) < 0.5) continue;
        g.fillStyle = cssAlpha(star, 0.35 + 0.65 * s.mag);
        g.fillRect(x, y, tx, ty);
        if (s.mag > 0.95) {
          g.fillRect(x - tx, y, tx * 3, ty);
          g.fillRect(x, y - ty, tx, ty * 3);
        }
      }
    }
    if (p.sun) this.paintSun(g, p.sun);
    // The snow, lit by the sky above it near the trees.
    const snow = g.createLinearGradient(0, y0, 0, H);
    snow.addColorStop(0, css(rgbOf(p.snow[0])));
    snow.addColorStop(1, css(rgbOf(p.snow[1])));
    g.fillStyle = snow;
    g.fillRect(0, y0, W, H - y0);
    // Long soft drifts: a little shade under each, no hard line.
    for (let k = 0; k < 4; k++) {
      const y = y0 + (H - y0) * (0.25 + 0.2 * k);
      const shade = g.createLinearGradient(0, y - this.ch, 0, y + this.ch * 1.5);
      const c = rgbOf(this.light ? [0.8, 0.03, 245] : [0.1, 0.03, 250]);
      shade.addColorStop(0, cssAlpha(c, 0));
      shade.addColorStop(0.5, cssAlpha(c, this.light ? 0.12 : 0.18));
      shade.addColorStop(1, cssAlpha(c, 0));
      g.fillStyle = shade;
      g.fillRect(0, y - this.ch, W, this.ch * 2.5);
    }
    if (p.sun) {
      // By day the low sun beyond the trees casts each one's long shadow toward us.
      const sx = W * 0.72;
      g.save();
      g.filter = `blur(${(this.cw * 0.25).toFixed(1)}px)`;
      g.fillStyle = cssAlpha(rgbOf([0.8, 0.05, 245]), 0.28);
      for (const s of SPRUCE) {
        if (s.h < 6) continue;
        const x = s.fx * W;
        const w = Math.min(s.h * this.ch * 0.16, this.cw * 1.6);
        const reach = (H - y0) * (0.6 + s.h / 20);
        const lean = (x - sx) * 0.9;
        g.beginPath();
        g.moveTo(x - w, y0);
        g.lineTo(x + w, y0);
        g.lineTo(x + lean * 1.05 + w * 0.3, y0 + reach);
        g.lineTo(x + lean * 0.95 - w * 0.3, y0 + reach);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    // The spruce, back ones first: narrow spires in tiers.
    g.fillStyle = css(rgbOf(p.spruce));
    for (const s of SPRUCE) {
      const x = s.fx * W;
      const base = y0 + s.drop * this.ch * 0.6;
      const h = s.h * this.ch;
      const w = Math.min(h * 0.32, this.cw * 2.6);
      g.beginPath();
      g.moveTo(x, base - h);
      const tiers = Math.max(2, Math.round(s.h / 2.2));
      for (let k = 1; k <= tiers; k++) {
        const ty = base - h + (h * k) / tiers;
        const tw = (w * k) / tiers;
        g.lineTo(x + tw, ty);
        if (k < tiers) g.lineTo(x + tw * 0.55, ty);
      }
      for (let k = tiers; k >= 1; k--) {
        const ty = base - h + (h * k) / tiers;
        const tw = (w * k) / tiers;
        if (k < tiers) g.lineTo(x - tw * 0.55, ty);
        g.lineTo(x - tw, ty);
      }
      g.closePath();
      g.fill();
    }
    // A cabin by the trees, its window lit.
    const cx = W * 0.68;
    const cb = y0 + this.ch * 0.8;
    g.fillStyle = css(rgbOf(p.cabin));
    g.beginPath();
    g.moveTo(cx - this.cw * 4.5, cb);
    g.lineTo(cx - this.cw * 4.5, cb - this.ch * 1.6);
    g.lineTo(cx - this.cw * 5.2, cb - this.ch * 1.6);
    g.lineTo(cx, cb - this.ch * 3.4);
    g.lineTo(cx + this.cw * 5.2, cb - this.ch * 1.6);
    g.lineTo(cx + this.cw * 4.5, cb - this.ch * 1.6);
    g.lineTo(cx + this.cw * 4.5, cb);
    g.closePath();
    g.fill();
    const win = rgbOf(p.window);
    const glow = g.createRadialGradient(cx + this.cw * 1.5, cb - this.ch * 0.9, 0, cx + this.cw * 1.5, cb - this.ch * 0.9, this.cw * 7);
    glow.addColorStop(0, cssAlpha(win, this.light ? 0.25 : 0.5));
    glow.addColorStop(1, cssAlpha(win, 0));
    g.fillStyle = glow;
    g.fillRect(cx - this.cw * 8, cb - this.ch * 4, this.cw * 18, this.ch * 6);
    g.fillStyle = css(win);
    g.fillRect(cx + this.cw * 0.6, cb - this.ch * 1.3, this.cw * 1.8, this.ch * 0.8);
    // Its light lies out on the snow in front of it.
    const pool = g.createRadialGradient(cx + this.cw * 2, cb + this.ch * 1.2, 0, cx + this.cw * 2, cb + this.ch * 1.2, this.cw * 9);
    pool.addColorStop(0, cssAlpha(win, this.light ? 0.12 : 0.32));
    pool.addColorStop(1, cssAlpha(win, 0));
    g.save();
    g.translate(0, cb + this.ch * 1.2);
    g.scale(1, 0.4);
    g.translate(0, -(cb + this.ch * 1.2));
    g.fillStyle = pool;
    g.fillRect(cx - this.cw * 8, cb - this.ch * 6, this.cw * 20, this.ch * 16);
    g.restore();
  }

  /** The low sun: its disc and glow, its halo a thin ring a little warm inside and cool outside,
   *  and a sun dog on the halo either side, bright, with a short tail outward. */
  private paintSun(g: Draw2D, sun: NonNullable<NorthernLightsPalette["sun"]>) {
    const { width: W, height: H } = this;
    const sx = W * 0.72;
    const sy = H * (HORIZON - 0.16);
    const R = H * 0.26;
    const disc = rgbOf(sun.disc);
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.34);
    glow.addColorStop(0, cssAlpha(disc, 0.6));
    glow.addColorStop(0.15, cssAlpha(disc, 0.25));
    glow.addColorStop(1, cssAlpha(disc, 0));
    g.fillStyle = glow;
    g.fillRect(sx - H * 0.4, sy - H * 0.4, H * 0.8, H * 0.8);
    g.lineWidth = Math.max(2, this.ch * 0.35);
    for (const [k, c] of [[-1, sun.halo[0]], [1, sun.halo[1]]] as const) {
      g.strokeStyle = cssAlpha(rgbOf(c), 0.75);
      g.beginPath();
      g.arc(sx, sy, R + k * g.lineWidth * 0.5, Math.PI * 1.02, Math.PI * 1.98);
      g.stroke();
    }
    const dog = rgbOf(sun.dog);
    for (const side of [-1, 1]) {
      const x = sx + side * R * 1.04;
      const d = g.createRadialGradient(x, sy, 0, x, sy, this.cw * 3);
      d.addColorStop(0, cssAlpha(dog, 1));
      d.addColorStop(1, cssAlpha(dog, 0));
      g.fillStyle = d;
      g.fillRect(x - this.cw * 3, sy - this.cw * 3, this.cw * 6, this.cw * 6);
      g.fillStyle = cssAlpha(dog, 0.4);
      g.fillRect(side > 0 ? x : x - this.cw * 7, sy - this.ch * 0.15, this.cw * 7, this.ch * 0.3);
    }
    g.fillStyle = css(disc);
    g.beginPath();
    g.arc(sx, sy, Math.max(this.cw * 1.4, H * 0.02), 0, Math.PI * 2);
    g.fill();
  }

  protected paint(t: Tundra, g: Draw2D) {
    if (this.stillFor !== this.version) {
      this.paintStill();
      this.stillFor = this.version;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.still, 0, 0);
    this.paintAurora(t, g);
    g.setTransform(this.pic.width / this.width, 0, 0, this.pic.height / this.height, 0, 0);
    this.paintTwinkle(t, g);
    this.paintMeteors(t, g);
    this.paintDrift(t, g);
  }

  /** The aurora a texel at a time, each curtain over the columns it reaches; then laid over the
   *  sky (added to it by night, tinting it by day), and given back faintly by the snow. */
  private paintAurora(t: Tundra, g: Draw2D) {
    const { width: W, height: H } = this;
    const pw = this.pic.width;
    const ph = this.pic.height;
    const p = this.palette;
    if (this.sum.length !== pw * ph * 4) {
      this.sum = new Float32Array(pw * ph * 4);
      this.auroraCanvas.width = pw;
      this.auroraCanvas.height = ph;
      this.auroraImage = new ImageData(pw, ph);
    }
    const sum = this.sum;
    sum.fill(0);
    const tx = W / pw;
    const ty = H / ph;
    const n = Math.ceil(W / 4) + 2;
    for (let k = 0; k < t.curtains.length; k++) {
      const tab = this.rayTable[k]?.length === n ? this.rayTable[k]! : (this.rayTable[k] = new Float32Array(n));
      for (let i = 0; i < n; i++) tab[i] = t.rays(k, i * 4 - W / 2);
    }
    const pull = t.pull;
    const across = W * PULL.across;
    const down = H * PULL.down;
    const yMax = H * HORIZON;
    for (let k = 0; k < t.curtains.length; k++) {
      const tab = this.rayTable[k]!;
      const reach = H * t.curtains[k]!.reach;
      for (let i = 0; i < pw; i++) {
        const x = (i + 0.5) * tx;
        const along = t.along(k, x) * p.strength;
        if (along < 0.02) continue;
        const base = t.edge(k, x);
        const lean = t.lean(x);
        const gx = pull > 0 ? 0.9 * pull * Math.exp(-(((x - t.at.x) / across) ** 2)) : 0;
        const j0 = Math.max(0, Math.floor((base - reach * 1.02) / ty));
        const j1 = Math.min(ph - 1, Math.floor(Math.min(yMax, base + reach * 0.16) / ty));
        const upright = tab[Math.min(n - 1, ((x + W / 2) / 4 + 0.5) | 0)]!;
        for (let j = j0; j <= j1; j++) {
          const y = (j + 0.5) * ty;
          const u = (base - y) / reach;
          const at = ((u + 0.3) * 200 + 0.5) | 0;
          if (at < 0 || at > 280) continue;
          const pu = PROFILE[at]!;
          if (pu < 0.01) continue;
          const r = lean === 0 ? upright : tab[Math.max(0, Math.min(n - 1, ((x + lean * (base - y) + W / 2) / 4 + 0.5) | 0))]!;
          let light = along * (0.06 + 0.94 * r) * pu;
          if (gx) light *= 1 + gx * Math.exp(-(((y - t.at.y) / down) ** 2));
          const c = this.hue[clamp(Math.round(((u + 0.3) / 1.4) * (HUES - 1)), 0, HUES - 1)]!;
          const d = (j * pw + i) * 4;
          sum[d] = sum[d]! + c[0] * light;
          sum[d + 1] = sum[d + 1]! + c[1] * light;
          sum[d + 2] = sum[d + 2]! + c[2] * light;
          sum[d + 3] = sum[d + 3]! + light;
        }
      }
    }
    const img = this.auroraImage!;
    const px = img.data;
    const add = !this.light;
    for (let d = 0; d < sum.length; d += 4) {
      const w = sum[d + 3]!;
      if (w <= 0) {
        px[d + 3] = 0;
        continue;
      }
      if (add) {
        px[d] = Math.min(255, sum[d]!);
        px[d + 1] = Math.min(255, sum[d + 1]!);
        px[d + 2] = Math.min(255, sum[d + 2]!);
        px[d + 3] = 255;
      } else {
        px[d] = sum[d]! / w;
        px[d + 1] = sum[d + 1]! / w;
        px[d + 2] = sum[d + 2]! / w;
        px[d + 3] = Math.min(255, w * 255);
      }
    }
    const a = this.auroraCanvas.getContext("2d");
    if (!a) return;
    a.putImageData(img, 0, 0);
    g.globalCompositeOperation = add ? "lighter" : "source-over";
    g.drawImage(this.auroraCanvas, 0, 0);
    // Its light on the snow: the sky's aurora turned over, softer, fainter.
    const horizon = HORIZON * ph;
    g.globalAlpha = p.reflect;
    g.save();
    g.beginPath();
    g.rect(0, horizon, pw, ph - horizon);
    g.clip();
    g.setTransform(1, 0, 0, -0.6, 0, horizon * 1.6);
    g.drawImage(this.auroraCanvas, 0, 0);
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  private paintTwinkle(t: Tundra, g: Draw2D) {
    if (!this.st.star) return;
    const { width: W, height: H } = this;
    g.fillStyle = this.st.star;
    const tx = W / this.pic.width;
    const ty = H / this.pic.height;
    const n = starsFor(W, H);
    for (let k = 0; k < n; k++) {
      const s = STARS[k]!;
      if (!s.rate || Math.sin(t.time * s.rate + s.fx * 97) < 0.7) continue;
      g.fillRect(s.fx * W, s.fy * H, tx, ty);
    }
  }

  /** A shooting star: a bright head and a streak behind it, fading. */
  private paintMeteors(t: Tundra, g: Draw2D) {
    const H = this.height;
    const c = rgbOf(this.palette.meteor);
    for (const m of t.meteors) {
      const fade = Math.sin(Math.PI * clamp(m.age / m.life, 0, 1));
      const speed = Math.hypot(m.vx, m.vy) || 1;
      const len = Math.min(speed * 0.22, H * 0.3);
      const x1 = m.x - (m.vx / speed) * len;
      const y1 = m.y - (m.vy / speed) * len;
      const grad = g.createLinearGradient(m.x, m.y, x1, y1);
      grad.addColorStop(0, cssAlpha(c, fade));
      grad.addColorStop(1, cssAlpha(c, 0));
      g.strokeStyle = grad;
      g.lineWidth = this.ch * 0.4;
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(x1, y1);
      g.stroke();
    }
  }

  private paintDrift(t: Tundra, g: Draw2D) {
    if (!this.st.drift) return;
    g.fillStyle = this.st.drift;
    for (const d of t.drift) g.fillRect(d.x, d.y + Math.sin(t.time * 3 + d.phase) * 3, this.cw * 1.4, this.ch * 0.25);
  }
}
