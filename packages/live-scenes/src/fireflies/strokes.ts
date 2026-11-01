/**
 * The meadow's shapes, as paths in CSS pixels: a blade a tapered curve from its root to its tip,
 * bending from the root as it sways; a leaf arching off a stem; and the seed heads at the tops of
 * the stems. Each shape adds to the path of its colour, so a layer of the meadow is a few fills,
 * however many blades stand in it. Every closed shape winds the same way, so two that overlap in
 * one path fill as one and never cut a hole.
 */
import { swayOf, type GrassBlade, type GrassLeaf } from "./grass";

/** A blade's centre line, a quadratic curve from its root (0) through (1) to its tip (2). */
export interface Curve {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A point on a curve and the unit way along it there, up the blade: `at` fills it. */
const P = { x: 0, y: 0, tx: 0, ty: -1 };

function at(c: Curve, s: number) {
  const u = 1 - s;
  P.x = u * u * c.x0 + 2 * s * u * c.x1 + s * s * c.x2;
  P.y = u * u * c.y0 + 2 * s * u * c.y1 + s * s * c.y2;
  const dx = u * (c.x1 - c.x0) + s * (c.x2 - c.x1);
  const dy = u * (c.y1 - c.y0) + s * (c.y2 - c.y1);
  const l = Math.hypot(dx, dy) || 1;
  P.tx = dx / l;
  P.ty = dy / l;
  return P;
}

/** Where blade `b` stands at time `t` (`null`: still, as it stands with no breeze), into `out`:
 *  its own lean and droop, its sway bending it from the root, its tip a little lower the further
 *  over it bends, and `push` px more at its tip (a firefly settled by it). */
export function bladeCurve(b: GrassBlade, cw: number, ch: number, t: number | null, push: number, out: Curve): Curve {
  const rx = b.x * cw;
  const ry = b.y * ch;
  const rise = b.height * ch;
  const lean = (b.slant ?? 0) * cw;
  const sw = (t === null ? 0 : swayOf(b, t) * cw) + push;
  // Lower down, the sway is a little behind: a wave runs up the blade.
  const low = (t === null ? 0 : swayOf(b, t, b.wave * b.height * 0.4) * cw) + push * 0.5;
  const drop = (0.5 * sw * sw) / rise;
  out.x0 = rx;
  out.y0 = ry;
  if (b.droop > 0) {
    // Arching over: up past its tip, and down to it.
    out.x1 = rx + lean * 0.5 + low * 0.6;
    out.y1 = ry - rise * (1 + Math.sqrt(b.droop));
    out.x2 = rx + lean * (1 + b.droop * 0.4) + sw;
    out.y2 = ry - rise * (1 - b.droop) + drop;
  } else {
    out.x1 = rx + lean * 0.22 + low * 0.3;
    out.y1 = ry - rise * 0.6;
    out.x2 = rx + lean + sw;
    out.y2 = ry - rise + drop;
  }
  return out;
}

/** A shape along a quadratic from (x0, y0) to (x2, y2), `w0` wide at the start and `w2` at the end
 *  (0: a point), fullest a little past its start, as a grass leaf is. */
export function taper(p: Path2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, w0: number, w2: number) {
  let dx = x1 - x0;
  let dy = y1 - y0;
  let l = Math.hypot(dx, dy) || 1;
  const ax = (-dy / l) * w0 * 0.5;
  const ay = (dx / l) * w0 * 0.5;
  dx = x2 - x0;
  dy = y2 - y0;
  l = Math.hypot(dx, dy) || 1;
  const wc = (w0 + w2) * 0.6;
  const bx = (-dy / l) * wc * 0.5;
  const by = (dx / l) * wc * 0.5;
  p.moveTo(x0 + ax, y0 + ay);
  if (w2 > 0) {
    dx = x2 - x1;
    dy = y2 - y1;
    l = Math.hypot(dx, dy) || 1;
    const cx = (-dy / l) * w2 * 0.5;
    const cy = (dx / l) * w2 * 0.5;
    p.quadraticCurveTo(x1 + bx, y1 + by, x2 + cx, y2 + cy);
    p.lineTo(x2 - cx, y2 - cy);
  } else p.quadraticCurveTo(x1 + bx, y1 + by, x2, y2);
  p.quadraticCurveTo(x1 - bx, y1 - by, x0 - ax, y0 - ay);
  p.closePath();
}

/** A blade along its curve. */
export const bladeInto = (p: Path2D, c: Curve, w0: number, w2: number) => taper(p, c.x0, c.y0, c.x1, c.y1, c.x2, c.y2, w0, w2);

/** A pointed oval from (ax, ay) to (bx, by), `w` across at its widest: a spikelet, a grain. */
export function lens(p: Path2D, ax: number, ay: number, bx: number, by: number, w: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * w;
  const ny = (dx / l) * w;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  p.moveTo(ax, ay);
  p.quadraticCurveTo(mx + nx, my + ny, bx, by);
  p.quadraticCurveTo(mx - nx, my - ny, ax, ay);
  p.closePath();
}

/** A leaf off stem `c`: springing from it `leaf.k` cells up, out to its side and arching over, its
 *  tip drooping; it rides the stem, and flutters a little more than it (`flutter`, px). */
export function leafInto(p: Path2D, c: Curve, b: GrassBlade, leaf: GrassLeaf, cw: number, flutter: number) {
  const q = at(c, Math.min(0.9, Math.max(0.05, leaf.k / b.height)));
  const L = leaf.len * cw;
  // Out from the stem, square to it, on the leaf's side.
  const ox = -q.ty * leaf.side;
  const oy = q.tx * leaf.side;
  const x0 = q.x;
  const y0 = q.y;
  taper(p, x0, y0,
    x0 + ox * L * 0.45 + q.tx * L * 0.55, y0 + oy * L * 0.45 + q.ty * L * 0.55,
    x0 + ox * L * 0.95 + q.tx * L * 0.1 + flutter, y0 + oy * L * 0.95 + q.ty * L * 0.1,
    b.width * cw * 2.4, 0);
}

/** The part of curve `c` from `s0` to its tip, as a curve of its own (a quadratic's piece is one). */
const H: Curve = { x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0 };
function headCurve(c: Curve, s0: number): Curve {
  const q = at(c, s0);
  H.x0 = q.x;
  H.y0 = q.y;
  // Its control: `s0` of the way from the whole curve's control to its tip.
  H.x1 = (1 - s0) * c.x1 + s0 * c.x2;
  H.y1 = (1 - s0) * c.y1 + s0 * c.y2;
  H.x2 = c.x2;
  H.y2 = c.y2;
  return H;
}

/** `(tx, ty)` turned `a` radians toward side `side` of it, times `len`, into `D`. */
const D = { x: 0, y: 0 };
function turned(tx: number, ty: number, side: number, a: number, len: number) {
  const cs = Math.cos(a);
  const sn = Math.sin(a) * side;
  // The square to (tx, ty) on side +1 is (-ty, tx).
  D.x = (tx * cs - ty * sn) * len;
  D.y = (ty * cs + tx * sn) * len;
  return D;
}

/** Blade `b`'s seed head along the top of its curve `c`: its grains and spikelets into `fill`, its
 *  bristles, awns and fine stalks into `fine` (stroked), a plume's soft body into `soft` (filled
 *  faint). A far one is smaller. */
export function headInto(fill: Path2D, fine: Path2D, soft: Path2D, c: Curve, b: GrassBlade, cw: number, ch: number) {
  const s0 = Math.max(0.35, 1 - b.seed / b.height);
  const len = b.seed * ch;
  const k = b.layer === 0 ? 0.6 : b.layer === 1 ? 0.85 : 1;
  switch (b.head) {
    case "spike":
    case "awned": {
      // Spikelets up both sides in turn, smaller toward the top, and one at the top; a barley's
      // long awns off each.
      const n = Math.max(3, Math.round(len / (cw * 0.42 * k)));
      for (let i = 0; i < n; i++) {
        const q = at(c, s0 + ((1 - s0) * (i + 0.5)) / n);
        const side = i % 2 ? 1 : -1;
        const size = cw * k * (0.5 - (0.16 * i) / n);
        const x = q.x;
        const y = q.y;
        const tx = q.tx;
        const ty = q.ty;
        const d = turned(tx, ty, side, 0.55, size);
        lens(fill, x, y, x + d.x, y + d.y, size * 0.32);
        if (b.head === "awned") {
          const ex = x + d.x;
          const ey = y + d.y;
          const a = turned(tx, ty, side, 0.28, cw * k * 1.0);
          fine.moveTo(ex, ey);
          fine.lineTo(ex + a.x, ey + a.y);
        }
      }
      const q = at(c, 1);
      lens(fill, q.x, q.y, q.x + q.tx * cw * k * 0.45, q.y + q.ty * cw * k * 0.45, cw * k * 0.14);
      if (b.head === "awned") {
        fine.moveTo(q.x + q.tx * cw * k * 0.45, q.y + q.ty * cw * k * 0.45);
        fine.lineTo(q.x + q.tx * cw * k * 1.4, q.y + q.ty * cw * k * 1.4);
      }
      break;
    }
    case "foxtail": {
      // A dense spike along the top of the stem, nodding with it, short bristles standing out of
      // it and leaning up.
      bladeInto(fill, headCurve(c, s0), cw * k * 0.3, cw * k * 0.12);
      const n = Math.max(5, Math.round(len / (cw * 0.22)));
      for (let i = 0; i < n; i++) {
        const r = at(c, s0 + ((1 - s0) * (i + 0.5)) / n);
        const side = i % 2 ? 1 : -1;
        const d = turned(r.tx, r.ty, side, 0.75, cw * k * (0.32 + 0.1 * Math.sin(Math.PI * ((i + 0.5) / n))));
        fine.moveTo(r.x + d.x * 0.3, r.y + d.y * 0.3);
        fine.lineTo(r.x + d.x, r.y + d.y);
      }
      break;
    }
    case "oat": {
      // Spikelets hanging from fine stalks off the top of the stem, to each side in turn.
      const n = 2 + Math.round(b.seed);
      for (let i = 0; i < n; i++) {
        const q = at(c, s0 + ((1 - s0) * (i + 0.4)) / n);
        const side = i % 2 ? 1 : -1;
        const x = q.x;
        const y = q.y;
        const qx = x + side * cw * k * 0.6;
        const qy = y + cw * k * 0.1;
        fine.moveTo(x, y);
        fine.quadraticCurveTo(x + side * cw * k * 0.4, y - cw * k * 0.3, qx, qy);
        lens(fill, qx, qy, qx + side * cw * k * 0.1, qy + cw * k * 0.65, cw * k * 0.17);
      }
      break;
    }
    case "plume": {
      // A soft feathery spindle, fine hairs along it.
      const a = at(c, s0);
      const ax = a.x;
      const ay = a.y;
      const q = at(c, 1);
      lens(soft, ax, ay, q.x + q.tx * cw * 0.3, q.y + q.ty * cw * 0.3, cw * k * 0.36);
      const n = Math.max(4, Math.round(len / (cw * 0.32)));
      for (let i = 0; i < n; i++) {
        const r = at(c, s0 + ((1 - s0) * (i + 0.5)) / n);
        const side = i % 2 ? 1 : -1;
        const d = turned(r.tx, r.ty, side, 0.42, cw * k * 0.55 * Math.sin(Math.PI * (0.15 + (0.85 * (i + 0.5)) / n)));
        fine.moveTo(r.x, r.y);
        fine.lineTo(r.x + d.x, r.y + d.y);
      }
      break;
    }
  }
}
