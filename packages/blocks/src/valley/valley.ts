/**
 * Block Valley's life, apart from any canvas: the land (terrain.ts) seen from a camera gliding
 * slowly round the valley, looking across it to the peaks on the far side; clouds of blocks
 * drifting over; birds circling in small flocks, flapping and gliding.
 *
 * The pointer tilts the camera gently toward it. A click on the land drops a block from the sky
 * there: it falls, bounces once and settles on top of the column (or of the blocks dropped there
 * before); past the cap, the block dropped longest ago sinks away. A click on the sky puffs out a
 * small cloud there.
 */
import type { Sim } from "../scene";
import { clamp, pickOne, rand, randInt, TAU } from "../rng";
import { idx, inLand, makeLand, Mat, SIZE, SOURCE, VIEW_SIDE, type Land } from "./terrain";

export type Vec3 = [number, number, number];

export interface Camera {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  /** The vertical field of view, radians; the horizontal one follows the window's shape. */
  fovY: number;
  aspect: number;
}

export interface Drop {
  i: number;
  j: number;
  y: number;
  vy: number;
  /** Where it comes to rest: its bottom's height. */
  rest: number;
  mat: Mat;
  state: "falling" | "set" | "leaving";
  age: number;
  bounces: number;
}

export interface Cloud { x: number; y: number; z: number; shape: number; speed: number; puff: number }
/** A bird wheeling round a point ahead of the camera (`ahead` along its view, `side` across it,
 *  `rise` over it), so the flocks are always out over the valley in sight, never at the lens. */
export interface Bird { flock: number; ahead: number; side: number; rise: number; r: number; a: number; speed: number; phase: number; rank: number }

