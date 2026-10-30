/**
 * Northern Lights' picture, which the character pass turns into characters: the sky above the land
 * in braille dots (each cell two columns of four), the land below in characters.
 *
 * The ground, crisp, painted once per size and look: the sky (by night indigo going teal; by day
 * dawn, a peach glow low where the sun will rise), the far ridge with light
 * along its top, the spruce along the horizon (narrow spires in tiers), the snow with shade in its
 * hollows and light on its crests, and a cabin by the trees, its window lit; then the stars, single
 * points, a few brighter, which the characters are not chosen from.
 *
 * The light, soft, each frame: the aurora, worked out a texel at a time from the curtains (`Tundra`'s
 * edge, folds, rays, strength and the pointer's pull), coloured by how far up its rays a texel is,
 * behind the ridge; its light on the snow; a shooting star's streak.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { PictureRenderer } from "../picture";
import { clamp, hash3, noise2 } from "../util";
import { ridgeAt, SPRUCE, STARS, starsFor } from "./land";
import { NORTHERN_LIGHTS_PALETTE, type NorthernLightsPalette } from "./palette";
import { HORIZON, PULL, Tundra } from "./tundra";

/** A curtain's light up its rays, tabled: u from -0.7 to 1.1, 200 a unit. */
const BASE = Float32Array.from({ length: 361 }, (_, i) => Tundra.base(-0.7 + i / 200));
const RISE = Float32Array.from({ length: 361 }, (_, i) => Tundra.rise(-0.7 + i / 200));
/** Its colour up its rays, tabled the same way. */
const HUES = 64;
/** Where the cabin stands, a share of the width. */
const CABIN = 0.68;

