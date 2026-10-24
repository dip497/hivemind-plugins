// You, walking the islands: a worker of your own that the arrow keys or WASD move, the way the
// camera faces, over land and bridges but never into the sea, through a castle wall, a tree, a
// house or another worker. Shift runs. Through your own eyes you walk at a calmer pace, and ← and →
// turn you.
// Which agent is close enough to talk to is worked out here; the scene draws you, the view acts.
import type { Who } from "./assets";

/** Keys that move you, and which way: forward, then right. */
const KEYS: Record<string, [number, number]> = {
  w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0],
  a: [0, -1], arrowleft: [0, -1], d: [0, 1], arrowright: [0, 1],
};
/** Through your own eyes, keys that turn you instead, and which way: left (−), right (+). */
const TURNS: Record<string, number> = { arrowleft: -1, arrowright: 1 };
/** Walking and running pace, in world units a second (a tile is about two across), and the share of
 *  it through your own eyes: from there the full pace is a jog and a sprint. */
const WALK = 2.4, RUN = 4.6, CALM = 0.6;
/** How long you take to come up to pace from standing, or to stop from it, in seconds. */
const RAMP = 0.15;
/** How fast ← and → turn you through your eyes, in radians a second, and how long a turn takes to
 *  come up to that or to stop. */
const TURN = 2, TURN_RAMP = 0.12;
/** How near an agent has to be to talk to it. */
export const TALK = 1.5;
/** How near you come to another worker through your own eyes, middle to middle: inside talking
 *  distance, and far enough off to see its face and the name over it. */
export const MEET = 0.95;
export const WHO: Who[] = ["rogue", "knight", "mage", "barbarian"];

/** Where you can go: `stand` says whether (x, z) is somewhere to stand, given that you step there from
 *  (fromX, fromZ) when those are given; `meets`, whether a step to (x, z) runs into another worker,
 *  where you stop rather than go round it as you go round a tree. */
export interface Ground { stand(x: number, z: number, fromX?: number, fromZ?: number): boolean; meets?(x: number, z: number): boolean }

/** How far your worker's body reaches from its middle (it is about 0.45 across): nothing you walk
 *  round comes nearer, so through its eyes a tree or a wall stays an arm's length away, not at your nose. */
export const BODY = 0.22;

/** Whether a step to (x, z) goes into a circle `r` round (cx, cz), or further into it. Standing in one
 *  already (a house went up where you stood, an agent walked up to you), a step that takes you out of
 *  it is allowed, so you are never shut in. With nowhere you come from (landing), inside is in. */
export function into(x: number, z: number, cx: number, cz: number, r: number, fromX?: number, fromZ?: number): boolean {
  // Squared distances: asked for every tree, house and worker near you, each step.
  const d = (x - cx) ** 2 + (z - cz) ** 2;
  return d < r * r && (fromX === undefined || fromZ === undefined || d <= (fromX - cx) ** 2 + (fromZ - cz) ** 2);
}

/** How wide a square of the world each list of things holds: wider than the widest thing (a castle)
 *  and your body together, so the squares next to a point hold everything that can reach it. */
const BUCKET = 2;
const bucket = (i: number, j: number) => i * 100_003 + j;

/** The things on open ground you walk round rather than through: trees, rocks, barrels, houses, each
 *  a circle on the ground, which your body keeps clear of. */
export class Blocks {
  private at = new Map<number, { x: number; z: number; r: number }[]>();
  /** Every thing, at (x, z), `r` across from its middle to its edge. */
  set(list: Iterable<{ x: number; z: number; r: number }>): void {
    this.at.clear();
    for (const b of list) {
      const k = bucket(Math.floor(b.x / BUCKET), Math.floor(b.z / BUCKET));
      const l = this.at.get(k);
      if (l) l.push({ x: b.x, z: b.z, r: b.r }); else this.at.set(k, [{ x: b.x, z: b.z, r: b.r }]);
    }
  }
  /** Whether nothing stops you at (x, z), coming from (fromX, fromZ) when those are given. */
  clear(x: number, z: number, fromX?: number, fromZ?: number): boolean {
    // Asked a few times a frame while you walk: the nine squares round the point, nothing made new.
    const i0 = Math.floor(x / BUCKET), j0 = Math.floor(z / BUCKET);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const l = this.at.get(bucket(i, j));
      if (!l) continue;
      for (const b of l) if (into(x, z, b.x, b.z, b.r + BODY, fromX, fromZ)) return false;
    }
    return true;
  }
}

export class Walker {
  x = 0; z = 0; heading = 0;
  moving = false;
  running = false;
  /** Seeing through your own eyes: you walk at a calmer pace, and ← and → turn you rather than step aside. */
  eyes = false;
  private held = new Set<string>();
  /** How fast you go now, which way over the ground, and how fast you turn. */
  private speed = 0;
  private dx = 0;
  private dz = 0;
  private spin = 0;

  constructor(public who: Who = "rogue") {}

  place(x: number, z: number): void { this.x = x; this.z = z; }

  /** A key went down or up; true when it is one that walks or turns. */
  press(key: string, down: boolean, shift = false): boolean {
    const k = key.toLowerCase();
    this.running = shift;
    if (!(k in KEYS)) return false;
    if (down) this.held.add(k); else this.held.delete(k);
    return true;
  }
  /** Lets go of everything, as when the window loses the keyboard: you stop where you are. */
  release(): void { this.held.clear(); this.moving = false; this.speed = 0; this.spin = 0; }
  /** Whether a key is held, or you are still coming to a stop. */
  get active(): boolean { return this.held.size > 0 || this.speed > 0 || this.spin !== 0; }

