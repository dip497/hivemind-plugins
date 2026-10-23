// You, walking the islands: a worker of your own that the arrow keys or WASD move, the way the
// camera faces, over land and bridges but never into the sea, through a castle wall, a tree, a
// house or another worker. Shift runs.
// Which agent is close enough to talk to is worked out here; the scene draws you, the view acts.
import type { Who } from "./assets";

/** Keys that move you, and which way: forward, then right. */
const KEYS: Record<string, [number, number]> = {
  w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0],
  a: [0, -1], arrowleft: [0, -1], d: [0, 1], arrowright: [0, 1],
};
/** Walking and running pace, in world units a second (a tile is about two across). */
const WALK = 2.4, RUN = 4.6;
/** How near an agent has to be to talk to it. */
export const TALK = 1.5;
export const WHO: Who[] = ["rogue", "knight", "mage", "barbarian"];

/** Where you can go: `stand` says whether (x, z) is somewhere to stand, given that you step there from
 *  (fromX, fromZ) when those are given. */
export interface Ground { stand(x: number, z: number, fromX?: number, fromZ?: number): boolean }

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
  private held = new Set<string>();

  constructor(public who: Who = "rogue") {}

  place(x: number, z: number): void { this.x = x; this.z = z; }

  /** A key went down or up; true when it is one that walks. */
  press(key: string, down: boolean, shift = false): boolean {
    const k = key.toLowerCase();
    this.running = shift;
    if (!(k in KEYS)) return false;
    if (down) this.held.add(k); else this.held.delete(k);
    return true;
  }
  /** Lets go of everything, as when the window loses the keyboard. */
  release(): void { this.held.clear(); this.moving = false; }
  get active(): boolean { return this.held.size > 0; }

  /** One step: along the camera's `yaw`, sliding along a coast rather than stopping at it. */
  step(dt: number, yaw: number, ground: Ground): boolean {
    let f = 0, r = 0;
    for (const k of this.held) { f += KEYS[k]![0]; r += KEYS[k]![1]; }
    const len = Math.hypot(f, r);
    if (!len) { this.moving = false; return false; }
    // The camera looks along (-cos yaw, -sin yaw); its right is (sin yaw, -cos yaw).
    const dx = (-Math.cos(yaw) * f + Math.sin(yaw) * r) / len, dz = (-Math.sin(yaw) * f - Math.cos(yaw) * r) / len;
    const s = (this.running ? RUN : WALK) * dt;
    const nx = this.x + dx * s, nz = this.z + dz * s, x = this.x, z = this.z;
    if (ground.stand(nx, nz, x, z)) { this.x = nx; this.z = nz; }
    else if (ground.stand(nx, z, x, z)) this.x = nx;
    else if (ground.stand(x, nz, x, z)) this.z = nz;
    // Square against something round (a tree, a house): round its side instead.
    else for (let side = 1; side >= -1; side -= 2) {
      const sx = x - dz * s * side, sz = z + dx * s * side;
      if (ground.stand(sx, sz, x, z)) { this.x = sx; this.z = sz; break; }
    }
    this.heading = Math.atan2(dx, dz);
    this.moving = true;
    return true;
  }

  /** The agent near enough to talk to, the nearest first; null when none is. */
  nearest(agents: Iterable<{ tileId: string; x: number; z: number }>): string | null {
    let best: string | null = null, bd = TALK;
    for (const a of agents) {
      const d = Math.hypot(a.x - this.x, a.z - this.z);
      if (d < bd) { bd = d; best = a.tileId; }
    }
    return best;
  }
}
