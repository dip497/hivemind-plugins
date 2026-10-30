/**
 * The isometric drawing the Blocks scenes share. A world is in blocks: x runs to the lower right of
 * the screen, y to the lower left, z up. A block is drawn 2S device pixels wide, its top a diamond S
 * tall and its sides HZ tall, so every corner lands on a whole device pixel and blocks drawn side by
 * side meet without a seam.
 *
 * Sprites (a block, a sheep, a car) are rastered once per size and look, pixel by pixel, with a depth
 * per pixel, so a model of many small boxes comes out right whatever order its boxes are given in.
 * A scene's still blocks are pieces of a `Stage`: painted once into a layer, and only those standing
 * in front of something that moves are drawn again over it each frame.
 */
import type { Rgb } from "./colour";

/** Where the world's points land on the screen, in device pixels. */
export interface Iso {
  /** Half a block's width on the screen: even, so a top's middle is a whole pixel. */
  S: number;
  /** A block's height on the screen. */
  HZ: number;
  /** Where the world's origin lands. */
  ox: number;
  oy: number;
}

export const screenX = (p: Iso, x: number, y: number) => p.ox + (x - y) * p.S;
export const screenY = (p: Iso, x: number, y: number, z: number) => p.oy + ((x + y) * p.S) / 2 - z * p.HZ;

