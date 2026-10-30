/**
 * Snowfall's drawing, in block cells: the land (the far peaks, their ridges drawn in slopes, snow
 * over rock; the forested hills; the fields; the village, wood walls and steep roofs, pines in
 * tiers; and the snow lying on the ground and on every ledge) is painted into a layer once per size
 * and look. Snow only ever grows, so as it rises a frame paints just the new snow over that layer:
 * the ground a column at a time as its height map rises by an eighth of a row, a roof or a branch as
 * its snow deepens. Each frame copies the layer in and draws over it what moves: the windows (and,
 * at dusk, their warm glow on the snow), the chimneys' smoke, the flakes (far ones a dot, the ones
 * among the houses a character, near ones a six-armed star drawn in lines, all on the cell grid)
 * and a click's powder.
 */
import { blockCell, textCells, type Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Oklch } from "../colour";
import { glowSprite } from "../glow";
import { SkyRenderer } from "../sky";
import { clamp, hash3, noise2 } from "../util";
import { SNOW_PALETTE, type SnowPalette } from "./palette";
import type { Valley } from "./valley";
import { Part, type House, type Layout } from "./village";

/** The snow's height is drawn in eighths of a row. */
const EIGHTHS = 8;

export class SnowRenderer extends SkyRenderer<SnowPalette> {
  private land = new OffscreenCanvas(1, 1);
  private landFor: { bg: number; layout: Layout | null } = { bg: -1, layout: null };
  /** The snow as last painted into the land: each column's surface, each ledge's depth, in eighths. */
  private drawnGround = new Int16Array(0);
  private drawnLedge = new Uint8Array(0);
  private st = {} as Record<string, string>;
  private seams = new Map<string, string>();
  private snowTones: string[] = [];
  private smokeStyles: string[] = [];
  private powderStyles: string[] = [];
  private glow: OffscreenCanvas | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, SNOW_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.seams.clear();
    const deeper: Oklch = this.light ? [0.5, 0.03, 250] : [0.08, 0.03, 265];
    const c = (o: Oklch) => {
      const style = css(rgbOf(o));
      this.seams.set(style, css(mix(rgbOf(o), rgbOf(deeper), this.light ? 0.08 : 0.2)));
      return style;
    };
    this.landFor.bg = -1;
    this.st = {
      snowLit: c(p.peakSnow[0]), snowShade: c(p.peakSnow[1]), rockLit: c(p.peakRock[0]), rockShade: c(p.peakRock[1]), peakInk: c(p.peakInk),
      forest: c(p.hills[0]), trees: c(p.hills[1]), clearing: c(p.hills[2]), sparkle: c(p.sparkle),
      wall: c(p.wall[0]), grain: c(p.wall[1]), roof: c(p.roof[0]), roofInk: c(p.roof[1]), chimney: c(p.chimney), door: c(p.door),
      lit: c(p.lit[0]), litInk: c(p.lit[1]), dark: c(p.dark[0]), darkInk: c(p.dark[1]),
      crown: c(p.pine[0]), needles: c(p.pine[1]), trunk: c(p.pine[2]),
      far: c(p.flake[0]), mid: c(p.flake[1]), near: c(p.flake[2]), edge: p.flakeEdge ? c(p.flakeEdge) : "",
      ledge: c(p.ledge),
    };
    this.snowTones = p.snow.map(c);
    const smoke = rgbOf(p.smoke.colour);
    this.smokeStyles = [1, 0.7, 0.45, 0.22].map((a) => cssAlpha(smoke, a * p.smoke.alpha));
    this.powderStyles = [1, 0.75, 0.5, 0.25].map((a) => cssAlpha(rgbOf(p.flake[this.light ? 1 : 2]), a));
    this.glow = p.litGlow ? glowSprite(rgbOf(p.litGlow.colour)) : null;
  }

  draw(v: Valley) {
    const { ctx, dpr, cols, rows } = this;
    if (cols === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const layout = v.layout;
    if (!layout || layout.cols !== cols || layout.rows !== rows) {
      ctx.drawImage(this.bg, 0, 0);
      return;
    }
    if (this.landFor.bg !== this.bgVersion || this.landFor.layout !== layout) this.paintLand(v, layout);
    else this.growSnow(v, layout);
    ctx.drawImage(this.land, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(ctx, this.ch, this.fontFamily);
    this.drawWindows(v, layout);
    this.drawSmoke(v);
    this.drawFlakes(v, layout);
    this.drawPowder(v);
  }

  /** One block cell: its seam, a block inset by it, and a character on it. The seam is the block's
   *  own colour a little deeper, so a body of cells reads as one thing made of cells. */
  private cell(g: Draw2D, c: number, r: number, block: string, ink?: string, glyph?: string) {
    blockCell(g, c, r, this.cw, this.ch, this.seams.get(block) ?? block, block, ink, glyph);
  }

  private paintLand(v: Valley, layout: Layout) {
    const { cols, rows, dpr, ch } = this;
    if (this.land.width !== this.bg.width || this.land.height !== this.bg.height) {
      this.land.width = this.bg.width;
      this.land.height = this.bg.height;
    }
    const g = this.land.getContext("2d");
    if (!g) return;
    this.landFor = { bg: this.bgVersion, layout };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.bg, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(g, ch, this.fontFamily);
    this.paintPeaks(g, layout);
    this.paintHills(g, layout);
    this.paintVillage(g, layout);
    this.drawnGround = new Int16Array(cols).fill(rows * EIGHTHS);
    this.drawnLedge = new Uint8Array(layout.ledges.length);
    this.growSnow(v, layout, g);
  }

  /** The far peaks: a ridge of slopes, snow above the snowline and on the sunward faces, rock below
   *  showing its strata. */
  private paintPeaks(g: Draw2D, l: Layout) {
    const { cols, st } = this;
    for (let c = 0; c < cols; c++) {
      const top = l.far[c]!;
      const left = l.far[Math.max(0, c - 1)]!;
      const right = l.far[Math.min(cols - 1, c + 1)]!;
      // The face rising to the right catches the light.
      const lit = l.farLit[c] === 1;
      // Snow down from the ridge to a ragged line, and below it in gullies running down the face.
      const snowline = top + 3 + Math.round(noise2(c / 7, 1.5, 7) * 8);
      for (let r = top; r < l.hills[c]!; r++) {
        const h = hash3(c, r, 17);
        const snow = r < snowline || noise2(c / 2.2, r / 6, 19) > 0.68;
        const block = snow ? (lit ? st.snowLit! : st.snowShade!) : lit ? st.rockLit! : st.rockShade!;
        if (r === top) {
          const glyph = left > top && right > top ? "^" : right < top ? "/" : left < top ? "\\" : "-";
          this.cell(g, c, r, block, st.peakInk, glyph);
        } else if (snow) this.cell(g, c, r, block, st.peakInk, h < 0.05 ? "'" : h > 0.94 ? "." : undefined);
        else this.cell(g, c, r, block, st.snowShade, h < 0.12 ? (lit ? "/" : "\\") : undefined);
      }
    }
  }

  /** The hills: forest, a tree's tip in many of its cells, a clearing of snow now and then; and the
   *  fields of snow below them, under the back of the village. */
  private paintHills(g: Draw2D, l: Layout) {
    const { cols, rows, st } = this;
    for (let c = 0; c < cols; c++) {
      for (let r = l.hills[c]!; r <= l.back; r++) {
        const h = hash3(c, r, 23);
        if (noise2(c / 4, r / 2, 27) > 0.78) this.cell(g, c, r, st.clearing!);
        else this.cell(g, c, r, st.forest!, st.trees, r === l.hills[c] || h < 0.3 ? "^" : undefined);
      }
      for (let r = l.back + 1; r < rows; r++) {
        const h = hash3(c, r, 29);
        this.cell(g, c, r, this.snowTones[1]!, st.sparkle, h < 0.04 ? "." : undefined);
      }
    }
  }

  /** The houses and the pines, cell by cell, back to front. */
  private paintVillage(g: Draw2D, l: Layout) {
    const { cols, rows, st } = this;
    for (let k = 0; k < l.things.length; k++) {
      const t = l.things[k]!;
      const mid = "w" in t ? (t as House).mid : (t as { c: number }).c;
      for (let r = 0; r < rows; r++) {
        for (let c = Math.max(0, mid - 16); c <= Math.min(cols - 1, mid + 16); c++) {
          const i = r * cols + c;
          if (l.owner[i] !== k) continue;
          const h = hash3(c, r, 31);
          switch (l.part[i] as Part) {
            case Part.Wall: this.cell(g, c, r, st.wall!, st.grain, h < 0.5 ? (h < 0.3 ? "|" : "=") : undefined); break;
            case Part.Roof: this.cell(g, c, r, st.roof!, st.roofInk, h < 0.6 ? (c < mid ? "/" : c > mid ? "\\" : "^") : undefined); break;
            case Part.RoofEdgeL: this.cell(g, c, r, st.roof!, st.roofInk, "/"); break;
            case Part.RoofEdgeR: this.cell(g, c, r, st.roof!, st.roofInk, "\\"); break;
            case Part.Chimney: this.cell(g, c, r, st.chimney!, st.roofInk, "#"); break;
            case Part.Window: this.cell(g, c, r, st.dark!, st.darkInk, "+"); break;
            case Part.Door: this.cell(g, c, r, st.door!, st.grain, "|"); break;
            case Part.Top: this.cell(g, c, r, st.crown!, st.needles, "^"); break;
            case Part.CrownL: this.cell(g, c, r, st.crown!, st.needles, "/"); break;
            case Part.CrownR: this.cell(g, c, r, st.crown!, st.needles, "\\"); break;
            case Part.Crown: this.cell(g, c, r, st.crown!, st.needles, h < 0.55 ? "^" : h < 0.7 ? "*" : undefined); break;
            case Part.Trunk: this.cell(g, c, r, st.trunk!, st.grain, "|"); break;
          }
        }
      }
    }
  }

  /** The snow lying on the ground and the ledges, where it has grown since it was last painted. */
  private growSnow(v: Valley, l: Layout, given?: Draw2D) {
    const { cols, rows, cw, ch, dpr } = this;
    let g: Draw2D | null = given ?? null;
    const ready = () => {
      if (g) return g;
      g = this.land.getContext("2d");
      if (!g) return null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      textCells(g, ch, this.fontFamily);
      return g;
    };
    for (let c = 0; c < cols; c++) {
      const q = Math.round((v.groundTop[c]! - v.ground[c]!) * EIGHTHS);
      if (q >= this.drawnGround[c]!) continue;
      const to = ready();
      if (!to) return;
      this.paintGround(to, c, q / EIGHTHS, Math.min(rows, this.drawnGround[c]! / EIGHTHS), l);
      this.drawnGround[c] = q;
    }
    l.ledges.forEach((ledge, k) => {
      const q = Math.round(v.ledgeDepth[k]! * EIGHTHS);
      if (q <= this.drawnLedge[k]! || ledge.r < 0) return;
      const to = ready();
      if (!to) return;
      this.drawnLedge[k] = q;
      const d = (q / EIGHTHS) * ch;
      to.fillStyle = this.st.ledge!;
      to.fillRect(ledge.c * cw, (ledge.r + 1) * ch - d, cw, d);
    });
  }

  /** Column `c`'s snow from its surface `s` (rows from the top) down through the row the old
   *  surface `was` lay in: the top cell filled as far as the snow reaches, those under it whole
   *  block cells, deeper ones a little bluer, a sparkle on a few. */
  private paintGround(g: Draw2D, c: number, s: number, was: number, l: Layout) {
    const { cw, ch, rows, st } = this;
    const r0 = Math.floor(s);
    const tone = (r: number) => this.snowTones[clamp(Math.floor((r - l.front) / 2), 0, 2)]!;
    if (r0 >= 0 && r0 < rows) {
      g.fillStyle = tone(r0);
      g.fillRect(c * cw, s * ch, cw, (r0 + 1 - s) * ch);
    }
    for (let r = Math.max(0, r0 + 1); r <= Math.min(rows - 1, Math.floor(was)); r++) {
      const h = hash3(c, r, 37);
      this.cell(g, c, r, tone(r), st.sparkle, h < 0.06 ? "." : h > 0.975 ? "'" : h > 0.95 ? "~" : undefined);
    }
  }

  /** The windows, and at dusk the glow of each lit one; one the snow has buried is not drawn. */
  private drawWindows(v: Valley, l: Layout) {
    const { ctx, cw, ch, st } = this;
    if (this.glow && this.palette.litGlow) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = this.palette.litGlow.alpha;
      const R = cw * 2.6;
      l.houses.forEach((h, k) => h.windows.forEach((w, j) => {
        if (v.lit[k]![j] && (w.r + 0.5) * ch < v.surface(w.c)) ctx.drawImage(this.glow!, (w.c + 0.5) * cw - R, (w.r + 0.5) * ch - R, R * 2, R * 2);
      }));
      ctx.restore();
    }
    for (const lit of [0, 1]) {
      for (const [k, h] of l.houses.entries()) {
        for (const [j, w] of h.windows.entries()) {
          if (v.lit[k]![j] !== lit || (w.r + 0.5) * ch > v.surface(w.c)) continue;
          this.cell(ctx, w.c, w.r, lit ? st.lit! : st.dark!, lit ? st.litInk : st.darkInk, "+");
        }
      }
    }
  }

  private drawSmoke(v: Valley) {
    const { ctx, cw, ch } = this;
    for (let level = 0; level < 4; level++) {
      ctx.fillStyle = this.smokeStyles[level]!;
      for (const puffs of v.smoke) {
        for (const p of puffs) {
          const a = p.age / p.life;
          if (Math.min(3, Math.floor(a * 4)) !== level) continue;
          const glyph = a < 0.18 ? (p.seed < 0.5 ? "o" : "°") : a < 0.55 ? "()~~"[Math.floor(p.seed * 4)]! : ".'`."[Math.floor(p.seed * 4)]!;
          ctx.fillText(glyph, (Math.floor(p.x / cw) + 0.5) * cw, (Math.floor(p.y / ch) + 0.5) * ch + 1);
        }
      }
    }
  }

  /** The flakes on the cell grid: far ones a dot (not over the village, which stands in front of
   *  them), the ones among the houses a character, near ones a six-armed star of lines. */
  private drawFlakes(v: Valley, l: Layout) {
    const { ctx, cw, ch, dpr, cols, rows, st } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = st.far!;
    const dot = Math.max(1, Math.round(1.5 * dpr));
    for (const f of v.flakes) {
      if (f.layer !== 0) continue;
      const c = Math.floor(f.x / cw);
      const r = Math.floor(f.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows || l.owner[r * cols + c]! >= 0) continue;
      ctx.fillRect(Math.round((c + 0.5) * cw * dpr) - (dot >> 1), Math.round((r + 0.5) * ch * dpr) - (dot >> 1), dot, dot);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = st.mid!;
    for (const f of v.flakes) {
      if (f.layer !== 1) continue;
      ctx.fillText(f.size > 0.55 ? "*" : "+", (Math.floor(f.x / cw) + 0.5) * cw, (Math.floor(f.y / ch) + 0.5) * ch + 1);
    }
    ctx.beginPath();
    for (const f of v.flakes) {
      if (f.layer !== 2) continue;
      const x = (Math.floor(f.x / cw) + 0.5) * cw;
      const y = (Math.floor(f.y / ch) + 0.5) * ch;
      const R = (0.42 + 0.2 * f.size) * cw;
      for (let a = 0; a < 3; a++) {
        const dx = Math.cos(Math.PI / 2 + (a * Math.PI) / 3) * R;
        const dy = Math.sin(Math.PI / 2 + (a * Math.PI) / 3) * R;
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
      }
    }
    const line = Math.max(1, Math.round(1.25 * dpr)) / dpr;
    ctx.lineCap = "round";
    if (st.edge) {
      ctx.strokeStyle = st.edge;
      ctx.lineWidth = line * 2.6;
      ctx.stroke();
    }
    ctx.strokeStyle = st.near!;
    ctx.lineWidth = line;
    ctx.stroke();
  }

  private drawPowder(v: Valley) {
    const { ctx, cw, ch } = this;
    for (let level = 0; level < 4; level++) {
      ctx.fillStyle = this.powderStyles[level]!;
      for (const p of v.powder) {
        const a = p.age / p.life;
        if (Math.min(3, Math.floor(a * 4)) !== level) continue;
        ctx.fillText(a < 0.2 ? "*" : a < 0.45 ? "+" : a < 0.7 ? "·" : ".", (Math.floor(p.x / cw) + 0.5) * cw, (Math.floor(p.y / ch) + 0.5) * ch + 1);
      }
    }
  }
}
