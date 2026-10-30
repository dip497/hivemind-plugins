/**
 * Dunes' drawing. The picture, painted at full size: a clean sky graded to the horizon (a huge moon
 * there at night, whole, with a soft glow; the sun's haze high on the left by day); then each range
 * of dunes, far to near, as smooth shapes: each dune's windward face light, graded down to its foot,
 * its slip face darker, the two meeting along the curved ridge from its peak; the far ranges hazed
 * toward the sky; by day the heat shimmering over the far dunes. Characters go only where they add
 * something (ascii.ts): the crests and ridges come out as lines; a few ripples on the nearest faces;
 * the caravan, small figures in characters walking one crest with their footprints behind them;
 * the stars; the sand streaming off the crests; the dust devil's grains; a gust's burst.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { PictureRenderer } from "../look";
import { hash } from "../num";
import { paintSky } from "../sky";
import { duneAt, type DesertLayout, type Range } from "./desert";
import { DUNES_PALETTE, DUNES_TONES, type DunesPalette } from "./palette";
import { DEVIL_HIGH, type Desert, type Member } from "./sands";

/** The caravan, facing right, in characters; `L` a leg as the step has it. */
const MEMBERS: Record<Member, string[]> = {
  camel: [" .-.  _", "(___)/ ", " L L L "],
  walker: [" o", "/|", " L"],
};
const STAR_LEVELS = 3;
const MIRROR: Record<string, string> = { "/": "\\", "\\": "/", "(": ")", ")": "(" };

