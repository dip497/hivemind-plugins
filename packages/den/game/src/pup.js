// One pup in the game: where it is, what it is doing, and how it moves and sounds.
// The hand calls grab / moveHand / release; everything else the pup decides for itself.
import * as THREE from 'three';
import { buildPup } from '../../pup/model.js';
import { mountPup, COM, SCRUFF } from '../../pup/mount.js';
import { makeFace, updateFace } from '../../pup/face.js';
import { Animator } from '../../pup/pose.js';
import { CLEARING } from './world.js';

const TAU = Math.PI * 2;
const HOME = new THREE.Vector3(0, 0, 1.25);
const HEAD = new THREE.Vector3(0.3, 0.66, 0);
const UNIT_M = 0.55; // one world unit in metres, for the height readout (the pup is ~0.5 m long)
const SCRUFF_LEN = COM.distanceTo(SCRUFF); // pendulum length while dangling
const BODY = 0.16; // how far the pup's body reaches sideways, for bumping into things
const STEP = 0.14; // the most it walks up without jumping

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const upright = (a) => Math.round(a / TAU) * TAU;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (k) => k * k * (3 - 2 * k);

export class Pup {
  constructor({ coat, shells, step, voice, tune, events, solid }) {
    this.model = buildPup({ coat, shells, step });
    this.mount = mountPup(this.model);
    this.object = this.mount.holder;
    this.face = makeFace(this.model);
    this.anim = new Animator(this.model);
    this.voice = voice;
    this.tune = tune;
    this.events = events;
    this.solid = solid;

    this.p = new THREE.Vector3(0.4, COM.y, 0.9);
    this.v = new THREE.Vector3();
    this.vPrev = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.yaw = -1.1;
    this.yawTarget = this.yaw;
    this.yawRate = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.squash = 0;
    this.squashVel = 0;
    this.hopY = 0;
    this.hopVy = 0;
    this.floor = 0; // height of what the pup stands on
    this.phase = 0;
    this.lastPatter = 0;
    this.state = 'sit';
    this.stateT = 0;
    this.next = 4;
    this.hand = new THREE.Vector3();
    this.handVel = new THREE.Vector3();
    this.handVelS = new THREE.Vector3();
    this.handVelPrev = new THREE.Vector3();
    this.swing = 0; // pendulum angle under the hand, in the screen plane
    this.swingVel = 0;
    this.hang = 0;
    this.face_ = 1; // which way it faces while dangling: 1 right, -1 left
    this.faceT = 0;
    this.still = 0;
    this.pick = 1;
    this.pickFrom = new THREE.Vector3();
    this.hover = 0;
    this.look = [{ x: 0, v: 0 }, { x: 0, v: 0 }];
    this.focus = null;
    this.focusUntil = 0;
    this.mouth = { amt: 0, until: 0, flutter: false };
    this.flight = null;
    this.scared = 0;
    this.lid = 0;
    this.t = 0;
    this.target = new THREE.Vector3();
    this.after = null;
  }

  // --- Called by the hand -------------------------------------------------------------

  grabbable() {
    return this.state !== 'held';
  }

  grab(at) {
    const fromAir = this.state === 'air';
    this.hand.copy(at);
    this.handVel.set(0, 0, 0);
    this.handVelS.set(0, 0, 0);
    this.handVelPrev.set(0, 0, 0);
    // A pup caught mid-tumble keeps a little of its spin as a swing.
    this.swing = fromAir ? clamp(wrap(this.pitch) * 0.5, -0.6, 0.6) : 0;
    this.swingVel = fromAir ? clamp(this.pitchVel * 0.3, -3, 3) : 0;
    this.face_ = Math.cos(this.yaw) >= 0 ? 1 : -1;
    this.hang = fromAir ? 0.5 : 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.pick = 0;
    this.pickFrom.copy(this.p);
    this.still = 0;
    this.voice.squealStop();
    if (fromAir) {
      this.say(this.voice.giggle());
      this.events.onCatch?.(this.heightNow());
    } else {
      this.say(this.voice.eep());
    }
    this.go('held');
  }

  moveHand(at, vel) {
    this.hand.copy(at);
    this.handVel.copy(vel);
  }

