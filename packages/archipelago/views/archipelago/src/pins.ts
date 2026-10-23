// A pin over every agent, the same size on screen however far the camera is: what each one is doing,
// read from the overview, where the workers themselves are a few pixels tall. One instanced quad
// for all of them, one draw call; the shape and its mark are drawn in the shader, so nothing loads.
// They fade in only as the workers get too small to read, and a pin calling you is larger and pulses.
import * as THREE from "three";
import type { Mood } from "./world";

/** The mark each mood draws: a turning arc, !, ✓, ×, … and a dash. */
const KIND: Record<Mood, number> = { working: 0, calling: 1, done: 2, failed: 3, idle: 4, gone: 5 };
/** How tall a pin stands over the ground a worker is on, above its head. */
const LIFT = 1.1;
/** Pins show once a worker is shorter than this on screen, in pixels, and are fully in at FADE_IN less. */
const SHOW_BELOW = 22, FADE_IN = 8;
/** A worker's height in the world, for how big it looks. */
const WORKER_HEIGHT = 0.65;

export interface PinSource { tileId: string; pos: THREE.Vector3; mood: Mood }
export type PinColors = Record<Mood, string>;

export class Pins {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private at: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private kind: THREE.InstancedBufferAttribute;
  private ids: string[] = [];
  private cap = 0;
  private tones = new Map<Mood, THREE.Color>();
  /** 0 when the workers can be read by themselves, 1 when only the pins can. */
  fade = 0;

