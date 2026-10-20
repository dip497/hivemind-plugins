// You, walking the islands: a worker of your own that the arrow keys or WASD move, the way the
// camera faces, over land and bridges but never into the sea or through a castle wall. Shift runs.
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

export interface Ground { stand(x: number, z: number): boolean }

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
    const nx = this.x + dx * s, nz = this.z + dz * s;
    if (ground.stand(nx, nz)) { this.x = nx; this.z = nz; }
    else if (ground.stand(nx, this.z)) this.x = nx;
    else if (ground.stand(this.x, nz)) this.z = nz;
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
