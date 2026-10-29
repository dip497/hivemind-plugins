/**
 * Jellyfish's drawing, in cells: the deep (look.ts), marine snow, and each jelly as it reads at a
 * glance: a soft glow round its bell; its tentacles, fine threads trailing from its rim and fading
 * toward their tips, and its oral arms, frilled ribbons hanging from under its middle; and in front
 * of them its bell, a dome, clear toward its middle and brighter toward its edge as light through a
 * bell is, its kind's pattern showing through, its outline bright, a gleam on its crown, and its rim
 * a row of scallops. A click's pulse is a faint ring spreading through the water.
 */
import { textCells } from "../cells";
import { css, mix, ramp as rampOf, rgbOf, RAMP } from "../colour";
import { glowSprite } from "../glow";
import { LookRenderer } from "../look";
import { clamp, hash3, TAU } from "../math";
import { JELLY_KINDS, type JellyKind } from "./kinds";
import { JELLY_PALETTE, type JellyPalette } from "./palette";
import { bellOf, PULSE_REACH, PULSE_SPEED, type Jelly, type Strand, type Swarm } from "./swarm";

/** A long tentacle's characters down its length where it hangs straight: a fine line, finer toward
 *  its tip; a fringe's, finer still. */
const THREAD = ["|", "|", "¦", ":", "'"];
const FRINGE = [":", "'", "'", ".", "."];
/** An oral arm's frills, side to side down it. */
const FRILL = ["(", "{", ")", "}"];
/** A lobe of the rim. */
const LOBE = "u";
const PULSE_LEVELS = 5;
/** Where in a cell the bell is sampled, besides its middle: what share of the cell it covers. */
const SUB = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const;
/** Where a cell of the bell looks for the water past its outline: out to either side, up, and up
 *  over either shoulder, most of a cell away. */
const EDGE = [[-0.75, 0], [0.75, 0], [0, -0.7], [-0.55, -0.55], [0.55, -0.55]] as const;

interface KindStyles {
  bell: string[];
  mark: string[];
  mark2: string[];
  tentacle: string[];
  arm: string[];
  glow: OffscreenCanvas;
}

/** The bell's outline where its outward normal points at `a` (radians, screen space, 0 to the
 *  right, π/2 down): a bracket down its sides, slashes over its shoulders, a bar along its crown. */
function rimGlyph(a: number) {
  const d = Math.round(((((a / TAU) % 1) + 1) % 1) * 8) % 8;
  // Eight ways round from the right, clockwise (down first, as the screen's y runs).
  return [")", ")", "_", "(", "(", "/", "-", "\\"][d]!;
}

/** A thread along (dx, dy), `along` its length (0 at the rim, 1 its tip). */
function threadGlyph(dx: number, dy: number, along: number, fringe: boolean) {
  if (Math.abs(dx) < Math.abs(dy) * 0.3) return (fringe ? FRINGE : THREAD)[Math.min(4, Math.floor(along * 5))]!;
  if (Math.abs(dy) < Math.abs(dx) * 0.4) return "~";
  return dx * dy > 0 ? "\\" : "/";
}

/** How far a jelly's crown leans over its level rim, across per unit up: a dome sheared rather
 *  than turned, so its scallops stay in one row of cells. */
const leanOf = (j: Jelly) => Math.tan(clamp(j.tilt, -0.5, 0.5));