  release(vel) {
    const v = vel.clone().multiplyScalar(this.tune.throw);
    const max = 15;
    if (v.length() > max) v.setLength(max);
    this.v.copy(v);
    const s = this.screenSign();
    this.pitch = this.hang + this.swing * s;
    // Spin: what the swing already had, plus a flip from throwing sideways.
    this.pitchVel = clamp(this.swingVel * s * 0.4 - v.x * 0.55 * this.face_ + rand(-0.4, 0.4), -9, 9);
    this.flight = { apex: this.p.y, peaked: false, impact: 0, bounces: 0, tossed: v.y > 2.5, self: false };
    if (v.y > 2.5) this.voice.squealStart();
    this.go('air');
  }

  // Rubbed by the hand: each call tops up how petted it feels.
  pet() {
    if (!['sit', 'beg', 'sniff', 'wander', 'pet', 'return'].includes(this.state)) return;
    this.petLevel = Math.min(1, (this.petLevel || 0) + 0.12);
    if (this.state !== 'pet' && this.petLevel > 0.3) {
      this.go('pet');
      this.events.onPet?.();
    }
  }

  // A tap on the nose: a startled-happy yip, a bounce and a flick of the ears.
  boop() {
    if (!this.grounded() || this.state === 'leap' || this.state === 'recover') return;
    this.say(this.voice.yip(1.25));
    this.hopVy = 1.7;
    this.face.blink = 1;
    this.anim.kickEars(8, -10);
    this.events.onBoop?.();
    if (this.state === 'sit' || this.state === 'sniff') this.go('beg');
  }

  heightNow() {
    return Math.max(0, (this.p.y - COM.y - this.floor) * UNIT_M);
  }

  // +1 when a positive pitch turns the pup counter-clockwise on screen (it faces right).
  screenSign() {
    return Math.cos(this.yaw) >= 0 ? 1 : -1;
  }

  // --- Each frame ---------------------------------------------------------------------

