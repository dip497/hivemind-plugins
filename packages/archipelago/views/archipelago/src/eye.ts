// How you see the islands while you walk them: through your own worker's eyes (first person), or
// from behind and above it (third person, the model-town look). Where your eyes are, which way they
// look, how wide they see and the change from one view to the other are worked out here; the scene
// sets its camera from them. V, the switch by the walking line, and the walk command change it.

export type Pov = "first" | "third";
export const POVS: readonly Pov[] = ["first", "third"];
/** The view a saved layout or a command asks for; anything else, an older layout's nothing included, is third person. */
export const povOf = (v: unknown): Pov => (v === "first" ? "first" : "third");

/** Where your eyes are, as a share of your worker's height above the ground under it: where these
 *  big-headed models have their faces, so roofs rise above you and you meet other workers' eyes. */
const EYES = 0.75;
/** How far up or down you can look through them: about 60 degrees each way. */
const LOOK = Math.PI / 3;
/** Where you look when you first see through them: a little below level, at the ground ahead. */
export const LEVEL = -0.1;
/** How wide you see, in degrees up and down: from above, narrow for the model-town look; through your
 *  eyes, as a person does, 60, and never more than 100 across, where a wide window would stretch the
 *  edges of the picture. */
export const FOV = { third: 32, first: 60, across: 100 } as const;
/** How near the camera draws: through your eyes, close enough that a wall or a tree at your body's
 *  width (BODY, 0.22) is not cut open, even in the corners of a wide picture drawn off centre beside a
 *  docked terminal (up to about 2.1 times as far out as straight ahead); no closer, which would only
 *  make the depth coarser. */
export const NEAR: Readonly<Record<Pov, number>> = { first: 0.1, third: 0.5 };
/** How long the change from one view to the other takes, in seconds, and coming down into your eyes
 *  from high above (more than HIGH up), where a drop that fast is a fall. */
const CHANGE = 0.4, LANDING = 0.8, HIGH = 20;
/** How fast your look comes back to level as you walk on, in radians a second. */
const SETTLE = 1;
/** How far your head rises and falls as you walk and as you run: very little. */
const BOB = { walk: 0.012, run: 0.018 };
/** How quickly your eyes follow the ground under you as it rises and falls, a second: within about a
 *  tenth of a second, so a step up is a slope, not a jolt. */
const RIDE = 12;

/** How wide you see through your eyes, in degrees up and down, in a window `aspect` times as wide as tall. */
function firstFov(aspect: number): number {
  const across = (Math.atan(Math.tan((FOV.across * Math.PI) / 360) / Math.max(aspect, 0.01)) * 360) / Math.PI;
  return Math.min(FOV.first, across);
}

/** Something with a place to set, as a three.js vector has. */
interface Settable { set(x: number, y: number, z: number): unknown }

export class Eye {
  /** The view you asked for. It stays when you fly up, for the next time you walk. */
  pov: Pov = "third";
  /** How far up (+) or down (−) from level you look through your eyes, in radians. */
  pitch = LEVEL;
  /** On the way into your eyes, the share of a turn still to make that this frame makes: all of it
   *  by the frame the eyes arrive, so the view never goes on turning while you stand still. 0 otherwise. */
  share = 0;
  /** How far the camera has come from behind you (0) to your eyes (1). */
  private t = 0;
  /** How long the change under way takes. */
  private span = CHANGE;
  private bobAt = 0;
  private bobBy = 0;
  /** The ground your eyes ride over; none until you first see through them. */
  private floor = Number.NaN;

  /** Switches to the other view, and says which it is now. */
  toggle(): Pov { return (this.pov = this.pov === "first" ? "third" : "first"); }
  /** A drag through your eyes: look `d` radians further up (+) or down (−), never past LOOK. */
  look(d: number): void { this.pitch = Math.max(-LOOK, Math.min(LOOK, this.pitch + d)); }
  /** Walking on without dragging, `dt` seconds: your look comes back toward level (LEVEL), so a loose
   *  drag does not leave you walking with only the sky or your feet in view. */
  settle(dt: number): void { this.pitch += Math.max(-SETTLE * dt, Math.min(SETTLE * dt, LEVEL - this.pitch)); }
  /** You land on the islands from a camera `height` up: from high above, the change into your eyes
   *  takes longer. Your eyes start on the ground where you land. */
  land(height: number): void {
    this.span = height > HIGH ? LANDING : CHANGE;
    this.floor = Number.NaN;
  }

  /** One frame on, `dt` seconds: toward your eyes while you walk in first person, back behind you
   *  otherwise. At once with less motion. True while the change is under way. */
  step(dt: number, walking: boolean, reduced: boolean): boolean {
    const to = walking && this.pov === "first" ? 1 : 0, was = this.t;
    if (reduced) this.t = to;
    else if (this.t < to) this.t = Math.min(to, this.t + dt / this.span);
    else if (this.t > to) this.t = Math.max(to, this.t - dt / this.span);
    this.share = to === 1 && was < 1 ? Math.min(1, dt / ((1 - was) * this.span)) : 0;
    if (this.t === to) this.span = CHANGE;
    // All the way back behind you: next time, your eyes start on the ground where you stand.
    if (this.t === 0) this.floor = Number.NaN;
    return this.t !== to;
  }
  /** How far into first person the camera is, eased in and out: 0 behind you, 1 through your eyes. */
  get blend(): number { const t = this.t; return t * t * (3 - 2 * t); }
  /** Past halfway to your eyes: your own worker and its ring are not drawn, nor the model-town focus. */
  get inside(): boolean { return this.t > 0.5; }
  /** How wide the camera sees now, in degrees up and down, in a window `aspect` times as wide as tall. */
  fov(aspect: number): number { return FOV.third + (firstFov(aspect) - FOV.third) * this.blend; }
  /** How near it draws now: close as soon as it leaves for your eyes, until it is all the way back. */
  get near(): number { return this.t > 0 ? NEAR.first : NEAR.third; }
  /** How far the camera stands from the point it looks at, `dist` away from behind you: none through
   *  your eyes, which look from where they are. */
  away(dist: number): number { return dist * (1 - this.blend); }

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
  /** The ground your eyes stand on, `dt` seconds on, over `ground` under your feet: following it
   *  closely but smoothly, so the rise of a terrace, or the ground's heights kept to a tenth of a unit,
   *  never jolts the picture. Where your eyes first open, the ground itself. */
  ride(ground: number, dt: number): number {
    this.floor = Number.isNaN(this.floor) ? ground : this.floor + (ground - this.floor) * (1 - Math.exp(-dt * RIDE));
    return this.floor;
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
