// How the pup's bones move. Two kinds of motion, kept apart on purpose:
//
//  - A held pose for each state (standing, sitting, the play bow, dangling, flying...).
//    Bones reach it through a critically damped spring, so a change of state eases in
//    and out instead of snapping.
//  - Rhythms on top: the gait, the wag, paddling, the shake, breathing, a landing crouch.
//    These are added after the spring, unfiltered, so a 5 Hz wag swings at full size.
//    Only their strength eases in and out.
//
// Signs, worked out once: legs swing forward with +z; the tail lifts with -z and wags on y;
// ears fold back with +z and tip outward with +x on the left (-x on the right); the head
// looks up with +z and turns to its right with +y.

const TAU = Math.PI * 2;
const LEGS = ['shoulderL', 'elbowL', 'pawFL', 'shoulderR', 'elbowR', 'pawFR', 'thighL', 'hockL', 'pawBL', 'thighR', 'hockR', 'pawBR'];
export const POSED = ['hips', 'spine', 'chest', 'neck', 'head', 'tail0', 'tail1', 'tail2', ...LEGS];

function blank() {
  const p = { lift: 0 };
  for (const b of POSED) p[b] = [0, 0, 0];
  return p;
}

const legs = (p, side, f, e, w, t, h, b) => {
  p['shoulder' + side][2] = f; p['elbow' + side][2] = e; p['pawF' + side][2] = w;
  p['thigh' + side][2] = t; p['hock' + side][2] = h; p['pawB' + side][2] = b;
};

// The held pose of each state. m.hang (dangling), m.vy (flying) shape two of them.
export function basePose(name, m) {
  const p = blank();
  switch (name) {
    case 'stand':
      p.tail0[2] = -0.4; p.tail1[2] = -0.12;
      break;
    case 'sniff':
      p.neck[2] = -0.55; p.head[2] = -0.4; p.spine[2] = -0.04;
      legs(p, 'L', 0.12, -0.1, 0, -0.05, 0.05, 0);
      legs(p, 'R', 0.12, -0.1, 0, -0.05, 0.05, 0);
      p.tail0[2] = -0.55;
      break;
    case 'sit':
      p.lift = -0.115;
      p.hips[2] = 0.55;
      p.spine[2] = 0.08;
      p.neck[2] = -0.16;
      p.head[2] = -0.04;
      legs(p, 'L', -0.62, 0.05, 0.05, 1.25, -2.05, 0.75);
      legs(p, 'R', -0.62, 0.05, 0.05, 1.25, -2.05, 0.75);
      p.tail0[2] = 0.35; p.tail1[2] = 0.5; p.tail2[2] = 0.3;
      break;
    case 'bow':
      // Play bow: chest down on bent elbows, rear up, tail high.
      p.lift = -0.02;
      p.hips[2] = -0.36;
      p.spine[2] = -0.05;
      p.neck[2] = 0.5;
      p.head[2] = 0.32;
      legs(p, 'L', 1.15, -1.55, 0.35, 0.2, 0.15, 0.0);
      legs(p, 'R', 1.15, -1.55, 0.35, 0.2, 0.15, 0.0);
      p.tail0[2] = -0.95; p.tail1[2] = -0.2;
      break;
    case 'held': {
      // Dangling from the scruff: the holder pitches the body nose-up by m.hang; legs and
      // tail hang toward the ground, the head stays level to look at you.
      const h = m.hang;
      p.spine[2] = -0.12;
      p.neck[2] = -h * 0.5;
      p.head[2] = -h * 0.45;
      legs(p, 'L', h * 0.55 + 0.2, -0.85, -0.45, h * 0.62 - 0.12, 0.6, -0.35);
      legs(p, 'R', h * 0.55 + 0.25, -0.8, -0.45, h * 0.62 - 0.08, 0.55, -0.35);
      p.tail0[2] = h * 0.7 + 0.25; p.tail1[2] = 0.25; p.tail2[2] = 0.15;
      break;
    }
    case 'air': {
      // Rising: legs tucked, tail trailing down. Falling: legs reach out, tail up.
      const up = Math.max(0, Math.min(1, m.vy / 6));
      const down = Math.max(0, Math.min(1, -m.vy / 6));
      const f = 0.55 + 0.35 * down - 0.2 * up, b = -0.55 - 0.35 * down + 0.2 * up;
      legs(p, 'L', f, -0.35 - 0.5 * up, 0.25, b, 0.5 + 0.4 * up, 0.15);
      legs(p, 'R', f - 0.08, -0.4 - 0.5 * up, 0.25, b + 0.06, 0.55 + 0.4 * up, 0.15);
      p.neck[2] = 0.12 + 0.12 * down;
      p.head[2] = 0.05 + 0.12 * down;
      p.tail0[2] = 0.3 * up - 0.55 * down;
      p.tail1[2] = 0.2 * up - 0.2 * down;
      break;
    }
    case 'brace':
      // About to touch down: legs straight under, a little forward, head up.
      legs(p, 'L', 0.25, -0.1, 0.1, 0.1, 0.05, 0.05);
      legs(p, 'R', 0.22, -0.12, 0.1, 0.12, 0.05, 0.05);
      p.neck[2] = 0.2; p.head[2] = 0.1;
      p.tail0[2] = -0.6;
      break;
    case 'sulk':
      p.neck[2] = -0.38;
      p.head[2] = -0.25;
      p.tail0[2] = 0.75; p.tail1[2] = 0.35;
      p.lift = -0.02;
      break;
    case 'sleep':
      // Curled up: lying on its belly, front paws out, back legs tucked, chin down, the tail
      // brought round its side.
      p.lift = -0.2;
      p.hips[2] = 0.05;
      p.neck[2] = -0.42;
      p.head[2] = -0.32;
      p.head[0] = 0.12;
      legs(p, 'L', 1.35, -0.35, 0.3, 1.25, -2.1, 0.8);
      legs(p, 'R', 1.3, -0.4, 0.3, 1.2, -2.05, 0.8);
      p.tail0[1] = 1.0; p.tail0[2] = 0.45; p.tail1[1] = 0.6; p.tail2[1] = 0.4;
      break;
    case 'splat':
      // Landed hard: legs out to the sides, belly down for a beat.
      p.lift = -0.09;
      for (const [b, s] of [['shoulderL', 1], ['thighL', 1], ['shoulderR', -1], ['thighR', -1]]) p[b][0] = 0.85 * s;
      p.shoulderL[2] = 0.4; p.shoulderR[2] = 0.4; p.thighL[2] = -0.4; p.thighR[2] = -0.4;
      p.neck[2] = -0.1;
      break;
  }
  return p;
}

