// Ships on the sea, each one something going on: work passing between two projects sails as a ship
// between their islands, an agent calling you waits as a boat moored off its island with its lantern
// lit, and fishing boats work the water round the islands that are busy. They ride the swells the sea
// draws (one wave function, `SWELLS`, for both), heel and fill their sails with the wind, find their
// way round the islands and never onto one, leave a wake, and light their lanterns as the light goes.
// Four instanced draws, however many ships there are, and at most `SHIPS_MAX` of them.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const SHIPS_MAX = 12;

/** The sea's long swells: direction, wave number and height. The sea's shader is written from these. */
export const SWELLS: readonly { dx: number; dz: number; k: number; a: number }[] = [
  [0.8, 0.6, 0.55], [-0.5, 0.86, 0.9], [0.97, -0.24, 1.6], [-0.83, -0.56, 2.7], [0.2, 0.98, 4.1],
].map(([dx, dz, k], i) => ({ dx: dx!, dz: dz!, k: k!, a: 0.12 / (1 + i * 0.9) }));

/** The same swells in GLSL: `slope(p)` gives the sea's slope at `p`, `swell` how high they run. */
export const SWELL_GLSL = `uniform float swell;
  vec2 slope(vec2 p) {
    vec2 s = vec2(0.0);
    ${SWELLS.map((w) => `s += vec2(${w.dx.toFixed(3)}, ${w.dz.toFixed(3)}) * ${(w.a * w.k).toFixed(4)} * swell * cos(dot(vec2(${w.dx.toFixed(3)}, ${w.dz.toFixed(3)}), p) * ${w.k.toFixed(3)} + time * ${(Math.sqrt(9.8 * w.k) * 0.45).toFixed(4)});`).join("\n    ")}
    return s;
  }`;

/** How high the sea stands at (x, z) at time `t` above its rest, and its slope there. */
export function seaAt(x: number, z: number, t: number, swell: number, out = { h: 0, sx: 0, sz: 0 }): { h: number; sx: number; sz: number } {
  out.h = out.sx = out.sz = 0;
  for (const w of SWELLS) {
    const ph = (w.dx * x + w.dz * z) * w.k + t * Math.sqrt(9.8 * w.k) * 0.45, a = w.a * swell;
    out.h += a * Math.sin(ph);
    const c = a * w.k * Math.cos(ph);
    out.sx += w.dx * c; out.sz += w.dz * c;
  }
  return out;
}

/** A place on the water: where a ship sets off from, makes for, or lies at. */
export interface Port { x: number; z: number }
/** What a ship is for. `key` says which it is from one change to the next. */
export type Errand =
  /** Work passing between two projects: it sails between them while the link lasts. */
  | { kind: "ferry"; key: string; from: Port; to: Port; flag: string }
  /** An agent calling you: it sails out to lie off its island, lantern lit, until you answer. */
  | { kind: "moored"; key: string; from: Port; at: Port; flag: string }
  /** An island at work: it fishes in a ring round it. */
  | { kind: "fishing"; key: string; cx: number; cz: number; r: number; flag: string };

/** How far a point of the sea is from land (0 on land). */
export type ShoreDistance = (x: number, z: number) => number;

export interface ShipsWeather {
  /** 0 a calm, 1 a gale. */
  wind: number;
  /** Where it blows to, a unit vector on the sea. */
  dirX: number; dirZ: number;
  /** 0 by day, 1 at night: the lanterns. */
  lamps: number;
  /** The colour of a call, for a moored boat's lantern. */
  call: THREE.Color;
}

/** The first point of open water going out from (x, z) along (dx, dz): a ship's place off that shore. */
export function offShore(x: number, z: number, dx: number, dz: number, distance: ShoreDistance, clear = 1): Port {
  const n = Math.hypot(dx, dz) || 1;
  dx /= n; dz /= n;
  let left = false;
  for (let s = 0; s < 80; s += 0.25) {
    const d = distance(x + dx * s, z + dz * s);
    if (d < 0.3) left = true;
    if ((left || s > 1) && d >= clear) return { x: x + dx * s, z: z + dz * s };
  }
  return { x: x + dx * 20, z: z + dz * 20 };
}

/** Water a ship's route keeps to, and the least it will come to a shore under way. */
const OPEN = 1.4, AGROUND = 0.45;
const clearLine = (a: Port, b: Port, distance: ShoreDistance) => {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
  for (let i = 1; i < n; i++) if (distance(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n) < OPEN * 0.8) return false;
  return true;
};

