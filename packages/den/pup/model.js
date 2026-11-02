// Builds one pup: the sculpt meshed and painted, a skeleton bound to it, fur shells,
// and the face parts (eyes with lids and catchlights, nose, jaw, tongue) on their bones.
import * as THREE from 'three';
import { surfaceNets } from './mesher.js';
import { BONES, REST, FACE, makeShape, coatAt, furAt, weightsAt } from './shape.js';
import { ellipsoid, roundCone, smin } from './sdf.js';
import { furMaterials, furShared } from './fur.js';

const lin = (hex) => new THREE.Color(hex); // THREE.Color converts sRGB hex to linear

export const COATS = {
  ash: { base: '#9d8e7f', dark: '#564a41', cream: '#f2e8d6', inner: '#e8d8c4', tip: '#2a221d', eye: '#4a2c17' },
  ember: { base: '#a9724a', dark: '#5e3a24', cream: '#f0dfc4', inner: '#e3cdb3', tip: '#3a2418', eye: '#24150b' },
  frost: { base: '#d9d2c7', dark: '#a79c90', cream: '#f7f2e8', inner: '#ece0d2', tip: '#8b8075', eye: '#21160e' },
};

export function buildPup({ coat = COATS.ash, form = {}, shells = 12, step = 0.0105 } = {}) {
  const shape = makeShape(form);
  const t0 = performance.now();
  const net = surfaceNets(shape.sdf, shape.bounds.min, shape.bounds.max, step);
  const n = net.positions.length / 3;

  const boneIndex = Object.fromEntries(BONES.map(([name], i) => [name, i]));
  const colors = new Float32Array(n * 3);
  const furLen = new Float32Array(n);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const C = Object.fromEntries(Object.entries(coat).map(([k, v]) => [k, lin(v)]));
  const c = new THREE.Color();
  for (let v = 0; v < n; v++) {
    const p = [net.positions[v * 3], net.positions[v * 3 + 1], net.positions[v * 3 + 2]];
    const nr = [net.normals[v * 3], net.normals[v * 3 + 1], net.normals[v * 3 + 2]];
    const dist = Float64Array.from(shape.measure(p[0], p[1], p[2]));
    const k = coatAt(shape, p, nr, dist);
    c.copy(C.base).lerp(C.dark, Math.min(1, k.dark * 1.1)).lerp(C.cream, k.cream).lerp(C.inner, k.inner).lerp(C.tip, k.tip * 0.9);
    colors.set([c.r, c.g, c.b], v * 3);
    furLen[v] = furAt(p, k, dist, shape);
    const w = weightsAt(shape, dist, boneIndex);
    for (let j = 0; j < 4; j++) {
      skinIndex[v * 4 + j] = w[j][0];
      skinWeight[v * 4 + j] = w[j][1];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(net.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(net.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('furLen', new THREE.BufferAttribute(furLen, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(new THREE.BufferAttribute(net.indices, 1));
  geo.computeBoundingSphere();

  // Skeleton.
  const root = new THREE.Group();
  root.name = 'pup';
  const bones = {};
  for (const [name, parent, p] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? REST[parent] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    b.userData.rest = b.position.clone();
    bones[name] = b;
    if (parent) bones[parent].add(b);
  }
  const fur = furShared();
  const mats = furMaterials(shells, fur);
  const body = new THREE.SkinnedMesh(geo, mats[0]);
  body.castShadow = true;
  body.frustumCulled = false;
  body.add(bones.hips);
  root.add(body);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map(([name]) => bones[name]));
  body.bind(skeleton);
  for (let s = 1; s <= shells; s++) {
    const shell = new THREE.SkinnedMesh(geo, mats[s]);
    shell.frustumCulled = false;
    shell.bind(skeleton, body.bindMatrix);
    root.add(shell);
  }

  const attach = (boneName, obj, at) => {
    const r = REST[boneName];
    obj.position.set(at[0] - r[0], at[1] - r[1], at[2] - r[2]);
    bones[boneName].add(obj);
    return obj;
  };

  // Eyes: glossy dark spheres with a lid each and a catchlight that faces the light.
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: coat.eye, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
  const pupilMat = new THREE.MeshPhysicalMaterial({ color: '#0b0705', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 });
  const lidMat = new THREE.MeshStandardMaterial({ color: lerpHex(coat.base, coat.dark, 0.35), roughness: 0.9 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes = [];
  for (const side of [1, -1]) {
    const e = [FACE.eye[0], FACE.eye[1], FACE.eye[2] * side];
    const pivot = new THREE.Group();
    const dir = new THREE.Vector3(FACE.eyeDir[0], FACE.eyeDir[1], FACE.eyeDir[2] * side);
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    attach('head', pivot, e);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(FACE.eyeR, 28, 18), eyeMat);
    pivot.add(ball);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(FACE.eyeR * 0.72, 24, 16), pupilMat);
    pupil.position.x = FACE.eyeR * 0.32;
    pivot.add(pupil);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(FACE.eyeR * 1.07, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
    const lidPivot = new THREE.Group();
    lidPivot.add(lid);
    pivot.add(lidPivot);
    // A lower lid trims the bottom of the eye so it reads almond-shaped, not round.
    const low = new THREE.Mesh(new THREE.SphereGeometry(FACE.eyeR * 1.06, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
    const lowPivot = new THREE.Group();
    lowPivot.rotation.z = Math.PI - 0.95;
    lowPivot.add(low);
    pivot.add(lowPivot);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(FACE.eyeR * 0.25, 12, 8), glintMat);
    const glint2 = new THREE.Mesh(new THREE.SphereGeometry(FACE.eyeR * 0.11, 8, 6), glintMat);
    pivot.add(glint, glint2);
    eyes.push({ pivot, lidPivot, glint, glint2, side });
  }

  // Nose: a small glossy button.
  const noseGeo = new THREE.SphereGeometry(1, 24, 16);
  noseGeo.scale(0.031, 0.024, 0.04);
  const nose = new THREE.Mesh(noseGeo, new THREE.MeshPhysicalMaterial({ color: '#1c1816', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
  attach('head', nose, FACE.nose);

  // Mouth: a dark inside on the head, and a lower jaw with a tongue that opens on its bone.
  const inside = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshStandardMaterial({ color: '#4a1f22', roughness: 0.7 }));
  inside.scale.set(0.06, 0.016, 0.04);
  attach('head', inside, [0.45, 0.58, 0]);
  const jawShape = (() => {
    // The lower jaw tucks up under the muzzle and stops short of the nose.
    const a = roundCone([0.37, 0.572, 0], [0.5, 0.567, 0], 0.044, 0.028);
    const b = ellipsoid([0.43, 0.563, 0], [0.065, 0.024, 0.045]);
    return (x, y, z) => smin(a(x, y, z), b(x, y, z), 0.03);
  })();
  const jn = surfaceNets(jawShape, [0.3, 0.5, -0.07], [0.61, 0.62, 0.07], 0.005);
  const jawGeo = new THREE.BufferGeometry();
  jawGeo.setAttribute('position', new THREE.BufferAttribute(jn.positions, 3));
  jawGeo.setAttribute('normal', new THREE.BufferAttribute(jn.normals, 3));
  const jv = jn.positions.length / 3;
  const jc = new Float32Array(jv * 3);
  const cream = lin(coat.cream);
  for (let v = 0; v < jv; v++) jc.set([cream.r, cream.g, cream.b], v * 3);
  jawGeo.setAttribute('color', new THREE.BufferAttribute(jc, 3));
  jawGeo.setAttribute('furLen', new THREE.BufferAttribute(new Float32Array(jv).fill(0.009), 1));
  jawGeo.setIndex(new THREE.BufferAttribute(jn.indices, 1));
  const jr = REST.jaw;
  jawGeo.translate(-jr[0], -jr[1], -jr[2]);
  for (let s = 0; s <= shells; s += Math.max(1, Math.round(shells / 4))) {
    const jaw = new THREE.Mesh(jawGeo, mats[s]);
    jaw.castShadow = s === 0;
    bones.jaw.add(jaw);
  }
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), new THREE.MeshStandardMaterial({ color: '#d9787c', roughness: 0.5 }));
  tongue.scale.set(0.05, 0.01, 0.03);
  tongue.position.set(0.455 - jr[0], 0.576 - jr[1], 0);
  bones.jaw.add(tongue);

  root.userData.buildMs = performance.now() - t0;
  root.userData.triangles = net.indices.length / 3;
  return { root, body, bones, skeleton, eyes, fur, mats, coat, shape };
}

function lerpHex(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}