  update(dt, t, ctx) {
    this.t = t;
    this.stateT += dt;
    const m = { t, wag: 0, phase: this.phase, look: null, tilt: 0, ears: 0, hang: 0, paddle: 0, shake: 0, splay: 0, vy: 0, speed: 0, pant: 0, stiffness: 150 };
    let name = 'stand';
    let lid = 0;
    let lookAt = 'free';

    switch (this.state) {
      case 'held': name = this.updateHeld(dt, m); lookAt = 'camera'; break;
      case 'air': name = this.updateAir(dt, m); lid = -0.2; lookAt = 'none'; break;
      case 'leap': name = this.updateLeap(dt, m); lookAt = 'none'; break;
      case 'recover': name = this.updateRecover(dt, m); lookAt = 'none'; break;
      case 'return': {
        const done = this.moveTo(this.homeJit, this.scared ? 1.1 : 2.5, dt, m, true);
        if (done) this.go('beg');
        m.ears = 0.6; m.wag = this.scared ? 0.2 : 0.6; m.pant = this.scared ? 0 : 1;
        lookAt = 'ahead';
        break;
      }
      case 'beg': name = this.updateBeg(dt, m); lid = 0.12; lookAt = 'camera'; break;
      case 'sit': name = this.updateSit(dt, m); break;
      case 'wander': {
        if (this.moveTo(this.target, 0.85, dt, m, true)) this.go(this.after || 'sniff');
        lookAt = 'ahead';
        break;
      }
      case 'sniff':
        name = 'sniff';
        lookAt = 'none';
        if (this.stateT > this.next) this.go(Math.random() < 0.55 ? 'return' : 'sit');
        break;
      case 'sulk': name = this.updateSulk(dt, m); lookAt = 'none'; break;
      case 'pet': name = this.updatePet(dt, m); lid = 0.9; lookAt = 'pointer'; break;
    }
    this.petLevel = Math.max(0, (this.petLevel || 0) - dt * 0.9);

    // Hover: a hand near a pup on the ground perks it up.
    if (this.hover && ['sit', 'beg', 'sniff', 'wander'].includes(this.state)) {
      m.ears = Math.max(m.ears, 0.8);
      m.wag = Math.max(m.wag, 0.85);
      lookAt = 'pointer';
      if (this.state === 'sit' || this.state === 'sniff') this.go('beg');
    }
    if (this.scared > 0) {
      this.scared = Math.max(0, this.scared - dt / 9);
      m.ears = Math.min(m.ears, -0.9 * Math.min(1, this.scared * 2));
      m.wag *= 1 - Math.min(1, this.scared * 3);
    }

    this.updateLook(dt, lookAt, ctx, m);
    this.anim.update(dt, name, m);

    // A little squash on landings (the legs do most of the work), a little stretch in flight.
    this.squashVel += (-300 * this.squash - 2 * Math.sqrt(300) * 0.55 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    const sq = clamp(this.squash, -0.15, 0.15);
    let sy = 1 - sq;
    let sxz = 1 + sq * 0.5;
    if (this.state === 'air') {
      const st = Math.min(0.07, Math.abs(this.v.y) * 0.006);
      sy *= 1 + st;
      sxz /= Math.sqrt(1 + st);
    }
    this.mount.squash.scale.set(sxz, sy, sxz);

    if (this.grounded()) {
      this.hopVy -= 15 * dt;
      this.hopY = Math.max(0, this.hopY + this.hopVy * dt);
      if (this.hopY === 0 && this.hopVy < 0) {
        if (this.hopVy < -1.2) this.anim.land(0.25);
        this.hopVy = 0;
      }
      const under = this.solid.top(this.p.x, this.p.z, 0.04);
      this.floor += (under - this.floor) * (1 - Math.exp(-25 * dt));
      this.p.y = this.floor + COM.y * sy + this.hopY;
      const r = Math.hypot(this.p.x, this.p.z);
      if (r > CLEARING) { this.p.x *= CLEARING / r; this.p.z *= CLEARING / r; }
    }

    // Turn toward the yaw we want, the short way round, easing in and out of the turn.
    if (this.state !== 'air') {
      const dy = wrap(this.yawTarget - this.yaw);
      const want = clamp(dy * 9, -8, 8);
      this.yawRate += (want - this.yawRate) * (1 - Math.exp(-14 * dt));
      this.yaw += this.yawRate * dt;
    } else {
      this.yawRate = 0;
    }

    this.object.position.copy(this.p);
    const pitch = this.state === 'held' ? this.hang + this.swing * this.screenSign() : this.pitch;
    this.object.rotation.set(0, this.yaw, pitch);

    // Fur swings opposite to how the body accelerates, and settles a little with gravity.
    this.acc.copy(this.v).sub(this.vPrev).divideScalar(Math.max(dt, 1e-3));
    this.vPrev.copy(this.v);
    const flow = this.acc.clone().multiplyScalar(-0.003);
    flow.y -= 0.25;
    if (m.shake > 0.05) flow.x += Math.sin(t * TAU * 6.5) * 0.9 * m.shake;
    if (flow.length() > 1) flow.setLength(1);
    const q = this.object.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.model.fur.flow.value.lerp(flow.applyQuaternion(q), 1 - Math.exp(-12 * dt));

    // Face: mouth from the voice (or panting), lids from mood.
    let mouth = 0;
    if (t < this.mouth.until) mouth = this.mouth.flutter ? this.mouth.amt * (0.55 + 0.45 * Math.sin(t * 40)) : this.mouth.amt;
    else if (m.pant > 0.5) mouth = 0.3 + 0.12 * Math.sin(t * TAU * 3);
    else if (this.state === 'air' && this.voice.live) mouth = 0.75;
    if (this.state === 'sulk') lid = 0.3;
    if (this.state === 'held') lid = this.scared ? -0.2 : this.still > 1.5 ? 0.35 : 0.05;
    this.lid += (lid - this.lid) * Math.min(1, dt * 8);
    updateFace(this.face, dt, t, { lidTarget: Math.max(0, this.lid), mouth, camera: ctx.camera, light: ctx.sun });
  }

  // --- States --------------------------------------------------------------------------

  updateHeld(dt, m) {
    this.hang += (0.95 - this.hang) * (1 - Math.exp(-9 * dt));
    // The hand's motion, smoothed a touch so pointer jitter does not shake the pup.
    this.handVelS.lerp(this.handVel, 1 - Math.exp(-30 * dt));
    const ax = (this.handVelS.x - this.handVelPrev.x) / Math.max(dt, 1e-3);
    const ay = (this.handVelS.y - this.handVelPrev.y) / Math.max(dt, 1e-3);
    this.handVelPrev.copy(this.handVelS);
    // Swing under the hand. A pup is not a weight on a string: the loose scruff and its
    // own body stiffen the swing, so it sways a little behind the hand and settles fast.
    const L = SCRUFF_LEN * 2.2, g = this.tune.gravity;
    const acc = -((g + clamp(ay, -30, 40)) / L) * Math.sin(this.swing) - (clamp(ax, -40, 40) / L) * 0.6 * Math.cos(this.swing) - 3.4 * this.swingVel;
    this.swingVel = clamp(this.swingVel + acc * dt, -6, 6);
    this.swing = clamp(this.swing + this.swingVel * dt, -0.6, 0.6);
    // It keeps facing the way it faced when picked up, turned three-quarters to you.
    this.yawTarget = this.face_ > 0 ? -0.55 : Math.PI + 0.55;

    const rot = new THREE.Euler(0, this.yaw, this.hang + this.swing * this.screenSign(), 'YZX');
    const exact = this.hand.clone().add(COM.clone().sub(SCRUFF).applyEuler(rot));
    this.pick = Math.min(1, this.pick + dt / 0.16);
    const before = this.p.clone();
    this.p.copy(this.pickFrom).lerp(exact, ease(this.pick));
    this.v.copy(this.p).sub(before).divideScalar(Math.max(dt, 1e-3));

    const speed = this.handVelS.length();
    this.still = speed < 0.4 ? this.still + dt : 0;
    m.hang = this.hang;
    // Wriggles when moved, hangs limp when held still for a while, with the odd kick.
    let pad = clamp(0.3 + speed * 0.14, 0, 1);
    if (this.still > 1.2) pad = 0.08 + (Math.sin(this.t * 1.3) > 0.93 ? 0.6 : 0);
    m.paddle = this.scared ? Math.max(pad, 0.8) : pad;
    m.wag = this.scared ? 0 : this.still > 1.2 ? 0.25 : 0.45;
    m.ears = -0.3 - clamp(speed * 0.05, 0, 0.4);
    m.stiffness = 220;
    this.anim.kickEars(clamp(-ax * 0.004, -0.6, 0.6), clamp(ay * 0.004, -0.6, 0.6));
    return 'held';
  }

  updateAir(dt, m) {
    const f = this.flight;
    const g = this.tune.gravity;
    const prevFeet = this.p.y - this.contact();
    const px = this.p.x, pz = this.p.z;
    this.v.y -= g * dt;
    this.v.multiplyScalar(Math.exp(-0.06 * dt));
    this.p.addScaledVector(this.v, dt);
    this.pitch += this.pitchVel * dt;
    this.pitchVel *= Math.exp(-0.35 * dt);
    // Pups twist to get their feet under them: strongly on the way down, and a slow spin
    // (a straight-up toss) never really gets going.
    if (Math.abs(this.pitchVel) < 2.5) this.pitchVel *= Math.exp(-2 * dt);
    if (this.v.y < 0 && Math.abs(this.pitchVel) < 5) {
      this.pitch += (upright(this.pitch) - this.pitch) * (1 - Math.exp(-3 * dt));
    }
    // The edge of the clearing is a bush: it bumps the pup back in.
    const r = Math.hypot(this.p.x, this.p.z);
    if (r > CLEARING) {
      const nx = this.p.x / r, nz = this.p.z / r;
      const out = this.v.x * nx + this.v.z * nz;
      if (out > 0) { this.v.x -= 1.5 * out * nx; this.v.z -= 1.5 * out * nz; }
      this.p.x = nx * CLEARING; this.p.z = nz * CLEARING;
    }
    // A side of a rock, bush, log or the mound: bounce off it.
    const wall = this.solid.top(this.p.x, this.p.z, BODY);
    if (wall > prevFeet + 0.03) {
      const n = this.solid.outward(this.p.x, this.p.z, BODY);
      if (n) {
        const vn = this.v.x * n.x + this.v.z * n.z;
        if (vn < 0) {
          this.v.x -= 1.45 * vn * n.x; this.v.z -= 1.45 * vn * n.z;
          this.voice.thump(Math.min(0.5, -vn / 10));
          this.pitchVel += rand(-2, 2);
          this.anim.kickEars(rand(-6, 6), -6);
        }
        this.p.x = px + n.x * 0.01; this.p.z = pz + n.z * 0.01;
      }
    }
    const h = this.p.y - COM.y;
    f.apex = Math.max(f.apex, this.p.y);
    this.voice.squealPitch(h);
    if (!f.peaked && this.v.y <= 0) {
      f.peaked = true;
      const metres = (f.apex - COM.y) * UNIT_M;
      if (f.tossed) {
        this.voice.squealStop(0.08);
        if (metres > this.tune.comfort) {
          this.say(this.voice.yelp());
          this.scared = 1;
        } else if (metres > 0.35) {
          this.say(this.voice.giggle());
        }
        this.events.onApex?.(metres);
      }
    }
    // Touch down on whatever is below: lower when it lands on its back or side.
    const floor = this.solid.top(this.p.x, this.p.z, 0.04);
    const ground = floor + this.contact();
    if (this.p.y <= ground && this.v.y < 0) {
      const s = -this.v.y;
      f.impact = Math.max(f.impact, s);
      this.floor = floor;
      this.voice.thump(Math.min(1, s / 13));
      this.events.onImpact?.(this.p, s);
      this.squash = Math.max(this.squash, Math.min(0.12, s * 0.01 * this.tune.squash));
      this.squashVel = 0;
      this.anim.land(Math.min(1.2, (s / 9) * this.tune.squash));
      this.p.y = ground;
      if (s > 2.6 && f.bounces < 3 && !f.self) {
        f.bounces++;
        this.v.y = s * this.tune.bounce;
        this.v.x *= 0.6; this.v.z *= 0.6;
        this.pitchVel = this.pitchVel * 0.5 + rand(-1.5, 1.5);
      } else {
        this.voice.squealStop();
        this.v.y = 0;
        const flipped = Math.abs(wrap(this.pitch)) > 0.45;
        this.rollFrom = flipped ? this.pitch : null;
        this.splatFor = f.impact > 9.5 ? 0.5 : 0;
        // A shake after a big landing or a roll; small ones it just bounces up from.
        this.shakeFor = flipped || f.impact > 6.5 ? 0.6 : 0;
        this.shakeAt = (flipped ? 0.42 : 0) + this.splatFor + (this.shakeFor ? 0.12 : 0);
        this.go('recover');
        if (!f.self) this.events.onLand?.((f.apex - COM.y) * UNIT_M, f.tossed);
      }
      return 'stand';
    }
    m.vy = this.v.y;
    m.ears = this.v.y < 0 ? 1 : -0.6;
    m.wag = 0.25;
    m.stiffness = 230;
    this.anim.kickEars(clamp(-this.v.y * 0.15, -2, 2), clamp(this.v.y * 0.1, -1, 1));
    // Reach for the ground when it is close.
    const feet = this.p.y - this.contact() - floor;
    return this.v.y < 0 && feet < 0.5 && Math.abs(wrap(this.pitch)) < 0.6 ? 'brace' : 'air';
  }

  contact() {
    return 0.24 + 0.12 * (0.5 + 0.5 * Math.cos(this.pitch));
  }

  updateRecover(dt, m) {
    const t = this.stateT;
    this.v.x *= Math.exp(-6 * dt);
    this.v.z *= Math.exp(-6 * dt);
    this.slide(this.v.x * dt, this.v.z * dt);
    if (this.rollFrom !== null && t < 0.42) {
      // Roll back onto its feet.
      const e = ease(t / 0.42);
      this.pitch = this.rollFrom + (upright(this.rollFrom) - this.rollFrom) * e;
      if (t < dt * 1.5) this.hopVy = 2.2;
      m.splay = 0.6;
      return 'splat';
    }
    this.pitch = upright(this.pitch);
    if (t < this.shakeAt) {
      m.ears = -0.4;
      return this.splatFor > 0 && t < (this.rollFrom !== null ? 0.42 : 0) + this.splatFor ? 'splat' : 'stand';
    }
    if (this.shakeFor && t < this.shakeAt + this.shakeFor) {
      if (!this.shook) { this.shook = true; this.voice.brr(); }
      m.shake = Math.sin(((t - this.shakeAt) / this.shakeFor) * Math.PI);
      m.ears = 0.2;
      return 'stand';
    }
    if (!this.shakeFor && t < 0.28) return 'stand'; // a beat to land before it moves on
    this.shook = false;
    const f = this.flight;
    if (f && f.self) {
      this.go(f.after || 'sniff');
    } else if (this.scared > 0.5) {
      this.say(this.voice.whimper());
      this.target.set(-1.2 + rand(-0.3, 0.3), 0, -0.9 + rand(-0.3, 0.3));
      this.go('sulk');
    } else {
      this.say(this.voice.yip(1.05));
      this.hopVy = 2.4; // a happy bounce before running back
      this.go('return');
    }
    return 'stand';
  }

  updateBeg(dt, m) {
    this.yawTarget = Math.atan2(-(ctxCam.z - this.p.z), ctxCam.x - this.p.x);
    // Yips come in little bursts with pauses between, the way pups ask, not on a metronome.
    if (this.stateT > this.next) {
      if (!this.burst) {
        this.burst = 1 + ((Math.random() * 3) | 0);
        this.hopVy = rand(1.6, 2.4);
      }
      this.burst--;
      this.next = this.stateT + (this.burst ? rand(0.2, 0.32) : rand(2.0, 3.6));
      this.say(this.voice.yip(rand(0.95, 1.15)));
    }
    if (this.stateT > 9 && !this.hover) this.go('sit');
    m.wag = 1;
    m.ears = 1;
    m.pant = 1;
    return 'bow';
  }

  // Being petted: sits into the hand, eyes shut in a smile, ears flat, tail going, humming.
  updatePet(dt, m) {
    this.yawTarget = Math.atan2(-(ctxCam.z - this.p.z), ctxCam.x - this.p.x) + 0.25;
    m.wag = 1;
    m.ears = -0.8;
    m.tilt = 0.22 * Math.sin(this.t * 1.7);
    m.pant = 0;
    this.scared = Math.max(0, this.scared - dt * 0.4);
    if (this.t > (this.humAt || 0)) { this.humAt = this.t + rand(0.7, 1.1); this.say(this.voice.hum()); }
    if (this.t >= this.mouth.until) this.mouth = { amt: 0.22, until: this.t + 0.05, flutter: false };
    if (this.petLevel < 0.05) {
      this.say(this.voice.yip(1.1));
      this.hopVy = 2;
      this.go('beg');
    }
    return 'sit';
  }

  updateSit(dt, m) {
    if (!this.perched) this.yawTarget = Math.atan2(-(ctxCam.z - this.p.z), ctxCam.x - this.p.x) + 0.35;
    m.wag = 0.25;
    if (this.stateT > this.tiltAt) {
      this.tiltAt = this.stateT + rand(3, 6);
      this.tiltFor = this.stateT + 1.3;
      this.tiltDir = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.25) this.say(this.voice.yawn());
    }
    m.tilt = this.stateT < this.tiltFor ? 0.32 * this.tiltDir : 0;
    if (this.stateT > this.next) this.pickWander();
    return 'sit';
  }