/** A way by water from `a` to `b` round whatever land lies between: the corners of the shortest path
 *  through open water on a grid a unit apart, cut short wherever there is a clear line. `[b]` when
 *  the way is clear or none is found. */
export function route(a: Port, b: Port, distance: ShoreDistance): Port[] {
  if (clearLine(a, b, distance)) return [b];
  const pad = 24, x0 = Math.floor(Math.min(a.x, b.x) - pad), z0 = Math.floor(Math.min(a.z, b.z) - pad);
  const w = Math.ceil(Math.max(a.x, b.x) + pad) - x0, h = Math.ceil(Math.max(a.z, b.z) + pad) - z0;
  const at = (i: number, j: number) => j * w + i;
  const open = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) open[at(i, j)] = distance(x0 + i, z0 + j) >= OPEN ? 1 : 0;
  const si = Math.round(a.x - x0), sj = Math.round(a.z - z0), gi = Math.round(b.x - x0), gj = Math.round(b.z - z0);
  open[at(si, sj)] = open[at(gi, gj)] = 1;
  const g = new Float32Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1), done = new Uint8Array(w * h);
  // A small binary heap of [f, cell].
  const heap: [number, number][] = [];
  const push = (f: number, c: number) => { heap.push([f, c]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p]![0] <= f) break; [heap[p], heap[k]] = [heap[k]!, heap[p]!]; k = p; } };
  const pop = () => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k]!, heap[m]!]; k = m; } } return top; };
  const hEst = (i: number, j: number) => Math.hypot(i - gi, j - gj);
  g[at(si, sj)] = 0;
  push(hEst(si, sj), at(si, sj));
  const goal = at(gi, gj);
  while (heap.length) {
    const [, c] = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) break;
    const ci = c % w, cj = (c - ci) / w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const n = at(ni, nj);
      if (!open[n] || done[n]) continue;
      const cost = g[c]! + (di && dj ? Math.SQRT2 : 1);
      if (cost < g[n]!) { g[n] = cost; from[n] = c; push(cost + hEst(ni, nj), n); }
    }
  }
  if (from[goal] === -1) return [b];
  const cells: Port[] = [];
  for (let c = goal; c !== -1 && c !== at(si, sj); c = from[c]!) cells.push({ x: x0 + (c % w), z: z0 + Math.floor(c / w) });
  cells.reverse();
  cells[cells.length - 1] = b;
  // Only the corners it must turn at: from each, the furthest it can see clearly.
  const out: Port[] = [];
  let here = a, k = 0;
  while (k < cells.length) {
    let far = k;
    while (far + 1 < cells.length && clearLine(here, cells[far + 1]!, distance)) far++;
    out.push(cells[far]!);
    here = cells[far]!;
    k = far + 1;
  }
  return out;
}

interface Ship {
  errand: Errand;
  x: number; z: number; heading: number; speed: number;
  /** Which way it goes: a ferry's leg, a fishing boat's place round its ring. */
  leg: number;
  /** The corners of the way it is on, and which it makes for. */
  path: Port[]; next: number;
  wait: number;
  /** 0 when it has just come or is going, 1 when it is all there. */
  shown: number;
  leaving: boolean;
  size: number;
  /** Which side its sails belly to: away from the wind, -1 or 1. */
  lee: number;
}

const SIZE = { ferry: 0.95, moored: 0.8, fishing: 0.6 };
const SEA_Y = -0.3;
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
const LANTERN = new THREE.Color(1, 0.72, 0.36), DARK = new THREE.Color(0.25, 0.2, 0.15);
const SEA = { h: 0, sx: 0, sz: 0 };

export class Fleet {
  readonly group = new THREE.Group();
  private hulls: THREE.InstancedMesh;
  private sails: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private lanterns: THREE.InstancedMesh;
  private lee = new THREE.InstancedBufferAttribute(new Float32Array(SHIPS_MAX), 1).setUsage(THREE.DynamicDrawUsage);
  private ships: Ship[] = [];
  private wind = { value: 0 };
  private time = { value: 0 };

