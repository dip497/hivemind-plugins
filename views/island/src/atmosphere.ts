// The air over the islands: soft clouds at many heights drifting on the wind, mist low on the water
// round every shore, and birds wheeling over each island by day. Clouds are one instanced quad that
// faces the camera, shaped by one small texture painted at start; birds are one instanced mesh that
// flaps in its shader. Two draw calls whatever the workspace, and nothing to load.
import * as THREE from "three";
import { random, type Sky } from "./world";

/** Puffs high in the sky, and low over the water by the shores. */
const HIGH = 48, LOW_PER_ISLAND = 6, LOW_MAX = 72;
const BIRDS_PER_ISLAND = 5, BIRDS_MAX = 60;
const WHITE = new THREE.Color(1, 1, 1), TINT = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();

export interface Shore { x: number; z: number; r: number }

export class Atmosphere {
  readonly clouds: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly birds: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private flock: { cx: number; cz: number; r: number; h: number; speed: number; phase: number }[] = [];
  private high = 0;

  constructor() {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.instanceCount = 0;
    this.clouds = new THREE.Mesh(geo, cloudMaterial());
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 5;
    this.birds = new THREE.InstancedMesh(birdGeometry(), birdMaterial(), BIRDS_MAX);
    this.birds.count = 0;
    this.birds.frustumCulled = false;
  }

  /** Lays the air out over the islands: high puffs over the whole sea, mist round each shore, a flock over each. */
  build(shores: readonly Shore[], far: number): void {
    const rand = random(0xa17);
    const at: number[] = [], size: number[] = [], seed: number[] = [], low: number[] = [];
    const span = far + 24;
    // Over open sea only: seen from the camera's slant from any side, a cloud never hides an island.
    const clear = (x: number, z: number, y: number, r: number) => shores.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + y * 0.5 + r);
    for (let i = 0, tries = 0; i < HIGH && tries < HIGH * 40; tries++) {
      // In clusters, as clouds are: a few big puffs and smaller ones round them.
      const cx = (rand() * 2 - 1) * span, cz = (rand() * 2 - 1) * span, y = 9 + rand() * 4;
      if (!clear(cx, cz, y, 7)) continue;
      i++;
      for (let k = 0; k < 3; k++) {
        at.push(cx + (rand() - 0.5) * 9, y + (rand() - 0.5) * 2, cz + (rand() - 0.5) * 6);
        size.push(3.5 + rand() * 4 - k * 0.8); seed.push(rand()); low.push(0);
      }
    }
    this.high = at.length / 3;
    let mist = 0;
    for (const s of shores) for (let k = 0; k < LOW_PER_ISLAND && mist < LOW_MAX; k++, mist++) {
      const a = rand() * Math.PI * 2, d = s.r + 1 + rand() * 4;
      at.push(s.x + Math.cos(a) * d, 0.6 + rand() * 0.9, s.z + Math.sin(a) * d);
      size.push(3.5 + rand() * 3); seed.push(rand()); low.push(1);
    }
    const geo = this.clouds.geometry;
    geo.setAttribute("iAt", new THREE.InstancedBufferAttribute(new Float32Array(at), 3));
    geo.setAttribute("iSize", new THREE.InstancedBufferAttribute(new Float32Array(size), 1));
    geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
    geo.setAttribute("iLow", new THREE.InstancedBufferAttribute(new Float32Array(low), 1));
    geo.instanceCount = at.length / 3;
    this.clouds.material.uniforms.uSpan!.value = span;
    this.flock = [];
    for (const s of shores) for (let k = 0; k < BIRDS_PER_ISLAND && this.flock.length < BIRDS_MAX; k++) {
      this.flock.push({ cx: s.x + (rand() - 0.5) * s.r * 0.4, cz: s.z + (rand() - 0.5) * s.r * 0.4, r: s.r * (0.45 + rand() * 0.4), h: 4 + rand() * 3, speed: (0.25 + rand() * 0.15) * (rand() < 0.5 ? -1 : 1), phase: rand() * Math.PI * 2 });
    }
  }

  /** The air at this moment: `cover` 0–1 is how much of the sky is cloud, more as more agents work. */
  update(t: number, sky: Sky, cover: number, reduced: boolean): boolean {
    const u = this.clouds.material.uniforms;
    const night = sky.lamps;
    // Lit by the sun or the moon: white by day, warm at dusk, a cool grey-blue at night.
    TINT.setHex(sky.key).lerp(WHITE, 0.55 - night * 0.3).multiplyScalar(1 - night * 0.62);
    u.uColor!.value.copy(TINT);
    u.uShade!.value.setHex(sky.above).multiplyScalar(0.55 + (1 - night) * 0.35);
    u.uTime!.value = reduced ? 0 : t;
    u.uHigh!.value = Math.round(this.high * Math.max(0.25, Math.min(1, cover)));
    // Mist lies thickest at dawn and by night.
    const dawn = sky.lamps > 0.3 ? 1 : sky.height < 0.3 ? 0.85 : 0.6;
    u.uMist!.value = dawn;
    // Birds fly by day, and only while things move.
    const show = !reduced && night < 0.4;
    this.birds.visible = show;
    if (!show) { this.birds.count = 0; return false; }
    this.flock.forEach((b, i) => {
      const a = b.phase + t * b.speed;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r, y = b.h + Math.sin(t * 0.7 + b.phase) * 0.4;
      // Its body along the way it flies round the circle.
      const heading = Math.atan2(-Math.sin(a) * b.speed, Math.cos(a) * b.speed);
      M.compose(P.set(x, y, z), Q.setFromEuler(E.set(0, heading, 0)), S.set(0.32, 0.32, 0.32));
      this.birds.setMatrixAt(i, M);
    });
    this.birds.count = this.flock.length;
    this.birds.instanceMatrix.needsUpdate = true;
    this.birds.material.uniforms.uTime!.value = t;
    this.birds.material.uniforms.uColor!.value.setHex(sky.below).multiplyScalar(0.5);
    return true;
  }
}