export class DunesRenderer extends PictureRenderer<DunesPalette, Desert> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = -1;
  private stillLayout: DesertLayout | null = null;
  private grainStyles: string[] = [];
  private starStyles: string[] = [];
  private caravanStyle = "";
  private stepStyle = "";
  private rippleStyle = "";
  private devilStyle = "";
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];
  private ripples: { x: number; y: number }[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, DUNES_PALETTE, DUNES_TONES);
  }

  protected styled() {
    const p = this.palette;
    const grain = rgbOf(p.grain);
    this.grainStyles = [0.3, 0.5, 0.75, 1].map((a) => cssAlpha(grain, a));
    const top = rgbOf(p.sky[0]!);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, rgbOf(p.star), (p.stars * (l + 1)) / STAR_LEVELS))) : [];
    this.caravanStyle = css(rgbOf(p.caravan));
    this.stepStyle = cssAlpha(this.light ? rgbOf(p.shade) : rgbOf(p.shade), 0.9);
    this.rippleStyle = cssAlpha(this.light ? mix(rgbOf(p.shade), rgbOf(p.litFoot), 0.4) : mix(rgbOf(p.lit), [255, 255, 255], 0.3), 0.7);
    this.devilStyle = cssAlpha(this.light ? rgbOf(p.shadeFoot) : rgbOf(p.lit), 0.5);
  }

  /** The moon's middle and radii, in cells: whole, over the horizon. */
  private moonAt(layout: DesertLayout) {
    const R = (this.palette.moon!.size * Math.min(this.width, this.height)) / 2;
    const rr = R / this.ch;
    return { c: this.palette.glow!.x * this.cols, r: Math.min(...layout.skyline) - rr * 1.3, rc: R / this.cw, rr };
  }

  /** What holds still, at full size: the sky, the moon, the dunes. */
  private paintStill(layout: DesertLayout) {
    const { cols, rows, cw, ch, dpr } = this;
    const p = this.palette;
    this.still.width = Math.round(cols * cw * dpr);
    this.still.height = Math.round(rows * ch * dpr);
    const g = this.still.getContext("2d")!;
    g.setTransform(cw * dpr, 0, 0, ch * dpr, 0, 0);
    paintSky(g, cols, rows, p, ch / cw);
    if (p.moon) {
      const { c, r, rc, rr } = this.moonAt(layout);
      const face = rgbOf(p.moon.face);
      const seas = rgbOf(p.moon.seas);
      // A soft glow round it, the disc, its seas faint and soft.
      g.save();
      g.translate(c, r);
      g.scale(1, rr / rc);
      const halo = g.createRadialGradient(0, 0, rc * 0.9, 0, 0, rc * 2.6);
      halo.addColorStop(0, cssAlpha(face, 0.2));
      halo.addColorStop(1, cssAlpha(face, 0));
      g.fillStyle = halo;
      g.fillRect(-rc * 2.6, -rc * 2.6, rc * 5.2, rc * 5.2);
      const disc = g.createRadialGradient(-rc * 0.2, -rc * 0.2, 0, 0, 0, rc);
      disc.addColorStop(0, css(face));
      disc.addColorStop(1, css(mix(face, seas, 0.6)));
      g.fillStyle = disc;
      g.beginPath();
      g.arc(0, 0, rc, 0, Math.PI * 2);
      g.fill();
      g.clip();
      for (const [dx, dy, s] of [[-0.3, -0.2, 0.34], [0.25, 0.15, 0.3], [-0.05, 0.45, 0.22]] as const) {
        const sea = g.createRadialGradient(dx * rc, dy * rc, 0, dx * rc, dy * rc, s * rc);
        sea.addColorStop(0, cssAlpha(seas, 0.4));
        sea.addColorStop(1, cssAlpha(seas, 0));
        g.fillStyle = sea;
        g.fillRect(-rc, -rc, rc * 2, rc * 2);
      }
      g.restore();
    }
    const horizonSky = rgbOf(p.sky[Math.round(0.5 * (p.sky.length - 1))]!);
    for (let k = 0; k < layout.ranges.length; k++) this.paintRange(g, layout, k, horizonSky);
    // Ripples: a few on the nearest dunes' windward faces.
    this.ripples = [];
    const near = layout.ranges.length - 1;
    for (let c = 1; c < cols - 1; c += 2) {
      for (let r = Math.ceil(layout.crests[near]![c]!) + 3; r < rows; r += 2) {
        if (hash(c, r, 3) > 0.05) continue;
        const { peak } = duneAt(layout.ranges[near]!, (c + 0.5) / cols);
        if (c + 0.5 < peak.x * cols - 1) this.ripples.push({ x: (c + 0.5) * cw, y: (r + 0.5) * ch });
      }
    }
  }

  /** One range of dunes: its shape in the light face's colours, its slip faces over it in the shade's,
   *  hazed by how far off it is. */
  private paintRange(g: OffscreenCanvasRenderingContext2D, layout: DesertLayout, k: number, horizonSky: Rgb) {
    const { cols, rows } = this;
    const p = this.palette;
    const range: Range = layout.ranges[k]!;
    const haze = p.haze * range.far ** 1.2;
    const hz = (c: Rgb) => css(mix(c, horizonSky, haze));
    const foot = range.foot * rows;
    const crestY = (x: number) => (range.foot - duneAt(range, x / cols).h - 0.012) * rows;
    const top = Math.min(...layout.crests[k]!);
    const bottom = Math.max(top + 1, Math.min(rows, foot));
    const body = g.createLinearGradient(0, top, 0, bottom);
    body.addColorStop(0, hz(rgbOf(p.lit)));
    body.addColorStop(1, hz(rgbOf(p.litFoot)));
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-1, rows + 1);
    for (let x = -1; x <= cols + 1; x += 0.25) g.lineTo(x, crestY(x));
    g.lineTo(cols + 1, rows + 1);
    g.closePath();
    g.fill();
    // Each slip face: from the peak along the crest to the right, down to the foot, and back up the
    // curved ridge to the peak.
    const shade = g.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, hz(rgbOf(p.shade)));
    shade.addColorStop(1, hz(rgbOf(p.shadeFoot)));
    g.fillStyle = shade;
    for (const peak of range.peaks) {
      const px = peak.x * cols;
      if (px + peak.right * cols < -1 || px > cols + 1) continue;
      const py = crestY(px);
      const end = px + peak.right * cols;
      g.beginPath();
      g.moveTo(px, py);
      let x = px;
      for (; x <= end; x += 0.25) {
        if (x > px + 0.5 && duneAt(range, x / cols).peak !== peak) break;
        g.lineTo(x, crestY(x));
      }
      // Down from where its crest ends, slanting as the ridge does, so it meets the next dune's
      // face along a slanting line, never a vertical seam.
      const footX = px + peak.right * cols * 0.85;
      const lean = (footX - px) / Math.max(1, foot - py);
      const sy = crestY(x);
      g.lineTo(x + lean * (foot + 2 - sy), foot + 2);
      g.lineTo(footX, foot + 2);
      // The ridge curves: steep under the peak, easing out toward the foot.
      g.quadraticCurveTo(px + (footX - px) * 0.15, py + (foot - py) * 0.7, px, py);
      g.closePath();
      g.fill();
    }
  }

  private placeStars(layout: DesertLayout) {
    const { width: W, cw, ch, cols } = this;
    let s = 0x57a;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    const moon = this.palette.moon ? this.moonAt(layout) : null;
    this.stars = [];
    for (let i = Math.round((W * layout.horizon * ch) / 6000); i > 0; i--) {
      const x = r() * W;
      const y = r() * layout.horizon * ch;
      const rate = 0.5 + r() * 1.8;
      const phase = r() * 6.28;
      const c = Math.floor(x / cw);
      const row = Math.floor(y / ch);
      if (layout.owner[row * cols + c] !== -1 || row > layout.skyline[c]! - 2) continue;
      if (moon && Math.hypot((c - moon.c) / moon.rc, (row - moon.r) / moon.rr) < 1.7) continue;
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
    const { cols, rows, dpr } = this;
    g.drawImage(this.still, 0, 0, cols, rows);
    // By day the heat shimmers over the far dunes: thin bands of them swaying a pixel or two.
    if (this.palette.mirage) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      const top = Math.round((layout.horizon - 4) * this.ch * dpr);
      const bottom = Math.round((layout.horizon + 4) * this.ch * dpr);
      const band = Math.max(2, Math.round(2 * dpr));
      for (let y = top; y < bottom; y += band) {
        const dx = Math.round(dpr * 1.5 * Math.sin(t * 5.3 + (y * 0.23) / dpr) * Math.sin(Math.PI * ((y - top) / (bottom - top))));
        if (dx) g.drawImage(this.still, 0, y, this.still.width, band, dx, y, this.still.width, band);
      }
      g.restore();
    }
    // The moon is the night's light: it glows.
    if (this.palette.moon) {
      const { c, r, rc, rr } = this.moonAt(layout);
      const l = this.ascii.lit;
      l.fillStyle = css(rgbOf(this.palette.moon.face));
      l.beginPath();
      l.ellipse(c, r, rc * 0.85, rr * 0.85, 0, 0, Math.PI * 2);
      l.fill();
    }
    // The dust devil: a funnel of dust where it whirls.
    const dv = desert.devil;
    if (dv.strength > 0.05) {
      const c = dv.x / this.cw;
      const foot = dv.y / this.ch;
      const top = (dv.y - DEVIL_HIGH * dv.strength) / this.ch;
      const grad = g.createLinearGradient(0, top, 0, foot);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, this.devilStyle);
      g.globalAlpha = dv.strength;
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(c - 0.6, foot);
      g.lineTo(c - 3, top);
      g.lineTo(c + 3, top);
      g.lineTo(c + 0.6, foot);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  protected overlay(g: Draw2D | null, desert: Desert) {
    const t = desert.time;
    const { cw, ch, cols } = this;
    const at = (glyph: string, x: number, y: number) => (g ? this.glyphAt(g, glyph, x, y) : this.ascii.hold(x, y));
    if (this.starStyles.length) {
      for (let l = 0; l < STAR_LEVELS; l++) {
        if (g) g.fillStyle = this.starStyles[l]!;
        for (const s of this.stars) {
          const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
          if (Math.min(STAR_LEVELS - 1, Math.floor(b * STAR_LEVELS)) === l) at(l === 2 ? "+" : l === 1 ? "." : "`", s.x, s.y);
        }
      }
    }
    if (g) g.fillStyle = this.rippleStyle;
    for (const r of this.ripples) at("~", r.x, r.y);
    // The caravan walking its crest, hidden where a nearer dune stands in front, its footprints
    // trailing behind it.
    const layout = desert.layout;
    const members = desert.caravanAt();
    const dir = desert.caravan.dir;
    const last = members[members.length - 1];
    if (last) {
      if (g) g.fillStyle = this.stepStyle;
      for (let k = 1; k < 40; k++) {
        const x = last.x - dir * (k + 1) * cw * 1.5;
        const c = Math.floor(x / cw);
        if (c < 0 || c >= cols) continue;
        const y = layout.crests[layout.route]![c]! * ch + ch * 0.4;
        if (layout.owner[Math.floor(y / ch) * cols + c]! > layout.route) continue;
        at(k % 2 ? "." : ",", x, y);
      }
    }
    if (g) g.fillStyle = this.caravanStyle;
    for (const m of members) {
      const sprite = MEMBERS[m.kind];
      const width = sprite[0]!.length;
      const stride = Math.floor(m.step * 2) % 2;
      sprite.forEach((row, k) => {
        let leg = 0;
        for (let i = 0; i < row.length; i++) {
          const chr = row[i]!;
          if (chr === " ") continue;
          const x = m.x + ((dir > 0 ? i : width - 1 - i) - width / 2) * cw;
          const y = m.y - (sprite.length - 1 - k) * ch - ch * 0.5;
          const c = Math.floor(x / cw);
          const r = Math.floor(y / ch);
          if (c < 0 || c >= cols || r < 0 || layout.owner[r * cols + c]! > m.z) continue;
          const glyph = chr === "L" ? (stride ? (leg++ % 2 ? "/" : "\\") : (leg++, "|")) : dir < 0 ? (MIRROR[chr] ?? chr) : chr;
          at(glyph, x, y);
        }
      });
    }
    // Sand streaming off the crests, fainter as it thins out.
    for (let level = 0; level < 4; level++) {
      if (g) g.fillStyle = this.grainStyles[level]!;
      for (const s of desert.stream) {
        const fade = 1 - s.age / s.life;
        if (Math.min(3, Math.floor(fade * s.near * 3.2)) === level) at(fade > 0.75 ? "~" : s.vx > 70 * s.near && fade > 0.4 ? "-" : fade > 0.35 ? "'" : ".", s.x, s.y);
      }
    }
    const dv = desert.devil;
    if (dv.strength > 0.02) {
      for (const front of [false, true]) {
        if (g) g.fillStyle = this.grainStyles[front ? 3 : 1]!;
        for (const w of dv.grains) {
          const p = desert.whirlAt(w);
          if (p.front === front && w.up <= DEVIL_HIGH * dv.strength + 4) at(front ? (w.up < 18 ? "~" : w.spin > 6.5 ? "o" : "*") : w.up < 18 ? "-" : ".", p.x, p.y);
        }
      }
    }
    for (let level = 1; level < 4; level++) {
      if (g) g.fillStyle = this.grainStyles[level]!;
      for (const b of desert.burst) {
        if ((b.landed >= 0 ? (b.landed < 0.3 ? 2 : 1) : 3) === level) at(b.landed >= 0 ? "." : Math.hypot(b.vx, b.vy) > 120 ? "*" : "'", b.x, b.y);
      }
    }
  }
}
