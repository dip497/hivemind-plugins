// Types for pose.js.
import type { PupModel } from "./model";

export interface Motion {
  t: number; speed?: number; phase?: number; wag?: number; paddle?: number; shake?: number; splay?: number;
  look?: [number, number] | null; tilt?: number; ears?: number; hang?: number; vy?: number; pant?: number; stiffness?: number;
}
export class Animator {
  constructor(pup: PupModel);
  crouch: { x: number; v: number };
  land(strength: number): void;
  kickEars(roll: number, fold: number): void;
  update(dt: number, pose: string, m: Motion): void;
}