/** A soft cloud puff, painted once: overlapping round blobs, light on top and shaded underneath. */
function puffTexture(): THREE.Texture {
  const n = 128, c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const rand = random(0xc1);
  for (let i = 0; i < 14; i++) {
    const x = n * (0.25 + rand() * 0.5), y = n * (0.35 + rand() * 0.35), r = n * (0.12 + rand() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function cloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: typeof document === "undefined" ? null : puffTexture() }, uTime: { value: 0 }, uSpan: { value: 100 },
      uColor: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.7, 0.75, 0.85) }, uHigh: { value: 0 }, uMist: { value: 0.5 },
    },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: /* glsl */ `
      attribute vec3 iAt; attribute float iSize; attribute float iSeed; attribute float iLow;
      uniform float uTime; uniform float uSpan; uniform float uHigh;
      varying vec2 vUv; varying float vSeed; varying float vLow; varying float vFade;
      void main() {
        vec3 p = iAt;
        // The wind: high clouds drift and wrap round the sea; mist only sways.
        p.x = iLow > 0.5 ? p.x + sin(uTime * 0.15 + iSeed * 6.28) * 0.8 : mod(p.x + uTime * (0.6 + iSeed * 0.5) + uSpan, 2.0 * uSpan) - uSpan;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * vec2(iSize * 1.6, iSize);
        gl_Position = projectionMatrix * mv;
        vUv = position.xy * 0.5 + 0.5; vSeed = iSeed; vLow = iLow;
        // Fewer high clouds when the agents rest; none so close to the camera they fill the view.
        float shown = iLow > 0.5 ? 1.0 : step(float(gl_InstanceID), uHigh - 0.5);
        vFade = shown * smoothstep(4.0, 22.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor; uniform vec3 uShade; uniform float uMist;
      varying vec2 vUv; varying float vSeed; varying float vLow; varying float vFade;
      void main() {
        // Each puff its own way round, so a sky of them does not repeat.
        float a = vSeed * 6.2831853;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (vUv - 0.5) + 0.5;
        float d = texture2D(uMap, q).a;
        if (d < 0.01) discard;
        vec3 col = mix(uShade, uColor, smoothstep(0.2, 0.85, vUv.y));
        float alpha = d * vFade * (vLow > 0.5 ? 0.4 * uMist : 0.8);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

/** A bird: two thin wings meeting at its body, seen from afar. */
function birdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // x along the wings, z along the body; the wing tips (|x| = 1) flap in the shader.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    0, 0, 0.35, -1, 0, -0.1, 0, 0, -0.25,
    0, 0, 0.35, 0, 0, -0.25, 1, 0, -0.1,
  ]), 3));
  g.computeVertexNormals();
  return g;
}

function birdMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.15, 0.15, 0.18) } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      void main() {
        vec3 p = position;
        float flap = sin(uTime * 9.0 + float(gl_InstanceID) * 1.7);
        p.y += abs(p.x) * flap * 0.55;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
}
