// The pup's sculpt: soft shapes blended into one body, the bones that move it, where its
// coat is dark or cream, and how long its fur is. Units are metres-ish in pup space:
// +x is forward, +y up, +z the pup's left. The origin is on the ground under the belly.
import { smin, smax, sphere, ellipsoid, roundCone, flatCone, norm } from './sdf.js';

export const BONES = [
  ['hips', null, [-0.18, 0.37, 0]],
  ['spine', 'hips', [-0.04, 0.37, 0]],
  ['chest', 'spine', [0.1, 0.4, 0]],
  ['neck', 'chest', [0.19, 0.47, 0]],
  ['head', 'neck', [0.27, 0.6, 0]],
  ['jaw', 'head', [0.36, 0.575, 0]],
  ['earL', 'head', [0.25, 0.735, 0.095]],
  ['earR', 'head', [0.25, 0.735, -0.095]],
  ['shoulderL', 'chest', [0.13, 0.34, 0.095]],
  ['elbowL', 'shoulderL', [0.145, 0.19, 0.1]],
  ['pawFL', 'elbowL', [0.155, 0.065, 0.1]],
  ['shoulderR', 'chest', [0.13, 0.34, -0.095]],
  ['elbowR', 'shoulderR', [0.145, 0.19, -0.1]],
  ['pawFR', 'elbowR', [0.155, 0.065, -0.1]],
  ['thighL', 'hips', [-0.17, 0.34, 0.1]],
  ['hockL', 'thighL', [-0.215, 0.17, 0.105]],
  ['pawBL', 'hockL', [-0.205, 0.065, 0.105]],
  ['thighR', 'hips', [-0.17, 0.34, -0.1]],
  ['hockR', 'thighR', [-0.215, 0.17, -0.105]],
  ['pawBR', 'hockR', [-0.205, 0.065, -0.105]],
  ['tail0', 'hips', [-0.28, 0.4, 0]],
  ['tail1', 'tail0', [-0.37, 0.37, 0]],
  ['tail2', 'tail1', [-0.45, 0.32, 0]],
];

export const REST = Object.fromEntries(BONES.map(([n, , p]) => [n, p]));

// Where the face parts sit, shared with the model that places eyes, nose and jaw.
export const FACE = {
  eye: [0.43, 0.67, 0.08],
  eyeR: 0.037,
  eyeDir: norm([1, 0.04, 0.38]),
  nose: [0.562, 0.622, 0],
  mouth: [0.45, 0.576, 0],
};

const mirror = (p) => [p[0], p[1], -p[2]];