export class JellyRenderer extends LookRenderer<JellyPalette> {
  private styles = {} as Record<JellyKind, KindStyles>;
  private snowStyles = ["", ""];
  private pulseStyles: string[] = [];
  /** Whether glows add light (on dark water) or tint (on light). */
  private glowAdd = true;
  private shine = 0;
  /** Cells this jelly has drawn this frame: its bell is in front, its strands cross, and a cell is
   *  drawn once. */
  private claimed = new Uint32Array(0);
  private pass = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, JELLY_PALETTE);
  }

  protected allocate(n: number) {
    this.claimed = new Uint32Array(n);
  }

  protected styled() {
    const p = this.palette;
    this.glowAdd = !this.light;
    const mid = rgbOf(p.water[1]!);
    for (const k of JELLY_KINDS) {
      const c = p.kinds[k];
      this.styles[k] = {
        bell: rampOf(mid, rgbOf(c.bell)),
        mark: rampOf(mid, rgbOf(c.mark)),
        mark2: rampOf(mid, rgbOf(c.mark2)),
        tentacle: rampOf(mid, rgbOf(c.tentacle)),
        arm: rampOf(mid, rgbOf(c.arm)),
        glow: glowSprite(rgbOf(c.bell)),
      };
    }
    const snow = rgbOf(p.snow);
    this.snowStyles = [css(mix(mid, snow, 0.4)), css(mix(mid, snow, 0.75))];
    this.pulseStyles = Array.from({ length: PULSE_LEVELS }, (_, l) => css(mix(mid, snow, 0.15 + (0.6 * (l + 1)) / PULSE_LEVELS)));
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
    textCells(ctx, ch, this.fontFamily);
    this.drawPulses(swarm);
    // Its bell first, claiming its cells: it is in front of its own arms, and they of its tentacles.
    for (const j of swarm.jellies) {
      this.pass++;
      this.drawBell(j);
      for (const s of j.strands) if (s.arm) this.drawStrand(j, s);
      for (const s of j.strands) if (!s.arm) this.drawStrand(j, s);
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

  /** Each click's pulse: a faint ring of specks spreading out, gone by the time it has reached as
   *  far as it goes. */
  private drawPulses(swarm: Swarm) {
    const { ctx, cw, ch, cols } = this;
    for (const p of swarm.pulses) {
      const r = p.age * PULSE_SPEED;
      const fade = 1 - r / PULSE_REACH;
      if (fade <= 0) continue;
      ctx.fillStyle = this.pulseStyles[clamp(Math.floor(fade * PULSE_LEVELS), 0, PULSE_LEVELS - 1)]!;
      const steps = Math.max(8, Math.ceil((TAU * r) / (cw * 1.2)));
      let last = -1;
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * TAU;
        const i = this.cellIndex(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.8);
        if (i < 0 || i === last) continue;
        last = i;
        ctx.fillText(fade > 0.55 ? "o" : ".", (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
      }
    }
  }

  /** The light round a jelly's bell: soft always, a flash when it starts. About the bell's own
   *  size, so its outline reads through it. */
  private drawGlow(j: Jelly) {
    const a = clamp(this.shine * (0.6 + 0.4 * j.depth) + j.glow * 0.5, 0, 1);
    if (a < 0.02) return;
    const { ctx } = this;
    const { w, h } = bellOf(j);
    const rx = w * (1.45 + j.glow * 0.5);
    const ry = Math.max(h * 1.6, w * 0.9) * (1 + j.glow * 0.4);
    const cx = j.x + leanOf(j) * h * 0.45;
    const cy = j.y - h * 0.45;
    ctx.save();
    ctx.globalCompositeOperation = this.glowAdd ? "lighter" : "source-over";
    ctx.globalAlpha = this.glowAdd ? a : a * 0.7;
    ctx.drawImage(this.styles[j.kind].glow, cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.restore();
  }

  /** One cell of a jelly, `level` toward its colour: its character, and a block `block` as far
   *  toward it under it, or none. */
  private cell(i: number, ramp: string[], level: number, glyph: string, block = 0) {
    const { ctx, cols, cw, ch } = this;
    const x = (i % cols) * cw;
    const y = ((i / cols) | 0) * ch;
    if (block > 0) {
      ctx.fillStyle = ramp[clamp(Math.round(block * RAMP), 0, RAMP)]!;
      ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
    }
    if (!glyph) return;
    ctx.fillStyle = ramp[clamp(Math.round(level * RAMP), 0, RAMP)]!;
    ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
  }

  /** Whether cell `i` is this jelly's to draw: in the grid, and not drawn by it already this frame. */
  private claim(i: number) {
    if (i < 0 || this.claimed[i] === this.pass) return false;
    this.claimed[i] = this.pass;
    return true;
  }

  /** A tentacle, a fine thread fading toward its tip, or an oral arm, a frilled ribbon, thick near
   *  the bell: each cell along the way from one node to the next. */
  private drawStrand(j: Jelly, strand: Strand) {
    const s = this.styles[j.kind];
    const near = 0.7 + 0.3 * j.depth;
    const step = Math.min(this.cw, this.ch) * 0.8;
    const n = strand.nodes;
    const count = n.length / 2;
    const fringe = j.shape.fringe && !strand.arm && !strand.trailer;
    let k = 0;
    for (let node = 1; node < count; node++) {
      const x0 = n[(node - 1) * 2]!;
      const y0 = n[(node - 1) * 2 + 1]!;
      const dx = n[node * 2]! - x0;
      const dy = n[node * 2 + 1]! - y0;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
      for (let q = 1; q <= steps; q++) {
        const i = this.cellIndex(x0 + (dx * q) / steps, y0 + (dy * q) / steps);
        if (!this.claim(i)) continue;
        k++;
        const along = (node - 1 + q / steps) / (count - 1);
        if (strand.arm) {
          // Frilled side to side, in blocks near the bell, a ribbon of characters lower down.
          const level = (0.95 - 0.35 * along) * near + j.glow * 0.3;
          const glyph = Math.abs(dy) < Math.abs(dx) * 0.4 ? "~" : FRILL[(k + strand.phase) % FRILL.length]!;
          this.cell(i, s.arm, level, glyph, along < 0.45 ? level * 0.38 : 0);
        } else {
          const level = (fringe ? 0.72 - 0.4 * along : 0.85 - 0.6 * along) * near + j.glow * 0.3;
          this.cell(i, s.tentacle, level, threadGlyph(dx, dy, along, fringe));
        }
      }
    }
  }

  private drawBell(j: Jelly) {
    const { cw, ch, cols, rows } = this;
    const s = this.styles[j.kind];
    const shape = j.shape;
    const { w, h } = bellOf(j);
    const lean = leanOf(j);
    const k = shape.dome;
    // The rim: a band of scallops below the dome, a row of cells deep.
    const hem = ch;
    /** How high the dome is `u` across (-1 to 1), as a share of its height. */
    const top = (u: number) => Math.pow(Math.max(0, 1 - u * u), k);
    /** What a point (dx, dy) from the rim's middle is: 0 water, 1 the dome, 2 its rim. */
    const part = (dx: number, dy: number) => {
      const u = (dx + dy * lean) / w;
      const hy = -dy;
      if (Math.abs(u) >= 1) return 0;
      if (hy >= 0) return hy / h <= top(u) ? 1 : 0;
      return hy >= -hem ? 2 : 0;
    };
    const reach = Math.max(w, h) + Math.max(cw, ch) * 2;
    const c0 = Math.max(0, Math.floor((j.x - reach) / cw));
    const c1 = Math.min(cols - 1, Math.floor((j.x + reach) / cw));
    const r0 = Math.max(0, Math.floor((j.y - reach) / ch));
    const r1 = Math.min(rows - 1, Math.floor((j.y + reach) / ch));
    const near = 0.7 + 0.3 * j.depth;
    const flash = j.glow * 0.35;
    const ramps = [s.bell, s.mark, s.mark2];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = c * cw + cw / 2 - j.x;
        const dy = r * ch + ch / 2 - j.y;
        const mid = part(dx, dy);
        let dome = mid === 1 ? 1 : 0;
        let covered = mid ? 1 : 0;
        for (const [ox, oy] of SUB) {
          const q = part(dx + ox * cw, dy + oy * ch);
          if (q) covered++;
          if (q === 1) dome++;
        }
        if (mid === 0 && dome === 0) continue;
        const i = r * cols + c;
        if (!this.claim(i)) continue;
        const u = clamp((dx + dy * lean) / w, -1, 1);
        const v = -dy / h;
        if (mid === 2) {
          // The rim: a scallop between each two notches.
          const q = (((u + 1) / 2) * shape.lobes) % 1;
          const lobe = q > 0.18 && q < 0.82;
          this.cell(i, s.bell, Math.min(1, (lobe ? 0.95 : 0.7) * near + flash), lobe ? LOBE : ".", lobe ? 0.22 * near : 0);
          continue;
        }
        if (!mid) {
          // Past the outline, which crosses the cell: a faint edge, so the dome is round.
          if (dome >= 2) this.cell(i, s.bell, Math.min(1, 0.62 * near + flash), v > top(u) * 0.6 ? "." : ":");
          continue;
        }
        // How far out toward the outline: 0 at the middle of its rim, 1 on the outline.
        const f = Math.max(Math.abs(u), v / Math.max(1e-3, top(u)));
        // On the outline: the water within most of a cell of it, out to the sides or up.
        let edge = covered < 5;
        for (let e = 0; !edge && e < EDGE.length; e++) edge = !part(dx + EDGE[e]![0] * cw, dy + EDGE[e]![1] * ch);
        if (edge) {
          // The outline: a brighter block, and a line on it the way the outline runs, from which
          // way it faces: in the bell's own frame (x across, y up), sheared by its lean to the
          // screen's (y down).
          const nx = (2 * k * u * Math.pow(Math.max(1e-6, 1 - u * u), k - 1)) / w;
          const ny = 1 / h;
          const facing = Math.atan2(nx * lean - ny, nx);
          this.cell(i, s.bell, Math.min(1, 0.95 * near + flash), rimGlyph(facing), (0.34 + 0.08 * v) * near + flash * 0.5);
          continue;
        }
        const key = hash3(c - Math.round(j.x / cw), r - Math.round(j.y / ch), j.id);
        // Clear toward its middle, brighter toward its edge and its crown: light through a bell.
        const block = (0.14 + 0.16 * f * f + 0.06 * v) * near + flash * 0.5;
        const slot = shape.pattern(u, v);
        if (slot) {
          // Its pattern, showing through: a tint, a character on some of it.
          const marks = shape.marks[slot - 1]!;
          this.cell(i, ramps[slot]!, Math.min(1, 0.9 * near + flash), key < 0.55 ? marks[Math.floor((key / 0.55) * marks.length)]! : "", Math.max(block * 1.3, 0.3 * near));
          continue;
        }
        // A gleam on its crown, where the light from above catches it.
        const gleam = u > -0.55 && u < -0.12 && v > 0.5 * top(u) && v < 0.85 * top(u);
        this.cell(i, s.bell, Math.min(1, (gleam ? 1 : 0.45) * near + flash), gleam ? (key < 0.5 ? "'" : "`") : key < 0.14 ? "." : "", block);
      }
    }
  }
}
