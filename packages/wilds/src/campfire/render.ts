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
import type { ClearingLayout } from "./clearing";
import { CAMPFIRE_PALETTE, CAMPFIRE_TONES, type CampfirePalette } from "./palette";

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
    super(canvas, CAMPFIRE_PALETTE, CAMPFIRE_TONES);
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

  /** What holds still, at full size: the sky, the crescent, the firs, the ground, the woodpile. */
  private paintStill(layout: ClearingLayout) {
    const { cols, rows, cw, ch, dpr } = this;
    const p = this.palette;
    this.still.width = Math.round(cols * cw * dpr);
    this.still.height = Math.round(rows * ch * dpr);
    const g = this.still.getContext("2d")!;
    g.setTransform(cw * dpr, 0, 0, ch * dpr, 0, 0);
    paintSky(g, cols, rows, p, ch / cw);
    // The crescent: the moon's disc, its shadowed part cut away, with a faint glow.
    const { x, y, r } = layout.moon;
    const moon = new OffscreenCanvas(this.still.width, this.still.height);
    const mg = moon.getContext("2d")!;
    mg.setTransform(cw * dpr, 0, 0, ch * dpr, 0, 0);
    mg.fillStyle = css(rgbOf(p.moon));
    mg.beginPath();
    mg.ellipse(x / cw, y / ch, r / cw, r / ch, 0, 0, Math.PI * 2);
    mg.fill();
    mg.globalCompositeOperation = "destination-out";
    mg.beginPath();
    mg.ellipse((x + r * 0.45) / cw, (y - r * 0.2) / ch, (r * 0.92) / cw, (r * 0.92) / ch, 0, 0, Math.PI * 2);
    mg.fill();
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(moon, 0, 0);
    g.restore();
    // The firs: broad, in drooping tiers of boughs, far ones paler with the sky behind them.
    const far = rgbOf(p.far);
    const near = rgbOf(p.near);
    for (const f of layout.firs) {
      const sky = rgbOf(p.sky[Math.min(p.sky.length - 1, Math.round(((f.r + f.height * 0.5) / rows) * (p.sky.length - 1)))]!);
      g.fillStyle = css(mix(mix(far, near, f.near), sky, (1 - f.near) * 0.12));
      const tiers = Math.max(3, Math.min(5, f.tiers));
      const wide = f.height * 0.48 * (ch / cw) * 0.62;
      g.beginPath();
      g.moveTo(f.c + 0.5, f.r);
      for (let i = 1; i <= tiers; i++) {
        const yb = f.r + (f.height * i) / tiers;
        const w = (wide * i) / tiers;
        g.quadraticCurveTo(f.c + 0.5 + w * 0.45, yb - (f.height / tiers) * 0.35, f.c + 0.5 + w, yb);
        if (i < tiers) g.lineTo(f.c + 0.5 + w * 0.5, yb - 0.2);
      }
      for (let i = tiers; i >= 1; i--) {
        const yb = f.r + (f.height * i) / tiers;
        const w = (wide * i) / tiers;
        if (i < tiers) g.lineTo(f.c + 0.5 - w * 0.5, yb - 0.2);
        g.lineTo(f.c + 0.5 - w, yb);
        g.quadraticCurveTo(f.c + 0.5 - w * 0.45, yb - (f.height / tiers) * 0.35, f.c + 0.5 - (wide * (i - 1)) / tiers, f.r + (f.height * (i - 1)) / tiers);
      }
      g.closePath();
      g.fill();
      g.fillRect(f.c + 0.2, f.r + f.height - 0.2, 0.6, 3);
    }
    // The clearing: clean, darker toward the bottom.
    const [ground, blade] = p.grass.map(rgbOf) as [Rgb, Rgb];
    const grad = g.createLinearGradient(0, layout.ground, 0, rows);
    grad.addColorStop(0, css(mix(ground, blade, 0.3)));
    grad.addColorStop(1, css(mix(ground, this.light ? blade : [0, 0, 0], this.light ? 0.25 : 0.4)));
    g.fillStyle = grad;
    g.fillRect(0, layout.ground, cols, rows - layout.ground);
    // The woodpile: logs end on, their rings showing.
    for (const e of layout.pile) {
      g.fillStyle = css(rgbOf(p.bark));
      g.beginPath();
      g.ellipse(e.c + 0.5, e.r + 0.5, 0.9, 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(rgbOf(p.end));
      g.beginPath();
      g.ellipse(e.c + 0.5, e.r + 0.5, 0.6, 0.4, 0, 0, Math.PI * 2);
      g.fill();
    }
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
      if (layout.firs.some((f) => row >= f.r - 1 && row <= f.r + f.height && Math.abs(c - f.c - 0.5) < ((row - f.r + 1) / f.height) * f.height * 0.3 * (this.ch / this.cw) + 1.5)) continue;
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
    g.drawImage(this.still, 0, 0, this.cols, this.rows);
    const f = layout.fire;
    const strong = camp.strength();
    const flicker = 0.9 + 0.1 * Math.sin(t * 11.3) * Math.sin(t * 4.1 + 1);
    const fl = rgbOf(p.firelight);
    // The firelight over everything near the fire, round and smooth, breathing with it.
    const fx = f.c + 0.5;
    const fy = f.base - f.height * 0.3;
    const reach = f.height * 2.4 * (0.88 + 0.12 * strong * flicker);
    g.save();
    g.translate(fx, fy);
    g.scale(1, this.cw / this.ch);
    const light = g.createRadialGradient(0, 0, 0, 0, 0, reach);
    light.addColorStop(0, cssAlpha(fl, (this.light ? 0.38 : 0.5) * Math.min(1.2, strong)));
    light.addColorStop(0.35, cssAlpha(fl, (this.light ? 0.16 : 0.2) * Math.min(1.2, strong)));
    light.addColorStop(1, cssAlpha(fl, 0));
    g.globalCompositeOperation = p.add ? "lighter" : "source-over";
    g.fillStyle = light;
    g.fillRect(-reach, -reach, reach * 2, reach * 2);
    g.restore();
    g.globalCompositeOperation = "source-over";
    // A log to sit on, by the fire, lit on its fire side.
    const seat = { x0: f.c - f.width * 1.25, x1: f.c - f.width * 0.72, y: f.base + 2.2 };
    const seatLit = g.createLinearGradient(seat.x0, 0, seat.x1, 0);
    seatLit.addColorStop(0, css(rgbOf(p.bark)));
    seatLit.addColorStop(1, css(mix(rgbOf(p.bark), fl, 0.55 * flicker)));
    g.strokeStyle = seatLit;
    g.lineCap = "round";
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(seat.x0, seat.y);
    g.lineTo(seat.x1, seat.y);
    g.stroke();
    // The ring of stones, round, lit on the side toward the fire; those behind it first.
    const stones = (front: boolean) => {
      for (const st of layout.stones) {
        if (st.front !== front) continue;
        const cx = st.c + st.width / 2;
        const lit = g.createLinearGradient(cx - st.width / 2, 0, cx + st.width / 2, 0);
        const toward = cx < fx ? 1 : 0;
        lit.addColorStop(toward ? 0 : 1, this.stoneStyles[0]!);
        lit.addColorStop(toward ? 1 : 0, this.stoneStyles[Math.min(2, Math.round(2 * flicker))]!);
        g.fillStyle = lit;
        g.beginPath();
        g.ellipse(cx, st.r + 0.5, st.width / 2, 0.62, 0, 0, Math.PI * 2);
        g.fill();
      }
    };
    stones(false);
    // The logs leaned together, their feet glowing in the coals.
    g.lineWidth = 0.9;
    for (const l of layout.logs) {
      const glow = g.createLinearGradient(l.c0, l.r0, l.c1, l.r1);
      glow.addColorStop(0, this.fireRamp[Math.round((0.4 + 0.25 * Math.sin(t * 5 + l.c0)) * RAMP)]!);
      glow.addColorStop(0.3, this.barkStyle);
      glow.addColorStop(1, this.barkStyle);
      g.strokeStyle = glow;
      g.beginPath();
      g.moveTo(l.c0 + 0.5, l.r0 + 0.5);
      g.lineTo(l.c1 + 0.5, l.r1 + 0.5);
      g.stroke();
    }
    // The fire, shaped from its field of heat: across its columns, tongues as high as the heat
    // reaches, tapering; red-orange at its edges, white-yellow at its core.
    const { fw, fh } = camp;
    const left = f.c - Math.floor(fw / 2);
    const top = f.base - fh;
    const shape = (edge: number) => {
      const tops: number[] = [];
      for (let c = 0; c < fw; c++) {
        let r = fh;
        while (r > 0 && camp.heat[(r - 1) * fw + c]! > edge) r--;
        tops.push(r);
      }
      g.beginPath();
      g.moveTo(left, f.base + 0.5);
      for (let c = 0; c < fw; c++) {
        const y = top + tops[c]!;
        g.quadraticCurveTo(left + c, y + 0.6, left + c + 0.5, y);
      }
      g.lineTo(left + fw, f.base + 0.5);
      g.closePath();
    };
    const flame = g.createLinearGradient(0, top, 0, f.base);
    flame.addColorStop(0, this.fireRamp[Math.round(0.05 * RAMP)]!);
    flame.addColorStop(0.45, this.fireRamp[Math.round(0.4 * RAMP)]!);
    flame.addColorStop(1, this.fireRamp[Math.round(0.65 * RAMP)]!);
    g.fillStyle = flame;
    shape(this.light ? 0.16 : 0.1);
    g.fill();
    const core = g.createLinearGradient(0, top + fh * 0.35, 0, f.base);
    core.addColorStop(0, this.fireRamp[Math.round(0.6 * RAMP)]!);
    core.addColorStop(1, this.fireRamp[RAMP]!);
    g.fillStyle = core;
    shape(0.55);
    g.fill();
    // Its cells carry characters (its detail), and it is the night's light.
    const lights = this.ascii.lit;
    const detail = this.ascii.dg;
    for (let i = 0; i < fw * fh; i++) {
      const h = camp.heat[i]!;
      if (h < 0.16) continue;
      const c = left + (i % fw);
      const r = top + Math.floor(i / fw);
      detail.fillStyle = "#fff";
      detail.fillRect(c, r, 1, 1);
      if (h > 0.35) {
        lights.fillStyle = this.fireRamp[Math.round(clamp(h, 0, 1) * RAMP)]!;
        lights.fillRect(c, r, 1, 1);
      }
    }
    stones(true);
    // A log thrown on: tumbling in, then lying across the fire's foot, burning down.
    g.lineWidth = 0.9;
    for (const l of camp.logs) {
      const k = l.fall;
      const x = (k < 1 ? l.from.x + (l.to.x - l.from.x) * k : l.to.x) / this.cw;
      const y = (k < 1 ? l.from.y + (l.to.y - l.from.y) * k - Math.sin(Math.PI * k) * this.ch * 2.5 : l.to.y) / this.ch;
      const len = k < 1 ? 3 : Math.max(2, 5 * (0.4 + 0.6 * (1 - l.burned / BURN)));
      const a = k < 1 ? k * 9 : 0;
      g.strokeStyle = k < 1 || l.burned < BURN * 0.4 ? this.barkStyle : this.charStyle;
      g.beginPath();
      g.moveTo(x - (Math.cos(a) * len) / 2, y - (Math.sin(a) * len) / 2 / 1.45);
      g.lineTo(x + (Math.cos(a) * len) / 2, y + (Math.sin(a) * len) / 2 / 1.45);
      g.stroke();
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
