/**
 * Jellyfish's drawing: the deep (look.ts), marine snow, and each jelly as it reads at a glance, a
 * soft glowing bell with its threads streaming under it:
 *   1. a soft glow round its bell (glow.ts), the light it gives;
 *   2. its tentacles, fine strokes from its rim that taper and fade toward their tips, and its oral
 *      arms, frilled ribbons twisting down from under its middle;
 *   3. in front of them its bell, see-through: the cells it covers, each sampled at its six parts
 *      (cells.ts) so its outline, its scalloped rim and its pattern are finer than the cells, filled
 *      edge to edge in runs of one tone with no seam between. A thick shell of gel, brighter toward
 *      its crown where it is thickest and the light from above falls, clearer inside where it is
 *      hollow, fading toward its rim, its outline a shade brighter, its kind's markings showing
 *      through in their own colours, a gleam on its crown; and on the whole cells inside it a grain
 *      of characters a shade darker, fixed to the bell.
 * A click's pulse is a faint ring of specks spreading through the water.
 *
 * What does not change (the bells' outlines and patterns, every colour) is worked out once: the
 * outlines and patterns per kind (`bellTables`), the colours per look (`styled`). A frame looks
 * them up and builds no strings.
 */
import { fillParts, PART_X, PART_Y, textCells } from "../cells";
import { cssAlpha, mix, rgbOf, type Oklch, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { LookRenderer } from "../look";
import { clamp, hash3, smoothstep, TAU } from "../math";
import { BELL, GLEAM, JELLY_KINDS, JELLY_SHAPES, topOf, type JellyKind, type JellyShape } from "./kinds";
import { JELLY_PALETTE, type JellyPalette } from "./palette";
import { ARM_NODES, bellOf, bellTurn, PULSE_REACH, RIM_SMILE, PULSE_SPEED, TENTACLE_NODES, type Jelly, type Swarm } from "./swarm";

/** Tones in a ramp of the bell, its markings and its threads: see-through at the first, nearly
 *  solid at the last. */
const LEVELS = 33;
const PULSE_LEVELS = 5;
/** Steps across a bell and up it in its tables. */
const U_STEPS = 128;
const HEM_STEPS = 24;
const DOME_STEPS = 64;
/** The brightest a bell's outline is over the gel inside it. */
const OUTLINE = 0.2;
/** A tentacle is drawn in this many pieces, each finer and fainter than the one before. */
const SECTIONS = 4;
/** Points an oral arm's ribbon is laid along, between two of its nodes. */
const ARM_SUB = 3;
/** The grain on a bell's whole cells, by how much of the cell each character covers: none on most
 *  of it, sparse where the light is on it, a little denser into shadow. No letters. */
const GRAIN = " .:";
/** Cells of gel too dim to take a grain: it would read as a speck of dirt in a clear hollow. */
const GRAIN_LIT = 0.38;
const GRAIN_LEVELS = 6;
/** A bell's tones: each of its three ramps' steps, and its gleam. */
const TONES = 3 * LEVELS + 1;

/** One kind's bell, once: its outline, its rim, and what each point of it is and how lit. */
interface BellTable {
  /** The dome's height, by `u` across, as a share of the bell's. */
  top: Float32Array;
  /** How far its rim hangs below its rim's line, by `u` across, as a share of the bell's height:
   *  with every lobe the kind has, and with every other one (for a bell too small to show them all). */
  hem: Float32Array;
  hemHalf: Float32Array;
  /** By `u` across and `vt` up (the hem's HEM_STEPS rows, then the dome's): what it is (kinds.ts:
   *  BELL, MARK, MARK2, GLEAM), and how much light it gives back, 0 to 1. */
  slot: Uint8Array;
  shade: Float32Array;
}

/** How far the rim hangs below its line `u` across, as a share of the bell's height: a curve (the
 *  front of the margin), and under it a row of rounded lobes with a notch between each two. */
function hemAt(shape: JellyShape, u: number, lobes: number) {
  const q = (((u + 1) / 2) * lobes) % 1;
  return RIM_SMILE * Math.sqrt(Math.max(0, 1 - u * u)) + shape.scallop * Math.pow(Math.sin(Math.PI * q), 0.55);
}

/** A bell seen from the side: a thick shell of gel round a hollow. Brightest toward its crown, where
 *  it is thickest and the light comes from; clearer in the hollow; fading toward its rim. */
function shadeAt(shape: JellyShape, u: number, vt: number, v: number) {
  if (vt < 0) return 0.34 + 0.06 * (1 + vt);
  // The hollow: under the crown, most of the way out and two thirds of the way up.
  const hollow = Math.abs(u) < 0.82 ? smoothstep(0.5, 0.75, v / Math.max(0.05, topOf(shape, u / 0.82))) : 1;
  const s = 0.32 + 0.32 * v + (0.12 + 0.1 * v) * hollow;
  return s * (0.78 + 0.22 * smoothstep(0, 0.3, v));
}

function tableOf(shape: JellyShape): BellTable {
  const top = new Float32Array(U_STEPS);
  const hem = new Float32Array(U_STEPS);
  const hemHalf = new Float32Array(U_STEPS);
  const rows = HEM_STEPS + DOME_STEPS;
  const slot = new Uint8Array(U_STEPS * rows);
  const shade = new Float32Array(U_STEPS * rows);
  for (let iu = 0; iu < U_STEPS; iu++) {
    const u = ((iu + 0.5) / U_STEPS) * 2 - 1;
    const t = (top[iu] = topOf(shape, u));
    hem[iu] = hemAt(shape, u, shape.lobes);
    hemHalf[iu] = hemAt(shape, u, Math.max(6, Math.round(shape.lobes / 2)));
    for (let iv = 0; iv < rows; iv++) {
      const vt = iv < HEM_STEPS ? (iv + 0.5) / HEM_STEPS - 1 : (iv - HEM_STEPS + 0.5) / DOME_STEPS;
      const v = vt < 0 ? 0 : vt * t;
      slot[iu * rows + iv] = shape.pattern(u, vt, v);
      shade[iu * rows + iv] = shadeAt(shape, u, vt, v);
    }
  }
  return { top, hem, hemHalf, slot, shade };
}

/** Every kind's bell, worked out the first time one is drawn. */
let tables: Record<JellyKind, BellTable> | null = null;
const bellTables = () => (tables ??= Object.fromEntries(JELLY_KINDS.map((k) => [k, tableOf(JELLY_SHAPES[k])])) as Record<JellyKind, BellTable>);

/** LEVELS steps of a colour, each a fill style, see-through at the first: from `from` at `a0` to
 *  `to` at `a1`. */
function alphaRamp(from: Rgb, to: Rgb, a0: number, a1: number) {
  return Array.from({ length: LEVELS }, (_, i) => {
    const t = i / (LEVELS - 1);
    return cssAlpha(mix(from, to, t), a0 + (a1 - a0) * t);
  });
}

/** A colour `dl` lighter (or darker) in OKLCH, its chroma `kc` times as much. */
const shifted = ([l, c, h]: Oklch, dl: number, kc = 1): Rgb => rgbOf([clamp(l + dl, 0, 1), c * kc, h]);

/** A bell as it is laid out this frame (`layBell`): its box of cells (its first column and row, and
 *  how many parts across and down), its half-width and height, how it is turned, and how many lobes
 *  its rim is drawn with. */
interface BellFrame {
  c0: number;
  r0: number;
  bw: number;
  bh: number;
  w: number;
  h: number;
  cos: number;
  sin: number;
  lobes: number;
}

interface KindStyles {
  /** The bell's tones (`TONES`), from 1: its gel's ramp, its marking's and its second's, then its
   *  gleam. */
  tones: string[];
  /** Its grain, by how lit the cell it is in is. */
  grain: string[];
  tentacle: string[];
  arm: string[];
  tip: string[];
  glow: OffscreenCanvas;
  /** The soft light round each of the lights of its rim, if it has them. */
  light: OffscreenCanvas;
}


export class JellyRenderer extends LookRenderer<JellyPalette> {
  private styles = {} as Record<JellyKind, KindStyles>;
  private snowStyles = ["", ""];
  private pulseStyles: string[] = [];
  /** Whether glows add light (on dark water) or tint (on light). */
  private glowAdd = true;
  private shine = 0;
  /** A bell's parts as it is laid out this frame: what each is (0 none, else 1 + its slot), and its
   *  light. Grown as a bigger bell needs. */
  private partSlot = new Uint8Array(0);
  private partShade = new Float32Array(0);
  /** An oral arm's ribbon this frame: per point its left edge and its right (x, y, x, y). */
  private ribbon = new Float32Array(0);
  /** A bell's runs this frame: each one's tone, and where (its row of parts, its first part and
   *  the part after its last, packed); how many of each tone, and the runs in order of tone. */
  private runTone = new Uint8Array(512);
  private runAt = new Int32Array(512);
  private toneCounts = new Int32Array(TONES + 1);
  private runOrder = new Int32Array(512);
  /** Where the lights round a rim are this frame (x, y). */
  private lightAt = new Float32Array(64);
  /** The bell being drawn, as `layBell` laid it out. */
  private frame: BellFrame = { c0: 0, r0: 0, bw: 0, bh: 0, w: 1, h: 1, cos: 1, sin: 0, lobes: 1 };

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, JELLY_PALETTE);
  }

  protected allocate() {}

  private growRuns() {
    const tone = new Uint8Array(this.runTone.length * 2);
    const at = new Int32Array(this.runAt.length * 2);
    tone.set(this.runTone);
    at.set(this.runAt);
    this.runTone = tone;
    this.runAt = at;
  }

  protected styled() {
    const p = this.palette;
    const light = this.light;
    this.glowAdd = !light;
    const mid = rgbOf(p.water[1]!);
    const deep = rgbOf(p.water[p.water.length - 1]!);
    /** Gel on dark water gives light, deepening to its colour and paling toward white where it is
     *  thickest; on light water it is ink, a pale wash deepening where there is more of it. */
    const gel = (c: Oklch, a0: number, a1: number) => (light ? alphaRamp(shifted(c, 0.1), shifted(c, -0.08, 1.05), a0, a1) : alphaRamp(shifted(c, -0.12), shifted(c, 0.07, 0.75), a0, a1));
    const thread = (c: Oklch) => (light ? alphaRamp(shifted(c, 0.02), shifted(c, -0.06), 0, 0.9) : alphaRamp(shifted(c, -0.05), shifted(c, 0.05), 0, 0.9));
    for (const k of JELLY_KINDS) {
      const c = p.kinds[k];
      const bell = gel(c.bell, 0.04, 0.9);
      const ramps: [string[], string[], string[]] = [bell, gel(c.mark, 0.1, 0.95), gel(c.mark2, 0.1, 0.95)];
      // A shade darker than the gel it is on: the water's own dark on dark water, deeper ink on light.
      const grainInk = light ? shifted(c.bell, -0.28) : deep;
      const arm = gel(c.arm, 0, 0.85);
      this.styles[k] = {
        tones: [...ramps.flat(), light ? cssAlpha(mix(rgbOf(p.water[0]!), [255, 255, 255], 0.6), 0.8) : cssAlpha(mix(rgbOf(c.bell), [255, 255, 255], 0.55), 0.78)],
        grain: Array.from({ length: GRAIN_LEVELS }, (_, i) => cssAlpha(grainInk, (light ? 0.16 : 0.2) + (light ? 0.1 : 0.16) * (i / (GRAIN_LEVELS - 1)))),
        tentacle: thread(c.tentacle),
        arm,
        tip: c.tip ? gel(c.tip, 0, 0.85) : arm,
        glow: glowSprite(rgbOf(c.bell)),
        light: glowSprite(rgbOf(c.mark2), 32),
      };
    }
    const snow = rgbOf(p.snow);
    this.snowStyles = [cssAlpha(mix(mid, snow, 0.4), 1), cssAlpha(mix(mid, snow, 0.75), 1)];
    this.pulseStyles = Array.from({ length: PULSE_LEVELS }, (_, l) => cssAlpha(mix(mid, snow, 0.15 + (0.6 * (l + 1)) / PULSE_LEVELS), 1));
    this.shine = p.shine;
  }

  draw(swarm: Swarm) {
    const { ctx, dpr, cols, ch } = this;
    if (cols === 0) return;
    const t = swarm.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop(t), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSnow(swarm);
    for (const j of swarm.jellies) this.drawGlow(j);
    this.drawPulses(swarm);
    textCells(ctx, ch, this.fontFamily);
    ctx.lineJoin = "round";
    // Far jellies first. Each one's threads behind its bell, which they show through.
    for (const j of swarm.jellies) {
      this.drawTentacles(j);
      this.drawArms(j, t);
      this.drawBell(j);
    }
  }

  /** Marine snow: a speck in its cell, low in it, nearer specks brighter. */
  private drawSnow(swarm: Swarm) {
    const { ctx, cw, ch } = this;
    for (let near = 0; near < 2; near++) {
      ctx.fillStyle = this.snowStyles[near]!;
      const size = near ? 2 : 1.5;
      for (const m of swarm.snow) {
        if ((m.z > 0.7 ? 1 : 0) !== near || this.cellIndex(m.x, m.y) < 0) continue;
        ctx.fillRect(Math.floor(m.x / cw) * cw + cw * 0.5, Math.floor(m.y / ch) * ch + ch * 0.6, size, size);
      }
    }
  }

  /** Each click's pulse: a faint ring of specks spreading out, evenly round it, finer as it fades,
   *  gone by the time it has reached as far as it goes. */
  private drawPulses(swarm: Swarm) {
    const { ctx, cw } = this;
    for (const p of swarm.pulses) {
      const r = p.age * PULSE_SPEED;
      const fade = 1 - r / PULSE_REACH;
      if (fade <= 0 || r < 1) continue;
      ctx.fillStyle = this.pulseStyles[clamp(Math.floor(fade * PULSE_LEVELS), 0, PULSE_LEVELS - 1)]!;
      const size = 1.25 + 1.25 * fade;
      const steps = Math.max(8, Math.ceil((TAU * r) / (cw * 0.9)));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * TAU;
        ctx.fillRect(p.x + Math.cos(a) * r - size / 2, p.y + Math.sin(a) * r * 0.8 - size / 2, size, size);
      }
    }
  }

  /** The light round a jelly's bell: soft always, a flash when it starts. About the bell's own
   *  size, so its outline reads through it. */
  private drawGlow(j: Jelly) {
    const a = clamp(this.shine * (0.6 + 0.4 * j.depth) + j.glow * 0.75, 0, 1);
    if (a < 0.02) return;
    const { ctx } = this;
    const { w, h } = bellOf(j);
    const rx = w * (1.45 + j.glow * 0.5);
    const ry = Math.max(h * 1.6, w * 0.9) * (1 + j.glow * 0.4);
    const turn = bellTurn(j);
    const cx = j.x + Math.sin(turn) * h * 0.45;
    const cy = j.y - Math.cos(turn) * h * 0.45;
    ctx.save();
    ctx.globalCompositeOperation = this.glowAdd ? "lighter" : "source-over";
    ctx.globalAlpha = this.glowAdd ? a : a * 0.7;
    ctx.drawImage(this.styles[j.kind].glow, cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.restore();
  }

  /** The step of a ramp `t` of the way along it. */
  private level(ramp: readonly string[], t: number) {
    return ramp[clamp(Math.round(t * (LEVELS - 1)), 0, LEVELS - 1)]!;
  }

  /** A strand's curve from control `from` to `to` (exclusive), each node `off` px across times how
   *  far down it is: a smooth curve through the midpoints of its segments, from its root at the
   *  first piece and on to its tip at the last. */
  private trace(n: Float32Array, from: number, to: number, off: number) {
    const { ctx } = this;
    const count = n.length / 2;
    const k1 = 1 / (count - 1);
    const x = (k: number) => n[k * 2]! + off * k * k1;
    const y = (k: number) => n[k * 2 + 1]!;
    if (from === 1) {
      ctx.moveTo(x(0), y(0));
      ctx.lineTo((x(0) + x(1)) / 2, (y(0) + y(1)) / 2);
    } else ctx.moveTo((x(from - 1) + x(from)) / 2, (y(from - 1) + y(from)) / 2);
    for (let k = from; k < to; k++) ctx.quadraticCurveTo(x(k), y(k), (x(k) + x(k + 1)) / 2, (y(k) + y(k + 1)) / 2);
    if (to === count - 1) ctx.lineTo(x(count - 1), y(count - 1));
  }

  /** Its tentacles, in pieces: each finer and fainter toward the tips, every tentacle of a class (a
   *  fringe, long threads, the one long trailer) in one path a piece. */
  private drawTentacles(j: Jelly) {
    const { ctx } = this;
    const shape = j.shape;
    if (!shape.tentacles && !shape.trailer) return;
    const ramp = this.styles[j.kind].tentacle;
    const near = 0.7 + 0.3 * j.depth;
    const base = Math.max(1.25, this.cw * 0.17);
    const threads = shape.threads ?? 1;
    const spread = this.cw * 0.9;
    ctx.lineCap = "butt";
    for (let cls = 0; cls < 3; cls++) {
      // 0 a fringe, 1 long threads, 2 a trailer.
      if (cls === 0 && !(shape.fringe && shape.tentacles)) continue;
      if (cls === 1 && (shape.fringe || !shape.tentacles)) continue;
      if (cls === 2 && !shape.trailer) continue;
      const count = TENTACLE_NODES;
      for (let sec = 0; sec < SECTIONS; sec++) {
        const a = (sec + 0.5) / SECTIONS;
        const from = 1 + Math.round(((count - 2) * sec) / SECTIONS);
        const to = 1 + Math.round(((count - 2) * (sec + 1)) / SECTIONS);
        const strength = cls === 0 ? 0.62 - 0.42 * a : 0.78 - 0.62 * a;
        ctx.strokeStyle = this.level(ramp, strength * near + j.glow * 0.3);
        ctx.lineWidth = base * (cls === 0 ? 0.8 : cls === 2 ? 1.1 : 1) * (1 - 0.5 * a);
        ctx.beginPath();
        for (const s of j.strands) {
          if (s.arm || (cls === 2) !== s.trailer) continue;
          if (cls === 2 || threads === 1) this.trace(s.nodes, from, to, 0);
          else for (let th = 0; th < threads; th++) this.trace(s.nodes, from, to, (th - (threads - 1) / 2) * spread * (0.6 + 0.4 * ((s.phase + th) % 2)));
        }
        ctx.stroke();
      }
    }
  }

  /** Its oral arms: each a ribbon down a smooth curve through its nodes, narrowing toward its end,
   *  twisting so it shows wide and then edge-on, its edges frilled; a see-through fill in one path
   *  for all its arms (a tip of its own colour over their ends), and their edges a little brighter,
   *  in two pieces, the lower fainter. */
  private drawArms(j: Jelly, t: number) {
    const shape = j.shape;
    if (!shape.arms) return;
    const { ctx } = this;
    const st = this.styles[j.kind];
    const near = 0.7 + 0.3 * j.depth;
    // A jelly's arms are its first strands (swarm.ts).
    const arms = shape.arms;
    const nodes = ARM_NODES;
    const P = (nodes - 1) * ARM_SUB + 1;
    if (this.ribbon.length < arms * P * 4) this.ribbon = new Float32Array(arms * P * 4);
    const rb = this.ribbon;
    const hw0 = shape.armWidth * j.length * (1 - 0.15 * j.beat);
    for (let ai = 0; ai < arms; ai++) {
      const s = j.strands[ai]!;
      const n = s.nodes;
      const nx = (k: number) => n[clamp(k, 0, nodes - 1) * 2]!;
      const ny = (k: number) => n[clamp(k, 0, nodes - 1) * 2 + 1]!;
      let px = nx(0);
      let py = ny(0);
      for (let i = 0; i < P; i++) {
        // Catmull-Rom between nodes k and k + 1.
        const k = Math.min(nodes - 2, Math.floor(i / ARM_SUB));
        const f = i / ARM_SUB - k;
        const f2 = f * f;
        const f3 = f2 * f;
        const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (3 * b - a - 3 * c + d) * f3);
        const x = cr(nx(k - 1), nx(k), nx(k + 1), nx(k + 2));
        const y = cr(ny(k - 1), ny(k), ny(k + 1), ny(k + 2));
        // Across it, from the way it runs here.
        let dx = i ? x - px : nx(1) - nx(0);
        let dy = i ? y - py : ny(1) - ny(0);
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        px = x;
        py = y;
        const along = i / (P - 1);
        const hw = hw0 * (1 - 0.62 * along);
        const turn = along * shape.twist * Math.PI + s.phase * 0.8 + t * 0.7;
        const wide = hw * (0.38 + 0.62 * Math.abs(Math.cos(turn)));
        // Ruffles down each edge, two waves running down it at their own paces.
        const frill = hw * 0.26;
        const ph = s.phase * 1.9 + ai * 0.7;
        const fl = frill * (Math.sin(along * 29 + ph + t * 1.6) + 0.5 * Math.sin(along * 61 + ph * 2 - t * 2.3));
        const fr = frill * (Math.sin(along * 29 + ph + 2.2 + t * 1.6) + 0.5 * Math.sin(along * 53 + ph * 3 - t * 2.1));
        const o = (ai * P + i) * 4;
        rb[o] = x - dy * (wide + fl);
        rb[o + 1] = y + dx * (wide + fl);
        rb[o + 2] = x + dy * (wide + fr);
        rb[o + 3] = y - dx * (wide + fr);
      }
    }
    // The ribbon itself, see-through, in one piece; a tip of its own colour over its end.
    const ribbon = (i0: number, i1: number) => {
      ctx.beginPath();
      for (let ai = 0; ai < arms; ai++) {
        const o = ai * P * 4;
        ctx.moveTo(rb[o + i0 * 4]!, rb[o + i0 * 4 + 1]!);
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(rb[o + i * 4]!, rb[o + i * 4 + 1]!);
        for (let i = i1; i >= i0; i--) ctx.lineTo(rb[o + i * 4 + 2]!, rb[o + i * 4 + 3]!);
        ctx.closePath();
      }
      ctx.fill();
    };
    ctx.fillStyle = this.level(st.arm, 0.36 * near + j.glow * 0.25);
    ribbon(0, P - 1);
    if (st.tip !== st.arm) {
      ctx.fillStyle = this.level(st.tip, 0.3 * near + j.glow * 0.25);
      ribbon(Math.round(P * 0.62), P - 1);
    }
    const pieces = 2;
    for (let sec = 0; sec < pieces; sec++) {
      const i0 = Math.round(((P - 1) * sec) / pieces);
      const i1 = Math.round(((P - 1) * (sec + 1)) / pieces);
      const a = (sec + 0.5) / pieces;
      const ramp = sec === pieces - 1 ? st.tip : st.arm;
      // Its frilled edges, catching the light, fainter toward its end.
      ctx.strokeStyle = this.level(ramp, (0.82 - 0.36 * a) * near + j.glow * 0.3);
      ctx.lineWidth = Math.max(1, this.cw * 0.13) * (1 - 0.3 * a);
      ctx.beginPath();
      for (let ai = 0; ai < arms; ai++) {
        const o = ai * P * 4;
        for (let e = 0; e < 4; e += 2) {
          ctx.moveTo(rb[o + i0 * 4 + e]!, rb[o + i0 * 4 + e + 1]!);
          for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(rb[o + i * 4 + e]!, rb[o + i * 4 + e + 1]!);
        }
      }
      ctx.stroke();
    }
  }

  /** The lights round its rim (a crystal jelly's, an atolla's), one in the middle of each lobe as
   *  its lobes are drawn: a part of a cell in its second colour, and on dark water a soft glow over
   *  it, brighter as the bell shuts and when it flashes, as such lights do. */
  private drawLights(j: Jelly, b: BellFrame) {
    const { ctx, cw, ch, dpr } = this;
    const { w, h, cos, sin, lobes } = b;
    const every = j.shape.rimLights ?? 1;
    const near = 0.7 + 0.3 * j.depth;
    const st = this.styles[j.kind];
    const n = Math.ceil(lobes / every);
    const xs = this.lightAt;
    for (let k = 0; k < n; k++) {
      const u = ((k * every + 0.5) / lobes) * 2 - 1;
      const bx = u * w;
      const by = 0.5 * (RIM_SMILE * Math.sqrt(1 - u * u) + j.shape.scallop) * h;
      xs[k * 2] = j.x + bx * cos - by * sin;
      xs[k * 2 + 1] = j.y + bx * sin + by * cos;
    }
    ctx.fillStyle = st.tones[2 * LEVELS + clamp(Math.round((0.85 * near + j.glow * 0.5) * (LEVELS - 1)), 0, LEVELS - 1)]!;
    for (let k = 0; k < n; k++) {
      const x = xs[k * 2]! / cw;
      const y = xs[k * 2 + 1]! / ch;
      const c = Math.floor(x);
      const r = Math.floor(y);
      fillParts(ctx, c, r, cw, ch, dpr, 1 << (Math.min(2, Math.floor((y - r) * 3)) * 2 + Math.floor((x - c) * 2)));
    }
    if (!this.glowAdd) return;
    const r = cw * (1 + 0.5 * j.glow);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp((0.34 + 0.12 * j.beat) * near + j.glow * 0.7, 0, 1);
    for (let k = 0; k < n; k++) ctx.drawImage(st.light, xs[k * 2]! - r, xs[k * 2 + 1]! - r, r * 2, r * 2);
    ctx.restore();
  }

  /**
   * Its bell. Each part of each cell near it is looked up in its kind's tables: inside its outline or
   * not (the dome, the rim's curve and its lobes), what it is and how lit (`layBell`). A part with
   * the water beside it is on its outline, a shade brighter. Then each row of parts is filled in runs
   * of one tone (`fillBell`), and the whole cells of plain gel take a grain character, keyed to where
   * on the bell they are (`grainBell`).
   */
  private drawBell(j: Jelly) {
    const b = this.layBell(j);
    if (!b) return;
    this.fillBell(j, b);
    if (j.shape.rimLights) this.drawLights(j, b);
    this.grainBell(j, b);
  }

  /** Lay a jelly's bell out over the parts of the cells round it, into `partSlot` and `partShade`:
   *  returns where (a box of cells), how it is turned and how big, or null when it is off the grid. */
  private layBell(j: Jelly): BellFrame | null {
    const { cw, ch, cols, rows } = this;
    const shape = j.shape;
    const table = bellTables()[j.kind];
    const { w, h } = bellOf(j);
    // Turned as it leans, about the middle of its rim.
    const turn = bellTurn(j);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    // Scallops too small to see are drawn as half as many.
    const halved = (2 * w) / shape.lobes < cw * 1.25;
    const hem = halved ? table.hemHalf : table.hem;
    const hemMax = (RIM_SMILE + shape.scallop) * h;
    // Its box on the screen: the corners of the bell's own, turned.
    const cx = j.x + ((h - hemMax) / 2) * sin;
    const cy = j.y + ((hemMax - h) / 2) * cos;
    const hx = w * Math.abs(cos) + ((h + hemMax) / 2) * Math.abs(sin);
    const hy = w * Math.abs(sin) + ((h + hemMax) / 2) * Math.abs(cos);
    const c0 = Math.max(0, Math.floor((cx - hx) / cw) - 1);
    const c1 = Math.min(cols - 1, Math.floor((cx + hx) / cw) + 1);
    const r0 = Math.max(0, Math.floor((cy - hy) / ch) - 1);
    const r1 = Math.min(rows - 1, Math.floor((cy + hy) / ch) + 1);
    if (c1 < c0 || r1 < r0) return null;
    const bw = (c1 - c0 + 1) * 2;
    const bh = (r1 - r0 + 1) * 3;
    if (this.partSlot.length < bw * bh) {
      this.partSlot = new Uint8Array(bw * bh * 2);
      this.partShade = new Float32Array(bw * bh * 2);
    }
    const { partSlot, partShade } = this;
    const R = HEM_STEPS + DOME_STEPS;
    const uk = U_STEPS / 2;
    for (let q = 0; q < bh; q++) {
      const py = (r0 + PART_Y[(q % 3) * 2]! + Math.floor(q / 3)) * ch - j.y;
      for (let p = 0; p < bw; p++) {
        const i = q * bw + p;
        partSlot[i] = 0;
        const px = (c0 + PART_X[p % 2]! + (p >> 1)) * cw - j.x;
        // In the bell's own frame: across it, and up it.
        const u = (px * cos + py * sin) / w;
        const up = px * sin - py * cos;
        if (u <= -1 || u >= 1) continue;
        const iu = ((u + 1) * uk) | 0;
        let iv: number;
        if (up >= 0) {
          const top = table.top[iu]! * h;
          if (up > top) continue;
          iv = HEM_STEPS + Math.min(DOME_STEPS - 1, ((up / top) * DOME_STEPS) | 0);
        } else {
          const down = hem[iu]! * h;
          if (-up > down) continue;
          iv = Math.min(HEM_STEPS - 1, ((1 + up / down) * HEM_STEPS) | 0);
        }
        partSlot[i] = 1 + table.slot[iu * R + iv]!;
        partShade[i] = table.shade[iu * R + iv]!;
      }
    }
    const frame = this.frame;
    Object.assign(frame, { c0, r0, bw, bh, w, h, cos, sin, lobes: halved ? Math.max(6, Math.round(shape.lobes / 2)) : shape.lobes });
    return frame;
  }

  /** Fill a laid-out bell: each row of parts in runs of one tone (1 + its slot's ramp step, the
   *  gleam last), then the runs a tone at a time, each tone's style set once. The runs meet and never
   *  overlap, so their order is free; each edge is on a device pixel, as `fillParts` has them. */
  private fillBell(j: Jelly, b: BellFrame) {
    const { ctx, cw, ch, dpr, partSlot, partShade } = this;
    const { c0, r0, bw, bh } = b;
    const st = this.styles[j.kind];
    const near = 0.7 + 0.3 * j.depth;
    const flash = j.glow * 0.5;
    const lift = j.shape.lift;
    const body = j.shape.body ?? 0;
    const counts = this.toneCounts.fill(0);
    let runs = 0;
    for (let q = 0; q < bh; q++) {
      let start = 0;
      let tone = 0;
      for (let p = 0; p <= bw; p++) {
        let t = 0;
        if (p < bw) {
          const i = q * bw + p;
          const slot = partSlot[i]!;
          if (slot) {
            const kind = slot - 1;
            if (kind === GLEAM) t = TONES;
            else {
              // On its outline: the water beside it, across or up and down.
              const edge = p === 0 || p === bw - 1 || q === 0 || q === bh - 1 || !partSlot[i - 1] || !partSlot[i + 1] || !partSlot[i - bw] || !partSlot[i + bw];
              const lit = partShade[i]! + (edge ? OUTLINE : 0);
              const level = lit + (kind === BELL ? body : lift[kind - 1]!);
              t = 1 + kind * LEVELS + clamp(Math.round((level * near + flash) * (LEVELS - 1)), 0, LEVELS - 1);
            }
          }
        }
        if (t === tone) continue;
        if (tone) {
          if (runs === this.runTone.length) this.growRuns();
          this.runTone[runs] = tone;
          // Its row of parts, its first part and the part after its last (a bell is far fewer than
          // 1024 parts across).
          this.runAt[runs] = (q << 20) | (start << 10) | p;
          runs++;
          counts[tone]!++;
        }
        start = p;
        tone = t;
      }
    }
    if (this.runOrder.length < runs) this.runOrder = new Int32Array(this.runTone.length);
    const order = this.runOrder;
    let sum = 0;
    for (let t = 0; t <= TONES; t++) {
      const n = counts[t]!;
      counts[t] = sum;
      sum += n;
    }
    for (let r = 0; r < runs; r++) order[counts[this.runTone[r]!]!++] = r;
    let style = -1;
    const xAt = (p: number) => Math.round((c0 + p / 2) * cw * dpr) / dpr;
    const yAt = (q: number) => Math.round((r0 + q / 3) * ch * dpr) / dpr;
    for (let o = 0; o < runs; o++) {
      const r = order[o]!;
      const tone = this.runTone[r]!;
      if (tone !== style) ctx.fillStyle = st.tones[(style = tone) - 1]!;
      const at = this.runAt[r]!;
      const q = at >>> 20;
      const x0 = xAt((at >>> 10) & 1023);
      const y0 = yAt(q);
      ctx.fillRect(x0, y0, xAt(at & 1023) - x0, yAt(q + 1) - y0);
    }
  }

  /** The grain on a laid-out bell: on each whole cell of plain gel lit enough, a character a shade
   *  darker, sparser where it is brighter. It is fixed to the point of the bell under it as the bell
   *  would be at rest, so it rides the bell through its beat and never twinkles. */
  private grainBell(j: Jelly, b: BellFrame) {
    const { ctx, cw, ch, partSlot, partShade } = this;
    const { c0, r0, bw, bh, cos, sin } = b;
    const st = this.styles[j.kind];
    const near = 0.7 + 0.3 * j.depth;
    const gx = (j.shape.w * j.length) / (b.w * cw);
    const gy = (j.shape.h * j.length) / (b.h * ch);
    let grain = -1;
    for (let r = r0; r < r0 + bh / 3; r++) {
      for (let c = c0; c < c0 + bw / 2; c++) {
        const p = (c - c0) * 2;
        const q = (r - r0) * 3;
        let lit = 0;
        let plain = true;
        for (let s = 0; s < 6 && plain; s++) {
          const i = (q + (s >> 1)) * bw + p + (s & 1);
          plain = partSlot[i] === 1 + BELL;
          lit += partShade[i]!;
        }
        lit /= 6;
        if (!plain || lit < GRAIN_LIT) continue;
        const px = (c + 0.5) * cw - j.x;
        const py = (r + 0.5) * ch - j.y;
        const key = (hash3(Math.round((px * cos + py * sin) * gx), Math.round((py * cos - px * sin) * gy), j.id) * 4294967295) >>> 0;
        if (key % 7 < 3) continue;
        const pick = Math.min(GRAIN.length - 1, Math.floor((1 - lit) * 3 + ((key >>> 8) % 3) - 1.2));
        if (pick < 1) continue;
        const g = clamp(Math.floor(lit * near * GRAIN_LEVELS), 0, GRAIN_LEVELS - 1);
        if (g !== grain) ctx.fillStyle = st.grain[(grain = g)]!;
        ctx.fillText(GRAIN[pick]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
      }
    }
  }
}
