/**
 * Fireflies' drawing, in cells: the sky (look.ts) and its stars, twinkling; the meadow along the
 * bottom (grass.ts), layer by layer, back to front, the cells of each that never sway drawn once
 * into a layer of their own and the rest each frame where the breeze has them; and the fireflies,
 * each its light: a soft glow, and in its cell the lantern, bright as it flashes and dim between,
 * its head before it and its wings beating over it (folded when it rests). The small ones are a
 * speck of light each. A click's burst is a soft light widening from it.
 */
import { leanGlyph, still, sway } from "../blades";
import { textCells, type Draw2D } from "../cells";
import { css, mix, ramp as rampOf, rgbOf, RAMP } from "../colour";
import { glowSprite } from "../glow";
import { LookRenderer } from "../look";
import { clamp, prng } from "../math";
import { meadowOf, type GrassBlade, type Meadowland } from "./grass";
import { FIREFLY_KINDS, type FireflyKind } from "./kinds";
import { WAVE_SPEED, type Firefly, type Meadow } from "./meadow";
import { FIREFLY_PALETTE, type FireflyPalette } from "./palette";

const STAR_LEVELS = 3;
/** How long a click's burst of light shows. */
const BURST = 0.9;
/** How far each layer of grass stands off the middle of its cells, as a share of a cell: so blades
 *  of two layers in one column stand side by side, not over each other. */
const OFFSET = [0, -0.28, 0.3, 0];

/** The meadow's cells that never sway, drawn once into a layer the height of the grass: the back
 *  layers' in one, the front layers' in another, since the back's swaying blades go between. */
interface StillLayer {
  canvas: OffscreenCanvas;
  top: number;
  layers: readonly number[];
}