export function makeShape(form = {}) {
  const head = form.head ?? 1.12;
  const chub = form.chub ?? 1.06;
  const ear = form.ear ?? 1;
  const parts = [];
  const add = (name, bone, fn, k) => parts.push({ name, bone, fn, k });

  // Body: a round belly, a back that rises a little to the chest, a fluffy chest.
  add('belly', 'spine', ellipsoid([-0.03, 0.335, 0], [0.235 * chub, 0.18 * chub, 0.182 * chub]), 0.06);
  add('back', 'hips', roundCone([-0.185, 0.37, 0], [-0.02, 0.39, 0], 0.16 * chub, 0.168 * chub), 0.06);
  add('front', 'chest', roundCone([-0.02, 0.39, 0], [0.13, 0.41, 0], 0.165 * chub, 0.178 * chub), 0.06);
  add('chestFluff', 'chest', ellipsoid([0.175, 0.385, 0], [0.12, 0.14, 0.135]), 0.06);
  add('neck', 'neck', roundCone([0.16, 0.45, 0], [0.27, 0.58, 0], 0.12, 0.112), 0.06);

  // Head: a broad skull, a step down at the brow into a long boxy muzzle, small jowls.
  // A pup's head: a big domed skull, soft brows, chubby cheeks and a short muzzle that
  // still steps down from the brow like a dog's.
  const hc = [0.285, 0.655, 0];
  add('skull', 'head', ellipsoid(hc, [0.158 * head, 0.148 * head, 0.15 * head]), 0.05);
  add('browL', 'head', ellipsoid([0.372, 0.728, 0.058], [0.036, 0.02, 0.036]), 0.035);
  add('browR', 'head', ellipsoid([0.372, 0.728, -0.058], [0.036, 0.02, 0.036]), 0.035);
  add('cheekL', 'head', sphere([0.39, 0.592, 0.072], 0.07), 0.045);
  add('cheekR', 'head', sphere([0.39, 0.592, -0.072], 0.07), 0.045);
  add('muzzle', 'head', roundCone([0.38, 0.612, 0], [0.53, 0.602, 0], 0.074, 0.054), 0.035);
  add('muzzleBox', 'head', ellipsoid([0.478, 0.598, 0], [0.068, 0.048, 0.058]), 0.03);

  // Ears: broad at the base and furred, standing up, with the tips folding forward.
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const base = [0.25, 0.728, 0.095 * side];
    const mid = [0.236, 0.728 + 0.125 * ear, (0.095 + 0.05 * ear) * side];
    const tip = [0.292, 0.728 + 0.098 * ear, (0.095 + 0.07 * ear) * side];
    add('ear' + nm, 'ear' + nm, flatCone(base, mid, 0.082 * ear, 0.04 * ear, norm([0.95, 0.05, 0.3 * side]), 2.6), 0.03);
    // The fold: a thin flap that tips forward and down from two-thirds of the way up.
    add('earTip' + nm, 'ear' + nm, flatCone(mid, tip, 0.04 * ear, 0.022, norm([0.35, 0.92, 0.18 * side]), 2.5), 0.018);
  }

  // Legs: short and soft, with round paws.
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const z = (v) => v * side;
    add('upperF' + s, 'shoulder' + s, roundCone([0.13, 0.34, z(0.095)], [0.145, 0.19, z(0.1)], 0.074, 0.054), 0.05);
    add('lowerF' + s, 'elbow' + s, roundCone([0.145, 0.19, z(0.1)], [0.155, 0.068, z(0.1)], 0.052, 0.045), 0.03);
    add('pawF' + s, 'pawF' + s, ellipsoid([0.176, 0.042, z(0.1)], [0.074, 0.042, 0.062]), 0.028);
    add('thigh' + s, 'thigh' + s, roundCone([-0.17, 0.34, z(0.1)], [-0.215, 0.17, z(0.105)], 0.1, 0.058), 0.05);
    add('shin' + s, 'hock' + s, roundCone([-0.215, 0.17, z(0.105)], [-0.205, 0.068, z(0.105)], 0.048, 0.042), 0.03);
    add('pawB' + s, 'pawB' + s, ellipsoid([-0.18, 0.042, z(0.105)], [0.072, 0.041, 0.06]), 0.028);
  }

  // Tail: a bushy brush that hangs back and down, a wolf's at rest.
  add('tail0', 'tail0', roundCone([-0.27, 0.405, 0], [-0.37, 0.37, 0], 0.05, 0.066), 0.05);
  add('tail1', 'tail1', roundCone([-0.37, 0.37, 0], [-0.45, 0.32, 0], 0.066, 0.058), 0.03);
  add('tail2', 'tail2', roundCone([-0.45, 0.32, 0], [-0.505, 0.265, 0], 0.058, 0.028), 0.03);

  // Cuts: sockets for the eyes and a hollow in the front of each ear.
  const cuts = [];
  for (const side of [1, -1]) {
    const e = side > 0 ? FACE.eye : mirror(FACE.eye);
    cuts.push({ fn: sphere([e[0] + 0.005, e[1], e[2]], 0.025), k: 0.014 });
    const n = norm([0.95, 0.05, 0.3 * side]);
    const base = [0.25 + n[0] * 0.026, 0.75, 0.095 * side + n[2] * 0.026];
    const mid = [0.236 + n[0] * 0.02, 0.72 + 0.12 * ear, (0.095 + 0.05 * ear) * side + n[2] * 0.02];
    cuts.push({ fn: flatCone(base, mid, 0.054 * ear, 0.02, n, 2.6), k: 0.012 });
  }

  const dist = new Float64Array(parts.length);
  function measure(x, y, z) {
    for (let i = 0; i < parts.length; i++) dist[i] = parts[i].fn(x, y, z);
    return dist;
  }
  function sdf(x, y, z) {
    let d = parts[0].fn(x, y, z);
    for (let i = 1; i < parts.length; i++) d = smin(d, parts[i].fn(x, y, z), parts[i].k);
    for (const c of cuts) d = smax(d, -c.fn(x, y, z), c.k);
    return d;
  }
  return { parts, sdf, measure, bounds: { min: [-0.6, -0.01, -0.27], max: [0.68, 0.92, 0.27] } };
}

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Coat layers at a surface point, given its normal and each part's distance there.
// Returns weights for the dark saddle, the cream mask, the inner ear and the tail tip.
export function coatAt(shape, p, n, dist) {
  const [x, y, z] = p;
  const near = (name, w = 0.02) => {
    const i = shape.parts.findIndex((q) => q.name === name);
    let m = Infinity;
    for (let j = 0; j < dist.length; j++) if (j !== i) m = Math.min(m, dist[j]);
    return sstep(w, -w, dist[i] - m);
  };
  const ear = Math.max(near('earL', 0.012), near('earR', 0.012), near('earTipL', 0.012), near('earTipR', 0.012));
  const tail = Math.max(near('tail0'), near('tail1'), near('tail2'));
  const muzzle = Math.max(near('muzzle', 0.02), near('muzzleBox', 0.02));
  const side = Math.sign(z) || 1;
  const eyeD = Math.hypot(x - FACE.eye[0], y - FACE.eye[1], Math.abs(z) - FACE.eye[2]);

  // Dark: the saddle and the top of the neck, a cap on the head, a mask round the eyes and
  // down the bridge of the muzzle, the backs of the ears, the top and tip of the tail.
  let dark = sstep(0.15, 0.75, n[1]) * sstep(0.28, 0.42, y) * sstep(0.3, 0.16, x);
  dark = Math.max(dark, sstep(0.55, 0.95, n[1]) * sstep(0.7, 0.76, y) * sstep(0.4, 0.3, x) * 0.75);
  dark = Math.max(dark, sstep(0.065, 0.04, eyeD) * 0.28);
  dark = Math.max(dark, muzzle * sstep(0.35, 0.75, n[1]) * sstep(0.62, 0.635, y) * sstep(0.026, 0.01, Math.abs(z)) * 0.35);
  dark = Math.max(dark, ear * 0.7 * sstep(0.1, -0.4, n[0] * 0.95 + n[2] * side * 0.3));
  dark = Math.max(dark, tail * sstep(-0.2, 0.6, n[1]));

  // Cream: the sides and underside of the muzzle, lower cheeks, throat, chest, belly,
  // inner legs, paws, and a light spot over each eye.
  let cream = muzzle * sstep(0.625, 0.6, y) * sstep(0.39, 0.43, x);
  cream = Math.max(cream, Math.max(near('cheekL'), near('cheekR')) * sstep(0.62, 0.585, y));
  cream = Math.max(cream, sstep(0.14, 0.22, x) * sstep(0.56, 0.48, y) * sstep(-0.1, 0.4, n[0]) * sstep(0.12, 0.06, Math.abs(z)));
  cream = Math.max(cream, sstep(0.27, 0.2, y) * sstep(0.2, -0.4, n[1]) * sstep(0.2, 0.1, x));
  cream = Math.max(cream, sstep(0.1, 0.06, y));
  for (const s of [1, -1]) {
    const d = Math.hypot(x - 0.392, y - 0.722, z - 0.052 * s);
    cream = Math.max(cream, sstep(0.022, 0.01, d));
  }
  cream *= (1 - tail) * (1 - ear * 0.7);

  // Inner ear: pale fur in the cup. Lips: a dark line where the muzzle meets the jaw.
  const inner = ear * sstep(0.2, 0.7, n[0] * 0.95 + n[2] * side * 0.3) * sstep(0.75, 0.79, y) * near('ear' + (side > 0 ? 'L' : 'R'), 0.012);
  const lip = muzzle * sstep(0.58, 0.572, y) * sstep(-0.3, -0.7, n[1]) * sstep(0.43, 0.47, x);
  const tip = Math.max(tail * sstep(-0.47, -0.5, x), lip * 0.6);
  const earTip = Math.max(near('earTipL', 0.01), near('earTipR', 0.01));
  return { dark, cream, inner, tip, ear, tail, earTip };
}

