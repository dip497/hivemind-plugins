/**
 * Campfire's drawing, in cells. Painted once per window and look, into the backdrop: the sky, the
 * crescent moon, the firs (warm where the firelight reaches them, on the side toward the fire), the
 * grass of the clearing warming toward the fire, and the woodpile. Every frame: the stars twinkling;
 * the firelight, a glow breathing with the fire; the ring of stones (those behind the fire first),
 * lit on the side toward it; the logs, their ends glowing; the fire itself, each of its cells a
 * character from a ramp (` .'^:;*+%#@`) in a colour from deep red to white-yellow by its heat, a
 * block under the hottest; a log thrown on, falling, then burning down; the smoke; the sparks; and
 * the crickets' blinks.
 */
import { textCells, type Draw2D } from "../cells";
import { css, cssAlpha, mix, ramp as rampOf, rgbOf, RAMP, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { LookRenderer } from "../look";
import { clamp, hash } from "../num";
import { BURN, type Camp } from "./camp";
import { firAt, type ClearingLayout } from "./clearing";
import { CAMPFIRE_PALETTE, type CampfirePalette } from "./palette";

/** The fire's characters, from its coolest tips to its hottest heart. */
export const FLAME = " .'^:;*+%#@";
const STAR_LEVELS = 3;
/** Shades of the fire's colour a frame picks from (each set once a frame). */
const LEVELS = 24;
const SEED = 0xf12e;

export class CampfireRenderer extends LookRenderer<CampfirePalette> {
  private fireRamp: string[] = [];
  private fireRgb: Rgb[] = [];
  private glow: OffscreenCanvas | null = null;
  private stoneStyles: string[] = [];
  private barkStyle = "";
  private endStyle = "";
  private charStyle = "";
  private smokeStyles: string[] = [];
  private cricketStyle = "";
  private starStyles: string[] = [];
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];
  private layout: ClearingLayout | null = null;
  private look = 0;
  private paintedLook = -1;
  private levels = new Uint8Array(0);

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, CAMPFIRE_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.look++;
    const stops = p.fire.map(rgbOf);
    this.fireRgb = Array.from({ length: RAMP + 1 }, (_, i) => {
      const t = (i / RAMP) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(t));
      return mix(stops[k]!, stops[k + 1]!, t - k);
    });
    this.fireRamp = this.fireRgb.map(css);
    this.glow = glowSprite(rgbOf(p.firelight));
    const stone = rgbOf(p.stone);
    const light = rgbOf(p.firelight);
    this.stoneStyles = [0, 0.25, 0.5].map((k) => css(mix(stone, light, k * p.warmth)));
    this.barkStyle = css(rgbOf(p.bark));
    this.endStyle = css(rgbOf(p.end));
    this.charStyle = css(mix(rgbOf(p.bark), [20, 14, 12], this.light ? 0.4 : 0.6));
    const smoke = rgbOf(p.smoke);
    this.smokeStyles = [0.12, 0.22, 0.34, 0.46].map((a) => cssAlpha(smoke, a));
    this.cricketStyle = css(rgbOf(p.cricket));
    const top = rgbOf(p.sky[0]!);
    const star = rgbOf(p.star);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, star, (p.stars * (l + 1)) / STAR_LEVELS))) : [];
  }

  private skyAt(r: number): Rgb {
    const s = this.palette.sky.map(rgbOf);
    const t = clamp((r + 0.5) / this.rows, 0, 1) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(t));
    return mix(s[i]!, s[i + 1]!, t - i);
  }

  protected paintScenery(g: Draw2D) {
    const layout = this.layout;
    if (!layout || layout.grid.cols !== this.cols || layout.grid.rows !== this.rows) return;
    this.paintedLook = this.look;
    textCells(g, this.ch, this.fontFamily);
    this.paintMoon(g, layout);
    this.paintFirs(g, layout);
    this.paintGrass(g, layout);
    this.paintPile(g, layout);
  }

  /** How much of the firelight reaches a point (px): most beside the fire, none far off. */
  private warmthAt(layout: ClearingLayout, x: number, y: number) {
    const { cw, ch } = this;
    const f = layout.fire;
    const dx = (x - (f.c + 0.5) * cw) / (f.height * ch * 2.6);
    const dy = (y - (f.base - f.height * 0.3) * ch) / (f.height * ch * 1.9);
    return clamp(1 - Math.hypot(dx, dy), 0, 1) ** 1.6 * this.palette.warmth;
  }

  /** A crescent moon: a disc with a darker disc over most of it. */
  private paintMoon(g: Draw2D, layout: ClearingLayout) {
    const { cw, ch } = this;
    const { x, y, r: R } = layout.moon;
    const moon = rgbOf(this.palette.moon);
    for (let r = Math.floor((y - R) / ch) - 1; r <= Math.ceil((y + R) / ch); r++) {
      for (let c = Math.floor((x - R) / cw) - 1; c <= Math.ceil((x + R) / cw); c++) {
        const px = (c + 0.5) * cw;
        const py = (r + 0.5) * ch;
        const d = Math.hypot(px - x, py - y) / R;
        const shadow = Math.hypot(px - (x + R * 0.48), py - (y - R * 0.22)) / (R * 0.92);
        if (d > 1.05 || shadow < 1.02) continue;
        const sky = this.skyAt(r);
        if (d > 0.93) {
          // Its rim, the way it runs there.
          const a = Math.atan2(py - y, px - x);
          const oct = Math.round((a / Math.PI) * 4 + 8) % 8;
          g.fillStyle = css(mix(moon, sky, 0.35));
          this.glyph(g, ")/_\\(/-\\"[oct]!, c, r);
          continue;
        }
        g.fillStyle = css(mix(moon, sky, 0.08 + 0.1 * hash(c, r, SEED)));
        g.fillRect(c * cw, r * ch, cw, ch);
      }
    }
  }

  /** The firs, far ones first: boughs in tiers, their edges sloping, warm on the side toward the
   *  fire where its light reaches. */
  private paintFirs(g: Draw2D, layout: ClearingLayout) {
    const { cols, rows, cw, ch } = this;
    const p = this.palette;
    const far = rgbOf(p.far);
    const near = rgbOf(p.near);
    const light = rgbOf(p.firelight);
    const fireX = (layout.fire.c + 0.5) * cw;
    for (const f of layout.firs) {
      const base = mix(far, near, f.near);
      for (let r = Math.max(0, f.r); r < Math.min(rows, f.r + f.height + (f.near ? 4 : 1)); r++) {
        const { reach, within } = firAt(f, r);
        if (reach < 0) {
          // Its trunk, under the boughs.
          if (r > f.r && f.near) {
            g.fillStyle = css(mix(base, rgbOf(p.bark), 0.35));
            this.block(g, f.c, r);
          }
          continue;
        }
        const left = Math.round(f.c - reach);
        const right = Math.round(f.c + reach);
        // Each tier of boughs a touch lighter on top, a touch darker under its tips.
        const tierLight = within < 0.8 ? 0.025 : -0.025;
        for (let c = Math.max(0, left); c <= Math.min(cols - 1, right); c++) {
          const toward = ((c - f.c) * Math.sign(fireX - f.c * cw)) / Math.max(1, reach);
          const warm = this.warmthAt(layout, (c + 0.5) * cw, (r + 0.5) * ch) * (0.55 + 0.45 * toward) * 1.3;
          const h = hash(c, r, SEED + f.c);
          const sky = this.skyAt(r);
          const lifted = mix(base, tierLight > 0 ? sky : [0, 0, 0], Math.abs(tierLight) * (this.light ? 2 : 1.4));
          const tone = mix(mix(lifted, sky, this.light ? 0.12 * (1 - f.near) : 0.18 * (1 - f.near)), light, clamp(warm, 0, 0.85));
          const edge = c === left || c === right || r === f.r;
          // A solid silhouette: whole cells, no seam; its edges the boughs' slope in characters.
          if (!edge) {
            g.fillStyle = css(tone);
            g.fillRect(c * cw, r * ch, cw, ch);
          }
          const needle = this.light ? mix(tone, sky, 0.3) : mix(tone, light, 0.2 + warm * 0.5);
          g.fillStyle = css(edge ? mix(tone, sky, 0.1) : needle);
          const glyph = r === f.r ? "^" : c === left ? "/" : c === right ? "\\" : h < 0.22 ? "^" : h < 0.3 ? "'" : "";
          if (glyph) this.glyph(g, glyph, c, r);
        }
      }
    }
  }

  /** The clearing's grass, lit warm toward the fire. */
  private paintGrass(g: Draw2D, layout: ClearingLayout) {
    const { cols, rows, cw, ch } = this;
    const p = this.palette;
    const [ground, blade] = p.grass.map(rgbOf) as [Rgb, Rgb];
    const light = rgbOf(p.firelight);
    for (let r = layout.ground; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const warm = this.warmthAt(layout, (c + 0.5) * cw, (r + 0.5) * ch);
        const h = hash(c, r, SEED + 3);
        const e = mix(mix(ground, this.light ? blade : [0, 0, 0], this.light ? h * 0.08 : h * 0.12), light, warm * 0.3);
        g.fillStyle = css(e);
        this.block(g, c, r);
        if (h > 0.55) continue;
        g.fillStyle = css(mix(mix(blade, light, warm * 0.6), e, 0.2));
        this.glyph(g, "'\",`.;'\""[Math.floor(h * 14.5)]!, c, r);
      }
    }
    // Tufts of longer grass, more toward the bottom and the sides.
    for (let r = layout.ground + 2; r < rows; r++) {
      const down = (r - layout.ground) / Math.max(1, rows - layout.ground);
      for (let c = 1; c < cols - 1; c++) {
        const side = Math.abs((c + 0.5) / cols - 0.5) * 2;
        if (hash(c, r, SEED + 7) > 0.03 + 0.07 * down + 0.05 * side) continue;
        const warm = this.warmthAt(layout, (c + 0.5) * cw, (r + 0.5) * ch);
        g.fillStyle = css(mix(this.light ? mix(blade, [30, 50, 40], 0.3) : mix(blade, [255, 255, 255], 0.08), light, warm * 0.5));
        this.glyph(g, "/", c - 1, r);
        this.glyph(g, "|", c, r - 1);
        this.glyph(g, "\\", c + 1, r);
        this.glyph(g, "|", c, r);
      }
    }
  }

  /** The woodpile beside the ring: logs stacked end on, their rings showing. */
  private paintPile(g: Draw2D, layout: ClearingLayout) {
    for (const end of layout.pile) {
      g.fillStyle = this.endStyle;
      this.block(g, end.c, end.r);
      g.fillStyle = this.barkStyle;
      this.glyph(g, "@", end.c, end.r);
    }
  }

  draw(camp: Camp) {
    const { ctx, dpr, cols, rows } = this;
    const layout = camp.layout;
    if (cols === 0 || !layout || layout.grid.cols !== cols || layout.grid.rows !== rows) return;
    if (layout !== this.layout || this.paintedLook !== this.look) {
      this.layout = layout;
      this.placeStars(layout);
      this.paintBackground();
    }
    const t = camp.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.bg, 0, 0);
    this.drawStars(t);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const strong = camp.strength();
    const flicker = 0.9 + 0.1 * Math.sin(t * 11.3) * Math.sin(t * 4.1 + 1);
    this.drawGlow(camp, strong * flicker);
    textCells(ctx, this.ch, this.fontFamily);
    this.drawStones(camp, false, flicker);
    this.drawLogs(camp, t);
    this.drawFire(camp);
    this.drawStones(camp, true, flicker);
    this.drawThrown(camp, t);
    this.drawSmoke(camp);
    this.drawSparks(camp, t);
    this.drawCrickets(camp);
  }

  private placeStars(layout: ClearingLayout) {
    const { width: W, height: H } = this;
    let s = 0xc1;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    this.stars = [];
    for (let i = 0; i < Math.round((W * H) / 9000); i++) {
      const x = r() * W;
      const y = r() * H * 0.5;
      const rate = 0.5 + r() * 1.7;
      const phase = r() * 6.28;
      if (Math.hypot(x - layout.moon.x, y - layout.moon.y) < layout.moon.r * 1.3) continue;
      this.stars.push({ x, y, rate, phase });
    }
  }

  private drawStars(t: number) {
    if (!this.starStyles.length) return;
    const { ctx, dpr } = this;
    const size = Math.max(1, Math.round(dpr * 1.5));
    for (let l = 0; l < STAR_LEVELS; l++) {
      ctx.fillStyle = this.starStyles[l]!;
      for (const s of this.stars) {
        const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
        if (Math.min(STAR_LEVELS - 1, Math.floor(b * STAR_LEVELS)) === l) ctx.fillRect(Math.round(s.x * dpr), Math.round(s.y * dpr), size, size);
      }
    }
  }

  /** The firelight: a glow round the fire breathing with it, and a pool of it on the ground. */
  private drawGlow(camp: Camp, strong: number) {
    if (!this.glow) return;
    const { ctx } = this;
    const f = camp.fireAt();
    const R = (f.base - f.top) * 2.3 * (0.85 + 0.15 * strong);
    ctx.save();
    ctx.globalCompositeOperation = this.palette.add ? "lighter" : "source-over";
    ctx.globalAlpha = clamp((this.palette.add ? 0.2 : 0.22) * strong, 0, 0.45);
    ctx.drawImage(this.glow, f.x - R, (f.base + f.top) / 2 - R, R * 2, R * 2);
    ctx.globalAlpha = clamp((this.palette.add ? 0.24 : 0.22) * strong, 0, 0.45);
    ctx.drawImage(this.glow, f.x - R * 1.1, f.base - R * 0.22, R * 2.2, R * 0.55);
    ctx.restore();
  }

  /** The ring of stones, lit on the side toward the fire as it flickers. */
  private drawStones(camp: Camp, front: boolean, flicker: number) {
    const { ctx } = this;
    const f = camp.layout.fire;
    for (const s of camp.layout.stones) {
      if (s.front !== front) continue;
      for (let k = 0; k < s.width; k++) {
        const c = s.c + k;
        const toward = (c < f.c ? k / Math.max(1, s.width - 1) : 1 - k / Math.max(1, s.width - 1)) * (front ? 0.6 : 1);
        ctx.fillStyle = this.stoneStyles[Math.min(2, Math.round(toward * 2 * flicker))]!;
        this.block(ctx, c, s.r);
        ctx.fillStyle = this.charStyle;
        this.glyph(ctx, (c + s.r) % 3 ? "@" : "o", c, s.r);
      }
    }
  }

  /** The logs leaned together over the fire, their feet glowing in it. */
  private drawLogs(camp: Camp, t: number) {
    const { ctx } = this;
    for (const l of camp.layout.logs) {
      const dc = l.c1 - l.c0;
      const dr = l.r1 - l.r0;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dc), Math.abs(dr) * 1.45)));
      const glyph = dc * dr > 0 ? "\\" : "/";
      for (let i = 0; i <= n; i++) {
        const c = Math.round(l.c0 + (dc * i) / n);
        const r = Math.round(l.r0 + (dr * i) / n);
        ctx.fillStyle = i < 2 ? this.charStyle : this.barkStyle;
        this.block(ctx, c, r);
        if (i < 2) {
          // Embers where it sits in the coals.
          const e = 0.5 + 0.5 * Math.sin(t * 6 + c * 1.7 + i);
          ctx.fillStyle = this.fireRamp[Math.round((0.35 + 0.4 * e) * RAMP)]!;
          this.glyph(ctx, e > 0.6 ? "*" : "+", c, r);
        } else {
          ctx.fillStyle = this.charStyle;
          this.glyph(ctx, glyph, c, r);
        }
      }
    }
  }

  /** The fire: each cell of its field by its heat, grouped by shade so each is set once; blocks
   *  under the hottest, characters over all of it. */
  private drawFire(camp: Camp) {
    const { ctx } = this;
    const { fw, fh } = camp;
    const f = camp.layout.fire;
    const left = f.c - Math.floor(fw / 2);
    const top = f.base - fh;
    if (this.levels.length !== fw * fh) this.levels = new Uint8Array(fw * fh);
    const lv = this.levels;
    // At dusk it shows only its brighter part: a smaller fire.
    const floor = this.light ? 0.1 : 0.05;
    for (let i = 0; i < fw * fh; i++) {
      const h = camp.heat[i]!;
      lv[i] = h < floor ? 0 : 1 + Math.min(LEVELS - 1, Math.floor(h * LEVELS));
    }
    const light = this.light;
    // Blocks under the heart of it.
    for (let l = Math.floor(LEVELS * (light ? 0.5 : 0.72)); l <= LEVELS; l++) {
      ctx.fillStyle = this.fireRamp[Math.round(clamp((l / LEVELS) * (light ? 0.9 : 0.62), 0, 1) * RAMP)]!;
      for (let i = 0; i < fw * fh; i++) if (lv[i] === l) this.block(ctx, left + (i % fw), top + Math.floor(i / fw));
    }
    for (let l = 1; l <= LEVELS; l++) {
      const h = l / LEVELS;
      // By night bright on the dark; at dusk ink on paper, the deep reds and oranges.
      ctx.fillStyle = this.fireRamp[Math.round(clamp(light ? (h > 0.5 ? h * 0.35 : 0.05 + h * 0.5) : h + 0.22, 0, 1) * RAMP)]!;
      const glyph = FLAME[clamp(Math.floor(h * (FLAME.length - 1)) + 1, 1, FLAME.length - 1)]!;
      for (let i = 0; i < fw * fh; i++) if (lv[i] === l) this.glyph(ctx, glyph, left + (i % fw), top + Math.floor(i / fw));
    }
  }

  /** A log thrown on: tumbling in, then lying across the fire, burning down. */
  private drawThrown(camp: Camp, t: number) {
    const { ctx, cw, ch } = this;
    for (const l of camp.logs) {
      if (l.fall < 1) {
        const k = l.fall;
        const x = l.from.x + (l.to.x - l.from.x) * k;
        const y = l.from.y + (l.to.y - l.from.y) * k - Math.sin(Math.PI * k) * ch * 2.5;
        const c = Math.floor(x / cw);
        const r = Math.floor(y / ch);
        // Turning end over end as it falls.
        const turn = Math.floor(k * 4) % 3;
        const cells = turn === 0 ? [[-1, -1], [0, 0], [1, 1]] : turn === 1 ? [[-1, 0], [0, 0], [1, 0], [2, 0]] : [[-1, 1], [0, 0], [1, -1]];
        for (const [dc, dr] of cells) {
          ctx.fillStyle = this.barkStyle;
          this.block(ctx, c + dc! * l.side * -1, r + dr!);
          ctx.fillStyle = this.endStyle;
          this.glyph(ctx, turn === 1 ? "=" : turn === 0 ? "\\" : "/", c + dc! * l.side * -1, r + dr!);
        }
        continue;
      }
      // Across the fire's foot: charring, its embers fading as it burns down.
      const left = Math.floor(l.to.x / cw) - 2;
      const r = Math.floor(l.to.y / ch);
      const left0 = 1 - l.burned / BURN;
      const len = Math.max(2, Math.round(5 * (0.4 + 0.6 * left0)));
      for (let k = 0; k < len; k++) {
        ctx.fillStyle = left0 > 0.6 ? this.barkStyle : this.charStyle;
        this.block(ctx, left + k, r);
        const e = 0.5 + 0.5 * Math.sin(t * 7 + k * 2.1);
        ctx.fillStyle = this.fireRamp[Math.round((0.3 + 0.55 * e * (0.4 + 0.6 * left0)) * RAMP)]!;
        this.glyph(ctx, k === 0 || k === len - 1 ? "@" : e > 0.55 ? "*" : "=", left + k, r);
      }
    }
  }

  /** Smoke curling up: fading in off the flames, out as it spreads. */
  private drawSmoke(camp: Camp) {
    const { ctx, cw, ch } = this;
    for (let level = 0; level < 4; level++) {
      ctx.fillStyle = this.smokeStyles[level]!;
      for (const s of camp.smoke) {
        const k = s.age / s.life;
        const a = Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 - k);
        if (Math.min(3, Math.floor(a * 5)) !== level || a < 0.05) continue;
        const glyph = k < 0.15 ? "~" : k < 0.45 ? (Math.sin(s.age * 0.9 + s.phase) > 0 ? ")" : "(") : k < 0.7 ? "~" : ".";
        ctx.fillText(glyph, Math.floor(s.x / cw) * cw + cw / 2, Math.floor(s.y / ch) * ch + ch / 2 + 1);
      }
    }
  }

  /** Sparks rising, winking, cooling from yellow to red as they go out. */
  private drawSparks(camp: Camp, t: number) {
    const { ctx, cw, ch } = this;
    const slot = Math.floor(t * 14);
    for (const s of camp.sparks) {
      const k = s.age / s.life;
      if (hash(Math.floor(s.phase * 1000), slot, 9) < 0.12 + 0.3 * k) continue;
      ctx.fillStyle = this.fireRamp[Math.round((this.light ? 0.5 * (1 - k) + 0.1 : 1 - 0.6 * k) * RAMP)]!;
      ctx.fillText(k < 0.25 ? "*" : k < 0.6 ? "+" : ".", Math.floor(s.x / cw) * cw + cw / 2, Math.floor(s.y / ch) * ch + ch / 2 + 1);
    }
  }

  private drawCrickets(camp: Camp) {
    const { ctx } = this;
    ctx.fillStyle = this.cricketStyle;
    camp.layout.crickets.forEach((k, i) => {
      if (camp.chirping(i)) this.glyph(ctx, i % 3 ? "." : "'", k.c, k.r);
    });
  }
}
