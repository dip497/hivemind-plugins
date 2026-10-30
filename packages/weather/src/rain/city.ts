/**
 * The city behind the rainy glass, out of focus: where each light is, how big its blur, which kind
 * (palette.ts's LIGHTS) and how strong, and the buildings along the street. Laid out from a seed of
 * the window's size, so the same window shows the same street. Buildings line both sides, tall near
 * the glass and lower down the street; two rows of street lamps run off to a point down the street,
 * smaller as they go; cars' lights and shop signs crowd along the street; the buildings' windows are
 * few and dim, fewer toward the top and the middle, where the panels and toolbars sit; a few big
 * soft blurs of lights near the glass stand in the bottom corners.
 */
import { clamp, lerp, seeded } from "../util";
import { LIGHTS, type Light } from "./palette";

export interface Bokeh {
  x: number;
  y: number;
  r: number;
  kind: Light;
  /** Its strength, 0 to 1, times the palette's most. */
  a: number;
}

/** A building along the street, out of focus: its sides and its top, in px. */
export interface Building {
  x0: number;
  x1: number;
  top: number;
}

/** The buildings lining both sides of the street: tall near the glass at the window's sides, lower
 *  toward the street's far end, each standing on the street. */
function buildingsOf(W: number, H: number, vx: number, vy: number, rnd: () => number): Building[] {
  const out: Building[] = [];
  for (const side of [-1, 1]) {
    let x = side < 0 ? -0.02 * W : 1.02 * W;
    while (side < 0 ? x < vx - 20 : x > vx + 20) {
      const near = side < 0 ? 1 - x / vx : (x - vx) / (W - vx);
      const w = lerp(40, 150, near) * lerp(0.7, 1.3, rnd()) * (Math.min(W, H) / 900);
      const top = H * lerp(0.5, 0.16, near) * lerp(0.85, 1.12, rnd());
      out.push({ x0: side < 0 ? x : x - w, x1: side < 0 ? x + w : x, top: Math.min(top, vy - 30) });
      x -= side * w * lerp(1, 1.15, rnd());
    }
  }
  return out;
}

/** Where the street runs off to for a window `W` by `H`: the same point the city is laid out to. */
export function farEnd(W: number, H: number) {
  const { vx, vy } = street(W, H);
  return { x: vx, y: vy };
}

/** The street's far end for a window, and the generator the rest of its layout is drawn from. */
function street(W: number, H: number) {
  const rnd = seeded(0xc17 + Math.round(W) * 7919 + Math.round(H));
  return { vx: W * lerp(0.52, 0.64, rnd()), vy: H * 0.6, rnd };
}

export interface City {
  lights: Bokeh[];
  buildings: Building[];
}

export function cityOf(W: number, H: number): City {
  const { vx, vy, rnd } = street(W, H);
  const buildings = buildingsOf(W, H, vx, vy, rnd);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const s = Math.min(W, H) / 900;
  const out: Bokeh[] = [];
  const add = (x: number, y: number, r: number, kind: Light, a: number) => out.push({ x, y, r: r * s, kind, a: clamp(a, 0, 1) });
  // Street lamps: a row on each side, high near the glass and going down the street.
  for (const [x0, y0] of [[-0.03 * W, 0.42 * H], [1.03 * W, 0.45 * H]] as const) {
    const n = Math.round(lerp(6, 10, rnd()) * Math.sqrt(W / 1440));
    for (let k = 0; k < n; k++) {
      const t = 1 - Math.pow(0.78, k + 0.6);
      const kind = rnd() < 0.75 ? "amber" : "orange";
      add(lerp(x0, vx, t) + (rnd() - 0.5) * 10 * s, lerp(y0, vy, t), lerp(64, 9, t), kind, lerp(0.95, 0.55, t));
    }
  }
  // Cars along the street: tail lights going away on the near side, headlights coming.
  const cars = Math.round((W / 1440) * lerp(5, 8, rnd()));
  for (let k = 0; k < cars; k++) {
    const t = rnd() ** 0.8;
    const y = lerp(H * 0.84, vy + 6 * s, t);
    const x = lerp(lerp(0.05, 0.95, rnd()) * W, vx, t * t);
    const r = lerp(30, 8, t);
    const head = rnd() < 0.4;
    for (const side of [-1, 1]) add(x + side * r * 1.15, y, r, head ? "warm" : "red", lerp(0.9, 0.6, t));
  }
  // Shop signs and lit fronts along both sides of the street.
  const signs = Math.round((W / 1440) * lerp(7, 11, rnd()));
  for (let k = 0; k < signs; k++) {
    const left = rnd() < 0.5;
    const t = rnd() * 0.85;
    const x = lerp(left ? 0.02 * W : 0.98 * W, vx, t);
    const y = lerp(H * 0.66, vy - 4 * s, t) - rnd() * 40 * s;
    const kind = pick(["magenta", "cyan", "green", "warm", "magenta", "cyan", "orange"] as const);
    const n = 2 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) add(x + (j - n / 2) * lerp(30, 10, t) * s, y + (rnd() - 0.5) * 12 * s, lerp(26, 9, t) * lerp(0.8, 1.2, rnd()), kind, lerp(0.85, 0.55, t));
  }
  // Windows on the buildings' faces, dim and small, fewer up high and toward the middle.
  for (const b of buildings) {
    const middle = 1 - Math.abs((b.x0 + b.x1) / W - 1);
    const lit = lerp(0.42, 0.18, middle);
    const across = Math.max(1, Math.round((b.x1 - b.x0) / (34 * s)));
    for (let j = 0; j < across * 6; j++) {
      if (rnd() > lit) continue;
      const x = lerp(b.x0, b.x1, ((j % across) + 0.5) / across);
      const y = lerp(b.top + 14 * s, vy - 10 * s, rnd());
      add(x, y, lerp(5, 10, rnd()), rnd() < 0.8 ? "warm" : "amber", lerp(0.3, 0.6, rnd()) * lerp(0.55, 1, (y - b.top) / Math.max(1, vy - b.top)));
    }
  }
  // Near the glass, out of focus: dark shapes along the bottom, and a few big soft lights.
  for (let k = 0; k < Math.round(W / 300); k++) add(lerp(0, W, rnd()), H * lerp(0.9, 1.08, rnd()), lerp(110, 190, rnd()), "shade", lerp(0.5, 0.8, rnd()));
  for (const corner of [0, 1]) {
    for (let j = 0; j < 2; j++) add(W * (corner ? lerp(0.82, 1.02, rnd()) : lerp(-0.02, 0.18, rnd())), H * lerp(0.8, 1, rnd()), lerp(80, 140, rnd()), pick(["amber", "red", "cyan", "magenta"] as const), lerp(0.35, 0.55, rnd()));
  }
  return { lights: out, buildings };
}

/** Index of a light's kind in LIGHTS. */
export const lightIndex = (k: Light) => LIGHTS.indexOf(k);