  constructor() {
    const wood = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.hulls = new THREE.InstancedMesh(hullGeometry(), wood, SHIPS_MAX);
    this.hulls.castShadow = true;
    const sails = sailGeometry();
    sails.setAttribute("lee", this.lee);
    this.sails = new THREE.InstancedMesh(sails, clothMaterial(0xf6ebd2, this.wind, this.time, "sail"), SHIPS_MAX);
    this.sails.castShadow = true;
    this.flags = new THREE.InstancedMesh(flagGeometry(), clothMaterial(0xffffff, this.wind, this.time, "flag"), SHIPS_MAX);
    this.lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.11, 0.08).translate(-0.66, 0.6, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), SHIPS_MAX);
    for (const m of [this.hulls, this.sails, this.flags, this.lanterns]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
  }

  /** What there is to sail for now. A ship for an errand gone sails off and fades; one for a new errand comes. */
  setErrands(errands: readonly Errand[], distance: ShoreDistance): void {
    const want = new Map(errands.slice(0, SHIPS_MAX).map((e) => [e.key, e]));
    for (const s of this.ships) {
      const e = want.get(s.errand.key);
      if (!e) { s.leaving = true; continue; }
      const moved = JSON.stringify(goalOf(s.errand, s.leg)) !== JSON.stringify(goalOf(e, s.leg));
      s.errand = e; s.leaving = false; want.delete(e.key);
      if (moved) this.plan(s, distance);
    }
    for (const e of want.values()) {
      if (this.ships.length >= SHIPS_MAX) break;
      const at = e.kind === "fishing" ? offShore(e.cx, e.cz, 1, 0, distance, OPEN) : e.from;
      const s: Ship = { errand: e, x: at.x, z: at.z, heading: 0, speed: 0, leg: 0, path: [], next: 0, wait: e.kind === "ferry" ? 1.5 : 0, shown: 0, leaving: false, size: SIZE[e.kind], lee: 1 };
      this.plan(s, distance);
      const first = s.path[0]!;
      s.heading = Math.atan2(first.z - s.z, first.x - s.x);
      this.ships.push(s);
    }
  }

  get count(): number { return this.ships.length; }

  /** Its way to where it makes for now, round the land. */
  private plan(s: Ship, distance: ShoreDistance): void {
    s.path = route({ x: s.x, z: s.z }, goalOf(s.errand, s.leg), distance);
    s.next = 0;
  }

  /** Sail every ship one frame on. `foam` leaves the wake. */
  update(t: number, dt: number, weather: ShipsWeather, distance: ShoreDistance, reduced: boolean, foam: (x: number, z: number, vx: number, vz: number, size: number) => void): void {
    this.wind.value = weather.wind;
    this.time.value = reduced ? 0 : t;
    const swell = 0.8 + weather.wind * 1.2, windAt = Math.atan2(weather.dirZ, weather.dirX);
    for (const s of this.ships) {
      s.shown = THREE.MathUtils.clamp(s.shown + (s.leaving ? -dt : dt) * 0.8, 0, 1);
      if (!reduced) this.sail(s, dt, weather, distance, foam);
    }
    this.ships = this.ships.filter((s) => !(s.leaving && s.shown === 0));
    let n = 0;
    for (const s of this.ships) {
      const sea = seaAt(s.x, s.z, reduced ? 0 : t, swell, SEA);
      // It leans away from a wind across it, and rocks with the slope of the sea under it: bow up
      // on a slope rising ahead, the side the sea rises on lifted.
      const across = Math.sin(windAt - s.heading);
      s.lee = across >= 0 ? 1 : -1;
      const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
      const pitch = (sea.sx * ch + sea.sz * sh) * 0.9, roll = -(sea.sx * -sh + sea.sz * ch) * 0.9 - across * weather.wind * 0.12;
      E.set(roll, -s.heading, pitch, "YXZ");
      Q.setFromEuler(E);
      const k = s.size * easeOut(s.shown);
      P.set(s.x, SEA_Y + sea.h * 0.6 - (1 - s.shown) * 0.3, s.z);
      M.compose(P, Q, S.set(k, k, k));
      for (const m of [this.hulls, this.sails, this.flags, this.lanterns]) m.setMatrixAt(n, M);
      this.lee.setX(n, s.lee);
      this.flags.setColorAt(n, C.set(s.errand.flag));
      // Lit as the light goes; a boat calling you shows its call by day too, and pulses.
      const calling = s.errand.kind === "moored";
      const glow = calling ? (0.6 + weather.lamps * 2.4) * (reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 4)) : weather.lamps * 2.6;
      this.lanterns.setColorAt(n, glow < 0.08 ? DARK : C.copy(calling ? weather.call : LANTERN).multiplyScalar(Math.max(0.3, glow)));
      n++;
    }
    for (const m of [this.hulls, this.sails, this.flags, this.lanterns]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.lee.needsUpdate = true;
  }

  private sail(s: Ship, dt: number, weather: ShipsWeather, distance: ShoreDistance, foam: (x: number, z: number, vx: number, vz: number, size: number) => void): void {
    const e = s.errand, last = s.next >= s.path.length - 1, goal = s.path[Math.min(s.next, s.path.length - 1)]!;
    const dx = goal.x - s.x, dz = goal.z - s.z, far = Math.hypot(dx, dz);
    if (s.wait > 0) { s.wait -= dt; s.speed = Math.max(0, s.speed - dt * 0.8); }
    else if (!last && far < 1.2) s.next++;
    else if (last && far < 0.6) {
      // There: a ferry lies a while and turns for the other island; a fishing boat moves round its ring.
      if (e.kind === "ferry") { s.leg ^= 1; s.wait = 2.5 + Math.random() * 2; this.plan(s, distance); }
      else if (e.kind === "fishing") { s.leg++; this.plan(s, distance); }
    }
    const moored = e.kind === "moored" && last && far < 0.9;
    // Lying at its place, it swings to face the wind.
    const want = moored ? Math.atan2(-weather.dirZ, -weather.dirX) : Math.atan2(dz, dx);
    const turn = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading));
    s.heading += THREE.MathUtils.clamp(turn, -1.2 * dt, 1.2 * dt);
    // Faster in a wind; slower turning hard and coming in.
    const top = (e.kind === "fishing" ? 0.45 : 0.8) * (0.55 + weather.wind * 1.1);
    const v = s.wait > 0 || moored ? 0 : top * Math.min(1, (last ? far / 2.5 : 1) + 0.15) * (Math.abs(turn) > 1.2 ? 0.4 : 1);
    s.speed += (v - s.speed) * Math.min(1, dt * 0.9);
    const nx = s.x + Math.cos(s.heading) * s.speed * dt, nz = s.z + Math.sin(s.heading) * s.speed * dt;
    // Never aground: a step that would bring it onto the shore it does not take, and it bears away
    // toward deeper water instead.
    const dn = distance(nx, nz);
    if (dn < AGROUND && dn <= distance(s.x, s.z)) {
      const gx = distance(s.x + 0.5, s.z) - distance(s.x - 0.5, s.z), gz = distance(s.x, s.z + 0.5) - distance(s.x, s.z - 0.5);
      const away = Math.atan2(gz, gx), off = Math.atan2(Math.sin(away - s.heading), Math.cos(away - s.heading));
      s.heading += THREE.MathUtils.clamp(off, -2.5 * dt, 2.5 * dt);
      s.speed *= 0.6;
      return;
    }
    s.x = nx; s.z = nz;
    // The wake, from the stern, as fast as it goes.
    if (s.speed > 0.12 && Math.random() < s.speed * dt * 14) {
      const bx = s.x - Math.cos(s.heading) * 0.75 * s.size, bz = s.z - Math.sin(s.heading) * 0.75 * s.size, side = (Math.random() - 0.5) * 0.5;
      foam(bx, bz, -Math.sin(s.heading) * side, Math.cos(s.heading) * side, 0.22 * s.size);
    }
  }
}

