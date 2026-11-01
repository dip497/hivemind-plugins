/**
 * Fireflies' drawing. Once per size and look, into the backdrop: the sky and its stars (sky.ts);
 * the far grass, short and pale and still; and the turf along the very bottom over its roots, a
 * soft mass whose top edge is drawn in the cells' parts, darker toward the bottom of the window,
 * nearer, a grain of characters in it.
 *
 * Over that the swaying meadow, back to front: the middle tufts; the fireflies settled in the grass,
 * so the near blades stand in front of them; the near grass and the seed stalks, each blade a
 * tapered curve bending from its root with the breeze, its leaves and its seed head with it
 * (strokes.ts), a few fills a layer. It is kept between frames in a strip the height of the grass
 * and drawn again a piece at a time, a third of the window a frame, the piece a firefly lands in or
 * takes off from at once.
 *
 * Each frame, over the sky and that strip: the lights, each a soft glow, and a click's burst, a
 * ring of light widening; the fireflies in flight, each a small dark insect against its own light
 * (insect.ts), its lantern at its tail bright as it flashes; and every light's bright core over all.
 * The small fireflies are a soft point each, there while they blink.
 */
import { fillParts, textCells, type Draw2D } from "../cells";
import { css, mix, ramp as rampOf, rgbOf, type Oklch, type Rgb } from "../colour";
import { LookRenderer } from "../look";
import { hash3 } from "../math";
import { meadowOf, swayOf, type GrassBlade, type Meadowland } from "./grass";
import { insectPaths, poseOf, type Pose } from "./insect";
import { FIREFLY_KINDS, type FireflyKind } from "./kinds";
import { coreSprite, haloSprite, ringSprite } from "./lights";
import { WAVE_SPEED, type Firefly, type Meadow } from "./meadow";
import { FIREFLY_PALETTE, type FireflyPalette } from "./palette";
import { paintSky } from "./sky";
import { bladeCurve, bladeInto, headInto, leafInto, type Curve } from "./strokes";

/** How long a click's burst of light shows. */
const BURST = 0.9;
/** The turf's rows, from the bottom of the window up: as deep as it gets. */
const TURF_ROWS = 4;
/** How solid a part along the turf's top edge is, by how much of it the turf covers. */
const EDGE = [1, 0.75, 0.5, 0.25];
/** The turf's grain, by how much of a cell each character covers. No letters: a letter reads as
 *  text. */
const GRAIN = " .`',:;\"";
/** How fast a firefly turns about, in its facing's units a second. */
const TURN = 5;
/** A firefly's length, in cells, at its biggest. */
const LENGTH = 1.9;
/** How many frames back a flash's light lingers along the way a firefly flew: a third of a
 *  second, the streak a moving light leaves on the eye. */
const TRAIL = 10;
/** The swaying meadow is drawn again in this many pieces across the window, one a frame: each
 *  sways at a third of the frame rate, ten times a second, its fastest tips moving under a pixel
 *  between. Drawn whole each frame, in software, it cost five times what the meadow of characters
 *  did. */
const PIECES = 3;
/** How far a blade of each layer can reach from its root past its lean, in cells: its sway, a
 *  firefly parting it, its leaves and its head. A piece draws every blade that can reach into it. */
const REACH = [1, 3, 6, 7];
const WHITE: Rgb = [255, 255, 255];

/** A kind's light: its glow, its core, and its lantern from dark to lit. */
interface Light {
  halo: OffscreenCanvas;
  core: OffscreenCanvas;
  lantern: string[];
}

/** What the renderer keeps of a firefly between frames: its facing as it turns, its pose, whether
 *  it was settled, the last frame it was seen, and where its lantern was and how bright over the
 *  last `TRAIL` frames that time passed in (`trail`, x, y and light each, the newest at `at`). */
interface Seen {
  face: number;
  pose: Pose;
  perched: boolean;
  frame: number;
  trail: Float32Array;
  at: number;
}