export class NorthernLightsRenderer extends PictureRenderer<NorthernLightsPalette, Tundra> {
  /** The aurora, a texel at a time: its light and colour summed, then made an image. */
  private auroraCanvas = new OffscreenCanvas(1, 1);
  private auroraImage: ImageData | null = null;
  private sum = new Float32Array(0);
  private hue: Rgb[] = [];
  private rayTable: Float32Array[] = [];
  /** The aurora's light on the snow: a row of each column's light, spread down the snow. */
  private glowRow = new OffscreenCanvas(1, 1);
  private glowRowImage: ImageData | null = null;
  private glowFall = new OffscreenCanvas(1, 1);
  private glowCols = new Float32Array(0);
  private st = {} as Record<string, string>;
  /** The far ridge's top (px) over each texel column of the picture; and the row the braille ends. */
  private ridgeY = new Float32Array(0);
  private brailleEnd = 0;

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
    const n = this.cols * 2;
    this.ridgeY = Float32Array.from({ length: n }, (_, i) => ridgeAt((i + 0.5) / n) * this.height);
    let top = Math.min(...this.ridgeY);
    for (const s of SPRUCE) top = Math.min(top, HORIZON * this.height - s.h * this.ch);
    this.brailleEnd = Math.max(0, Math.floor(top / this.ch));
  }

  protected brailleRows() {
    return this.brailleEnd;
  }

  protected timeOf(t: Tundra) {
    return t.time;
  }

  /** The sky, the far ridge, the spruce, the snow and the cabin. */
  protected paintGround(_t: Tundra, g: Draw2D) {
    const { width: W, height: H, cw, ch } = this;
    const p = this.palette;
    const y0 = H * HORIZON;
    const sky = g.createLinearGradient(0, 0, 0, y0);
    p.sky.forEach((c, i) => sky.addColorStop(i / (p.sky.length - 1), css(rgbOf(c))));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, y0 + 2);
    if (p.dawn) {
      // Where the sun will rise: a wide glow low over the horizon.
      g.save();
      g.translate(W * CABIN, y0);
      g.scale(1, 0.45);
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.55);
      glow.addColorStop(0, cssAlpha(rgbOf(p.dawn.colour), p.dawn.alpha));
      glow.addColorStop(0.4, cssAlpha(rgbOf(p.dawn.colour), p.dawn.alpha * 0.35));
      glow.addColorStop(1, cssAlpha(rgbOf(p.dawn.colour), 0));
      g.fillStyle = glow;
      g.fillRect(-W, -H * 2, W * 2, H * 2);
      g.restore();
    }
    // The far ridge, light along its top.
    g.save();
    g.beginPath();
    g.moveTo(0, y0 + ch);
    for (let x = 0; x <= W + cw; x += cw * 0.5) g.lineTo(x, ridgeAt(x / W) * H);
    g.lineTo(W, y0 + ch);
    g.closePath();
    g.fillStyle = css(rgbOf(p.ridge[0]));
    g.fill();
    g.clip();
    g.beginPath();
    for (let x = 0; x <= W + cw; x += cw * 0.5) g.lineTo(x, ridgeAt(x / W) * H);
    g.strokeStyle = cssAlpha(rgbOf(p.ridge[1]), 0.35);
    g.lineWidth = ch * 1.1;
    g.stroke();
    g.strokeStyle = css(rgbOf(p.ridge[1]));
    g.lineWidth = Math.max(1.5, ch * 0.18);
    g.stroke();
    g.restore();
    // The snow: lit near the trees, darker toward us; long drifts, shade in the hollow behind each
    // and light along its crest.
    const snow = g.createLinearGradient(0, y0, 0, H);
    snow.addColorStop(0, css(rgbOf(p.snow[0])));
    snow.addColorStop(1, css(rgbOf(p.snow[1])));
    g.fillStyle = snow;
    g.fillRect(0, y0, W, H - y0);
    // Drifts, nearer ones longer and further apart: each a crest catching the light and shade in the
    // hollow behind it.
    const hollow = rgbOf(p.hollow.colour);
    for (let k = 0; k < 9; k++) {
      const near = (k + 0.5) / 9;
      const yk = y0 + (H - y0) * (0.08 + 0.88 * near ** 1.3);
      const len = W * (0.18 + 0.3 * near) * (0.7 + 0.6 * hash3(k, 1, 73));
      const x0 = (hash3(k, 2, 73) * 1.3 - 0.15) * W;
      const crest = (x: number) => yk + (noise2(x / W * 3.2, k + 0.5, 71) - 0.5) * ch * (1 + 2 * near);
      const deep = ch * (0.8 + 2.2 * near);
      const steps = 24;
      const at = (s: number) => x0 + (len * s) / steps;
      const lift = (s: number) => Math.sin((Math.PI * s) / steps) * deep;
      const shade = g.createLinearGradient(0, yk - ch, 0, yk + deep);
      shade.addColorStop(0, cssAlpha(hollow, p.hollow.alpha));
      shade.addColorStop(1, cssAlpha(hollow, 0));
      g.fillStyle = shade;
      g.beginPath();
      for (let s = 0; s <= steps; s++) g.lineTo(at(s), crest(at(s)));
      for (let s = steps; s >= 0; s--) g.lineTo(at(s), crest(at(s)) + lift(s));
      g.closePath();
      g.fill();
      g.strokeStyle = cssAlpha(rgbOf(p.crest), 0.5);
      g.lineWidth = Math.max(1, ch * 0.1);
      g.beginPath();
      for (let s = 4; s <= steps - 4; s++) g.lineTo(at(s), crest(at(s)) - 1);
      g.stroke();
    }
    // The spruce: narrow spires in tiers.
    g.fillStyle = css(rgbOf(p.spruce));
    for (const s of SPRUCE) {
      const x = s.fx * W;
      const base = y0 + s.drop * ch * 0.6;
      const h = s.h * ch;
      const w = Math.min(h * 0.32, cw * 2.6);
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
      g.fillRect(x - cw * 0.12, base - ch * 0.2, cw * 0.24, ch * 0.5);
    }
    this.paintCabin(g);
  }

  /** A cabin by the trees: log walls, a steep roof under snow, a chimney; its window lit and the
   *  light lying out on the snow in front of it. */
  private paintCabin(g: Draw2D) {
    const { width: W, height: H, cw, ch } = this;
    const p = this.palette;
    const cx = W * CABIN;
    const cb = H * HORIZON + ch * 0.8;
    const win = rgbOf(p.window);
    const pool = g.createRadialGradient(cx + cw * 1.5, cb + ch * 0.8, 0, cx + cw * 1.5, cb + ch * 0.8, cw * 10);
    pool.addColorStop(0, cssAlpha(win, this.light ? 0.18 : 0.34));
    pool.addColorStop(1, cssAlpha(win, 0));
    g.save();
    g.translate(0, cb + ch * 0.8);
    g.scale(1, 0.35);
    g.translate(0, -(cb + ch * 0.8));
    g.fillStyle = pool;
    g.fillRect(cx - cw * 10, cb - ch * 6, cw * 24, ch * 16);
    g.restore();
    g.fillStyle = css(rgbOf(p.cabin));
    g.fillRect(cx + cw * 2, cb - ch * 3.6, cw * 0.9, ch * 1.2);
    g.fillRect(cx - cw * 4.5, cb - ch * 1.7, cw * 9, ch * 1.7);
    g.beginPath();
    g.moveTo(cx - cw * 5.4, cb - ch * 1.6);
    g.lineTo(cx, cb - ch * 3.5);
    g.lineTo(cx + cw * 5.4, cb - ch * 1.6);
    g.closePath();
    g.fill();
    // Snow on the roof, thicker toward the ridge.
    g.fillStyle = css(rgbOf(p.roof));
    g.beginPath();
    g.moveTo(cx - cw * 5.5, cb - ch * 1.55);
    g.lineTo(cx, cb - ch * 3.7);
    g.lineTo(cx + cw * 5.5, cb - ch * 1.55);
    g.lineTo(cx + cw * 4.6, cb - ch * 1.75);
    g.lineTo(cx, cb - ch * 3.25);
    g.lineTo(cx - cw * 4.6, cb - ch * 1.75);
    g.closePath();
    g.fill();
    g.fillRect(cx + cw * 1.95, cb - ch * 3.75, cw * 1, ch * 0.2);
    const glow = g.createRadialGradient(cx + cw * 1.6, cb - ch * 0.9, 0, cx + cw * 1.6, cb - ch * 0.9, cw * 6);
    glow.addColorStop(0, cssAlpha(win, this.light ? 0.25 : 0.5));
    glow.addColorStop(1, cssAlpha(win, 0));
    g.fillStyle = glow;
    g.fillRect(cx - cw * 6, cb - ch * 5, cw * 16, ch * 7);
    g.fillStyle = css(win);
    g.fillRect(cx + cw * 0.8, cb - ch * 1.25, cw * 1.6, ch * 0.7);
    g.fillStyle = css(rgbOf(p.cabin));
    g.fillRect(cx + cw * 1.52, cb - ch * 1.25, cw * 0.16, ch * 0.7);
  }

  /** The stars, single points (a few brighter), over the sky but not behind the ridge or the trees. */
  protected paintDetail(_t: Tundra, g: Draw2D) {
    const p = this.palette;
    if (!p.stars) return;
    const { width: W, height: H, dpr } = this;
    const star = rgbOf(p.stars);
    const px = 1 / dpr;
    const n = Math.min(STARS.length, Math.round(starsFor(W, H) * 1.4));
    for (let k = 0; k < n; k++) {
      const s = STARS[k]!;
      const x = Math.round(s.fx * W * dpr) / dpr;
      const y = Math.round(s.fy * H * dpr) / dpr;
      if (y > ridgeAt(s.fx) * H - 3) continue;
      // Thicker along the Milky Way.
      const inBand = Math.abs((y - H * 0.3) * Math.cos(0.42) + (x - W * 0.5) * Math.sin(0.42)) < H * 0.12;
      if (!inBand && k >= n / 1.4 && hash3(k, 3, 5) < 0.8) continue;
      if (s.mag > 0.85) {
        const glow = g.createRadialGradient(x + px, y + px, 0, x + px, y + px, 3.5);
        glow.addColorStop(0, cssAlpha(star, 0.35));
        glow.addColorStop(1, cssAlpha(star, 0));
        g.fillStyle = glow;
        g.fillRect(x - 3, y - 3, 8, 8);
        g.fillStyle = css(star);
        g.fillRect(x, y, px * 2, px * 2);
      } else {
        g.fillStyle = cssAlpha(star, 0.3 + 0.7 * Math.sqrt(s.mag));
        g.fillRect(x, y, px, px);
      }
    }
  }

  protected paintLight(t: Tundra, g: Draw2D) {
    this.paintAurora(t, g);
    this.paintMeteors(t, g);
    this.paintDrift(t, g);
  }

  /** The aurora a texel at a time, each curtain over the columns it reaches, behind the ridge; and
   *  given back faintly by the snow. It is light added to the sky: by day only a faint glow. */
  private paintAurora(t: Tundra, g: Draw2D) {
    const { width: W, height: H } = this;
    const pw = this.lightLayer.width;
    const ph = this.lightLayer.height;
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
    for (let k = 0; k < t.curtains.length; k++) {
      const tab = this.rayTable[k]!;
      const reach = H * t.curtains[k]!.reach;
      for (let i = 0; i < pw; i++) {
        const x = (i + 0.5) * tx;
        const along = t.along(k, x) * p.strength;
        if (along < 0.02) continue;
        const base = t.edge(k, x);
        const fold = t.fold(k, x);
        const lean = t.lean(x);
        const gx = pull > 0 ? 0.9 * pull * Math.exp(-(((x - t.at.x) / across) ** 2)) : 0;
        const j0 = Math.max(0, Math.floor((base - reach * 1.06) / ty));
        const j1 = Math.min(ph - 1, Math.floor(Math.min(this.ridgeY[i] ?? H, base + reach * 0.7) / ty));
        const upright = tab[Math.min(n - 1, ((x + W / 2) / 4 + 0.5) | 0)]!;
        for (let j = j0; j <= j1; j++) {
          const y = (j + 0.5) * ty;
          const u = (base - y) / reach;
          const at = ((u + 0.7) * 200 + 0.5) | 0;
          if (at < 0 || at > 360) continue;
          const b = BASE[at]!;
          const rise = RISE[at]!;
          if (b + rise < 0.004) continue;
          const r = lean === 0 ? upright : tab[Math.max(0, Math.min(n - 1, ((x + lean * (base - y) + W / 2) / 4 + 0.5) | 0))]!;
          let light = along * fold * (b + rise * r * r);
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
    // The light, added to the sky: by day only a faint glow of it.
    const px = this.auroraImage!.data;
    const veil = p.veil;
    for (let d = 0; d < sum.length; d += 4) {
      const w = sum[d + 3]!;
      if (w <= 0) {
        px[d] = px[d + 1] = px[d + 2] = px[d + 3] = 0;
        continue;
      }
      px[d] = Math.min(255, sum[d]! * veil);
      px[d + 1] = Math.min(255, sum[d + 1]! * veil);
      px[d + 2] = Math.min(255, sum[d + 2]! * veil);
      px[d + 3] = 255;
    }
    this.auroraCanvas.getContext("2d")?.putImageData(this.auroraImage!, 0, 0);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.auroraCanvas, 0, 0);
    g.restore();
    if (p.reflect > 0) this.paintGlowOnSnow(g, pw, ph);
  }

  /** The aurora is light: added to the sky by day too, faintly. */
  protected lightAdds() {
    return true;
  }

  /** The aurora's light on the snow: each column's light, summed up the sky, lying on the snow
   *  below it, strongest by the trees and fading toward us. */
  private paintGlowOnSnow(g: Draw2D, pw: number, ph: number) {
    const sum = this.sum;
    const horizon = Math.round(HORIZON * ph);
    if (this.glowRow.width !== pw) {
      this.glowRow.width = pw;
      this.glowRowImage = new ImageData(pw, 1);
    }
    const row = this.glowRowImage!.data;
    const cols = this.glowCols.length === pw * 3 ? this.glowCols : (this.glowCols = new Float32Array(pw * 3));
    for (let i = 0; i < pw; i++) {
      let r = 0;
      let gr = 0;
      let b = 0;
      for (let j = 0; j < horizon; j++) {
        const d = (j * pw + i) * 4;
        r += sum[d]!;
        gr += sum[d + 1]!;
        b += sum[d + 2]!;
      }
      cols[i * 3] = r;
      cols[i * 3 + 1] = gr;
      cols[i * 3 + 2] = b;
    }
    // Spread along the snow: each column takes the light of the sky a few columns either side.
    const k = this.palette.reflect / Math.max(1, horizon * 0.12) / 17;
    for (let i = 0; i < pw; i++) {
      let r = 0;
      let gr = 0;
      let b = 0;
      for (let j = Math.max(0, i - 8); j <= Math.min(pw - 1, i + 8); j++) {
        r += cols[j * 3]!;
        gr += cols[j * 3 + 1]!;
        b += cols[j * 3 + 2]!;
      }
      row[i * 4] = Math.min(255, r * k);
      row[i * 4 + 1] = Math.min(255, gr * k);
      row[i * 4 + 2] = Math.min(255, b * k);
      row[i * 4 + 3] = 255;
    }
    this.glowRow.getContext("2d")?.putImageData(this.glowRowImage!, 0, 0);
    const fall = this.glowFall;
    fall.width = pw;
    fall.height = ph - horizon;
    const f = fall.getContext("2d");
    if (!f) return;
    f.globalCompositeOperation = "source-over";
    f.imageSmoothingEnabled = true;
    f.drawImage(this.glowRow, 0, 0, pw, fall.height);
    f.globalCompositeOperation = "destination-in";
    const fade = f.createLinearGradient(0, 0, 0, fall.height);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    f.fillStyle = fade;
    f.fillRect(0, 0, pw, fall.height);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.drawImage(fall, 0, horizon);
    g.restore();
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
      g.lineWidth = this.ch * 0.35;
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
