/**
 * Dunes' drawing. The picture, one pixel a cell: the sky, the moon low on the right at night (the
 * sun's haze high on the left by day); each range of dunes, far to near, each dune's face toward the
 * light bright under its crest and darkening to its foot, its other face in shadow, the ridge from
 * each peak between them, faint wind ripples across the windward faces, the far ranges hazed toward
 * the sky; by day a mirage shimmering on the far sand; and the caravan's silhouettes on their ridge,
 * hidden where a nearer dune stands in front. That picture is drawn through characters (ascii.ts):
 * crests and ridges come out as lines, the faces as a ramp. Over it, as characters of their own:
 * the stars, the sand streaming off the crests, the dust devil's grains, a gust's burst.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { PictureRenderer } from "../look";
import { clamp, fbm2 } from "../num";
import { paintSky } from "../sky";
import { duneAt, type DesertLayout } from "./desert";
import { DUNES_PALETTE, type DunesPalette } from "./palette";
import { DEVIL_HIGH, type Desert, type Member } from "./sands";

/** The caravan, facing right, as its silhouette's cells. */
const MEMBERS: Record<Member, string[]> = {
  camel: [
    "    ##     #",
    "   ####   ##",
    "  ######### ",
    "  #######   ",
    "  #  #  # # ",
    "  #  #  # # ",
  ],
  walker: [
    " #",
    "###",
    " # ",
    "# #",
  ],
};
const STAR_LEVELS = 3;