export class FireflyRenderer extends LookRenderer<FireflyPalette> {
  private lights = {} as Record<FireflyKind, Light>;
  private mote: Light | null = null;
  private ring: OffscreenCanvas | null = null;
  /** Each layer of grass in three shades: its own, one toward its seeds, one into the sky. */
  private grassStyles: string[][] = [];
  private seedStyles: string[] = [];
  /** The turf at its top and its bottom, and its grain's, a shade off it. */
  private turfLook: [Rgb, Rgb, Rgb, Rgb] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  private bodyStyle = "";
  private shieldStyle = "";
  private wingStyle = "";
  private add = true;
  private hasStyles = false;
  private land: Meadowland = { blades: [], turf: new Float32Array(0) };
  /** The blades by layer, back to front. */
  private layers: GrassBlade[][] = [[], [], [], []];
  private curve: Curve = { x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0 };
  /** Where the fireflies settled in the grass are this frame (the first `settledCount`): the
   *  grass parts round them. */
  private settled: { x: number; y: number }[] = [];
  private settledCount = 0;
  private seen = new Map<number, Seen>();
  private frame = 0;
  /** The meadow's time at the last frame: a frame drawn again with none gone by is the same. */
  private drawnAt = 0;
  /** The swaying meadow, kept between frames: the backdrop's strip of the window the grass stands
   *  in, from `top` (CSS px) down, with the grass and the settled fireflies over it. `whole`: it is
   *  drawn whole for the backdrop as it is now; `piece`: the one drawn again next; `dirty`: the
   *  pieces to draw again this frame, a bit each, where a firefly landed or took off. */
  private strip = new OffscreenCanvas(1, 1);
  private top = 0;
  private whole = false;
  private piece = 0;
  private dirty = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, FIREFLY_PALETTE);
  }

  protected styled() {
    this.hasStyles = true;
    const p = this.palette;
    for (const k of FIREFLY_KINDS) this.lights[k] = this.lightOf(p.kinds[k]);
    this.mote = this.lightOf(p.mote);
    this.ring = ringSprite(rgbOf(p.mote));
    const horizon = rgbOf(p.water[p.water.length - 1]!);
    this.grassStyles = p.grass.map((g, l) => {
      const c = rgbOf(g);
      return [css(c), css(mix(c, rgbOf(p.seed[l]!), 0.16)), css(mix(c, horizon, 0.16))];
    });
    this.seedStyles = p.seed.map((s) => css(rgbOf(s)));
    const [top, bottom] = p.turf.map(rgbOf) as [Rgb, Rgb];
    // Its grain a shade off it: lighter at night, darker at dusk.
    const off = this.light ? rgbOf(p.grass[2]) : rgbOf(p.grass[0]);
    const k = this.light ? 0.14 : 0.22;
    this.turfLook = [top, bottom, mix(top, off, k), mix(bottom, off, k)];
    this.bodyStyle = css(rgbOf(p.body));
    this.shieldStyle = css(rgbOf(p.shield));
    // A pale blur at night; a grey one on a dusk sky, where pale would not show.
    this.wingStyle = css(this.light ? mix(rgbOf(p.body), horizon, 0.55) : mix(rgbOf(p.lantern), WHITE, 0.5));
    this.add = p.add;
  }

  private lightOf(k: Oklch): Light {
    const p = this.palette;
    const c = rgbOf(k);
    return {
      halo: haloSprite(p.glowL ? rgbOf([p.glowL, k[1], k[2]]) : c),
      core: coreSprite(mix(c, WHITE, p.hot)),
      lantern: rampOf(rgbOf(p.lantern), mix(c, WHITE, p.hot * 0.5)),
    };
  }

  /** The grass, from a fixed seed: the same window shows the same meadow. */
  protected allocate() {
    this.land = meadowOf(this.cols, this.rows);
    this.layers = [[], [], [], []];
    for (const b of this.land.blades) this.layers[b.layer]!.push(b);
  }

  /** The sky, the far grass and the turf: what never moves. The swaying meadow over it is drawn
   *  whole again the next frame. */
  protected paintBackground() {
    if (!this.hasStyles) this.styled();
    const g = this.bg.getContext("2d");
    if (!g) return;
    paintSky(g, this.width, this.height, this.dpr, this.palette, 0x57a25 + this.cols * 31 + this.rows);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLayer(g, 0, null);
    this.paintTurf(g);
    this.sizeStrip();
  }

  /** The turf: one mass, its blocks meeting with no seam, paler up it toward the far grass on it and
   *  darker down it, nearer; its top edge drawn in the cells' parts, each part along it as solid as
   *  the turf covers it, so the edge is soft and finer than the parts; and a character on some of
   *  its whole cells, fixed to the cell. */
  private paintTurf(g: Draw2D) {
    const { cols, rows, cw, ch, dpr } = this;
    const turf = this.land.turf;
    let deepest = 0;
    for (const d of turf) deepest = Math.max(deepest, d);
    const [top, bottom, grainTop, grainBottom] = this.turfLook;
    const down = (a: Rgb, b: Rgb) => {
      const grad = g.createLinearGradient(0, (rows - deepest) * ch, 0, rows * ch);
      grad.addColorStop(0, css(a));
      grad.addColorStop(1, css(b));
      return grad;
    };
    g.fillStyle = down(top, bottom);
    // By how much of it the turf covers: whole, then three steps of the edge.
    const masks = [0, 0, 0, 0];
    for (let k = 0; k < TURF_ROWS; k++) {
      const r = rows - 1 - k;
      for (let c = 0; c < cols; c++) {
        masks.fill(0);
        for (let h = 0; h < 2; h++) {
          const thirds = turf[c * 2 + h]! * 3 - 3 * k;
          for (let j = 0; j < 3; j++) {
            const cover = thirds - j;
            if (cover <= 0.12) break;
            masks[cover >= 0.88 ? 0 : cover >= 0.62 ? 1 : cover >= 0.37 ? 2 : 3]! |= 1 << ((2 - j) * 2 + h);
          }
        }
        for (let m = 0; m < 4; m++) {
          if (!masks[m]) continue;
          g.globalAlpha = EDGE[m]!;
          fillParts(g, c, r, cw, ch, dpr, masks[m]!);
        }
      }
    }
    g.globalAlpha = 1;
    textCells(g, ch, this.fontFamily);
    g.fillStyle = down(grainTop, grainBottom);
    for (let k = 0; k < TURF_ROWS; k++) {
      const r = rows - 1 - k;
      for (let c = 0; c < cols; c++) {
        if (Math.min(turf[c * 2]!, turf[c * 2 + 1]!) - k < 1.3) continue;
        const h = hash3(c, r, 0x7f);
        if (h < 0.6) g.fillText(GRAIN[1 + Math.floor((h / 0.6) * (GRAIN.length - 1))]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
      }
    }
  }

  /** The strip the swaying meadow is kept in: from above the tallest blade's reach to the bottom
   *  of the window, at the backdrop's size. */
  private sizeStrip() {
    let top = this.rows;
    for (let l = 1; l < 4; l++) for (const b of this.layers[l]!) top = Math.min(top, b.y - b.height * 1.15 - 2.5);
    this.top = Math.max(0, Math.floor(top)) * this.ch;
    const w = this.bg.width;
    const h = Math.max(1, this.bg.height - Math.round(this.top * this.dpr));
    if (this.strip.width !== w || this.strip.height !== h) {
      this.strip.width = w;
      this.strip.height = h;
    }
    this.whole = false;
  }

  draw(meadow: Meadow) {
    const { ctx, dpr, cols } = this;
    if (cols === 0) return;
    const t = meadow.time;
    const dt = Math.max(0, t - this.drawnAt);
    this.drawnAt = t;
    this.place(meadow, dt);
    // The swaying meadow: whole for a backdrop painted again, else a piece of it a frame, and any
    // piece a firefly landed in or took off from.
    if (!this.whole) {
      for (let k = 0; k < PIECES; k++) this.relay(k, t, meadow);
      this.whole = true;
    } else if (dt > 0 || this.dirty) {
      if (dt > 0) {
        this.dirty |= 1 << this.piece;
        this.piece = (this.piece + 1) % PIECES;
      }
      for (let k = 0; k < PIECES; k++) if (this.dirty & (1 << k)) this.relay(k, t, meadow);
    }
    this.dirty = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const bg = this.backdrop(t);
    const sy = Math.round(this.top * dpr);
    if (sy > 0) ctx.drawImage(bg, 0, 0, bg.width, sy, 0, 0, bg.width, sy);
    ctx.drawImage(this.strip, 0, sy);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawGlows(meadow);
    for (const f of meadow.flies) if (!f.perched) this.drawFly(ctx, meadow, f, 0);
    this.drawCores(meadow);
  }

  /** Each firefly's pose this frame, turning toward the way it faces; where those settled in the
   *  grass are; and the pieces of the meadow to draw again where one landed or took off. */
  private place(meadow: Meadow, dt: number) {
    const frame = ++this.frame;
    const span = this.width / PIECES;
    this.settledCount = 0;
    for (const f of meadow.flies) {
      let s = this.seen.get(f.id);
      if (!s) {
        s = { face: f.facing, pose: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, lx: 0, ly: 0, len: 0 }, perched: f.perched, frame, trail: new Float32Array(TRAIL * 3), at: 0 };
        this.seen.set(f.id, s);
      }
      s.face += (f.facing - s.face) * Math.min(1, dt * TURN);
      s.frame = frame;
      poseOf(f, s.face, this.cw * LENGTH * (0.8 + 0.2 * f.size), s.pose);
      if (dt > 0) {
        s.at = (s.at + 1) % TRAIL;
        s.trail[s.at * 3] = s.pose.lx;
        s.trail[s.at * 3 + 1] = s.pose.ly;
        s.trail[s.at * 3 + 2] = f.perched ? 0 : meadow.light(f);
      }
      if (f.perched !== s.perched) {
        s.perched = f.perched;
        const r = s.pose.len;
        for (let k = Math.max(0, Math.floor((f.x - r) / span)); k <= Math.min(PIECES - 1, Math.floor((f.x + r) / span)); k++) this.dirty |= 1 << k;
      }
      if (f.perched) {
        const at = (this.settled[this.settledCount++] ??= { x: 0, y: 0 });
        at.x = f.x;
        at.y = f.y;
      }
    }
    if (this.seen.size > meadow.flies.length) for (const [id, s] of this.seen) if (s.frame !== frame) this.seen.delete(id);
  }

  /** Piece `k` of the swaying meadow (of `PIECES` across), as it is at time `t`: the backdrop's
   *  strip there, the middle tufts, the fireflies settled there, the near grass and the stalks.
   *  Each blade or firefly that reaches into the piece is drawn, clipped to it. */
  private relay(k: number, t: number, meadow: Meadow) {
    const { dpr, cw } = this;
    const g = this.strip.getContext("2d");
    if (!g) return;
    const w = this.bg.width;
    const x0 = Math.round((k * w) / PIECES);
    const x1 = Math.round(((k + 1) * w) / PIECES);
    const sy = Math.round(this.top * dpr);
    const h = this.strip.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "copy";
    g.drawImage(this.bg, x0, sy, x1 - x0, h, x0, 0, x1 - x0, h);
    g.globalCompositeOperation = "source-over";
    g.save();
    g.beginPath();
    g.rect(x0, 0, x1 - x0, h);
    g.clip();
    g.setTransform(dpr, 0, 0, dpr, 0, -sy);
    const from = x0 / dpr / cw;
    const to = x1 / dpr / cw;
    this.drawLayer(g, 1, t, from, to);
    for (const f of meadow.flies) {
      if (!f.perched) continue;
      const c = f.x / cw;
      if (c + LENGTH < from || c - LENGTH > to) continue;
      this.drawFly(g, meadow, f, sy);
    }
    this.drawLayer(g, 2, t, from, to);
    this.drawLayer(g, 3, t, from, to);
    g.restore();
  }

  /** How far over a blade's tip parts where a firefly has settled by it: away from it, more the
   *  nearer it is, in px. */
  private parting(b: GrassBlade) {
    if (!this.settledCount) return 0;
    const { cw, ch } = this;
    const x = b.x * cw;
    const top = (b.y - b.height) * ch;
    const foot = b.y * ch;
    const span = cw * 2.5;
    let push = 0;
    for (let i = 0; i < this.settledCount; i++) {
      const s = this.settled[i]!;
      const d = x - s.x;
      if (d > span || d < -span || s.y < top || s.y > foot) continue;
      push += (d < 0 ? -1 : 1) * (span - Math.abs(d)) * 0.5;
    }
    return push;
  }

  /** Layer `layer`'s blades where the breeze has them at time `t` (`null`: still), those that can
   *  reach between `from` and `to` (cells across), each shade one fill, their seed heads one more and
   *  their bristles one stroke. */
  private drawLayer(g: Draw2D, layer: number, t: number | null, from = -Infinity, to = Infinity) {
    const { cw, ch } = this;
    const tones = [new Path2D(), new Path2D(), new Path2D()];
    const heads = new Path2D();
    const fine = new Path2D();
    const soft = new Path2D();
    const reach = REACH[layer]!;
    for (const b of this.layers[layer]!) {
      const lean = (b.slant ?? 0) * 1.2;
      if (b.x + Math.max(0, lean) + reach < from || b.x + Math.min(0, lean) - reach > to) continue;
      const c = bladeCurve(b, cw, ch, t, t === null ? 0 : this.parting(b), this.curve);
      const p = tones[b.tone]!;
      bladeInto(p, c, b.width * cw, b.tip * cw);
      for (const leaf of b.leaves) leafInto(p, c, b, leaf, cw, t === null ? 0 : swayOf(b, t + 0.8) * cw * 0.2);
      if (b.head) headInto(heads, fine, soft, c, b, cw, ch);
    }
    const styles = this.grassStyles[layer]!;
    for (let k = 0; k < 3; k++) {
      g.fillStyle = styles[k]!;
      g.fill(tones[k]!);
    }
    const seed = this.seedStyles[layer]!;
    g.fillStyle = seed;
    g.fill(heads);
    g.globalAlpha = 0.55;
    g.fill(soft);
    g.globalAlpha = 1;
    g.strokeStyle = seed;
    g.lineWidth = Math.max(0.5, cw * (layer === 0 ? 0.06 : 0.075));
    g.lineCap = "round";
    g.stroke(fine);
  }

  /** A firefly, into `g` (its origin `oy` device px down the window): its body, dark against its
   *  light, its wings a blur over it as it flies, its legs under it settled, its lantern lit as it
   *  flashes. Leaves `g` in CSS px. */
  private drawFly(g: Draw2D, meadow: Meadow, f: Firefly, oy: number) {
    const { dpr } = this;
    const paths = insectPaths();
    const q = this.seen.get(f.id)!.pose;
    const l = meadow.light(f);
    g.setTransform(dpr * q.a, dpr * q.b, dpr * q.c, dpr * q.d, dpr * q.e, dpr * q.f - oy);
    if (!f.perched) {
      g.globalAlpha = 0.22 + 0.25 * l;
      g.fillStyle = this.wingStyle;
      g.fill(paths.wings);
      g.globalAlpha = 1;
    }
    g.fillStyle = this.bodyStyle;
    g.fill(paths.body);
    if (!f.perched) g.fill(paths.covers);
    g.strokeStyle = this.bodyStyle;
    g.lineWidth = 0.04;
    g.lineCap = "round";
    g.stroke(paths.feelers);
    if (f.perched) g.stroke(paths.legs);
    g.fillStyle = this.shieldStyle;
    g.fill(paths.shield);
    g.fillStyle = this.tone(0.12 + 0.88 * l, this.lights[f.kind].lantern);
    g.fill(paths.lantern);
    g.setTransform(dpr, 0, 0, dpr, 0, -oy);
  }

  /** Every light's glow, behind the fireflies' bodies: a bigger one's wider, brighter as it
   *  flashes; a small one's while it blinks; and each click's burst, a ring of light widening to
   *  where it reaches and fading, a flash where it began. */
  private drawGlows(meadow: Meadow) {
    const { ctx, cw } = this;
    const mote = this.mote!;
    ctx.globalCompositeOperation = this.add ? "lighter" : "source-over";
    // Light adds to the night; at dusk it tints the sky, and must not wash it out.
    const scale = this.add ? 1 : 0.75;
    for (const w of meadow.waves) {
      if (w.age > BURST) continue;
      const fade = 1 - w.age / BURST;
      const r = Math.max(cw * 2, w.age * WAVE_SPEED) / 0.8;
      ctx.globalAlpha = fade * fade * 0.5 * scale;
      ctx.drawImage(this.ring!, w.x - r, w.y - r, r * 2, r * 2);
      if (w.age < 0.45) {
        const f = cw * (2.5 + w.age * 16);
        ctx.globalAlpha = (1 - w.age / 0.45) * 0.55 * scale;
        ctx.drawImage(mote.halo, w.x - f, w.y - f, f * 2, f * 2);
      }
    }
    for (const m of meadow.motes) {
      const l = meadow.moteLight(m);
      if (l < 0.04) continue;
      const r = cw * (0.9 + 1.7 * l);
      ctx.globalAlpha = l * 0.55 * scale;
      ctx.drawImage(mote.halo, m.x - r, m.y - r, r * 2, r * 2);
    }
    for (const f of meadow.flies) {
      const l = meadow.light(f);
      const q = this.seen.get(f.id)!.pose;
      const r = cw * (2 + 4.6 * l) * (0.8 + 0.25 * f.size);
      ctx.globalAlpha = (0.07 + 0.8 * l) * scale;
      ctx.drawImage(this.lights[f.kind].halo, q.lx - r, q.ly - r, r * 2, r * 2);
    }
    this.drawTrails(meadow);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** The streak a flash leaves along the way a firefly flew, fading behind it: its light where its
   *  lantern was each of the last frames, as bright as it was then, fainter and smaller the older. */
  private drawTrails(meadow: Meadow) {
    const { ctx } = this;
    for (const f of meadow.flies) {
      if (f.perched) continue;
      const s = this.seen.get(f.id)!;
      const core = this.lights[f.kind].core;
      const len = s.pose.len;
      for (let back = 1; back < TRAIL; back++) {
        const i = ((s.at - back + TRAIL) % TRAIL) * 3;
        const l = s.trail[i + 2]!;
        const fade = 1 - back / TRAIL;
        const a = l * fade * fade * 0.4;
        if (a < 0.03) continue;
        const r = len * (0.16 + 0.3 * l) * (0.5 + 0.5 * fade);
        ctx.globalAlpha = a;
        ctx.drawImage(core, s.trail[i]! - r, s.trail[i + 1]! - r, r * 2, r * 2);
      }
    }
  }

  /** Each light's bright core, over all: a firefly's at its lantern, a small one's as it blinks. */
  private drawCores(meadow: Meadow) {
    const { ctx, cw } = this;
    ctx.globalCompositeOperation = this.add ? "lighter" : "source-over";
    for (const f of meadow.flies) {
      const l = meadow.light(f);
      const q = this.seen.get(f.id)!.pose;
      const r = q.len * (0.22 + 0.5 * l);
      ctx.globalAlpha = 0.2 + 0.8 * l;
      ctx.drawImage(this.lights[f.kind].core, q.lx - r, q.ly - r, r * 2, r * 2);
    }
    const core = this.mote!.core;
    for (const m of meadow.motes) {
      const l = meadow.moteLight(m);
      if (l < 0.04) continue;
      const r = cw * (0.22 + 0.3 * l);
      ctx.globalAlpha = Math.min(1, l * 1.3);
      ctx.drawImage(core, m.x - r, m.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
