// How you see the islands while you walk them: through your own worker's eyes (first person), or
// from behind and above it (third person, the model-town look). Where your eyes are, which way they
// look, how wide they see and the change from one view to the other are worked out here; the scene
// sets its camera from them. V, the switch by the walking line, and the walk command change it.

export type Pov = "first" | "third";
export const POVS: readonly Pov[] = ["first", "third"];
/** The view a saved layout or a command asks for; anything else, an older layout's nothing included, is third person. */
export const povOf = (v: unknown): Pov => (v === "first" ? "first" : "third");

/** Where your eyes are, as a share of your worker's height above the ground under it. */
export const EYES = 0.92;
/** How far up or down you can look through them: about 60 degrees each way. */
export const LOOK = Math.PI / 3;
/** Where you look when you first see through them: a little below level, at the ground ahead. */
export const LEVEL = -0.1;
/** How wide you see, in degrees: through your eyes as a person does, and narrow from above for the model-town look. */
export const FOV: Readonly<Record<Pov, number>> = { first: 70, third: 32 };
/** How near the camera draws: close through your eyes, so a wall beside you is not cut open. */
export const NEAR: Readonly<Record<Pov, number>> = { first: 0.05, third: 0.5 };
/** How long the change from one view to the other takes, in seconds. */
export const CHANGE = 0.4;
/** How far your head rises and falls as you walk and as you run: very little. */
const BOB = { walk: 0.012, run: 0.018 };

/** Something with a place to set, as a three.js vector has. */
interface Settable { set(x: number, y: number, z: number): unknown }

export class Eye {
  /** The view you asked for. It stays when you fly up, for the next time you walk. */
  pov: Pov = "third";
  /** How far up (+) or down (−) from level you look through your eyes, in radians. */
  pitch = LEVEL;
  /** How far the camera has come from behind you (0) to your eyes (1). */
  private t = 0;
  private bobAt = 0;
  private bobBy = 0;

  /** Switches to the other view, and says which it is now. */
  toggle(): Pov { return (this.pov = this.pov === "first" ? "third" : "first"); }
  /** A drag through your eyes: look `d` radians further up (+) or down (−), never past LOOK. */
  look(d: number): void { this.pitch = Math.max(-LOOK, Math.min(LOOK, this.pitch + d)); }

  /** One frame on, `dt` seconds: toward your eyes while you walk in first person, back behind you
   *  otherwise. At once with less motion. True while the change is under way. */
  step(dt: number, walking: boolean, reduced: boolean): boolean {
    const to = walking && this.pov === "first" ? 1 : 0;
    if (reduced) this.t = to;
    else if (this.t < to) this.t = Math.min(to, this.t + dt / CHANGE);
    else if (this.t > to) this.t = Math.max(to, this.t - dt / CHANGE);
    return this.t !== to;
  }
  /** How far into first person the camera is, eased in and out: 0 behind you, 1 through your eyes. */
  get blend(): number { const t = this.t; return t * t * (3 - 2 * t); }
  /** Past halfway to your eyes: your own worker and its ring are not drawn, nor the model-town focus. */
  get inside(): boolean { return this.t > 0.5; }
  /** How wide the camera sees now, in degrees. */
  get fov(): number { return FOV.third + (FOV.first - FOV.third) * this.blend; }
  /** How near it draws now: close as soon as it leaves for your eyes, until it is all the way back. */
  get near(): number { return this.t > 0 ? NEAR.first : NEAR.third; }

  /** How far your head is up (+) or down (−) of where it rests, `dt` seconds on: a small rise and fall
   *  with each step while you walk, faster and a little more as you run, settling when you stop. None
   *  with less motion. */
  bob(dt: number, moving: boolean, running: boolean, reduced: boolean): number {
    if (reduced) { this.bobBy = 0; return 0; }
    const want = moving ? (running ? BOB.run : BOB.walk) : 0;
    this.bobBy += (want - this.bobBy) * Math.min(1, dt * 8);
    if (moving) this.bobAt = (this.bobAt + dt * (running ? 15 : 11)) % (Math.PI * 2);
    return this.bobBy * Math.sin(this.bobAt);
  }

  /** Your eyes, standing at (x, z) on ground `ground` as a worker `height` tall, and the point a unit
   *  ahead that they look at: along the camera's yaw, (−cos yaw, −sin yaw), the way W walks, tipped by
   *  `pitch`. `lift` raises them (the head's bob). Written into `eye` and `at`, so a frame makes nothing new. */
  pose(x: number, z: number, ground: number, height: number, yaw: number, eye: Settable, at: Settable, lift = 0): void {
    const y = ground + height * EYES + lift, flat = Math.cos(this.pitch);
    eye.set(x, y, z);
    at.set(x - Math.cos(yaw) * flat, y + Math.sin(this.pitch), z - Math.sin(yaw) * flat);
  }
}