// One leg through a stride. u: 0..1 around the cycle. On the ground (u < duty) the leg
// sweeps back at an even pace; in the air it swings forward fast with the joint folded.
function stride(u, duty, reach, fold) {
  u -= Math.floor(u);
  if (u < duty) return [reach * (1 - 2 * (u / duty)), 0];
  const s = (u - duty) / (1 - duty);
  const e = s * s * (3 - 2 * s);
  return [reach * (-1 + 2 * e), Math.sin(Math.PI * s) * fold];
}

// Where each foot is in the cycle (fraction of a stride), per gait.
const WALK = { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75, duty: 0.64, reachF: 0.32, reachB: 0.36, foldF: 0.95, foldB: 0.8 };
const RUN = { LH: 0, RH: 0.1, LF: 0.46, RF: 0.55, duty: 0.36, reachF: 0.62, reachB: 0.66, foldF: 1.35, foldB: 1.05 };

function gaitLegs(g, u) {
  const out = {};
  for (const leg of ['LF', 'RF', 'LH', 'RH']) {
    const front = leg[1] === 'F';
    out[leg] = stride(u + g[leg], g.duty, front ? g.reachF : g.reachB, front ? g.foldF : g.foldB);
  }
  return out;
}

// A spring per channel, critically damped: x'' = k (target - x) - 2 sqrt(k) x'
function spring(s, target, k, dt) {
  const c = 2 * Math.sqrt(k);
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
  return s.x;
}

export class Animator {
  constructor(pup) {
    this.pup = pup;
    this.ch = {};
    for (const b of POSED) this.ch[b] = [0, 1, 2].map(() => ({ x: 0, v: 0 }));
    this.lift = { x: 0, v: 0 };
    this.loco = { x: 0, v: 0 };
    this.run = { x: 0, v: 0 };
    this.wag = { x: 0, v: 0 };
    this.paddle = { x: 0, v: 0 };
    this.crouch = { x: 0, v: 0 };
    this.ears = { earL: [0, 1, 2].map(() => ({ x: 0, v: 0 })), earR: [0, 1, 2].map(() => ({ x: 0, v: 0 })) };
    this.twitchAt = 1.5;
    this.wagPhase = 0;
    this.padPhase = 0;
  }

