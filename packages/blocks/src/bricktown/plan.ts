/**
 * Brick Town's plan: a town of toy bricks on a baseplate that runs past every edge of the window, a
 * grid of streets every ten studs (a road two studs wide, then a lot eight wide whose rim is the
 * pavement). Each lot is fixed by where it is (a hash of its place), so the town is the same every
 * time, and a bigger window shows more of it. One big park of four lots holds the railway: a loop of
 * track round its edge, a station, a pond and trees inside. Lots near the middle of the window are
 * gardens and low houses; the taller buildings stand further out.
 */
import { hash2 } from "../rng";

export const PERIOD = 10;
/** What a cell of the baseplate is. */
export const Ground = { Plate: 0, Road: 1, Walk: 2, Track: 3, Path: 4, Water: 5, Paving: 6 } as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

const mod = (a: number, n: number) => ((a % n) + n) % n;
/** The road running along y at this x, or along x at this y. */
export const roadAt = (v: number) => mod(v, PERIOD) < 2;
/** The lot a cell is in, along one axis. */
export const lotOf = (v: number) => Math.floor((v - 2) / PERIOD);

/** The park with the railway: the four lots from (PARK, PARK). */
export const PARK = 0;
const P0 = PARK * PERIOD + 2;
const P1 = P0 + 2 * PERIOD - 2;
export const PARK_BOX = { x0: P0, y0: P0, x1: P1, y1: P1 };
export const inPark = (x: number, y: number) => x >= P0 && x < P1 && y >= P0 && y < P1;

/** The track's loop through cell middles, inset one from the park's edge: its corners in order. */
export const TRACK = (() => {
  const a = P0 + 1.5;
  const b = P1 - 1.5;
  return [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
})();
export const TRACK_LENGTH = 4 * (TRACK[1]!.x - TRACK[0]!.x);

/** Where along the loop a distance `d` is: the point, and the way it runs (0 +x, 1 +y, 2 -x, 3 -y). */
export function alongTrack(d: number): { x: number; y: number; dir: number } {
  const side = TRACK[1]!.x - TRACK[0]!.x;
  const s = mod(d, TRACK_LENGTH);
  const k = Math.floor(s / side);
  const t = s - k * side;
  const a = TRACK[k]!;
  const dir = k;
  const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][k]!;
  return { x: a.x + dx! * t, y: a.y + dy! * t, dir };
}

export interface House {
  x0: number;
  y0: number;
  w: number;
  d: number;
  /** Walls this many bricks high. */
  floors: number;
  /** Indexes into the palette's walls and roofs. */
  wall: number;
  roof: number;
  /** A flat roof with a rim, for a taller block of shops. */
  flat: boolean;
}

export type LotKind = "houses" | "tower" | "garden" | "square" | "park";
export interface Lot {
  bx: number;
  by: number;
  kind: LotKind;
  houses: House[];
  trees: { x: number; y: number; big: boolean }[];
  lamps: { x: number; y: number }[];
  fountain: { x: number; y: number } | null;
  /** Flower beds: a cell each, by colour. */
  beds: { x: number; y: number; colour: number }[];
}

export const WALLS = 6;
export const ROOFS = 4;

/** The plan, made for a window centred on lot (cx, cy): lots are made as asked for, and kept. */
export class Plan {
  private lots = new Map<number, Lot>();
  constructor(readonly cx: number, readonly cy: number) {}

  /** What the baseplate is at a cell. */
  ground(x: number, y: number): Ground {
    if (inPark(x, y)) {
      if (x === P0 || y === P0 || x === P1 - 1 || y === P1 - 1) return Ground.Walk;
      if (x === P0 + 1 || y === P0 + 1 || x === P1 - 2 || y === P1 - 2) return Ground.Track;
      const pond = Math.hypot(x + 0.5 - (P0 + 12.5), (y + 0.5 - (P0 + 12)) * 1.2) < 2.6;
      if (pond) return Ground.Water;
      if (x === P0 + 6 || y === P0 + 7) return Ground.Path;
      return Ground.Plate;
    }
    if (roadAt(x) || roadAt(y)) return Ground.Road;
    const mx = mod(x, PERIOD);
    const my = mod(y, PERIOD);
    if (mx === 2 || mx === 9 || my === 2 || my === 9) return Ground.Walk;
    return this.lot(lotOf(x), lotOf(y)).kind === "square" ? Ground.Paving : Ground.Plate;
  }

  /** The lot at (bx, by). */
  lot(bx: number, by: number): Lot {
    const key = bx * 100003 + by;
    const have = this.lots.get(key);
    if (have) return have;
    const lot = this.make(bx, by);
    this.lots.set(key, lot);
    return lot;
  }