  // Off to sniff somewhere, or up onto the log, a rock or the mound to sit.
  pickWander() {
    this.perched = false;
    const perches = this.solid.perches;
    if (perches.length && Math.random() < 0.4) {
      const pr = perches[(Math.random() * perches.length) | 0];
      this.target.set(pr.x, 0, pr.z);
      this.after = 'perch';
    } else {
      for (let i = 0; i < 20; i++) {
        this.target.set(rand(-2.4, 2.4), 0, rand(-1.8, 1.5));
        if (this.solid.top(this.target.x, this.target.z, BODY + 0.1) === 0) break;
      }
      this.after = 'sniff';
    }
    this.go('wander');
  }

  updateSulk(dt, m) {
    if (!this.sulkArrived) {
      if (this.moveTo(this.target, 0.9, dt, m, false)) {
        this.sulkArrived = this.stateT;
        this.yawTarget = Math.atan2(1.6, -1.2);
      }
      return 'sulk';
    }
    if (this.stateT - this.sulkArrived > 3.8) {
      this.sulkArrived = 0;
      this.go('return');
    }
    return 'sulk';
  }

  // A crouch, then a jump to `to` (a point on whatever is there), then `after`.
  startLeap(to, after) {
    this.leapTo = to.clone();
    this.leapAfter = after;
    this.go('leap');
  }