  // A sudden landing: legs give and the body dips, then springs back up.
  land(strength) {
    this.crouch.v += 26 * Math.min(1.2, strength);
    for (const e of ['earL', 'earR']) this.ears[e][2].v -= 14 * Math.min(1, strength);
  }

  // Push the ears: rad/s on each ear's [roll, turn, fold] (the right ear's roll is mirrored).
  kickEars(roll, fold) {
    this.ears.earL[0].v += roll; this.ears.earR[0].v -= roll;
    this.ears.earL[2].v += fold; this.ears.earR[2].v += fold;
  }

  // m: { t, speed, phase, wag, paddle, shake, splay, look:[yaw,pitch], tilt, ears, hang, vy,
  //      pant (0..1), stiffness }
  update(dt, name, m) {
    if (!(dt > 0)) return; // a clock that stood still or ran backwards moves nothing
    const b = this.pup.bones;
    const target = basePose(name, m);
    const k = (m.stiffness ?? 150);

    // Rhythm strengths ease, the rhythms themselves do not.
    const speed = m.speed || 0;
    const loco = spring(this.loco, speed > 0.05 ? 1 : 0, 120, dt);
    const run = spring(this.run, Math.min(1, Math.max(0, (speed - 1.0) / 0.8)), 60, dt);
    const wag = spring(this.wag, m.wag || 0, 40, dt);
    const paddle = spring(this.paddle, m.paddle || 0, 60, dt);
    const crouch = spring(this.crouch, 0, 170, dt);

    const out = {};
    for (const name of POSED) {
      const tg = target[name];
      out[name] = [spring(this.ch[name][0], tg[0], k, dt), spring(this.ch[name][1], tg[1], k, dt), spring(this.ch[name][2], tg[2], k, dt)];
    }
    let lift = spring(this.lift, target.lift, k, dt);

    // Gait: walk and run blended by speed, the stride locked to how far the body moved.
    if (loco > 0.01) {
      const u = m.phase / TAU;
      const w = gaitLegs(WALK, u), r = gaitLegs(RUN, u);
      const mix = (a, c) => [a[0] + (c[0] - a[0]) * run, a[1] + (c[1] - a[1]) * run];
      const L = { LF: mix(w.LF, r.LF), RF: mix(w.RF, r.RF), LH: mix(w.LH, r.LH), RH: mix(w.RH, r.RH) };
      const add = (bone, axis, v) => (out[bone][axis] += v * loco);
      for (const [leg, s] of [['LF', 'L'], ['RF', 'R']]) {
        add('shoulder' + s, 2, L[leg][0]);
        add('elbow' + s, 2, -L[leg][1]);
        add('pawF' + s, 2, 0.4 * L[leg][1]);
      }
      for (const [leg, s] of [['LH', 'L'], ['RH', 'R']]) {
        add('thigh' + s, 2, L[leg][0]);
        add('hock' + s, 2, L[leg][1]);
        add('pawB' + s, 2, -0.45 * L[leg][1]);
      }
      // Body: a small double bob at a walk; at a run the spine coils and stretches and the
      // body bounds, highest just after the back legs push off.
      const a = u * TAU;
      lift += loco * ((1 - run) * 0.008 * Math.cos(2 * a) + run * 0.045 * Math.max(0, Math.sin(a - 0.7)));
      add('hips', 2, run * 0.1 * Math.sin(a + 0.4));
      add('spine', 2, run * 0.12 * Math.sin(a - 0.6));
      add('chest', 2, -run * 0.08 * Math.sin(a - 1.2));
      add('neck', 2, -run * 0.07 * Math.sin(a - 1.6) - (1 - run) * 0.03 * Math.cos(2 * a));
      add('hips', 0, (1 - run) * 0.035 * Math.sin(a));
      add('tail0', 2, run * (0.12 * Math.sin(a + 1) + 0.2));
      if (run > 0.5 && Math.sin(a - 0.7) > 0.98) this.kickEars(0, -2.5);
    }

    // Wag: a wave down the tail, the hips answering a little.
    if (wag > 0.01) {
      this.wagPhase += dt * TAU * (3.2 + 3.6 * Math.min(1, m.wag || 0));
      const s = this.wagPhase;
      out.tail0[1] += 0.5 * wag * Math.sin(s);
      out.tail1[1] += 0.42 * wag * Math.sin(s - 0.9);
      out.tail2[1] += 0.36 * wag * Math.sin(s - 1.8);
      out.hips[1] -= 0.05 * wag * Math.sin(s);
    }

    // Paddling while dangling: front paws alternate like swimming, back legs kick.
    if (paddle > 0.01) {
      this.padPhase += dt * TAU * (2.2 + 1.6 * paddle);
      const u = this.padPhase / TAU;
      for (const [s, off] of [['L', 0], ['R', 0.5]]) {
        const f = stride(u + off, 0.5, 0.45, 0.9);
        out['shoulder' + s][2] += paddle * f[0];
        out['elbow' + s][2] -= paddle * f[1];
        const h = stride(u + off + 0.25, 0.5, 0.35, 0.7);
        out['thigh' + s][2] += paddle * h[0];
        out['hock' + s][2] += paddle * h[1];
      }
    }

    // Shake: a wet-dog shake, a roll that runs from the head back to the tail.
    if (m.shake > 0.01) {
      const s = m.shake, w = m.t * TAU * 6.5;
      out.head[0] += 0.5 * s * Math.sin(w);
      out.neck[0] += 0.42 * s * Math.sin(w - 0.6);
      out.chest[0] += 0.36 * s * Math.sin(w - 1.2);
      out.spine[0] += 0.3 * s * Math.sin(w - 1.8);
      out.hips[0] += 0.2 * s * Math.sin(w - 2.4);
      out.tail0[1] += 0.6 * s * Math.sin(w - 2.8);
      const fl = 0.08 * s * Math.sin(w);
      this.kickEars(fl * 60, 0);
    }

    // Breathing: slow when calm, a quick pant when excited.
    {
      const pant = m.pant || 0;
      const br = Math.sin(m.t * TAU * (0.45 + 2.6 * pant));
      out.chest[2] += (0.012 + 0.012 * pant) * br;
      out.spine[2] += 0.008 * br;
      lift += 0.002 * br;
    }

    // Landing crouch: elbows and hocks give, the chest dips, the head nods.
    if (Math.abs(crouch) > 1e-3) {
      const c = crouch;
      lift -= 0.16 * c;
      for (const s of ['L', 'R']) {
        out['shoulder' + s][2] += 0.45 * c;
        out['elbow' + s][2] -= 0.95 * c;
        out['pawF' + s][2] += 0.5 * c;
        out['thigh' + s][2] += 0.7 * c;
        out['hock' + s][2] -= 1.2 * c;
        out['pawB' + s][2] += 0.5 * c;
      }
      out.neck[2] -= 0.35 * c;
      out.head[2] -= 0.15 * c;
      out.tail0[2] -= 0.4 * c;
    }

    if (m.splay) {
      for (const [bn, s] of [['shoulderL', 1], ['thighL', 1], ['shoulderR', -1], ['thighR', -1]]) out[bn][0] += 0.5 * m.splay * s;
    }
    if (m.look) {
      out.head[1] += m.look[0] * 0.6;
      out.neck[1] += m.look[0] * 0.4;
      out.head[2] += m.look[1] * 0.6;
      out.neck[2] += m.look[1] * 0.3;
    }
    if (m.tilt) out.head[0] += m.tilt;

    for (const name of POSED) b[name].rotation.set(out[name][0], out[name][1], out[name][2]);
    b.hips.position.y = b.hips.userData.rest.y + lift;

    // Ears: their own floppy springs toward where the mood puts them, plus the odd twitch.
    const ears = m.ears ?? 0;
    const fold = -ears * 0.25 + (ears < 0 ? -ears * 0.6 : 0);
    const roll = 0.12 + (ears < 0 ? -ears * 0.35 : 0);
    if (m.t > this.twitchAt) {
      this.twitchAt = m.t + 1.5 + Math.random() * 4;
      const side = Math.random() < 0.5 ? 'earL' : 'earR';
      this.ears[side][2].v += (Math.random() < 0.5 ? -1 : 1) * 9;
      this.ears[side][0].v += (side === 'earL' ? 1 : -1) * 4;
    }
    for (const [e, s] of [['earL', 1], ['earR', -1]]) {
      const ch = this.ears[e];
      const goal = [roll * s, 0, fold];
      for (let i = 0; i < 3; i++) {
        // Under-damped on purpose: ears flop and settle.
        ch[i].v += (220 * (goal[i] - ch[i].x) - 11 * ch[i].v) * dt;
        ch[i].x += ch[i].v * dt;
      }
      b[e].rotation.set(clamp(ch[0].x, -1.2, 1.2), ch[1].x, clamp(ch[2].x, -1.0, 1.5));
    }
  }
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
