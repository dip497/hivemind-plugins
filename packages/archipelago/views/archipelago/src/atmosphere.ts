// The air over the islands: soft clouds drifting on the wind over the open sea, and birds wheeling
// over each island by day. Clouds are one instanced quad that
// faces the camera, shaped by one small texture painted at start; birds are one instanced mesh that
// flaps in its shader. Two draw calls whatever the workspace, and nothing to load. Neither comes so
// close to the camera that it fills the view.
import * as THREE from "three";
import { random, type Sky } from "./world";

/** Clusters of cloud puffs over the sea. */
const HIGH = 48;
const BIRDS_PER_ISLAND = 5, BIRDS_MAX = 60;
/** A bird's wingspan in the world: a gull's, a little short of a worker's height. */
const SPAN = 0.5;
/** How far its wings beat up and down, for each unit out from its body (the shader's flap). */
const BEAT = 0.55;
/** The farthest any part of a bird gets from its middle, its wing tips at the top of a beat. */
const REACH = (SPAN / 2) * Math.hypot(1, BEAT);
/** How wide a bird may show, in pixels: one nearer than that is drawn smaller, as a pin keeps its
 *  size, so one flying past the camera, close over a small island, never fills the view. */
const MOST = 90;
const WHITE = new THREE.Color(1, 1, 1), TINT = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), V = new THREE.Vector3();

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

  /** Lays the air out over the islands: clouds over the open sea, a flock over each island. */
  build(shores: readonly Shore[], far: number): void {
    const rand = random(0xa17);
    const at: number[] = [], size: number[] = [], seed: number[] = [];
    const span = far + 24;
    // Over open sea only: seen from the camera's slant from any side, a cloud never hides an island.
    const clear = (x: number, z: number, y: number, r: number) => shores.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + y * 0.9 + r);
    for (let i = 0, tries = 0; i < HIGH && tries < HIGH * 40; tries++) {
      // In clusters, as clouds are: a few big puffs and smaller ones round them.
      const cx = (rand() * 2 - 1) * span, cz = (rand() * 2 - 1) * span, y = 9 + rand() * 4;
      if (!clear(cx, cz, y, 11)) continue;
      i++;
      for (let k = 0; k < 3; k++) {
        at.push(cx + (rand() - 0.5) * 9, y + (rand() - 0.5) * 2, cz + (rand() - 0.5) * 6);
        size.push(2.6 + rand() * 2.6 - k * 0.5); seed.push(rand());
      }
    }
    this.high = at.length / 3;
    const geo = this.clouds.geometry;
    geo.setAttribute("iAt", new THREE.InstancedBufferAttribute(new Float32Array(at), 3));
    geo.setAttribute("iSize", new THREE.InstancedBufferAttribute(new Float32Array(size), 1));
    geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
    geo.instanceCount = at.length / 3;
    this.clouds.material.uniforms.uSpan!.value = span;
    this.flock = [];
    for (const s of shores) for (let k = 0; k < BIRDS_PER_ISLAND && this.flock.length < BIRDS_MAX; k++) {
      this.flock.push({ cx: s.x + (rand() - 0.5) * s.r * 0.4, cz: s.z + (rand() - 0.5) * s.r * 0.4, r: s.r * (0.45 + rand() * 0.4), h: 4 + rand() * 3, speed: (0.25 + rand() * 0.15) * (rand() < 0.5 ? -1 : 1), phase: rand() * Math.PI * 2 });
    }
  }

  /** The air at this moment: `cover` 0–1 is how much of the sky is cloud, more as more agents work.
   *  Seen by `camera` in a view `viewportH` pixels high. */
  update(t: number, sky: Sky, cover: number, reduced: boolean, camera: THREE.PerspectiveCamera, viewportH: number): boolean {
    const u = this.clouds.material.uniforms;
    const night = sky.lamps;
    // Lit by the sun or the moon: white by day, warm at dusk, a cool grey-blue at night.
    TINT.setHex(sky.key).lerp(WHITE, 0.55 - night * 0.3).multiplyScalar(1 - night * 0.62);
    u.uColor!.value.copy(TINT);
    u.uShade!.value.setHex(sky.above).multiplyScalar(0.55 + (1 - night) * 0.35);
    u.uTime!.value = reduced ? 0 : t;
    u.uHigh!.value = Math.round(this.high * Math.max(0.25, Math.min(1, cover)));
    // Birds fly by day, and only while things move.
    const show = !reduced && night < 0.4;
    this.birds.visible = show;
    if (!show) { this.birds.count = 0; return false; }
    // A bird's width on screen, per unit of width over its distance in front of the camera.
    const across = (camera.projectionMatrix.elements[5]! * viewportH) / 2;
    this.flock.forEach((b, i) => {
      const a = b.phase + t * b.speed;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r, y = b.h + Math.sin(t * 0.7 + b.phase) * 0.4;
      // Its body along the way it flies round the circle.
      const heading = Math.atan2(-Math.sin(a) * b.speed, Math.cos(a) * b.speed);
      // The most it can show, whichever way it is turned and however its wings beat: as wide as it
      // reaches, from as near as its nearest point comes, stretched as the lens stretches what is off
      // to the side. Wider than MOST, it is drawn smaller; reaching behind the camera, not at all.
      V.copy(P.set(x, y, z)).applyMatrix4(camera.matrixWorldInverse);
      const ahead = -V.z - REACH;
      const wide = ahead > 0 ? (2 * REACH * across * Math.hypot(1, V.x / ahead, V.y / ahead)) / ahead : Infinity;
      M.compose(P, Q.setFromEuler(E.set(0, heading, 0)), S.setScalar((SPAN / 2) * Math.min(1, MOST / wide)));
      this.birds.setMatrixAt(i, M);
    });
    this.birds.count = this.flock.length;
    this.birds.instanceMatrix.needsUpdate = true;
    const bu = this.birds.material.uniforms;
    bu.uTime!.value = t;
    // From above, a gull's back lit as the clouds are; from below, its shade against the sky.
    bu.uBack!.value.copy(TINT).multiplyScalar(0.92);
    bu.uBelly!.value.setHex(sky.below).multiplyScalar(0.5);
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
      uColor: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.7, 0.75, 0.85) }, uHigh: { value: 0 },
    },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: /* glsl */ `
      attribute vec3 iAt; attribute float iSize; attribute float iSeed;
      uniform float uTime; uniform float uSpan; uniform float uHigh;
      varying vec2 vUv; varying float vSeed; varying float vFade;
      void main() {
        vec3 p = iAt;
        // The wind: clouds drift and wrap round the sea.
        p.x = mod(p.x + uTime * (0.6 + iSeed * 0.5) + uSpan, 2.0 * uSpan) - uSpan;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * vec2(iSize * 1.6, iSize);
        gl_Position = projectionMatrix * mv;
        vUv = position.xy * 0.5 + 0.5; vSeed = iSeed;
        // Fewer clouds when the agents rest; none so close to the camera they fill the view.
        float shown = step(float(gl_InstanceID), uHigh - 0.5);
        vFade = shown * smoothstep(4.0, 22.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor; uniform vec3 uShade;
      varying vec2 vUv; varying float vSeed; varying float vFade;
      void main() {
        // Each puff its own way round, so a sky of them does not repeat.
        float a = vSeed * 6.2831853;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (vUv - 0.5) + 0.5;
        // Faded to nothing before the quad's edge, so no puff shows a straight cut.
        float d = texture2D(uMap, q).a * smoothstep(0.5, 0.3, length(vUv - 0.5));
        if (d < 0.01) discard;
        vec3 col = mix(uShade, uColor, smoothstep(0.2, 0.85, vUv.y));
        float alpha = d * vFade * 0.8;
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

/** A gull: a slim body, and wings bent at the elbow and swept back to their tips. */
function birdGeometry(): THREE.BufferGeometry {
  type Point = [number, number, number];
  // x along the wings (tips at |x| = 1), z along the body, its head at +z; the wings flap in the shader.
  const tris: [Point, Point, Point][] = [[[0, 0, 0.38], [-0.07, 0, 0], [0, 0, -0.32]], [[0, 0, 0.38], [0, 0, -0.32], [0.07, 0, 0]]];
  for (const s of [-1, 1]) {
    const root: Point = [0, 0, 0.12], back: Point = [0, 0, -0.1], elbow: Point = [0.42 * s, 0.06, 0.1], elbowBack: Point = [0.42 * s, 0.06, -0.08];
    tris.push([root, elbow, back], [back, elbow, elbowBack], [elbow, [s, -0.02, -0.24], elbowBack]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flat(2)), 3));
  return g;
}

function birdMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBack: { value: new THREE.Color(0.85, 0.87, 0.9) }, uBelly: { value: new THREE.Color(0.15, 0.15, 0.18) } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld; varying float vTip; varying float vAbove;
      void main() {
        vec3 p = position;
        float flap = sin(uTime * 9.0 + float(gl_InstanceID) * 1.7);
        p.y += abs(p.x) * flap * ${BEAT.toFixed(3)};
        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
        vWorld = world.xyz; vTip = abs(position.x);
        // Its back or its belly by where the camera is, above it or below: not by which way a face
        // is turned, which a two-sided face does not say.
        vAbove = step((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y, cameraPosition.y);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBack; uniform vec3 uBelly;
      varying vec3 vWorld; varying float vTip; varying float vAbove;
      void main() {
        // A gull: pale above with dark wing tips, a shade against the sky from below.
        vec3 col = mix(uBelly, mix(uBack, uBelly, smoothstep(0.6, 0.8, vTip)), vAbove);
        // Each face a little darker the more it tilts, so the bend of a wing shows as it beats.
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        col *= 0.72 + 0.28 * abs(n.y);
        gl_FragColor = vec4(col, 1.0);
        // Without the effects pass the renderer maps the light itself, as it does for the pins.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