  updateLeap(dt, m) {
    // Anticipation: sink on the haunches, then spring.
    this.anim.crouch.x = Math.max(this.anim.crouch.x, 0.55 * ease(Math.min(1, this.stateT / 0.16)));
    this.yawTarget = Math.atan2(-(this.leapTo.z - this.p.z), this.leapTo.x - this.p.x);
    m.ears = 0.8;
    if (this.stateT < 0.18) return 'stand';
    const g = this.tune.gravity;
    const toTop = this.solid.top(this.leapTo.x, this.leapTo.z, 0.04);
    const dh = toTop - this.floor;
    const vy = Math.sqrt(2 * g * (Math.max(dh, 0) + 0.16));
    const T = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * g * dh))) / g;
    this.v.set((this.leapTo.x - this.p.x) / T, vy, (this.leapTo.z - this.p.z) / T);
    this.pitch = 0;
    this.pitchVel = dh > 0 ? 0.6 : -0.6;
    this.anim.crouch.x = 0;
    this.anim.crouch.v = -6; // legs push
    this.flight = { apex: this.p.y, peaked: true, impact: 0, bounces: 0, tossed: false, self: true, after: this.leapAfter };
    this.go('air');
    return 'stand';
  }

  // Walk or run toward a point on the ground; true once there. Jumps up onto or down off
  // things in the way when `hop` is set, and steers around what it will not jump.
  moveTo(target, speed, dt, m, hop) {
    const dx = target.x - this.p.x, dz = target.z - this.p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) return true;
    let dir = Math.atan2(-dz, dx);
    // Look a little ahead for something to climb, jump or go round.
    const here = this.floor;
    const look = Math.min(0.34, d);
    const probe = (a) => this.solid.top(this.p.x + Math.cos(a) * look, this.p.z - Math.sin(a) * look, BODY);
    const ahead = probe(dir);
    const climb = this.solid.standTop(this.p.x + Math.cos(dir) * look, this.p.z - Math.sin(dir) * look, BODY);
    if (hop && ahead - here > STEP && climb >= ahead - 0.02 && climb - here < 0.7) {
      const spot = this.solid.landingAlong(this.p.x, this.p.z, Math.cos(dir), -Math.sin(dir), Math.min(0.85, d + 0.1));
      if (spot) {
        this.startLeap(new THREE.Vector3(spot.x, 0, spot.z), this.state);
        return false;
      }
    }
    if (here - this.solid.top(this.p.x + Math.cos(dir) * look, this.p.z - Math.sin(dir) * look, 0.04) > STEP) {
      if (hop) {
        this.startLeap(new THREE.Vector3(this.p.x + Math.cos(dir) * 0.6, 0, this.p.z - Math.sin(dir) * 0.6), this.state);
        return false;
      }
    } else if (ahead - here > STEP) {
      for (const off of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        if (probe(dir + off) - here <= STEP) { dir += off; break; }
      }
    }
    this.yawTarget = dir;
    const align = Math.max(0, Math.cos(wrap(this.yawTarget - this.yaw)));
    const sp = speed * Math.min(1, d / 0.45 + 0.15) * (0.25 + 0.75 * align);
    const mx = Math.cos(this.yaw) * sp * dt, mz = -Math.sin(this.yaw) * sp * dt;
    this.slide(mx, mz);
    // The stride is locked to the distance covered, so the feet do not skate.
    const run = clamp((sp - 1.0) / 0.8, 0, 1);
    const strideLen = 0.34 + (0.8 - 0.34) * run;
    this.phase += ((Math.hypot(mx, mz) + Math.abs(this.yawRate) * dt * 0.1) / strideLen) * TAU;
    m.phase = this.phase;
    m.speed = Math.max(sp, Math.abs(this.yawRate) * 0.12);
    if (run > 0.5 && this.t - this.lastPatter > 0.16) { this.lastPatter = this.t; this.voice.patter(); }
    return false;
  }

  // Move along the ground without walking into things: slide along a side instead.
  slide(mx, mz) {
    const nx = this.p.x + mx, nz = this.p.z + mz;
    if (this.solid.top(nx, nz, BODY) - this.floor <= STEP) { this.p.x = nx; this.p.z = nz; return; }
    const n = this.solid.outward(nx, nz, BODY);
    if (!n) return;
    const into = mx * n.x + mz * n.z;
    const sx = this.p.x + mx - into * n.x, sz = this.p.z + mz - into * n.z;
    if (this.solid.top(sx, sz, BODY) - this.floor <= STEP) { this.p.x = sx; this.p.z = sz; }
  }

  // Where the head points: quick turns between things worth looking at, like an animal's
  // glances, rather than a smooth stare.
  updateLook(dt, mode, ctx, m) {
    let want = [0, 0];
    if (mode !== 'none' && this.state !== 'air') {
      let target = null;
      if (mode === 'camera') target = ctx.camera.position;
      else if (mode === 'pointer') target = ctx.pointerWorld || ctx.camera.position;
      else {
        if (this.t > this.focusUntil) {
          this.focusUntil = this.t + rand(1.2, 3.6);
          const r = Math.random();
          this.focus = r < 0.7 ? 'camera' : new THREE.Vector3(this.p.x + rand(-2, 2), rand(0.35, 1.0), this.p.z + rand(-2, 1));
        }
        target = mode === 'ahead' ? null : this.focus === 'camera' ? ctx.camera.position : this.focus;
      }
      if (target) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, this.pitch, 'YZX'));
        const head = HEAD.clone().sub(COM).applyQuaternion(q).add(this.p);
        const d = target.clone().sub(head).applyQuaternion(q.invert());
        // It looks up at you only so far: tipped further, a long muzzle hides the face.
        want = [clamp(Math.atan2(-d.z, d.x), -1.1, 1.1), clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 0.26)];
        if (Math.abs(want[0]) > 1.05) want[1] *= 0.5;
      }
    }
    if (this.state === 'held') want = [this.face_ > 0 ? 0.55 : -0.55, 0.15];
    const k = 160, c = 2 * Math.sqrt(k);
    for (let i = 0; i < 2; i++) {
      const s = this.look[i];
      s.v += (k * (want[i] - s.x) - c * s.v) * dt;
      s.x += s.v * dt;
    }
    m.look = [this.look[0].x, this.look[1].x];
  }

  grounded() {
    return this.state !== 'held' && this.state !== 'air';
  }

  say(s) {
    if (!s) return;
    this.mouth = { amt: s.mouth, until: this.t + s.dur, flutter: !!s.flutter };
  }

  go(state) {
    if (state === 'perch') {
      this.perched = true;
      this.yawTarget = Math.atan2(-(ctxCam.z - this.p.z), ctxCam.x - this.p.x);
      state = 'sit';
    }
    if (state === this.state) return;
    this.state = state;
    this.stateT = 0;
    this.sulkArrived = 0;
    this.tiltAt = 2;
    this.tiltFor = 0;
    if (state === 'beg') this.next = 0.4;
    if (state === 'sit') this.next = rand(6, 10);
    if (state === 'sniff') this.next = rand(1.8, 3);
    if (state === 'return') { this.perched = false; this.homeJit = HOME.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.25, 0.2))); }
    if (state !== 'held' && state !== 'air') this.hang = 0;
    this.events.onState?.(state);
  }
}

// The camera position, shared so grounded pups can face it. Set by main each frame.
export const ctxCam = new THREE.Vector3(0, 2, 6);