/** The point of the level `z` under a point of the screen (device pixels). */
export function groundAt(p: Iso, X: number, Y: number, z: number) {
  const a = (X - p.ox) / p.S;
  const b = (2 * (Y - p.oy + z * p.HZ)) / p.S;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Which face of a box: its top, the side facing +y (on the screen's left), or +x (its right). */
export const Face = { Top: 0, Left: 1, Right: 2 } as const;
export type Face = (typeof Face)[keyof typeof Face];

/** A face's colour at (u, v) across it, 0 to 1: on the top u along x and v along y; on a side u
 *  along it and v down it from its top edge. `null` leaves the pixel as it was. */
export type Paint = (face: Face, u: number, v: number) => Rgb | null;

/** One colour per face. */
export const flat = (top: Rgb, left: Rgb, right: Rgb): Paint => (f) => (f === Face.Top ? top : f === Face.Left ? left : right);

/** A sprite and where its top left sits from the screen point of the model's origin. */
export interface Sprite {
  canvas: OffscreenCanvas;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

/** A buffer of pixels with a depth each: boxes and cylinders rastered into it, nearest wins. */
export class Raster {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  private depth: Float32Array;

  constructor(readonly w: number, readonly h: number, readonly p: Iso) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.depth = new Float32Array(w * h).fill(-Infinity);
  }

  private put(i: number, d: number, c: Rgb, a = 255) {
    if (d <= this.depth[i]!) return;
    this.depth[i] = d;
    const k = i * 4;
    this.data[k] = c[0];
    this.data[k + 1] = c[1];
    this.data[k + 2] = c[2];
    this.data[k + 3] = a;
  }

  /** The pixels a box of the world covers, from its eight corners. */
  private bounds(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const { p } = this;
    const L = Math.floor(screenX(p, x0, y1));
    const R = Math.ceil(screenX(p, x1, y0));
    const T = Math.floor(screenY(p, x0, y0, z1));
    const B = Math.ceil(screenY(p, x1, y1, z0));
    return { L: Math.max(0, L), R: Math.min(this.w, R), T: Math.max(0, T), B: Math.min(this.h, B) };
  }

  /** An upright box from (x0, y0, z0) to (x1, y1, z1): its top and its two sides that face the viewer. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, paint: Paint) {
    const { p } = this;
    const { L, R, T, B } = this.bounds(x0, y0, z0, x1, y1, z1);
    const half = p.S / 2;
    for (let Y = T; Y < B; Y++) {
      for (let X = L; X < R; X++) {
        const a = (X + 0.5 - p.ox) / p.S;
        const yy = Y + 0.5 - p.oy;
        // Its top, at z1.
        const b = (2 * (yy + z1 * p.HZ)) / p.S;
        let x = (a + b) / 2;
        let y = (b - a) / 2;
        let c: Rgb | null = null;
        let d = 0;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) {
          c = paint(Face.Top, (x - x0) / (x1 - x0), (y - y0) / (y1 - y0));
          d = x + y + z1;
        } else {
          // The side facing +y, at y1.
          x = a + y1;
          let z = ((x + y1) * half - yy) / p.HZ;
          if (x >= x0 && x < x1 && z >= z0 && z < z1) {
            c = paint(Face.Left, (x - x0) / (x1 - x0), (z1 - z) / (z1 - z0));
            d = x + y1 + z;
          } else {
            // The side facing +x, at x1.
            y = x1 - a;
            z = ((x1 + y) * half - yy) / p.HZ;
            if (y >= y0 && y < y1 && z >= z0 && z < z1) {
              c = paint(Face.Right, (y - y0) / (y1 - y0), (z1 - z) / (z1 - z0));
              d = x1 + y + z;
            }
          }
        }
        if (c) this.put(Y * this.w + X, d, c);
      }
    }
  }

  /** An upright cylinder round (cx, cy) from z0 to z1: its top disc and its side, shaded from `lit`
   *  (the side toward the screen's left, where the light comes from) to `dark`; `rim` rings the top. */
  cylinder(cx: number, cy: number, z0: number, z1: number, r: number, top: Rgb, lit: Rgb, dark: Rgb, rim: Rgb | null = null) {
    const { p } = this;
    const { L, R, T, B } = this.bounds(cx - r, cy - r, z0, cx + r, cy + r, z1);
    const k = p.HZ / p.S;
    for (let Y = T; Y < B; Y++) {
      for (let X = L; X < R; X++) {
        const a = (X + 0.5 - p.ox) / p.S;
        const yy = Y + 0.5 - p.oy;
        const bt = (2 * (yy + z1 * p.HZ)) / p.S;
        const xt = (a + bt) / 2 - cx;
        const yt = (bt - a) / 2 - cy;
        const rr = xt * xt + yt * yt;
        if (rr < r * r) {
          this.put(Y * this.w + X, xt + yt + cx + cy + z1, rim && Math.sqrt(rr) > r * 0.8 ? rim : top);
          continue;
        }
        // Down the side: along this pixel's line of sight, x and y grow by k for each unit of z.
        const bb = (2 * (yy + z0 * p.HZ)) / p.S;
        const dx = (a + bb) / 2 - cx;
        const dy = (bb - a) / 2 - cy;
        const s = dx + dy;
        const disc = s * s - 2 * (dx * dx + dy * dy - r * r);
        if (disc < 0) continue;
        const t = (-s + Math.sqrt(disc)) / (2 * k);
        if (t < 0 || t >= z1 - z0) continue;
        const nx = dx + k * t;
        const ny = dy + k * t;
        // Lit from the screen's left (+y), dark to its right (+x).
        const light = Math.max(0, Math.min(1, 0.5 + (ny - nx) / (2 * r)));
        this.put(Y * this.w + X, nx + ny + cx + cy + z0 + t, mixRgb(dark, lit, light));
      }
    }
  }

  /** One pixel, drawn over whatever is there: a speck, an eye. */
  dot(X: number, Y: number, c: Rgb) {
    if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) return;
    this.put(Y * this.w + X, Infinity, c);
    this.depth[Y * this.w + X] = Infinity;
  }

  toCanvas(): OffscreenCanvas {
    const canvas = new OffscreenCanvas(Math.max(1, this.w), Math.max(1, this.h));
    const g = canvas.getContext("2d");
    if (g && this.w && this.h) g.putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return canvas;
  }
}

/** `t` of the way from `a` to `b`, plainly in sRGB: for shading within a sprite. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as unknown as Rgb;
}

/** A model's sprite: everything `draw` rasters inside the world box `bounds` (relative to the
 *  model's origin), at the scale of `S` and `HZ`. */
export function sprite(S: number, HZ: number, bounds: readonly [number, number, number, number, number, number], draw: (r: Raster) => void): Sprite {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const at: Iso = { S, HZ, ox: 0, oy: 0 };
  const L = Math.floor(screenX(at, x0, y1)) - 1;
  const R = Math.ceil(screenX(at, x1, y0)) + 1;
  const T = Math.floor(screenY(at, x0, y0, z1)) - 1;
  const B = Math.ceil(screenY(at, x1, y1, z0)) + 1;
  const r = new Raster(R - L, B - T, { S, HZ, ox: -L, oy: -T });
  draw(r);
  return { canvas: r.toCanvas(), dx: L, dy: T, w: R - L, h: B - T };
}

// ── the stage: still pieces, painted once ───────────────────────────────────

/** A box of the world, where it is. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** A still piece of a scene: its sprite, the device pixel its top left is drawn at, and its box. */
export interface Piece extends Box {
  img: OffscreenCanvas;
  X: number;
  Y: number;
  w: number;
  h: number;
  /** Its place in the order the stage is painted in. */
  order: number;
  /** The last frame it was looked at, so a piece in two buckets is taken once. */
  seen: number;
}

/** Whether `a` stands in front of `b` (drawn after it): a box apart from another along an axis is
 *  in front of it if it is further along that axis. Two boxes apart along two axes in opposite ways
 *  never overlap on the screen. */
export function inFront(a: Box, b: Box) {
  const e = 1e-6;
  return a.x0 >= b.x1 - e || a.y0 >= b.y1 - e || a.z0 >= b.z1 - e;
}

const BUCKET = 64;

/** A scene's still pieces in the order they are painted (back to front), found by where they are
 *  on the screen. */
export class Stage {
  pieces: Piece[] = [];
  private buckets = new Map<number, Piece[]>();
  private frame = 0;
  private picked: Piece[] = [];

  clear() {
    this.pieces = [];
    this.buckets.clear();
  }

  /** Add a still piece: its sprite drawn at (X, Y), its box `b`. Pieces are painted in the order of
   *  `key`, then of adding. */
  add(img: Sprite, X: number, Y: number, b: Box, key: number) {
    const piece: Piece = { img: img.canvas, X: Math.round(X + img.dx), Y: Math.round(Y + img.dy), w: img.w, h: img.h, ...b, order: key, seen: -1 };
    this.pieces.push(piece);
    return piece;
  }

  /** Sort the pieces for painting and file them by where they fall. */
  finish() {
    this.pieces.sort((a, b) => a.order - b.order);
    this.pieces.forEach((p, i) => { p.order = i; });
    this.buckets.clear();
    for (const p of this.pieces) {
      for (let by = Math.floor(p.Y / BUCKET); by <= Math.floor((p.Y + p.h - 1) / BUCKET); by++) {
        for (let bx = Math.floor(p.X / BUCKET); bx <= Math.floor((p.X + p.w - 1) / BUCKET); bx++) {
          const key = by * 65536 + bx;
          const list = this.buckets.get(key);
          if (list) list.push(p);
          else this.buckets.set(key, [p]);
        }
      }
    }
  }

  /** The pieces that overlap the rectangle (stage pixels), in painting order. */
  private within(L: number, T: number, R: number, B: number, keep: (p: Piece) => boolean): Piece[] {
    this.frame++;
    const out = this.picked;
    out.length = 0;
    for (let by = Math.floor(T / BUCKET); by <= Math.floor((B - 1) / BUCKET); by++) {
      for (let bx = Math.floor(L / BUCKET); bx <= Math.floor((R - 1) / BUCKET); bx++) {
        const list = this.buckets.get(by * 65536 + bx);
        if (!list) continue;
        for (const p of list) {
          if (p.seen === this.frame) continue;
          p.seen = this.frame;
          if (p.X < R && p.X + p.w > L && p.Y < B && p.Y + p.h > T && keep(p)) out.push(p);
        }
      }
    }
    return out.length > 1 ? out.sort((a, b) => a.order - b.order) : out;
  }

  /** Paint every piece, shifted by (dx, dy). */
  paint(g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, dx = 0, dy = 0) {
    for (const p of this.pieces) g.drawImage(p.img, p.X + dx, p.Y + dy);
  }

  /** Paint again only what falls in the rectangle (stage pixels), clipped to it: a block taken away
   *  or put back. `under` paints what lies behind the pieces there first. */
  repaint(g: OffscreenCanvasRenderingContext2D, L: number, T: number, R: number, B: number, under: (L: number, T: number, R: number, B: number) => void) {
    g.save();
    g.beginPath();
    g.rect(L, T, R - L, B - T);
    g.clip();
    under(L, T, R, B);
    for (const p of this.within(L, T, R, B, () => true)) g.drawImage(p.img, p.X, p.Y);
    g.restore();
  }

  /** Draw again the pieces standing in front of `box` that overlap the rectangle it was drawn in
   *  (screen pixels; the stage drawn shifted by dx, dy), clipped to that rectangle. */
  occlude(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, box: Box, L: number, T: number, R: number, B: number, dx = 0, dy = 0) {
    const over = this.within(L - dx, T - dy, R - dx, B - dy, (p) => inFront(p, box) && !inFront(box, p));
    if (!over.length) return;
    g.save();
    g.beginPath();
    g.rect(L, T, R - L, B - T);
    g.clip();
    for (const p of over) g.drawImage(p.img, p.X + dx, p.Y + dy);
    g.restore();
  }
}

/** Something that moves, drawn over the stage each frame in order of `key` (nearer last). */
export interface Actor extends Box {
  key: number;
  img: OffscreenCanvas;
  X: number;
  Y: number;
  alpha?: number;
}

/** The order to draw `actors` in, back to front: by `key`, except where two overlap on the screen
 *  and their boxes say which is in front (a long car beside a brick): then the one behind first. */
export function depthOrder(actors: Actor[]): Actor[] {
  actors.sort((a, b) => a.key - b.key);
  const n = actors.length;
  const rect = actors.map((a) => [Math.round(a.X), Math.round(a.Y), Math.round(a.X) + a.img.width, Math.round(a.Y) + a.img.height] as const);
  // waiting[j]: the actors that wait for j to be drawn first (j is behind them though its key is
  // later); waits[i]: how many i waits for.
  const waiting: number[][] = actors.map(() => []);
  const waits = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const [l, t, r, b] = rect[i]!;
    for (let j = i + 1; j < n; j++) {
      const q = rect[j]!;
      if (q[0] >= r || q[2] <= l || q[1] >= b || q[3] <= t) continue;
      // j comes after i by key; if i is in fact in front of j, j goes first.
      if (inFront(actors[i]!, actors[j]!) && !inFront(actors[j]!, actors[i]!)) {
        waiting[j]!.push(i);
        waits[i]!++;
      }
    }
  }
  // Each actor once every actor behind it is drawn, earliest key first.
  const out: Actor[] = [];
  const done = new Array<boolean>(n).fill(false);
  let progress = true;
  while (out.length < n && progress) {
    progress = false;
    for (let i = 0; i < n; i++) {
      if (done[i] || waits[i]! > 0) continue;
      done[i] = true;
      out.push(actors[i]!);
      for (const k of waiting[i]!) waits[k]!--;
      progress = true;
      break;
    }
  }
  // A ring of actors each in front of the next cannot be ordered: the rest by key.
  for (let i = 0; i < n; i++) if (!done[i]) out.push(actors[i]!);
  return out;
}

/** Draw `actors` over `stage` (already painted), back to front, each covered again by the still
 *  pieces in front of it. */
export function drawActors(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, stage: Stage, actors: Actor[], dx = 0, dy = 0) {
  for (const a of depthOrder(actors)) {
    const X = Math.round(a.X);
    const Y = Math.round(a.Y);
    if (a.alpha !== undefined && a.alpha < 1) {
      g.globalAlpha = Math.max(0, a.alpha);
      g.drawImage(a.img, X, Y);
      g.globalAlpha = 1;
    } else g.drawImage(a.img, X, Y);
    stage.occlude(g, a, X, Y, X + a.img.width, Y + a.img.height, dx, dy);
  }
}
