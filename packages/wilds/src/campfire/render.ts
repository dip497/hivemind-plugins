/**
 * Campfire's drawing. The picture, one pixel a cell: the sky and a crescent moon; firs round the
 * clearing in tiers of boughs, far ones paler, near ones black against the sky; the clearing's
 * ground, darker toward the bottom, tufts of grass along its edges; the woodpile; then, each frame,
 * the firelight breathing over everything near the fire (trees, ground, stones), the ring of stones,
 * the logs leaned together with their feet glowing, the fire itself from its field of heat (deep red
 * at its tips to white-yellow at its heart), and a log thrown on. That is drawn through characters
 * (ascii.ts): the firs' outlines come out as lines, the fire as a ramp in its own colours, and the
 * fire blooms. Over it, as characters of their own: the stars, the sparks, the smoke, the crickets.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, RAMP, type Rgb } from "../colour";
import { PictureRenderer } from "../look";
import { clamp, hash } from "../num";
import { paintSky } from "../sky";
import { BURN, type Camp } from "./camp";
import { firAt, type ClearingLayout } from "./clearing";
import { CAMPFIRE_PALETTE, type CampfirePalette } from "./palette";

const STAR_LEVELS = 3;
/** Shades of the fire's colour a frame picks from (each set once a frame). */
const LEVELS = 24;