/** How many dropped blocks stay; the one dropped longest ago sinks away past it. */
export const DROPS = 24;
export const PUFFS = 3;
export const PUFF_LIFE = 9;
const GRAVITY = 36;
/** One sweep of the camera across its side of the valley and back, in seconds. */
const LAP = 360;
/** How far round the valley it sweeps either way (radians), and how far out from the middle. */
const SWEEP = 0.75;
const ORBIT = SIZE * 0.36;
/** How far the pointer turns the camera (radians across the window, and up it). */
export const TILT = { yaw: 0.2, pitch: 0.12 };
const DROPPED: Mat[] = [Mat.Grass, Mat.Stone, Mat.Wood, Mat.Sand, Mat.Leaves, Mat.Dirt];

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class Valley implements Sim {
  width = 0;
  height = 0;
  dpr = 1;
  time = 0;
  land: Land = makeLand();
  /** How far through its sweep the camera is (radians of the clock's round), where round the
   *  valley that puts it, and how far the pointer has turned it. */
  phase = 0;
  angle = VIEW_SIDE;
  tilt = { yaw: 0, pitch: 0 };
  private eyeY = 0;
  camera: Camera = { eye: [0, 0, 0], forward: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], fovY: 0.9, aspect: 1.6 };
  drops: Drop[] = [];
  clouds: Cloud[] = [];
  birds: Bird[] = [];
  pointer = { x: 0, y: 0, active: false };

  resize(width: number, height: number, dpr = 1) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.camera.aspect = width / Math.max(1, height);
    if (first) this.aim(0, true);
    this.stock();
  }

  /** Clouds and birds for the window: more on a bigger one, spread over the valley. */
  private stock() {
    const area = this.width * this.height;
    const clouds = clamp(Math.round(area / 150_000), 5, 14);
    const keep = this.clouds.filter((c) => c.puff < 0);
    for (let k = keep.length; k < clouds; k++) {
      keep.push({ x: ((k + rand(0.1, 0.9)) / clouds) * (SIZE + 60) - 30, y: rand(36, 44), z: rand(-10, SIZE + 10), shape: randInt(0, 3), speed: rand(0.5, 1.1), puff: -1 });
    }
    this.clouds = [...keep.slice(0, clouds), ...this.clouds.filter((c) => c.puff >= 0)];
    const flocks = clamp(Math.round(area / 330_000), 2, 6);
    const have = new Set(this.birds.map((b) => b.flock)).size;
    if (have > flocks) this.birds = this.birds.filter((b) => b.flock < flocks);
    for (let f = have; f < flocks; f++) {
      const ahead = rand(30, 46);
      // Spread across the view: never further out to the side than ahead.
      const side = ((f + 0.5) / flocks - 0.5) * ahead * 1.1;
      const rise = rand(2, 7);
      const r = rand(3, 6);
      const speed = (Math.random() < 0.5 ? 1 : -1) * rand(0.25, 0.4);
      const a = rand(0, TAU);
      const n = randInt(3, 5);
      for (let b = 0; b < n; b++) this.birds.push({ flock: f, ahead, side, rise, r, a, speed, phase: rand(0, TAU), rank: b });
    }
  }

  // ── the camera ───────────────────────────────────────────────────────────

  /** The land's height at a column (the water's surface where there is water), with the blocks
   *  dropped on it (falling to it or set). */
  topAt(i: number, j: number) {
    if (!inLand(i, j)) return 0;
    let h = Math.max(this.land.height[idx(i, j)]!, this.land.water[idx(i, j)]!);
    for (const d of this.drops) if (d.i === i && d.j === j && d.state !== "leaving") h++;
    return h;
  }

  /** Put the camera where the clock has it: sweeping slowly to and fro across its side of the
   *  valley, eased up over the land under it, looking across the lake and the village to the
   *  river winding back between the peaks, turned toward the pointer. */
  private aim(dt: number, now = false) {
    const c = SIZE / 2;
    this.angle = VIEW_SIDE + Math.sin(this.phase) * SWEEP;
    const eye: Vec3 = [c + Math.cos(this.angle) * ORBIT, 0, c + Math.sin(this.angle) * ORBIT];
    let ground = 0;
    for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) ground = Math.max(ground, this.land.height[idx(clamp(Math.floor(eye[0]) + a, 0, SIZE - 1), clamp(Math.floor(eye[2]) + b, 0, SIZE - 1))]!);
    const want = Math.max(ground + 10, 22);
    this.eyeY = now ? want : this.eyeY + (want - this.eyeY) * Math.min(1, dt * 0.5);
    eye[1] = this.eyeY;
    // At a point between the lake's middle and where the river comes in, a little above the land.
    const at = { x: c + (SOURCE.x - c) * 0.3, z: c + (SOURCE.z - c) * 0.3 };
    const far = Math.hypot(at.x - eye[0], at.z - eye[2]);
    // A little to the left of it, so the river leads in from right of the middle.
    const yaw = Math.atan2(at.z - eye[2], at.x - eye[0]) - 0.07 + this.tilt.yaw;
    const pitch = Math.atan2(7 - eye[1], far) + 0.17 + this.tilt.pitch;
    const forward = norm([Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)]);
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    this.camera = { ...this.camera, eye, forward, right, up };
  }

  /** The line of sight through a point of the window (CSS px). */
  ray(px: number, py: number): Vec3 {
    const { forward: f, right: r, up: u, fovY, aspect } = this.camera;
    const t = Math.tan(fovY / 2);
    const nx = ((2 * px) / Math.max(1, this.width) - 1) * t * aspect;
    const ny = (1 - (2 * py) / Math.max(1, this.height)) * t;
    return norm([f[0] + r[0] * nx + u[0] * ny, f[1] + r[1] * nx + u[1] * ny, f[2] + r[2] * nx + u[2] * ny]);
  }

  /** Where a point of the world shows in the window (CSS px), or null behind the camera. */
  project(p: Vec3): { x: number; y: number } | null {
    const { eye, forward: f, right: r, up: u, fovY, aspect } = this.camera;
    const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (z <= 0.01) return null;
    const t = Math.tan(fovY / 2);
    const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z / (t * aspect);
    const y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / z / t;
    return { x: ((x + 1) / 2) * this.width, y: ((1 - y) / 2) * this.height };
  }

  /** The column the line of sight through a point of the window meets first, or null for sky. */
  columnAt(px: number, py: number): { i: number; j: number } | null {
    const dir = this.ray(px, py);
    const e = this.camera.eye;
    for (let t = 0.5; t < 260; t += 0.2) {
      const x = e[0] + dir[0] * t;
      const y = e[1] + dir[1] * t;
      const z = e[2] + dir[2] * t;
      if (y < 0) return null;
      const i = Math.floor(x);
      const j = Math.floor(z);
      if (!inLand(i, j)) {
        if (x < -20 || z < -20 || x > SIZE + 20 || z > SIZE + 20) return null;
        continue;
      }
      if (y <= this.topAt(i, j)) return { i, j };
    }
    return null;
  }

  // ── the pointer and clicks ──────────────────────────────────────────────

  point(x: number, y: number, active: boolean) {
    this.pointer = { x, y, active };
  }

  splash(px: number, py: number) {
    const hit = this.columnAt(px, py);
    if (!hit) {
      // The sky: a small cloud puffs out there.
      const dir = this.ray(px, py);
      const e = this.camera.eye;
      const t = 40;
      this.clouds.push({ x: e[0] + dir[0] * t - 2, y: e[1] + dir[1] * t, z: e[2] + dir[2] * t - 1.5, shape: 4, speed: 0.8, puff: 0 });
      const puffs = this.clouds.filter((c) => c.puff >= 0);
      if (puffs.length > PUFFS) this.clouds.splice(this.clouds.indexOf(puffs[0]!), 1);
      return;
    }
    const rest = this.topAt(hit.i, hit.j);
    this.drops.push({ i: hit.i, j: hit.j, y: rest + 30, vy: -4, rest, mat: pickOne(DROPPED), state: "falling", age: 0, bounces: 0 });
    const kept = this.drops.filter((d) => d.state !== "leaving");
    if (kept.length > DROPS) this.sink(kept[0]!);
  }

  /** Sink a dropped block away; those dropped on top of it settle down a block. */
  private sink(d: Drop) {
    d.state = "leaving";
    d.age = 0;
    for (const o of this.drops) {
      if (o === d || o.state === "leaving" || o.i !== d.i || o.j !== d.j || o.rest < d.rest) continue;
      o.rest -= 1;
      if (o.state === "set") { o.state = "falling"; o.vy = 0; o.bounces = 1; }
    }
  }

  // ── a step ───────────────────────────────────────────────────────────────

  step(dt: number) {
    this.time += dt;
    this.phase += (TAU / LAP) * dt;
    // Toward the pointer while it rests on the window, back to straight when it goes.
    const want = this.pointer.active
      ? { yaw: (this.pointer.x / Math.max(1, this.width) - 0.5) * TILT.yaw, pitch: -(this.pointer.y / Math.max(1, this.height) - 0.5) * TILT.pitch }
      : { yaw: 0, pitch: 0 };
    const k = Math.min(1, dt * 1.6);
    this.tilt.yaw += (want.yaw - this.tilt.yaw) * k;
    this.tilt.pitch += (want.pitch - this.tilt.pitch) * k;
    this.aim(dt);
    for (const d of this.drops) {
      d.age += dt;
      if (d.state === "falling") {
        d.vy -= GRAVITY * dt;
        d.y += d.vy * dt;
        if (d.y <= d.rest) {
          d.y = d.rest;
          if (d.bounces < 1 && d.vy < -4) {
            d.vy = -d.vy * 0.22;
            d.bounces++;
          } else {
            d.state = "set";
            d.vy = 0;
          }
        }
      } else if (d.state === "leaving") d.y -= dt * 1.4;
    }
    this.drops = this.drops.filter((d) => d.state !== "leaving" || d.age < 0.8);
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.puff >= 0) c.puff += dt;
      else if (c.x > SIZE + 40) c.x = -40;
    }
    this.clouds = this.clouds.filter((c) => c.puff < PUFF_LIFE);
    for (const b of this.birds) b.a += b.speed * dt;
  }

  /** Where a bird is, the way it flies, and how its wings are (-1 down to 1 up). */
  birdAt(b: Bird): { x: number; y: number; z: number; heading: number; wing: number } {
    const { eye, forward: f } = this.camera;
    const len = Math.hypot(f[0], f[2]) || 1;
    const fx = f[0] / len;
    const fz = f[2] / len;
    const cx = eye[0] + fx * b.ahead - fz * b.side;
    const cz = eye[2] + fz * b.ahead + fx * b.side;
    // The flock flies in a V: its leader on the round, each other bird a place behind and to one
    // side of the one before.
    const heading = b.a + (b.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
    const row = Math.ceil(b.rank / 2);
    const across = (b.rank % 2 ? 1 : -1) * row * 0.75;
    const x = cx + Math.cos(b.a) * b.r - Math.cos(heading) * row * 0.9 - Math.sin(heading) * across;
    const z = cz + Math.sin(b.a) * b.r - Math.sin(heading) * row * 0.9 + Math.cos(heading) * across;
    // A few beats, then a glide.
    const beat = (this.time * 0.55 + b.phase) % 3;
    const wing = beat < 1.2 ? Math.sin(beat * TAU * 2.4) : 0.15;
    return { x, y: eye[1] + b.rise + row * 0.12 + Math.sin(this.time * 0.7 + b.phase) * 0.15, z, heading, wing };
  }
}