/** Where an errand has a ship make for, on a given leg. */
function goalOf(e: Errand, leg: number): Port {
  if (e.kind === "ferry") return leg ? e.from : e.to;
  if (e.kind === "moored") return e.at;
  const a = leg * 0.8;
  return { x: e.cx + Math.cos(a) * e.r, z: e.cz + Math.sin(a) * e.r };
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

// ── the ship, in a few dozen faces ───────────────────────────────────────────
// Bow along +x. One mast a little forward of the middle, a mainsail aft of it on a boom and a jib
// to the bow, both fore and aft, so the ship reads as one from any side.

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position!.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}

function hullGeometry(): THREE.BufferGeometry {
  // The deck's outline, stern to a pointed bow, and the keel's, narrower and shorter under it.
  const deck: [number, number][] = [[-0.72, -0.25], [-0.2, -0.31], [0.35, -0.26], [0.82, 0]];
  const ring = (y: number, sx: number, sz: number, dx = 0) => {
    const pts = [...deck, ...deck.slice(0, -1).reverse().map(([x, z]) => [x, -z] as [number, number])];
    return pts.map(([x, z]) => new THREE.Vector3(x * sx + dx, y, z * sz));
  };
  // The deck stands a little above the sea, and the hull goes on down below it, out of sight.
  const top = ring(0.22, 1, 1), mid = ring(0.1, 0.97, 0.98), keel = ring(-0.3, 0.7, 0.35, 0.05);
  const pos: number[] = [], col: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hex: number) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const k = new THREE.Color(hex);
    for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b);
  };
  const band = (u: THREE.Vector3[], d: THREE.Vector3[], hex: number) => {
    for (let i = 0; i < u.length; i++) {
      const j = (i + 1) % u.length;
      tri(u[i]!, d[i]!, d[j]!, hex);
      tri(u[i]!, d[j]!, u[j]!, hex);
    }
  };
  band(top, mid, 0xe2c07f);   // the gunwale's painted strake
  band(mid, keel, 0x7a4a24);  // the planked side
  const c0 = new THREE.Vector3(0, 0.22, 0), c1 = new THREE.Vector3(0.05, -0.3, 0);
  for (let i = 0; i < top.length; i++) {
    const j = (i + 1) % top.length;
    tri(c0, top[j]!, top[i]!, 0xb98a55);   // the deck
    tri(c1, keel[i]!, keel[j]!, 0x5a341a); // the bottom
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const cabin = paint(new THREE.BoxGeometry(0.3, 0.18, 0.34).translate(-0.48, 0.31, 0), 0x9c6a3c);
  const roof = paint(new THREE.BoxGeometry(0.36, 0.04, 0.4).translate(-0.48, 0.42, 0), 0x6b3f1f);
  const mast = paint(new THREE.CylinderGeometry(0.022, 0.032, 1.5, 6).translate(0.12, 0.95, 0), 0x6b4423);
  const boom = paint(new THREE.CylinderGeometry(0.016, 0.016, 0.72, 5).rotateZ(Math.PI / 2).translate(-0.24, 0.42, 0), 0x6b4423);
  const post = paint(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4).translate(-0.66, 0.45, 0), 0x3d2a18);
  return mergeGeometries([g, cabin, roof, mast, boom, post])!;
}