export class CampfireRenderer extends PictureRenderer<CampfirePalette, Camp> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = -1;
  private stillLayout: ClearingLayout | null = null;
  private fireRamp: string[] = [];
  private stoneStyles: string[] = [];
  private barkStyle = "";
  private charStyle = "";
  private smokeStyles: string[] = [];
  private cricketStyle = "";
  private starStyles: string[] = [];
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, CAMPFIRE_PALETTE, { dim: 0.3, bloom: 0.8, wash: 0.2, night: [0.2, 0.92], day: [0.16, 0.5] });
  }

  protected styled() {
    const p = this.palette;
    const stops = p.fire.map(rgbOf);
    this.fireRamp = Array.from({ length: RAMP + 1 }, (_, i) => {
      const t = (i / RAMP) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(t));
      return css(mix(stops[k]!, stops[k + 1]!, t - k));
    });
    const stone = rgbOf(p.stone);
    const light = rgbOf(p.firelight);
    this.stoneStyles = [0, 0.3, 0.6].map((k) => css(mix(stone, light, k * p.warmth)));
    this.barkStyle = css(rgbOf(p.bark));
    this.charStyle = css(mix(rgbOf(p.bark), [20, 14, 12], this.light ? 0.4 : 0.6));
    const smoke = rgbOf(p.smoke);
    this.smokeStyles = [0.18, 0.3, 0.45, 0.6].map((a) => cssAlpha(smoke, a));
    this.cricketStyle = css(rgbOf(p.cricket));
    const top = rgbOf(p.sky[0]!);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, rgbOf(p.star), (p.stars * (l + 1)) / STAR_LEVELS))) : [];
  }

  /** What holds still: the sky, the moon, the firs, the ground, the woodpile. */
  private paintStill(layout: ClearingLayout) {
    const { cols, rows, cw, ch } = this;
    const p = this.palette;
    this.still.width = cols;
    this.still.height = rows;
    const g = this.still.getContext("2d")!;
    paintSky(g, cols, rows, p, ch / cw);
    // The crescent: the moon's disc, the shadowed part of it cut away.
    const moon = new OffscreenCanvas(cols, rows);
    const mg = moon.getContext("2d")!;
    const { x, y, r } = layout.moon;
    mg.fillStyle = css(rgbOf(p.moon));
    mg.beginPath();
    mg.ellipse(x / cw, y / ch, r / cw, r / ch, 0, 0, Math.PI * 2);
    mg.fill();
    mg.globalCompositeOperation = "destination-out";
    mg.beginPath();
    mg.ellipse((x + r * 0.45) / cw, (y - r * 0.2) / ch, (r * 0.92) / cw, (r * 0.92) / ch, 0, 0, Math.PI * 2);
    mg.fill();
    g.drawImage(moon, 0, 0);
    // The firs: far ones paler with the sky behind them, the near ones darkest.
    const far = rgbOf(p.far);
    const near = rgbOf(p.near);
    for (const f of layout.firs) {
      const sky = rgbOf(p.sky[Math.min(p.sky.length - 1, Math.round(((f.r + f.height * 0.5) / rows) * (p.sky.length - 1)))]!);
      const tone = mix(mix(far, near, f.near), sky, (1 - f.near) * (this.light ? 0.15 : 0.12));
      g.fillStyle = css(tone);
      g.beginPath();
      for (let r = f.r; r <= f.r + f.height; r++) {
        const { reach } = firAt(f, r);
        if (reach < 0) continue;
        g.rect(f.c - reach + 0.5, r, reach * 2, 1.02);
      }
      g.fill();
      // Its trunk under the boughs.
      g.fillRect(f.c, f.r + f.height, 1, 4);
    }
    // The clearing: darker toward the bottom; tufts of longer grass along its edges.
    const [ground, blade] = p.grass.map(rgbOf) as [Rgb, Rgb];
    const grad = g.createLinearGradient(0, layout.ground, 0, rows);
    grad.addColorStop(0, css(mix(ground, blade, 0.25)));
    grad.addColorStop(1, css(mix(ground, this.light ? blade : [0, 0, 0], this.light ? 0.2 : 0.35)));
    g.fillStyle = grad;
    g.fillRect(0, layout.ground, cols, rows - layout.ground);
    g.fillStyle = css(this.light ? mix(blade, [40, 60, 50], 0.35) : mix(ground, [0, 0, 0], 0.45));
    for (let c = 0; c < cols; c++) {
      const side = Math.abs((c + 0.5) / cols - 0.5) * 2;
      if (hash(c, 1, 77) > 0.12 + 0.5 * side ** 2) continue;
      const h = 1 + Math.floor(hash(c, 2, 77) * (2 + 4 * side));
      g.fillRect(c, rows - h, 1, h);
    }
    // The woodpile, logs end on.
    g.fillStyle = css(rgbOf(p.end));
    for (const e of layout.pile) g.fillRect(e.c, e.r, 1, 1);
  }

  private placeStars(layout: ClearingLayout) {
    const { width: W, height: H } = this;
    let s = 0xc1;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    this.stars = [];
    for (let i = Math.round((W * H) / 9000); i > 0; i--) {
      const x = r() * W;
      const y = r() * H * 0.42;
      const rate = 0.5 + r() * 1.7;
      const phase = r() * 6.28;
      if (Math.hypot(x - layout.moon.x, y - layout.moon.y) < layout.moon.r * 1.4) continue;
      // Not over a fir.
      const c = x / this.cw;
      const row = y / this.ch;
      if (layout.firs.some((f) => { const { reach } = firAt(f, Math.floor(row)); return reach >= 0 && Math.abs(c - f.c) < reach + 1; })) continue;
      this.stars.push({ x, y, rate, phase });
    }
  }

  protected paint(g: Draw2D, camp: Camp) {
    const layout = camp.layout;
    if (!layout || layout.grid.cols !== this.cols || layout.grid.rows !== this.rows) return;
    if (this.stillFor !== this.version || this.stillLayout !== layout) {
      this.stillFor = this.version;
      this.stillLayout = layout;
      this.paintStill(layout);
      this.placeStars(layout);
    }
    const t = camp.time;
    const p = this.palette;
    g.drawImage(this.still, 0, 0);
    const f = layout.fire;
    const strong = camp.strength();
    const flicker = 0.9 + 0.1 * Math.sin(t * 11.3) * Math.sin(t * 4.1 + 1);
    // The firelight: over everything near the fire, breathing with it.
    const fx = f.c + 0.5;
    const fy = f.base - f.height * 0.35;
    const reach = f.height * 2.6 * (0.85 + 0.15 * strong * flicker);
    g.save();
    g.translate(fx, fy);
    g.scale(1, this.cw / this.ch);
    const light = g.createRadialGradient(0, 0, 0, 0, 0, reach);
    const fl = rgbOf(p.firelight);
    light.addColorStop(0, cssAlpha(fl, (this.light ? 0.4 : 0.55) * Math.min(1.2, strong)));
    light.addColorStop(0.4, cssAlpha(fl, (this.light ? 0.16 : 0.22) * Math.min(1.2, strong)));
    light.addColorStop(1, cssAlpha(fl, 0));
    g.globalCompositeOperation = p.add ? "lighter" : "source-over";
    g.fillStyle = light;
    g.fillRect(-reach, -reach, reach * 2, reach * 2);
    g.restore();
    g.globalCompositeOperation = "source-over";
    // The ring of stones, lit on the side toward the fire; those behind it first.
    const stones = (front: boolean) => {
      for (const s of layout.stones) {
        if (s.front !== front) continue;
        for (let k = 0; k < s.width; k++) {
          const c = s.c + k;
          const toward = c < f.c ? k / Math.max(1, s.width - 1) : 1 - k / Math.max(1, s.width - 1);
          g.fillStyle = this.stoneStyles[Math.min(2, Math.round(toward * 2 * flicker))]!;
          g.fillRect(c, s.r, 1, 1);
        }
      }
    };
    stones(false);
    // The logs leaned together, their feet in the coals.
    for (const l of layout.logs) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(l.c1 - l.c0), Math.abs(l.r1 - l.r0) * 1.45)));
      for (let i = 0; i <= n; i++) {
        const c = Math.round(l.c0 + ((l.c1 - l.c0) * i) / n);
        const r = Math.round(l.r0 + ((l.r1 - l.r0) * i) / n);
        g.fillStyle = i < 2 ? this.fireRamp[Math.round((0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 6 + c))) * RAMP)]! : this.barkStyle;
        g.fillRect(c, r, 1, 1);
      }
    }
    // The fire: its field of heat, in its colours, grouped by shade; and its light, which blooms.
    const { fw, fh } = camp;
    const left = f.c - Math.floor(fw / 2);
    const top = f.base - fh;
    const floor = this.light ? 0.1 : 0.05;
    const lights = this.ascii.lit;
    for (let lv = 1; lv <= LEVELS; lv++) {
      const lo = lv / LEVELS;
      g.fillStyle = this.fireRamp[Math.round(clamp(lo, 0, 1) * RAMP)]!;
      lights.fillStyle = g.fillStyle;
      for (let i = 0; i < fw * fh; i++) {
        const h = camp.heat[i]!;
        if (h < floor || Math.min(LEVELS, 1 + Math.floor(h * LEVELS)) !== lv) continue;
        const c = left + (i % fw);
        const r = top + Math.floor(i / fw);
        g.fillRect(c, r, 1, 1);
        if (h > 0.35) lights.fillRect(c, r, 1, 1);
      }
    }
    stones(true);
    // A log thrown on: tumbling in, then lying across the fire's foot, burning down.
    for (const l of camp.logs) {
      const k = l.fall;
      const x = (k < 1 ? l.from.x + (l.to.x - l.from.x) * k : l.to.x) / this.cw;
      const y = (k < 1 ? l.from.y + (l.to.y - l.from.y) * k - Math.sin(Math.PI * k) * this.ch * 2.5 : l.to.y) / this.ch;
      const len = k < 1 ? 3 : Math.max(2, Math.round(5 * (0.4 + 0.6 * (1 - l.burned / BURN))));
      const tilt = k < 1 ? Math.sin(k * 9) : 0;
      for (let j = 0; j < len; j++) {
        g.fillStyle = k < 1 || l.burned < BURN * 0.4 ? this.barkStyle : this.charStyle;
        g.fillRect(Math.round(x - len / 2 + j), Math.round(y + (j - len / 2) * tilt), 1, 1);
      }
    }
  }

  protected overlay(g: Draw2D | null, camp: Camp) {
    const t = camp.time;
    const hold = (x: number, y: number) => this.ascii.hold(x, y);
    if (this.starStyles.length) {
      for (let l = 0; l < STAR_LEVELS; l++) {
        if (g) g.fillStyle = this.starStyles[l]!;
        for (const s of this.stars) {
          const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
          if (Math.min(STAR_LEVELS - 1, Math.floor(b * STAR_LEVELS)) !== l) continue;
          if (g) this.glyphAt(g, l === 2 ? "+" : l === 1 ? "." : "`", s.x, s.y);
          else hold(s.x, s.y);
        }
      }
    }
    // Smoke curling up: fading in off the flames, out as it spreads.
    for (let level = 0; level < 4; level++) {
      if (g) g.fillStyle = this.smokeStyles[level]!;
      for (const s of camp.smoke) {
        const k = s.age / s.life;
        const a = Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 - k);
        if (Math.min(3, Math.floor(a * 5)) !== level || a < 0.05) continue;
        if (!g) {
          hold(s.x, s.y);
          continue;
        }
        this.glyphAt(g, k < 0.15 ? "~" : k < 0.45 ? (Math.sin(s.age * 0.9 + s.phase) > 0 ? ")" : "(") : k < 0.7 ? "~" : ".", s.x, s.y);
      }
    }
    // Sparks rising, winking, cooling from yellow to red as they go out.
    const slot = Math.floor(t * 14);
    for (const s of camp.sparks) {
      const k = s.age / s.life;
      if (hash(Math.floor(s.phase * 1000), slot, 9) < 0.12 + 0.3 * k) continue;
      if (!g) {
        hold(s.x, s.y);
        continue;
      }
      g.fillStyle = this.fireRamp[Math.round((this.light ? 0.45 * (1 - k) + 0.05 : 1 - 0.6 * k) * RAMP)]!;
      this.glyphAt(g, k < 0.25 ? "*" : k < 0.6 ? "+" : ".", s.x, s.y);
    }
    if (g) g.fillStyle = this.cricketStyle;
    camp.layout.crickets.forEach((k, i) => {
      if (!camp.chirping(i)) return;
      const x = (k.c + 0.5) * this.cw;
      const y = (k.r + 0.5) * this.ch;
      if (g) this.glyphAt(g, i % 3 ? "." : "'", x, y);
      else hold(x, y);
    });
  }
}