export class DunesRenderer extends PictureRenderer<DunesPalette, Desert> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = -1;
  private stillLayout: DesertLayout | null = null;
  private grainStyles: string[] = [];
  private starStyles: string[] = [];
  private caravanStyle = "";
  private devilStyle = "";
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, DUNES_PALETTE, { dim: 0.26, bloom: 0.5, wash: 0.22, night: [0.2, 0.92], day: [0.16, 0.36] });
  }

  protected styled() {
    const p = this.palette;
    const grain = rgbOf(p.grain);
    this.grainStyles = [0.3, 0.5, 0.75, 1].map((a) => cssAlpha(grain, a));
    const top = rgbOf(p.sky[0]!);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, rgbOf(p.star), (p.stars * (l + 1)) / STAR_LEVELS))) : [];
    this.caravanStyle = css(rgbOf(p.caravan));
    this.devilStyle = cssAlpha(this.light ? rgbOf(p.shadeFoot) : rgbOf(p.litFoot), 0.55);
  }

  /** The moon's middle and radius, in cells across and down. */
  private moonAt(layout: DesertLayout) {
    const m = this.palette.moon!;
    const R = (m.size * Math.min(this.width, this.height)) / 2;
    return { c: this.palette.glow!.x * this.cols, r: layout.horizon - (R * 0.3) / this.ch, rc: R / this.cw, rr: R / this.ch };
  }

  /** What holds still: the sky, the moon, the dunes. */
  private paintStill(layout: DesertLayout) {
    const { cols, rows } = this;
    const g = this.still.getContext("2d")!;
    this.still.width = cols;
    this.still.height = rows;
    const p = this.palette;
    paintSky(g, cols, rows, p, this.ch / this.cw);
    if (p.moon) {
      const { c, r, rc, rr } = this.moonAt(layout);
      g.fillStyle = css(rgbOf(p.moon.face));
      g.beginPath();
      g.ellipse(c, r, rc, rr, 0, 0, Math.PI * 2);
      g.fill();
      // Its seas, darker, and its limb, dimmer.
      const seas = rgbOf(p.moon.seas);
      for (const [dx, dy, s] of [[-0.3, -0.25, 0.3], [0.2, 0.1, 0.35], [-0.1, 0.35, 0.22], [0.35, -0.3, 0.18]] as const) {
        g.fillStyle = cssAlpha(seas, 0.32);
        g.beginPath();
        g.ellipse(c + dx * rc, r + dy * rr, s * rc, s * rr * 0.8, 0.4, 0, Math.PI * 2);
        g.fill();
      }
      const limb = g.createRadialGradient(c, r, 0, c, r, rc);
      limb.addColorStop(0.75, "rgba(0,0,0,0)");
      limb.addColorStop(1, "rgba(0,0,0,0.25)");
      g.save();
      g.translate(c, r);
      g.scale(1, rr / rc);
      g.translate(-c, -r);
      g.fillStyle = limb;
      g.beginPath();
      g.arc(c, r, rc, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    this.paintSand(g, layout);
  }

  /** Each range of dunes, far to near. */
  private paintSand(g: OffscreenCanvasRenderingContext2D, layout: DesertLayout) {
    const { cols, rows } = this;
    const p = this.palette;
    const [lit, litFoot, shade, shadeFoot] = [p.lit, p.litFoot, p.shade, p.shadeFoot].map(rgbOf) as [Rgb, Rgb, Rgb, Rgb];
    const img = g.getImageData(0, 0, cols, rows);
    const d = img.data;
    const horizonSky = rgbOf(p.sky[Math.round(0.5 * (p.sky.length - 1))]!);
    const mirage = p.mirage && rgbOf(p.mirage);
    for (let k = 0; k < layout.ranges.length; k++) {
      const range = layout.ranges[k]!;
      const crest = layout.crests[k]!;
      const haze = p.haze * range.far ** 1.2;
      const foot = range.foot * rows;
      for (let c = 0; c < cols; c++) {
        const top = crest[c]!;
        for (let r = Math.max(0, Math.round(top)); r < rows; r++) {
          const i = r * cols + c;
          if (layout.owner[i] !== k) continue;
          // Which dune this cell is on: going down from the crest, the faces lean the way the
          // ridges do, so a slip face meets the next dune's face along a slanting line, not a
          // vertical seam.
          const { peak } = duneAt(range, (c + 0.5 - (r - top) * 0.35) / cols);
          const peakRow = (range.foot - peak.h - 0.012) * rows;
          // The ridge from the peak down to the slip face's foot: the windward face is to its left.
          const slant = (peak.right * 0.85 * cols) / Math.max(1, peak.h * rows);
          const t = clamp((r - top) / Math.max(2, foot - top), 0, 1);
          const windward = c + 0.5 < peak.x * cols + (r - peakRow) * slant;
          const lighted = windward === (p.from < 0);
          let rgb: Rgb;
          if (lighted) {
            // Ripples across the windward face, faint.
            const ripple = windward ? 1 + 0.05 * Math.sin(c * 0.7 + r * 2.4 + Math.sin(c * 0.11) * 3) : 1;
            rgb = mix(litFoot, lit, (1 - t) ** 0.7);
            rgb = rgb.map((v) => Math.min(255, v * ripple)) as unknown as Rgb;
          } else rgb = mix(shade, shadeFoot, t ** 0.8);
          // The crest's very edge catches the light.
          if (r - top < 1 && lighted) rgb = mix(rgb, [255, 255, 255], 0.12);
          rgb = mix(rgb, horizonSky, haze);
          // By day a mirage: the sky lying on the furthest sand, in streaks.
          if (mirage && k === 0 && r - top > 0.5 && fbm2(c * 0.08, r * 0.9, 7) > 0.48) rgb = mix(rgb, mirage, 0.6);
          d[i * 4] = rgb[0];
          d[i * 4 + 1] = rgb[1];
          d[i * 4 + 2] = rgb[2];
          d[i * 4 + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
  }

  private placeStars(layout: DesertLayout) {
    const { width: W, cw, ch, cols } = this;
    let s = 0x57a;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    const moon = this.palette.moon ? this.moonAt(layout) : null;
    this.stars = [];
    for (let i = Math.round((W * layout.horizon * ch) / 7000); i > 0; i--) {
      const x = r() * W;
      const y = r() * layout.horizon * ch;
      const rate = 0.5 + r() * 1.8;
      const phase = r() * 6.28;
      const c = Math.floor(x / cw);
      const row = Math.floor(y / ch);
      if (layout.owner[row * cols + c] !== -1 || row > layout.skyline[c]! - 2) continue;
      if (moon && Math.hypot((c - moon.c) / moon.rc, (row - moon.r) / moon.rr) < 1.5) continue;
      this.stars.push({ x, y, rate, phase });
    }
  }

  protected paint(g: Draw2D, desert: Desert) {
    const layout = desert.layout;
    if (!layout || layout.grid.cols !== this.cols || layout.grid.rows !== this.rows) return;
    if (this.stillFor !== this.version || this.stillLayout !== layout) {
      this.stillFor = this.version;
      this.stillLayout = layout;
      this.paintStill(layout);
      this.placeStars(layout);
    }
    const t = desert.time;
    g.drawImage(this.still, 0, 0);
    // The moon is the night's light: it glows.
    if (this.palette.moon) {
      const { c, r, rc, rr } = this.moonAt(layout);
      const l = this.ascii.lit;
      l.fillStyle = css(rgbOf(this.palette.moon.face));
      l.beginPath();
      l.ellipse(c, r, rc * 0.9, rr * 0.9, 0, 0, Math.PI * 2);
      l.fill();
      // Only where it shows: the dunes in front of it do not glow.
      l.fillStyle = "#000";
      for (let k = 0; k < this.cols; k++) l.fillRect(k, layout.skyline[k]!, 1, this.rows);
    }
    // By day the heat shimmers over the far dunes: their rows swaying a cell now and then.
    if (this.palette.mirage) {
      for (let r = layout.horizon - 6; r < layout.horizon + 4; r++) {
        const dx = Math.round(0.9 * Math.sin(t * 3.1 + r * 1.7) * Math.sin(t * 0.7 + r * 0.4));
        if (dx) g.drawImage(this.still, 0, r, this.cols, 1, dx, r, this.cols, 1);
      }
    }
    // The dust devil: a column of dust where it whirls.
    const dv = desert.devil;
    if (dv.strength > 0.05) {
      const c = dv.x / this.cw;
      const top = (dv.y - DEVIL_HIGH * dv.strength) / this.ch;
      const grad = g.createLinearGradient(0, top, 0, dv.y / this.ch);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, this.devilStyle);
      g.globalAlpha = dv.strength;
      g.fillStyle = grad;
      g.fillRect(c - 2.5, top, 5, dv.y / this.ch - top);
      g.globalAlpha = 1;
    }
    // The caravan: silhouettes on their ridge, legs stepping, hidden behind nearer dunes.
    g.fillStyle = this.caravanStyle;
    for (const m of desert.caravanAt()) {
      const sprite = MEMBERS[m.kind];
      const width = sprite[0]!.length;
      const left = Math.round(m.x / this.cw - width / 2);
      const bottom = Math.floor(m.y / this.ch);
      const step = Math.floor(m.step * 2) % 2;
      sprite.forEach((row, k) => {
        const r = bottom - (sprite.length - 1) + k;
        if (r < 0 || r >= this.rows) return;
        const legs = k >= sprite.length - (m.kind === "camel" ? 2 : 1);
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== "#") continue;
          // Striding: the legs shift a cell, the fore and hind pairs opposite.
          const shift = legs && step ? (i < width / 2 ? 1 : -1) * (k === sprite.length - 1 ? 1 : 0) : 0;
          const c = left + (desert.caravan.dir > 0 ? i : width - 1 - i) + shift;
          if (c < 0 || c >= this.cols || layout.owner[r * this.cols + c]! > m.z) continue;
          g.fillRect(c, r, 1, 1);
        }
      });
    }
  }

  protected overlay(g: Draw2D | null, desert: Desert) {
    const t = desert.time;
    const hold = (x: number, y: number) => this.ascii.hold(x, y);
    // The stars, twinkling.
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
    // Sand streaming off the crests, fainter as it thins out.
    for (let level = 0; level < 4; level++) {
      if (g) g.fillStyle = this.grainStyles[level]!;
      for (const s of desert.stream) {
        const fade = 1 - s.age / s.life;
        if (Math.min(3, Math.floor(fade * s.near * 3.2)) !== level) continue;
        if (!g) {
          hold(s.x, s.y);
          continue;
        }
        this.glyphAt(g, fade > 0.75 ? "~" : s.vx > 70 * s.near && fade > 0.4 ? "-" : fade > 0.35 ? "'" : ".", s.x, s.y);
      }
    }
    // The dust devil's grains whirling up it, those in front brighter.
    const dv = desert.devil;
    if (dv.strength > 0.02) {
      for (const front of [false, true]) {
        if (g) g.fillStyle = this.grainStyles[front ? 3 : 1]!;
        for (const w of dv.grains) {
          const at = desert.whirlAt(w);
          if (at.front !== front || w.up > DEVIL_HIGH * dv.strength + 4) continue;
          if (g) this.glyphAt(g, front ? (w.up < 18 ? "~" : w.spin > 6.5 ? "o" : "*") : w.up < 18 ? "-" : ".", at.x, at.y);
          else hold(at.x, at.y);
        }
      }
    }
    // A gust's burst: grains flying up and out, then lying where they fell, fading.
    for (let level = 1; level < 4; level++) {
      if (g) g.fillStyle = this.grainStyles[level]!;
      for (const b of desert.burst) {
        if ((b.landed >= 0 ? (b.landed < 0.3 ? 2 : 1) : 3) !== level) continue;
        if (g) this.glyphAt(g, b.landed >= 0 ? "." : Math.hypot(b.vx, b.vy) > 120 ? "*" : "'", b.x, b.y);
        else hold(b.x, b.y);
      }
    }
  }
}