  private make(bx: number, by: number): Lot {
    const lot: Lot = { bx, by, kind: "houses", houses: [], trees: [], lamps: [], fountain: null, beds: [] };
    // Inside the lot (its pavement rim left out): x0 … x0 + 5.
    const x0 = bx * PERIOD + 3;
    const y0 = by * PERIOD + 3;
    if (bx >= PARK && bx <= PARK + 1 && by >= PARK && by <= PARK + 1) {
      lot.kind = "park";
      if (bx === PARK && by === PARK) this.park(lot);
      return lot;
    }
    const h = hash2(bx, by, 101);
    const near = Math.max(Math.abs(bx - this.cx), Math.abs(by - this.cy)) <= 1;
    lot.kind = near ? (h < 0.45 ? "garden" : h < 0.6 ? "square" : "houses") : h < 0.5 ? "houses" : h < 0.68 ? "tower" : h < 0.86 ? "garden" : "square";
    const r = (k: number) => hash2(bx, by, 200 + k);
    const colour = (k: number) => Math.floor(r(k) * WALLS);
    const roof = (k: number) => Math.floor(r(k + 50) * ROOFS);
    if (lot.kind === "houses") {
      const layout = Math.floor(r(1) * 3);
      const low = near ? 2 : 3;
      if (layout === 0) {
        lot.houses.push({ x0, y0, w: 4, d: 4, floors: 2 + Math.floor(r(2) * low), wall: colour(3), roof: roof(3), flat: false });
        lot.trees.push({ x: x0 + 5, y: y0 + 5, big: true }, { x: x0 + 5, y: y0 + 1, big: false });
        lot.beds.push({ x: x0 + 1, y: y0 + 5, colour: 0 }, { x: x0 + 2, y: y0 + 5, colour: 1 });
      } else if (layout === 1) {
        lot.houses.push({ x0, y0, w: 3, d: 3, floors: 2 + Math.floor(r(2) * low), wall: colour(3), roof: roof(3), flat: false });
        lot.houses.push({ x0: x0 + 3, y0: y0 + 3, w: 3, d: 3, floors: 2 + Math.floor(r(4) * low), wall: colour(5), roof: roof(5), flat: false });
        lot.trees.push({ x: x0 + 4, y: y0 + 1, big: true }, { x: x0 + 1, y: y0 + 4, big: r(6) < 0.5 });
      } else {
        lot.houses.push({ x0, y0: y0 + 1, w: 3, d: 4, floors: 2 + Math.floor(r(2) * low), wall: colour(3), roof: roof(3), flat: false });
        lot.houses.push({ x0: x0 + 4, y0, w: 2, d: 3, floors: 2 + Math.floor(r(4) * 2), wall: colour(5), roof: roof(5), flat: false });
        lot.trees.push({ x: x0 + 4, y: y0 + 4, big: true });
        lot.beds.push({ x: x0 + 5, y: y0 + 5, colour: 2 }, { x: x0, y: y0, colour: 1 });
      }
    } else if (lot.kind === "tower") {
      lot.houses.push({ x0: x0 + 1, y0: y0 + 1, w: 4, d: 4, floors: 4 + Math.floor(r(2) * 3), wall: colour(3), roof: roof(3), flat: true });
      lot.trees.push({ x: x0, y: y0 + 5, big: false }, { x: x0 + 5, y: y0, big: false });
    } else if (lot.kind === "garden") {
      for (let k = 0; k < 4; k++) lot.trees.push({ x: x0 + Math.floor(r(10 + k) * 6), y: y0 + Math.floor(r(20 + k) * 6), big: r(30 + k) < 0.6 });
      lot.trees = lot.trees.filter((t, i) => !lot.trees.slice(0, i).some((o) => Math.abs(o.x - t.x) + Math.abs(o.y - t.y) < 2));
      for (let k = 0; k < 5; k++) {
        const bed = { x: x0 + Math.floor(r(40 + k) * 6), y: y0 + Math.floor(r(50 + k) * 6), colour: k % 3 };
        if (!lot.trees.some((t) => t.x === bed.x && t.y === bed.y)) lot.beds.push(bed);
      }
    } else {
      lot.fountain = { x: x0 + 2.5, y: y0 + 2.5 };
      lot.trees.push({ x: x0, y: y0, big: false }, { x: x0 + 5, y: y0, big: false }, { x: x0, y: y0 + 5, big: false }, { x: x0 + 5, y: y0 + 5, big: false });
    }
    // Street lamps on two corners of its pavement.
    const corners = [[bx * PERIOD + 2, by * PERIOD + 2], [bx * PERIOD + 9, by * PERIOD + 2], [bx * PERIOD + 9, by * PERIOD + 9], [bx * PERIOD + 2, by * PERIOD + 9]] as const;
    const first = Math.floor(r(60) * 4);
    for (const k of [first, (first + 2) % 4]) lot.lamps.push({ x: corners[k]![0], y: corners[k]![1] });
    return lot;
  }

  /** The railway park: the station by the track, trees, beds round the pond. */
  private park(lot: Lot) {
    lot.houses.push({ x0: P0 + 3, y0: P0 + 9, w: 2, d: 4, floors: 2, wall: 1, roof: 0, flat: false });
    for (const [x, y, big] of [[P0 + 3, P0 + 3, true], [P0 + 9, P0 + 3, true], [P0 + 14, P0 + 4, false], [P0 + 4, P0 + 15, true], [P0 + 15, P0 + 15, false], [P0 + 9, P0 + 15, false], [P0 + 15, P0 + 8, true], [P0 + 11, P0 + 4, false]] as const) {
      lot.trees.push({ x, y, big });
    }
    for (const [x, y, c] of [[P0 + 8, P0 + 10, 0], [P0 + 9, P0 + 10, 1], [P0 + 15, P0 + 11, 2], [P0 + 15, P0 + 12, 0], [P0 + 10, P0 + 14, 1]] as const) lot.beds.push({ x, y, colour: c });
    lot.lamps.push({ x: P0 + 5, y: P0 + 7 }, { x: P0 + 7, y: P0 + 5 }, { x: P0 + 13, y: P0 + 7 });
  }

  /** Every lot whose cells could show in a box of cells. */
  lotsIn(x0: number, y0: number, x1: number, y1: number): Lot[] {
    const out: Lot[] = [];
    for (let by = lotOf(y0) - 1; by <= lotOf(y1) + 1; by++) for (let bx = lotOf(x0) - 1; bx <= lotOf(x1) + 1; bx++) out.push(this.lot(bx, by));
    return out;
  }
}