  /** How far ← and → turn you this frame, `dt` seconds on, in radians (right +): through your eyes
   *  only, coming up to speed and slowing to a stop rather than all at once. */
  turn(dt: number): number {
    let want = 0;
    if (this.eyes) for (const k of this.held) want += TURNS[k] ?? 0;
    want = Math.sign(want) * TURN;
    this.spin = toward(this.spin, want, (TURN / TURN_RAMP) * dt);
    return this.spin * dt;
  }

  /** One step: along the camera's `yaw`, sliding along a coast rather than stopping at it. You come up
   *  to pace, and to a stop, over a moment rather than at once. */
  step(dt: number, yaw: number, ground: Ground): boolean {
    let f = 0, r = 0;
    for (const k of this.held) {
      if (this.eyes && k in TURNS) continue;
      f += KEYS[k]![0]; r += KEYS[k]![1];
    }
    const len = Math.hypot(f, r);
    // The camera looks along (-cos yaw, -sin yaw); its right is (sin yaw, -cos yaw).
    if (len) { this.dx = (-Math.cos(yaw) * f + Math.sin(yaw) * r) / len; this.dz = (-Math.sin(yaw) * f - Math.cos(yaw) * r) / len; }
    const pace = (this.running ? RUN : WALK) * (this.eyes ? CALM : 1);
    this.speed = toward(this.speed, len ? pace : 0, (Math.max(pace, this.speed) / RAMP) * dt);
    if (!this.speed) { this.moving = false; return false; }
    const dx = this.dx, dz = this.dz, s = this.speed * dt;
    const nx = this.x + dx * s, nz = this.z + dz * s, x = this.x, z = this.z;
    if (ground.stand(nx, nz, x, z)) { this.x = nx; this.z = nz; }
    // Into another worker: you stop, facing it, rather than slide along or round it as along a coast
    // or round a tree.
    else if (ground.meets?.(nx, nz)) { /* stopped */ }
    else if (ground.stand(nx, z, x, z)) this.x = nx;
    else if (ground.stand(x, nz, x, z)) this.z = nz;
    // Square against something round (a tree, a house): round its side instead.
    else for (let side = 1; side >= -1; side -= 2) {
      const sx = x - dz * s * side, sz = z + dx * s * side;
      if (ground.stand(sx, sz, x, z)) { this.x = sx; this.z = sz; break; }
    }
    this.heading = Math.atan2(dx, dz);
    // Pushing against something that does not give, you stand: no walk, no head rising and falling.
    this.moving = this.x !== x || this.z !== z;
    return this.moving;
  }
  /** Through your own eyes your body turns with your head: you face where the camera looks along `yaw`. */
  face(yaw: number): void { this.heading = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)); }

  /** The agent near enough to talk to, the nearest; null when none is. Through your own eyes, the one
   *  you face first: an agent beside you counts as twice as far as it is, one behind you three times. */
  nearest(agents: Iterable<{ tileId: string; x: number; z: number }>): string | null {
    let best: string | null = null, bd = Infinity;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const a of agents) {
      const dx = a.x - this.x, dz = a.z - this.z, d = Math.hypot(dx, dz);
      if (d >= TALK) continue;
      const far = this.eyes && d > 0 ? d * (2 - (dx * fx + dz * fz) / d) : d;
      if (far < bd) { bd = far; best = a.tileId; }
    }
    return best;
  }
}

/** Where another worker at (x, z), walking `by` toward (tx, tz), gets to while you stand at (meX, meZ),
 *  into `out`: never nearer your middle than `room`. One that would come nearer walks round you, the
 *  way its goal lies; one going somewhere inside your room waits at its edge, and so does one already
 *  inside it (it stood there when you came), which comes no nearer. */
export function giveWay(x: number, z: number, tx: number, tz: number, by: number, meX: number, meZ: number, room: number, out: { x: number; z: number }): void {
  const dx = tx - x, dz = tz - z, len = Math.hypot(dx, dz), k = len > by ? by / len : 1;
  out.x = x + dx * k; out.z = z + dz * k;
  const ox = x - meX, oz = z - meZ, od = Math.hypot(ox, oz), nd = Math.hypot(out.x - meX, out.z - meZ);
  if (nd >= room || nd >= od) return;
  if (od < room || Math.hypot(tx - meX, tz - meZ) < room) { out.x = x; out.z = z; return; }
  // Round you, as far as it would have walked, at the distance it stands.
  const a = ((ox * dz - oz * dx >= 0 ? 1 : -1) * by) / od, c = Math.cos(a), s = Math.sin(a);
  out.x = meX + ox * c - oz * s; out.z = meZ + ox * s + oz * c;
}

/** A point within `room` of you at (meX, meZ) moved out to its edge, straight away from your middle,
 *  into `out`; anywhere else, where it is. */
export function aside(x: number, z: number, meX: number, meZ: number, room: number, out: { x: number; z: number }): void {
  const ox = x - meX, oz = z - meZ, d = Math.hypot(ox, oz);
  if (d >= room || d < 1e-6) { out.x = x; out.z = z; return; }
  out.x = meX + (ox / d) * room; out.z = meZ + (oz / d) * room;
}

/** `v` moved toward `to` by at most `by`. */
const toward = (v: number, to: number, by: number) => (v < to ? Math.min(to, v + by) : Math.max(to, v - by));