  constructor() {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.mesh = new THREE.Mesh(geo, pinMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.at = this.color = this.kind = null!;
    this.grow(64);
    geo.instanceCount = 0;
  }

  setColors(c: PinColors): void {
    for (const m of Object.keys(KIND) as Mood[]) this.tones.set(m, new THREE.Color(c[m]));
  }

  /** Fills the pins from the workers, and fades them by how big a worker looks; false when none show. */
  update(workers: readonly PinSource[], camera: THREE.PerspectiveCamera, distance: number, viewportH: number, t: number, reduced: boolean): boolean {
    const tall = (WORKER_HEIGHT / (distance * Math.tan((camera.fov * Math.PI) / 360))) * (viewportH / 2);
    this.fade = Math.max(0, Math.min(1, (SHOW_BELOW - tall) / FADE_IN));
    const u = this.mesh.material.uniforms;
    u.uFade!.value = this.fade;
    u.uTime!.value = reduced ? 0 : t;
    u.uReduced!.value = reduced ? 1 : 0;
    const geo = this.mesh.geometry;
    if (this.fade === 0) { geo.instanceCount = 0; this.mesh.visible = false; return false; }
    if (workers.length > this.cap) this.grow(workers.length + 64);
    this.ids.length = workers.length;
    const at = this.at.array as Float32Array, col = this.color.array as Float32Array, kind = this.kind.array as Float32Array;
    workers.forEach((w, i) => {
      this.ids[i] = w.tileId;
      at[i * 3] = w.pos.x; at[i * 3 + 1] = w.pos.y + LIFT; at[i * 3 + 2] = w.pos.z;
      const c = this.tones.get(w.mood);
      col[i * 3] = c?.r ?? 1; col[i * 3 + 1] = c?.g ?? 1; col[i * 3 + 2] = c?.b ?? 1;
      kind[i] = KIND[w.mood];
    });
    this.at.needsUpdate = this.color.needsUpdate = this.kind.needsUpdate = true;
    geo.instanceCount = workers.length;
    this.mesh.visible = true;
    return true;
  }

  setViewport(w: number, h: number): void { this.mesh.material.uniforms.uViewport!.value.set(w, h); }

  /** The agent whose pin is under a screen point, while the pins show. */
  pick(x: number, y: number, camera: THREE.Camera, w: number, h: number): string | null {
    if (this.fade < 0.5) return null;
    const at = this.at.array as Float32Array, kind = this.kind.array as Float32Array;
    const size = this.mesh.material.uniforms.uSize!.value as number;
    let best: string | null = null, bd = Infinity;
    for (let i = 0; i < this.ids.length; i++) {
      P.set(at[i * 3]!, at[i * 3 + 1]!, at[i * 3 + 2]!).project(camera);
      if (P.z > 1) continue;
      const s = size * (kind[i] === KIND.calling ? 1.3 : 1);
      // The disc sits a pin's height above the point it stands on.
      const cx = ((P.x + 1) / 2) * w, cy = ((1 - P.y) / 2) * h - s * 1.25;
      const d = Math.hypot(cx - x, cy - y);
      if (d < s && d < bd) { bd = d; best = this.ids[i]!; }
    }
    return best;
  }

  private grow(n: number): void {
    const geo = this.mesh.geometry;
    this.cap = n;
    this.at = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.kind = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iAt", this.at);
    geo.setAttribute("iColor", this.color);
    geo.setAttribute("iKind", this.kind);
  }
}

const P = new THREE.Vector3();

function pinMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uViewport: { value: new THREE.Vector2(1, 1) }, uSize: { value: 13 }, uFade: { value: 0 }, uTime: { value: 0 }, uReduced: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false, fog: false,
    vertexShader: /* glsl */ `
      attribute vec3 iAt; attribute vec3 iColor; attribute float iKind;
      uniform vec2 uViewport; uniform float uSize; uniform float uTime; uniform float uReduced;
      varying vec2 vUv; varying vec3 vColor; varying float vKind;
      void main() {
        vec4 c = projectionMatrix * viewMatrix * vec4(iAt, 1.0);
        float calling = step(0.5, iKind) * step(iKind, 1.5);
        float s = uSize * (1.0 + calling * (0.3 + (1.0 - uReduced) * 0.1 * sin(uTime * 5.0)));
        // The quad is 2 by 2.5 pin-radii: the disc on top, its point at the bottom on the anchor.
        vec2 q = vec2(position.x, position.y * 1.25 + 1.25);
        c.xy += q * s * 2.0 / uViewport * c.w;
        gl_Position = c;
        vUv = q; vColor = iColor; vKind = iKind;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade; uniform float uTime;
      varying vec2 vUv; varying vec3 vColor; varying float vKind;
      float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      void main() {
        // Pin space: the disc of radius 1 round (0, 1.5), its point at (0, 0).
        vec2 d = vUv - vec2(0.0, 1.5);
        float aa = fwidth(vUv.y) * 1.2;
        float disc = length(d) - 0.92;
        float tip = seg(vUv, vec2(0.0, 0.18), vec2(0.0, 1.0)) - 0.28 * clamp((vUv.y - 0.18) / 0.82, 0.0, 1.0) - 0.02;
        float shape = min(disc, tip);
        float alpha = 1.0 - smoothstep(-aa, aa, shape);
        if (alpha <= 0.0) discard;
        // A dark edge so a pin reads on sand, grass, sea and night alike.
        vec3 col = mix(vec3(0.07, 0.08, 0.1), vColor, smoothstep(-aa, aa, -shape - 0.16));
        float mark = 1e3;
        int k = int(vKind + 0.5);
        if (k == 0) {
          float r = abs(length(d) - 0.48) - 0.11;
          float a = fract((atan(d.y, d.x) + uTime * 4.0) / 6.2831853);
          mark = a < 0.72 ? r : 1e3;
        } else if (k == 1) {
          mark = min(seg(d, vec2(0.0, -0.05), vec2(0.0, 0.48)) - 0.12, length(d - vec2(0.0, -0.36)) - 0.12);
        } else if (k == 2) {
          mark = min(seg(d, vec2(-0.42, 0.0), vec2(-0.12, -0.3)), seg(d, vec2(-0.12, -0.3), vec2(0.44, 0.32))) - 0.11;
        } else if (k == 3) {
          mark = min(seg(d, vec2(-0.34, -0.34), vec2(0.34, 0.34)), seg(d, vec2(-0.34, 0.34), vec2(0.34, -0.34))) - 0.11;
        } else if (k == 4) {
          mark = min(min(length(d - vec2(-0.36, 0.0)), length(d)), length(d - vec2(0.36, 0.0))) - 0.11;
        } else {
          mark = seg(d, vec2(-0.34, 0.0), vec2(0.34, 0.0)) - 0.1;
        }
        // The mark black on a pale tone and white on a deep one, by inkOn's rule (world.ts): the tone is
        // linear here, so its luminance is the weighted sum.
        vec3 ink = vec3(step(dot(vColor, vec3(0.2126, 0.7152, 0.0722)), 0.179));
        col = mix(col, ink, 1.0 - smoothstep(-aa, aa, max(mark, disc + 0.16)));
        gl_FragColor = vec4(col, alpha * uFade * (k == 5 ? 0.6 : 1.0));
        // Without the effects pass the renderer maps the light itself, as it does for the sky and sea.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
