/**
 * A firefly seen from the side, as paths a body-length long, head forward (+x) and its back up
 * (-y): its lantern at the tip of its tail, its body, its head under the pale shield of its
 * pronotum, two feelers; in flight its wing covers raised over it and its wings a blur above
 * them, settled its legs under it. Laid out once and drawn under each firefly's own transform
 * (`poseOf`): where it is, how big, which way it faces and how far it leans.
 */
import type { Firefly } from "./meadow";

const ellipse = (p: Path2D, x: number, y: number, rx: number, ry: number, rot = 0) => {
  p.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  p.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
};

/** Where the lantern is, in body-lengths from the middle of the body. */
export const LANTERN = { x: -0.36, y: 0.03, rx: 0.15, ry: 0.12 };

function insect() {
  const body = new Path2D();
  ellipse(body, -0.03, 0, 0.3, 0.13);
  ellipse(body, 0.42, 0.04, 0.08, 0.075);
  const shield = new Path2D();
  ellipse(shield, 0.31, -0.01, 0.13, 0.115, -0.2);
  const lantern = new Path2D();
  ellipse(lantern, LANTERN.x, LANTERN.y, LANTERN.rx, LANTERN.ry, 0.15);
  const feelers = new Path2D();
  feelers.moveTo(0.46, -0.02);
  feelers.quadraticCurveTo(0.62, -0.12, 0.78, -0.2);
  feelers.moveTo(0.45, 0);
  feelers.quadraticCurveTo(0.62, -0.05, 0.8, -0.08);
  // Raised in flight: the wing covers hinged at the shoulder, their tips up and back.
  const covers = new Path2D();
  ellipse(covers, -0.04, -0.16, 0.28, 0.07, 0.42);
  ellipse(covers, 0.0, -0.12, 0.26, 0.06, 0.2);
  // The wings beating too fast to see: a pale blur above.
  const wings = new Path2D();
  ellipse(wings, -0.1, -0.33, 0.42, 0.17, 0.62);
  ellipse(wings, -0.02, -0.24, 0.4, 0.12, 0.18);
  const legs = new Path2D();
  for (const [x, dx] of [[0.18, 0.08], [0.02, -0.02], [-0.14, -0.1]] as const) {
    legs.moveTo(x, 0.08);
    legs.lineTo(x + dx, 0.24);
  }
  return { body, shield, lantern, feelers, covers, wings, legs };
}

let shapes: ReturnType<typeof insect> | null = null;
/** The firefly's paths, laid out the first time they are needed (a Path2D needs a page). */
export const insectPaths = () => (shapes ??= insect());

/** A firefly's transform, in CSS px: `a b c d e f` as a canvas takes it, without the pixel
 *  ratio. Its length; its facing eased (`face`, -1 … 1: through 0 it turns, seen end on); in
 *  flight its head up and its tail hanging, more as it climbs; settled, a lean of its own. */
export interface Pose {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  /** Its lantern's middle, and its length. */
  lx: number;
  ly: number;
  len: number;
}

export function poseOf(f: Firefly, face: number, len: number, out: Pose): Pose {
  const climb = Math.max(-0.3, Math.min(0.3, -f.vy / 90));
  const tilt = f.perched ? 0.05 + 0.3 * ((f.id * 0.618) % 1) - 0.12 : 0.42 + climb;
  const sgn = face < 0 ? -1 : 1;
  const sx = sgn * Math.max(0.14, Math.abs(face)) * len;
  const th = -sgn * tilt;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  out.a = cs * sx;
  out.b = sn * sx;
  out.c = -sn * len;
  out.d = cs * len;
  out.e = f.x;
  out.f = f.y;
  out.lx = f.x + out.a * LANTERN.x + out.c * LANTERN.y;
  out.ly = f.y + out.b * LANTERN.x + out.d * LANTERN.y;
  out.len = len;
  return out;
}