export class FireflyRenderer extends LookRenderer<FireflyPalette> {
  private lights = {} as Record<FireflyKind, { ramp: string[]; glow: OffscreenCanvas }>;
  private mote: { ramp: string[]; glow: OffscreenCanvas } | null = null;
  private bodyStyle = "";
  /** The grass's layers, back to front, each in three shades; its seed heads; and the block at the
   *  foot of a near blade. */
  private grassStyles: string[][] = [];
  private footStyle = "";
  private seedStyle = "";
  private starStyles: string[] = [];
  private add = true;
  private grass: GrassBlade[] = [];
  private turf: Pick<Meadowland, "turf" | "texture"> = { turf: new Uint8Array(0), texture: [] };
  private turfStyles = ["", ""];
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];
  private back: StillLayer = { canvas: new OffscreenCanvas(1, 1), top: 0, layers: [0, 1] };
  private front: StillLayer = { canvas: new OffscreenCanvas(1, 1), top: 0, layers: [2, 3] };
  private stillFresh = false;
  /** Where the fireflies settled in the grass are this frame, by cell (the first `settledCount`):
   *  the grass parts round them. */
  private settled: { c: number; r: number }[] = [];
  private settledCount = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, FIREFLY_PALETTE);
  }

  protected styled() {
    this.stillFresh = false;
    const p = this.palette;
    const body = rgbOf(p.body);
    const sky = rgbOf(p.water[1]!);
    for (const k of FIREFLY_KINDS) this.lights[k] = { ramp: rampOf(sky, rgbOf(p.kinds[k])), glow: glowSprite(rgbOf(p.kinds[k])) };
    this.mote = { ramp: rampOf(sky, rgbOf(p.mote)), glow: glowSprite(rgbOf(p.mote)) };
    this.bodyStyle = css(body);
    const seed = rgbOf(p.seed);
    // Its own green, one leaning to the seeds' straw, one fading into the sky.
    this.grassStyles = p.grass.map((c) => [css(rgbOf(c)), css(mix(rgbOf(c), seed, 0.28)), css(mix(rgbOf(c), sky, 0.22))]);
    this.footStyle = css(mix(rgbOf(p.grass[2]), sky, 0.55));
    this.seedStyle = css(rgbOf(p.seed));
    this.turfStyles = p.turf.map((c) => css(rgbOf(c)));
    const star = rgbOf(p.star);
    const top = rgbOf(p.water[0]!);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, star, (p.stars * (l + 1)) / STAR_LEVELS))) : [];
    this.add = p.add;
  }

  protected allocate() {
    this.layout();
    this.stillFresh = false;
  }

  /** The grass and the stars, from a fixed seed: the same window shows the same meadow. */
  private layout() {
    const { cols, rows, cw, ch } = this;
    const { blades, turf, texture } = meadowOf(cols, rows);
    this.grass = blades;
    this.turf = { turf, texture };
    const rnd = prng(0x57a25 + cols * 31 + rows);
    this.stars = Array.from({ length: Math.round((cols * cw * rows * ch) / 9000) }, () => ({
      x: rnd() * cols * cw, y: rnd() * rows * ch * 0.62, rate: 0.6 + rnd() * 1.8, phase: rnd() * Math.PI * 2,
    }));
  }

  draw(meadow: Meadow) {
    const { ctx, dpr, cols, ch, cw } = this;
    if (cols === 0) return;
    const t = meadow.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop(t), 0, 0);
    this.drawStars(t);
    if (!this.stillFresh) {
      this.paintStill(this.back);
      this.paintStill(this.front);
      this.stillFresh = true;
    }
    this.settledCount = 0;
    for (const f of meadow.flies) {
      if (!f.perched) continue;
      const s = (this.settled[this.settledCount++] ??= { c: 0, r: 0 });
      s.c = Math.floor(f.x / cw);
      s.r = Math.floor(f.y / ch);
    }
    // Back to front: the far and middle grass, then the near grass and the stalks over it.
    for (const layer of [this.back, this.front]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer.canvas, 0, Math.round(layer.top * ch * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      textCells(ctx, ch, this.fontFamily);
      for (const l of layer.layers) this.drawSwaying(l, t);
    }
    this.drawGlows(meadow);
    this.drawMotes(meadow);
    for (const f of meadow.flies) this.drawFly(meadow, f, t);
  }

  private drawStars(t: number) {
    if (!this.starStyles.length) return;
    const { ctx, dpr } = this;
    for (let l = 0; l < STAR_LEVELS; l++) {
      ctx.fillStyle = this.starStyles[l]!;
      for (const s of this.stars) {
        const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
        if (Math.min(STAR_LEVELS - 1, Math.floor(b * STAR_LEVELS)) !== l || this.cellIndex(s.x, s.y) < 0) continue;
        ctx.fillRect(Math.round(s.x * dpr), Math.round(s.y * dpr), Math.max(1, Math.round(dpr * 1.5)), Math.max(1, Math.round(dpr * 1.5)));
      }
    }
  }

  /** How far over a blade parts at its tip where a firefly has settled in it: away from it, more
   *  the nearer it is. */
  private parting(b: GrassBlade) {
    let push = 0;
    for (let i = 0; i < this.settledCount; i++) {
      const s = this.settled[i]!;
      const d = b.c - s.c;
      if (Math.abs(d) > 2 || s.r < b.foot - b.height || d === 0) continue;
      push += Math.sign(d) * (3 - Math.abs(d)) * 0.8;
    }
    return push;
  }

  /** A blade's cells from `from` up to `to`, where the breeze (and a firefly settled near it) has
   *  them at time `t`: its stem, its tip, a leaf where one springs off it, and the cells of its seed
   *  head (`heads`) or not. */
  private drawBlade(g: Draw2D, b: GrassBlade, from: number, to: number, t: number, part: number, heads: boolean) {
    const { cols, rows, cw, ch } = this;
    const dx = cw / 2 + OFFSET[b.layer]! * cw;
    let below = from > 0 ? sway(b, from - 1, t) + (part ? Math.round(part * Math.pow((from - 1) / b.height, 1.3)) : 0) : 0;
    for (let k = from; k < to; k++) {
      const off = sway(b, k, t) + (part ? Math.round(part * Math.pow(k / b.height, 1.3)) : 0);
      const c = b.c + off;
      const r = b.foot - k;
      const head = k >= b.height - b.seed;
      if (head === heads && r >= 0 && c >= 0 && c < cols && r < rows) {
        const glyph = head ? b.head[(b.height - 1 - k) % b.head.length]! : k === b.height - 1 ? b.top : leanGlyph(off - below, b.stem);
        g.fillText(glyph, c * cw + dx, r * ch + ch / 2 + 1);
        if (!heads) {
          for (const leaf of b.leaves) {
            if (leaf.k !== k || c + leaf.side < 0 || c + leaf.side >= cols) continue;
            g.fillText(leaf.side > 0 ? "/" : "\\", (c + leaf.side) * cw + dx, r * ch + ch / 2 + 1);
          }
        }
      }
      below = off;
    }
  }

  /** Layer `layer`'s blades where they sway: their stems in the layer's colour, and their seed
   *  heads, wherever they are, in the seeds'. */
  private drawSwaying(layer: number, t: number) {
    const { ctx } = this;
    for (let tone = 0; tone < 3; tone++) {
      ctx.fillStyle = this.grassStyles[layer]![tone]!;
      for (const b of this.grass) if (b.layer === layer && b.tone === tone) this.drawBlade(ctx, b, still(b), b.height, t, this.parting(b), false);
    }
    ctx.fillStyle = this.seedStyle;
    for (const b of this.grass) if (b.layer === layer && b.seed) this.drawBlade(ctx, b, b.height - b.seed, b.height, t, this.parting(b), true);
  }

  /** The cells of `layer`'s blades that never sway, into its canvas: the transform is 1:1. */
  private paintStill(layer: StillLayer) {
    const { dpr, cols, rows, cw, ch } = this;
    let top = rows - 4;
    for (const b of this.grass) if (layer.layers.includes(b.layer)) top = Math.min(top, b.foot - still(b) + 1);
    layer.top = top = Math.max(0, top);
    const w = Math.max(1, Math.round(cols * cw * dpr));
    const h = Math.max(1, Math.round((rows - top) * ch * dpr));
    if (layer.canvas.width !== w || layer.canvas.height !== h) {
      layer.canvas.width = w;
      layer.canvas.height = h;
    }
    const g = layer.canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, -top * ch * dpr);
    textCells(g, ch, this.fontFamily);
    // The turf, behind everything: a block in each of its cells, a character on some.
    if (layer === this.back) {
      const { turf, texture } = this.turf;
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < turf[c]!; k++) {
          const r = rows - 1 - k;
          g.fillStyle = this.turfStyles[0]!;
          g.fillRect(c * cw + 1, r * ch + 1, cw - 1, ch - 1);
          g.fillStyle = this.turfStyles[1]!;
          g.fillText(texture[c * 4 + k]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
        }
      }
    }
    for (const l of layer.layers) {
      // A near blade's foot, a block: the grass thick at its roots.
      if (l === 2) {
        g.fillStyle = this.footStyle;
        for (const b of this.grass) if (b.layer === 2) for (let k = 0; k < Math.min(2, b.height - 1); k++) g.fillRect((b.c + sway(b, k, 0)) * cw + 1, (b.foot - k) * ch + 1, cw - 1, ch - 1);
      }
      for (let tone = 0; tone < 3; tone++) {
        g.fillStyle = this.grassStyles[l]![tone]!;
        for (const b of this.grass) if (b.layer === l && b.tone === tone) this.drawBlade(g, b, 0, still(b), 0, 0, false);
      }
    }
  }

  /** Every firefly's glow, behind all the lights: a bigger one's wider, brighter as it flashes;
   *  and each click's burst, a soft light widening from it and fading. */
  private drawGlows(meadow: Meadow) {
    const { ctx, cw } = this;
    ctx.save();
    ctx.globalCompositeOperation = this.add ? "lighter" : "source-over";
    const scale = this.add ? 1 : 0.55;
    if (this.mote) {
      for (const w of meadow.waves) {
        if (w.age > BURST) continue;
        const r = cw * 2 + w.age * WAVE_SPEED * 0.7;
        ctx.globalAlpha = (1 - w.age / BURST) * 0.45 * scale;
        ctx.drawImage(this.mote.glow, w.x - r, w.y - r, r * 2, r * 2);
      }
      for (const m of meadow.motes) {
        const l = meadow.moteLight(m);
        if (l < 0.05) continue;
        const r = cw * (1.1 + 1.6 * l);
        ctx.globalAlpha = l * 0.7 * scale;
        ctx.drawImage(this.mote.glow, m.x - r, m.y - r, r * 2, r * 2);
      }
    }
    for (const f of meadow.flies) {
      const l = meadow.light(f);
      const r = cw * (2.4 + 4.4 * l) * (0.8 + 0.25 * f.size);
      ctx.globalAlpha = (0.16 + 0.76 * l) * scale;
      ctx.drawImage(this.lights[f.kind].glow, f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private drawMotes(meadow: Meadow) {
    const { ctx, cw, ch, cols } = this;
    const ramp = this.mote!.ramp;
    for (const m of meadow.motes) {
      const l = meadow.moteLight(m);
      if (l < 0.15) continue;
      const i = this.cellIndex(m.x, m.y);
      if (i < 0) continue;
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      ctx.fillStyle = ramp[clamp(Math.round((0.4 + 0.6 * l) * RAMP), 0, RAMP)]!;
      ctx.fillText(l > 0.55 ? "*" : l > 0.3 ? "+" : ".", x + cw / 2, y + ch / 2 + 1);
    }
  }

  /** One cell of a firefly: a block under its character, or none. */
  private flyCell(c: number, r: number, block: string | null, glyph: string, glyphStyle: string) {
    const { ctx, cols, rows, cw, ch } = this;
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    if (block) {
      ctx.fillStyle = block;
      ctx.fillRect(c * cw + 1, r * ch + 1, cw - 1, ch - 1);
    }
    ctx.fillStyle = glyphStyle;
    ctx.fillText(glyph, c * cw + cw / 2, r * ch + ch / 2 + 1);
  }

  /** A bigger firefly: its lantern in its cell, a block of its light as it flashes, dim between;
   *  its head before it; and its wings over it, beating as it flies, folded as it rests, lit by its
   *  lantern. */
  private drawFly(meadow: Meadow, f: Firefly, t: number) {
    const { cw, ch } = this;
    const l = meadow.light(f);
    const ramp = this.lights[f.kind].ramp;
    const at = (k: number) => ramp[clamp(Math.round(k * RAMP), 0, RAMP)]!;
    const c = Math.floor(f.x / cw);
    const r = Math.floor(f.y / ch);
    // On a dusk sky its lantern is dark between flashes, and its light a block of colour.
    if (l > 0.3) this.flyCell(c, r, at(0.35 + 0.6 * l), l > 0.65 ? "@" : "o", this.add ? at(Math.min(1, 0.55 + l)) : this.bodyStyle);
    else this.flyCell(c, r, null, "o", this.add ? at(0.55 + l) : this.bodyStyle);
    this.flyCell(c + f.facing, r, null, ".", this.bodyStyle);
    const beat = Math.floor(t * 16 + f.id) % 2;
    const wings = f.perched ? "-" : beat ? (f.facing > 0 ? "\\" : "/") : "^";
    this.flyCell(c, r - 1, null, wings, at(0.3 + 0.5 * l));
  }
}
