/**
 * Dunes' drawing, in cells. Painted once per window and look, into the backdrop: the sky, the moon
 * at night, and the dunes, each cell shaded from the ground it shows (a block of sand in its light
 * or shade, under a character from the ramp ` .:-=+*#%@`: by night the brighter the denser, by day
 * ink on paper, the deeper the shade the denser), wind ripples banding the faces toward us, the
 * crests drawn as their line against what lies beyond, the far sand hazed toward the sky, and by
 * day the mirage. Every frame: the stars twinkling; by day the heat shimmering over the far dunes
 * and the mirage flickering; the sand streaming off the crests; the caravan on its ridge, hidden
 * where a nearer dune stands in front; the dust devil; a gust's burst.
 */
import { textCells, type Draw2D } from "../cells";
import { css, cssAlpha, mix, ramp as rampOf, rgbOf, RAMP, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { LookRenderer } from "../look";
import { clamp, fbm2, hash } from "../num";
import { FAR, type DesertLayout } from "./desert";
import { DUNES_PALETTE, type DunesPalette } from "./palette";
import { DEVIL_HIGH, type Desert, type Member } from "./sands";

/** The sand's characters, from the least ink to the most. */
export const SAND = " .:-=+*#%@";
const STAR_LEVELS = 3;
/** The caravan, facing right: a letter is a block of its silhouette, any other character is drawn
 *  alone; `L` a leg as the step has it. */
const MEMBERS: Record<Member, string[]> = {
  camel: [
    "  ,#,  _",
    " #####/ ",
    "  L  L  ",
  ],
  walker: [
    "o",
    "#",
    "L",
  ],
};
const SEED = 0xd00e;

export class DunesRenderer extends LookRenderer<DunesPalette> {
  private grainStyles: string[] = [];
  private caravanStyle = "";
  private starStyles: string[] = [];
  private devilGlow: OffscreenCanvas | null = null;
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];
  /** The mirage's cells: each its block's style and its characters'. */
  private mirage: { c: number; r: number; block: string; ink: string }[] = [];
  /** The layout the backdrop was painted for. */
  private layout: DesertLayout | null = null;
  private look = 0;
  private paintedLook = -1;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, DUNES_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.look++;
    const grain = rgbOf(p.grain);
    this.grainStyles = [0.25, 0.45, 0.7, 0.95].map((a) => cssAlpha(grain, a));
    this.caravanStyle = css(rgbOf(p.caravan));
    const top = rgbOf(p.sky[0]!);
    const star = rgbOf(p.star);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, star, (p.stars * (l + 1)) / STAR_LEVELS))) : [];
    this.devilGlow = glowSprite(grain);
  }

  /** The sky's colour at row `r`, as its gradient has it. */
  private skyAt(r: number): Rgb {
    const s = this.palette.sky.map(rgbOf);
    const t = clamp((r + 0.5) / this.rows, 0, 1) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(t));
    return mix(s[i]!, s[i + 1]!, t - i);
  }

  /** The moon's middle and radius, in px. */
  private moonAt(layout: DesertLayout) {
    const m = this.palette.moon!;
    const R = (m.size * Math.min(this.width, this.height)) / 2;
    return { x: this.palette.glow!.x * this.width, y: layout.horizonY - R * 0.35, R };
  }

  protected paintScenery(g: Draw2D) {
    const layout = this.layout;
    if (!layout || layout.grid.cols !== this.cols || layout.grid.rows !== this.rows) return;
    this.paintedLook = this.look;
    textCells(g, this.ch, this.fontFamily);
    if (this.palette.moon) this.paintMoon(g, layout);
    this.paintSand(g, layout);
  }

  /** The moon, huge and low, its seas darker, its rim soft; the dunes go over its foot. */
  private paintMoon(g: Draw2D, layout: DesertLayout) {
    const { cw, ch, cols, rows } = this;
    const m = this.palette.moon!;
    const { x, y, R } = this.moonAt(layout);
    const face = rgbOf(m.face);
    const seas = rgbOf(m.seas);
    for (let r = Math.max(0, Math.floor((y - R) / ch) - 1); r <= Math.min(rows - 1, Math.ceil((y + R) / ch)); r++) {
      const sky = this.skyAt(r);
      for (let c = Math.max(0, Math.floor((x - R) / cw) - 1); c <= Math.min(cols - 1, Math.ceil((x + R) / cw)); c++) {
        const dx = ((c + 0.5) * cw - x) / R;
        const dy = ((r + 0.5) * ch - y) / R;
        const d = Math.hypot(dx, dy);
        if (d > 1.04) continue;
        const sea = fbm2(dx * 2.6 + 4, dy * 2.6, SEED);
        const limb = Math.sqrt(Math.max(0, 1 - Math.min(1, d) ** 2));
        const tone = mix(sea > 0.55 ? mix(face, seas, clamp((sea - 0.55) * 5, 0, 1)) : face, sky, 0.38 - 0.3 * limb);
        if (d > 0.96) {
          g.fillStyle = css(mix(tone, sky, 0.35));
          this.glyph(g, dy < -0.3 ? (dx < 0 ? "/" : "\\") : dy > 0.3 ? (dx < 0 ? "\\" : "/") : dx < 0 ? "(" : ")", c, r);
          continue;
        }
        g.fillStyle = css(tone);
        g.fillRect(c * cw, r * ch, cw, ch);
        const h = hash(c, r, SEED);
        if (sea > 0.58 || h < 0.08) {
          g.fillStyle = css(mix(tone, seas, 0.7));
          this.glyph(g, sea > 0.68 ? ":" : h < 0.04 ? "o" : ".", c, r);
        }
      }
    }
  }

  /** The dunes, cell by cell, from the ground each cell shows. */
  private paintSand(g: Draw2D, layout: DesertLayout) {
    const { cols, rows } = this;
    const p = this.palette;
    const light = this.light;
    const [lx, ly, lz] = p.light;
    const ll = Math.hypot(lx, ly, lz);
    const blocks = rampOf(rgbOf(p.shade), rgbOf(p.lit));
    const inks = rampOf(rgbOf(p.inkShade), rgbOf(p.inkLit));
    const parse = (s: string): Rgb => {
      const n = parseInt(s.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const mirage = p.mirage && rgbOf(p.mirage);
    this.mirage = [];
    // How much light each cell's ground takes, stretched so the ramp's whole range is used: the
    // dimmest twentieth of the sand at the bottom of it, the brightest at the top.
    const lightOf = new Float32Array(rows * cols);
    const seen: number[] = [];
    for (let i = 0; i < rows * cols; i++) {
      if (layout.depth[i] === Infinity) continue;
      lightOf[i] = Math.max(0, (layout.nx[i]! * lx + layout.ny[i]! * ly + layout.nz[i]! * lz) / ll);
      if (i % 7 === 0) seen.push(lightOf[i]!);
    }
    seen.sort((a, b) => a - b);
    const lo = seen[Math.floor(seen.length * 0.05)] ?? 0;
    const hi = seen[Math.floor(seen.length * 0.97)] ?? 1;
    for (let r = 0; r < rows; r++) {
      const sky = this.skyAt(Math.min(r, layout.horizon));
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const z = layout.depth[i]!;
        if (z === Infinity) continue;
        const lit = clamp((lightOf[i]! - lo) / Math.max(1e-3, hi - lo), 0, 1);
        // Brightest at the crests, darkest down in the troughs; rippled, more so near us.
        const near = clamp(1 - z / (FAR * 0.3), 0, 1);
        const s = clamp((p.ambient + (1 - p.ambient) * lit) * (0.3 + 0.7 * layout.rise[i]! ** 1.6) + layout.ripple[i]! * (0.07 + 0.1 * near), 0, 1);
        const haze = p.haze * Math.min(1, (z / FAR) ** 0.75);
        const block = mix(parse(blocks[Math.round((light ? 0.15 + 0.85 * s : 0.75 * s) * RAMP)]!), sky, haze);
        // By day a far mirage: the sky's own colour lying on the sand just under the far crests.
        if (mirage && z > FAR * 0.5 && r - layout.skyline[c]! >= 1 && r - layout.skyline[c]! <= 3 && hash(c, r, SEED + 1) < 0.75) {
          const b = css(mix(block, mirage, 0.55));
          const ink = css(mix(mirage, rgbOf(p.inkShade), 0.25));
          g.fillStyle = b;
          g.fillRect(c * this.cw, r * this.ch, this.cw, this.ch);
          g.fillStyle = ink;
          this.glyph(g, hash(c, r, SEED) < 0.5 ? "~" : "-", c, r);
          this.mirage.push({ c, r, block: b, ink });
          continue;
        }
        g.fillStyle = css(block);
        g.fillRect(c * this.cw, r * this.ch, this.cw, this.ch);
        let glyph: string;
        let ink: Rgb;
        if (layout.crest[i]) {
          // The crest's line against what lies beyond, the way it runs.
          const at = (cc: number, rr: number) => cc >= 0 && cc < cols && rr >= 0 && rr < rows && layout.crest[rr * cols + cc] === 1;
          glyph = at(c - 1, r - 1) && !at(c + 1, r - 1) ? "\\" : at(c + 1, r - 1) && !at(c - 1, r - 1) ? "/" : at(c - 1, r + 1) && at(c + 1, r + 1) ? "^" : light ? "_" : "-";
          ink = light ? rgbOf(p.inkShade) : mix(rgbOf(p.inkLit), rgbOf(p.inkShade), 0.15 + 0.5 * (1 - s));
        } else {
          // Most of the sand in the lighter glyphs, the dense ones only at the extremes: by night the
          // brightest crests, by day the deepest shade.
          const k = clamp(Math.floor((light ? 1 - s : s) ** 1.7 * 9.99) + (hash(c, r, SEED) < 0.2 ? 1 : 0), 0, SAND.length - 1);
          glyph = SAND[k]!;
          ink = parse(inks[Math.round((light ? 0.55 * s : 0.2 + 0.8 * s) * RAMP)]!);
        }
        if (glyph === " ") continue;
        g.fillStyle = css(mix(ink, sky, haze * 0.8));
        this.glyph(g, glyph, c, r);
      }
    }
  }

  draw(desert: Desert) {
    const { ctx, dpr, cols, rows } = this;
    const layout = desert.layout;
    if (cols === 0 || !layout || layout.grid.cols !== cols || layout.grid.rows !== rows) return;
    if (layout !== this.layout || this.paintedLook !== this.look) {
      this.layout = layout;
      this.placeStars(layout);
      this.paintBackground();
    }
    const t = desert.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.bg, 0, 0);
    this.drawStars(t);
    if (this.palette.mirage) this.drawHeat(layout, t);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(ctx, this.ch, this.fontFamily);
    this.drawCaravan(desert);
    this.drawStreams(desert);
    this.drawDevil(desert);
    this.drawBurst(desert);
  }

  private placeStars(layout: DesertLayout) {
    const { width: W, cw, ch } = this;
    let s = 0x57a;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    const moon = this.palette.moon ? this.moonAt(layout) : null;
    this.stars = [];
    for (let i = 0; i < Math.round((W * layout.horizonY) / 5000); i++) {
      const x = r() * W;
      const y = r() * layout.horizonY;
      const rate = 0.5 + r() * 1.8;
      const phase = r() * 6.28;
      const c = Math.floor(x / cw);
      if (y > (layout.skyline[c]! - 1) * ch || (moon && Math.hypot(x - moon.x, y - moon.y) < moon.R * 1.1)) continue;
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

  /** By day: the heat shimmering over the far dunes, thin bands of them swaying a pixel or two, and
   *  the mirage flickering. */
  private drawHeat(layout: DesertLayout, t: number) {
    const { ctx, dpr, ch } = this;
    const top = Math.round((layout.horizon - 4) * ch * dpr);
    const bottom = Math.round((layout.horizon + 5) * ch * dpr);
    const band = Math.max(2, Math.round(2 * dpr));
    const w = this.canvas.width;
    for (let y = top; y < bottom; y += band) {
      const k = (y - top) / (bottom - top);
      const dx = Math.round(dpr * 1.6 * Math.sin(t * 5.3 + y * 0.23 / dpr) * (0.4 + 0.6 * Math.sin(t * 1.3 + y * 0.05 / dpr) ** 2) * Math.sin(Math.PI * k));
      if (dx) ctx.drawImage(this.bg, 0, y, w, band, dx, y, w, band);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(ctx, ch, this.fontFamily);
    const slot = Math.floor(t * 6);
    for (let i = 0; i < this.mirage.length; i++) {
      const m = this.mirage[i]!;
      if (hash(i, slot, 5) > 0.12) continue;
      ctx.fillStyle = m.block;
      this.block(ctx, m.c, m.r);
      ctx.fillStyle = m.ink;
      this.glyph(ctx, hash(i, slot, 6) < 0.5 ? "=" : "~", m.c, m.r);
    }
  }

  /** The caravan on its ridge, its legs stepping; nothing of it where a nearer dune is in front. */
  private drawCaravan(desert: Desert) {
    const { ctx, cw, ch, cols, rows } = this;
    const depth = desert.layout.depth;
    ctx.fillStyle = this.caravanStyle;
    for (const m of desert.caravanAt()) {
      const sprite = MEMBERS[m.kind];
      const width = sprite[0]!.length;
      const dir = desert.caravan.dir;
      const left = Math.round(m.x / cw - width / 2);
      const bottom = Math.floor(m.y / ch);
      const stride = Math.floor(m.step * 2) % 2;
      sprite.forEach((row, k) => {
        const r = bottom - (sprite.length - 1) + k;
        if (r < 0 || r >= rows) return;
        let leg = 0;
        for (let i = 0; i < row.length; i++) {
          const g = row[i]!;
          if (g === " ") continue;
          const c = left + (dir > 0 ? i : width - 1 - i);
          if (g === "L") leg++;
          if (c < 0 || c >= cols || depth[r * cols + c]! < m.z * 0.97) continue;
          if (g === "#") this.block(ctx, c, r);
          else {
            const glyph = g === "L" ? (stride ? (leg % 2 ? "/" : "|") : leg % 2 ? "|" : "\\") : g;
            const mirror: Record<string, string> = { "/": "\\", "\\": "/", ",": ",", "=": "=" };
            this.glyph(ctx, dir > 0 ? glyph : mirror[glyph] ?? glyph, c, r);
          }
        }
      });
    }
  }

  /** Sand streaming off the crests: fainter as it thins out, grouped by how faint. */
  private drawStreams(desert: Desert) {
    const { ctx, cw, ch } = this;
    for (let level = 0; level < 4; level++) {
      ctx.fillStyle = this.grainStyles[level]!;
      for (const g of desert.stream) {
        const fade = 1 - g.age / g.life;
        const l = Math.min(3, Math.floor(fade * g.near * 3.2));
        if (l !== level) continue;
        const glyph = fade > 0.75 ? "=" : g.vx > 70 * g.near && fade > 0.4 ? "~" : fade > 0.4 ? "-" : fade > 0.2 ? "'" : ".";
        ctx.fillText(glyph, Math.floor(g.x / cw) * cw + cw / 2, Math.floor(g.y / ch) * ch + ch / 2 + 1);
      }
    }
  }

  /** The dust devil: a soft column of dust, and its grains whirling up it, those in front brighter. */
  private drawDevil(desert: Desert) {
    const d = desert.devil;
    if (d.strength < 0.02) return;
    const { ctx, cw, ch } = this;
    if (this.devilGlow) {
      ctx.save();
      ctx.globalAlpha = (this.light ? 0.35 : 0.22) * d.strength;
      const h = DEVIL_HIGH * (0.4 + 0.6 * d.strength);
      ctx.drawImage(this.devilGlow, d.x - 36, d.y - h, 72, h * 1.15);
      ctx.restore();
    }
    for (const front of [false, true]) {
      ctx.fillStyle = this.grainStyles[front ? 3 : 1]!;
      for (const g of d.grains) {
        const p = desert.whirlAt(g);
        if (p.front !== front || g.up > DEVIL_HIGH * d.strength + 4) continue;
        const glyph = front ? (g.up < 18 ? "~" : g.spin > 6.5 ? "o" : "*") : g.up < 18 ? "-" : ".";
        ctx.fillText(glyph, Math.floor(p.x / cw) * cw + cw / 2, Math.floor(p.y / ch) * ch + ch / 2 + 1);
      }
    }
  }

  /** A gust's burst: grains flying up and out, then lying where they fell, fading. */
  private drawBurst(desert: Desert) {
    const { ctx, cw, ch } = this;
    for (let level = 1; level < 4; level++) {
      ctx.fillStyle = this.grainStyles[level]!;
      for (const b of desert.burst) {
        const l = b.landed >= 0 ? (b.landed < 0.3 ? 2 : 1) : 3;
        if (l !== level) continue;
        const glyph = b.landed >= 0 ? "." : Math.hypot(b.vx, b.vy) > 120 ? "*" : "'";
        ctx.fillText(glyph, Math.floor(b.x / cw) * cw + cw / 2, Math.floor(b.y / ch) * ch + ch / 2 + 1);
      }
    }
  }
}
