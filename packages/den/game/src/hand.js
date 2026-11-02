// Your hand: press a pup and move to pick it up by the scruff, drag to carry it, let go to
// throw it with the speed your pointer had. Rub it instead to pet it; tap it to boop its
// nose. Pressing anywhere else opens the hand, and a falling pup that comes within reach of
// an open hand is caught.
import * as THREE from 'three';
import { COM } from '../../pup/mount.js';
import { CLEARING } from './world.js';

const ray = new THREE.Raycaster();
const plane = new THREE.Plane();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();

export class Hand {
  constructor(canvas, camera, pup, voice, events) {
    this.canvas = canvas;
    this.camera = camera;
    this.pup = pup;
    this.voice = voice;
    this.events = events;
    this.down = false;
    this.holding = false;
    this.open = false;
    this.screen = { x: -1e4, y: -1e4 };
    this.touch = false;
    this.world = new THREE.Vector3();
    this.samples = [];
    this.vel = new THREE.Vector3();
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', () => { if (!this.down) this.screen = { x: -1e4, y: -1e4 }; });
  }

  // Where the pointer is on the upright plane through the pup, facing the camera.
  project(x, y) {
    const r = this.canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    const n = tmp.copy(this.camera.position).sub(this.planeAt ?? this.pup.p);
    n.y = 0;
    n.normalize();
    plane.setFromNormalAndCoplanarPoint(n, this.planeAt ?? this.pup.p);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  // The pup's centre and size on screen, in CSS pixels.
  pupOnScreen() {
    const r = this.canvas.getBoundingClientRect();
    const c = this.pup.p.clone().project(this.camera);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const e = this.pup.p.clone().addScaledVector(right, 0.42).project(this.camera);
    const x = (c.x * 0.5 + 0.5) * r.width + r.left, y = (-c.y * 0.5 + 0.5) * r.height + r.top;
    const ex = (e.x * 0.5 + 0.5) * r.width + r.left;
    return { x, y, r: Math.abs(ex - x) };
  }

  near(extra) {
    const s = this.pupOnScreen();
    return Math.hypot(this.screen.x - s.x, this.screen.y - s.y) < s.r * 1.05 + extra;
  }

  onDown(e) {
    this.voice.unlock();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.down = true;
    this.touch = e.pointerType !== 'mouse';
    this.screen = { x: e.clientX, y: e.clientY };
    this.samples = [];
    this.planeAt = null;
    if (this.pup.grabbable() && this.near(this.touch ? 28 : 10)) {
      // A pup in the air is caught at once; one on the ground waits to see what you mean.
      if (this.pup.state === 'air') this.grab();
      else this.pending = { t0: performance.now(), x0: e.clientX, y0: e.clientY, path: 0, lx: e.clientX, ly: e.clientY, petted: false };
    } else this.open = true;
    e.preventDefault();
  }

  // `press`: where and when the press began, so a quick flick counts from there.
  grab(press = null) {
    this.planeAt = this.pup.p.clone();
    const at = this.project(this.screen.x, this.screen.y) ?? this.pup.p.clone();
    this.clampHold(at);
    this.holding = true;
    this.open = false;
    this.samples = [{ t: performance.now(), p: at.clone() }];
    const from = press && this.project(press.x0, press.y0);
    if (from) { this.clampHold(from); this.samples.unshift({ t: press.t0, p: from }); }
    this.pup.grab(at);
    this.events.onGrab?.();
  }

  clampHold(at) {
    at.y = Math.max(at.y, COM.y + 0.62);
    at.y = Math.min(at.y, 4.5);
    const r = Math.hypot(at.x, at.z);
    if (r > CLEARING) { at.x *= CLEARING / r; at.z *= CLEARING / r; }
  }

  onMove(e) {
    const dx = e.clientX - this.screen.x, dy = e.clientY - this.screen.y;
    this.screen = { x: e.clientX, y: e.clientY };
    const pd = this.pending;
    if (pd) {
      pd.path += Math.hypot(e.clientX - pd.lx, e.clientY - pd.ly);
      pd.lx = e.clientX; pd.ly = e.clientY;
      const away = Math.hypot(e.clientX - pd.x0, e.clientY - pd.y0);
      // Lifting (up, or far) picks it up; rubbing back and forth on it pets it.
      if ((pd.y0 - e.clientY > 14 || away > 26) && !pd.petted) { this.pending = null; this.grab(pd); }
      else if (pd.path > 36 && this.near(16)) { pd.petted = true; this.pup.pet(); }
      if (!this.holding) return;
    }
    if (!this.down && !this.touch && this.near(4)) {
      // A mouse rubbing over the pup without pressing pets it too.
      this.rub = (this.rub || 0) + Math.hypot(dx, dy);
      if (this.rub > 60) this.pup.pet();
    }
    if (!this.holding) return;
    const at = this.project(e.clientX, e.clientY);
    if (!at) return;
    this.clampHold(at);
    const now = performance.now();
    this.samples.push({ t: now, p: at.clone() });
    while (this.samples.length > 2 && now - this.samples[0].t > 120) this.samples.shift();
    this.pup.moveHand(at, this.velocity(now));
  }

  velocity(now) {
    const s = this.samples.filter((q) => now - q.t <= 90);
    if (s.length < 2) return this.vel.set(0, 0, 0);
    const a = s[0], b = s[s.length - 1];
    const dt = Math.max(0.012, (b.t - a.t) / 1000);
    return this.vel.copy(b.p).sub(a.p).divideScalar(dt);
  }

  onUp(e, cancelled = false) {
    if (!this.down) return;
    this.down = false;
    this.open = false;
    const pd = this.pending;
    this.pending = null;
    if (pd && !pd.petted && !cancelled && performance.now() - pd.t0 < 350) this.pup.boop();
    if (this.holding) {
      this.holding = false;
      const v = cancelled ? new THREE.Vector3() : this.velocity(performance.now()).clone();
      this.pup.release(v);
      this.events.onRelease?.(v);
    }
    if (this.touch) this.screen = { x: -1e4, y: -1e4 };
  }

  // Each frame: catch a falling pup that reaches an open hand; tell the pup about hover.
  update() {
    this.rub = Math.max(0, (this.rub || 0) * 0.9);
    // Pressed and held still on the pup: pick it up after a moment.
    const pd = this.pending;
    if (pd && !pd.petted && performance.now() - pd.t0 > 380) { this.pending = null; this.grab(); }
    if (this.open && this.pup.state === 'air' && this.pup.v.y < 1 && this.near(this.touch ? 40 : 24)) {
      this.grab();
    }
    this.pup.hover = !this.down && !this.touch && this.near(30) ? 1 : 0;
    this.canvas.style.cursor = this.holding ? 'grabbing' : this.near(10) ? 'grab' : 'default';
  }

  pointerWorld() {
    if (this.screen.x < -1e3) return null;
    return this.project(this.screen.x, this.screen.y);
  }
}