/** The mainsail and the jib, each a triangle cut fine enough to belly out; `cloth` is where on it a
 *  point is (along its foot, up its luff), for the shader. */
function sailGeometry(): THREE.BufferGeometry {
  const sail = (tack: THREE.Vector3, head: THREE.Vector3, clew: THREE.Vector3) => {
    const g = new THREE.PlaneGeometry(1, 1, 5, 6), p = g.attributes.position!, cloth = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      const q = tack.clone().addScaledVector(clew.clone().sub(tack), u * (1 - v)).addScaledVector(head.clone().sub(tack), v);
      p.setXYZ(i, q.x, q.y, q.z);
      cloth[i * 2] = u * (1 - v); cloth[i * 2 + 1] = v;
    }
    g.setAttribute("cloth", new THREE.BufferAttribute(cloth, 2));
    g.deleteAttribute("uv");
    g.computeVertexNormals();
    return g;
  };
  const main = sail(new THREE.Vector3(0.1, 0.45, 0), new THREE.Vector3(0.1, 1.62, 0), new THREE.Vector3(-0.58, 0.44, 0));
  const jib = sail(new THREE.Vector3(0.78, 0.3, 0), new THREE.Vector3(0.16, 1.4, 0), new THREE.Vector3(0.2, 0.42, 0));
  return mergeGeometries([main, jib])!;
}
function flagGeometry(): THREE.BufferGeometry {
  // At the masthead, streaming astern.
  return new THREE.PlaneGeometry(0.28, 0.15, 5, 1).translate(-0.14, 0, 0).translate(0.12, 1.66, 0);
}

/** Cloth that the wind moves: a sail bellies out to its lee, a flag streams and flutters. */
function clothMaterial(color: number, wind: { value: number }, time: { value: number }, kind: "sail" | "flag"): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.wind = wind;
    sh.uniforms.clothTime = time;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float wind; uniform float clothTime;${kind === "sail" ? "\nattribute vec2 cloth; attribute float lee;" : ""}`)
      .replace("#include <begin_vertex>", kind === "sail"
        ? `#include <begin_vertex>
          // Most in the middle of the sail, none along its luff and foot; it shivers a little.
          float belly = sin(3.14159 * clamp(cloth.x / max(1.0 - cloth.y, 0.001), 0.0, 1.0)) * sin(3.14159 * cloth.y) * (1.0 - cloth.y);
          transformed.z += lee * (0.04 + wind * 0.16) * belly * (0.94 + 0.06 * sin(clothTime * 3.3 + position.y * 8.0));`
        : `#include <begin_vertex>
          float f = clamp((0.12 - position.x) / 0.28, 0.0, 1.0);
          transformed.z += f * sin(clothTime * (5.0 + wind * 7.0) + position.x * 22.0) * (0.02 + wind * 0.05);
          transformed.y -= f * (0.06 * (1.0 - wind));`);
  };
  m.customProgramCacheKey = () => `cloth-${kind}`;
  return m;
}