// How long the fur is at a point, from the coat layers above.
export function furAt(p, coat, dist, shape) {
  const [x, y, z] = p;
  let len = 0.026;
  len = lerp(len, 0.04, coat.cream * sstep(0.12, 0.2, x) * sstep(0.56, 0.4, y));
  len = lerp(len, 0.048, coat.tail);
  len = lerp(len, 0.036, sstep(0.3, 0.37, x) * sstep(0.62, 0.57, y) * (1 - coat.ear));
  len = lerp(len, 0.009, sstep(0.43, 0.48, x) * sstep(0.68, 0.64, y));
  len = lerp(len, 0.01, coat.ear);
  len = lerp(len, 0.016, coat.inner);
  len = lerp(len, 0.003, coat.earTip); // the fold is too thin to carry fur without bristling
  len = lerp(len, 0.011, sstep(0.14, 0.07, y));
  for (const side of [1, -1]) {
    const e = FACE.eye;
    const d = Math.hypot(x - e[0], y - e[1], z - e[2] * side);
    len *= sstep(0.04, 0.075, d) * 0.85 + 0.15;
  }
  return len;
}

const lerp = (a, b, t) => a + (b - a) * t;

// Skin weights: each bone pulls on the surface near the parts it owns.
export function weightsAt(shape, dist, boneIndex) {
  const best = new Map();
  let m = Infinity;
  for (let i = 0; i < dist.length; i++) {
    const b = shape.parts[i].bone;
    const d = dist[i];
    if (!best.has(b) || d < best.get(b)) best.set(b, d);
    if (d < m) m = d;
  }
  const list = [...best.entries()]
    .map(([b, d]) => [boneIndex[b], Math.exp(-(d - m) / 0.018)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const sum = list.reduce((s, [, w]) => s + w, 0);
  while (list.length < 4) list.push([0, 0]);
  return list.map(([i, w]) => [i, w / sum]);
}
