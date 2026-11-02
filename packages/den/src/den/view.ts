/**
 * The Den drawn: the yard's ground in the theme's colours (or a meadow's, with the Colour switch),
 * a few tufts of grass that sway, and each pup in 3D, furred, posed by what it is doing.
 *
 * The camera looks down on the ground at a 40° slant with no perspective, so a point on screen is
 * a point on the ground: (x, y) pixels is (x/unit, 0, y/(unit·sin 40°)) in the world, and the pups
 * line up with the tiles exactly. Everything is lit once; nothing casts a shadow but a soft blob.
 */
import * as THREE from "three";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { buildPup, buildPupGeometry, setCoat, type Coat, type PupGeometry, type PupModel } from "../../pup/model.js";
import { Animator, type Motion } from "../../pup/pose.js";
import { makeFace, updateFace, type Face } from "../../pup/face.js";
import { mountPup, COM } from "../../pup/mount.js";
import { KINDS, SLANT, type Pup, type Yard } from "./yard";

const ELEV = (40 * Math.PI) / 180;

/** A coat for each kind of agent: all of one program's pups look alike. */
export const COATS: Coat[] = [
  { base: "#9d8e7f", dark: "#564a41", cream: "#f2e8d6", inner: "#e8d8c4", tip: "#2a221d", eye: "#4a2c17" }, // ash
  { base: "#a9724a", dark: "#5e3a24", cream: "#f0dfc4", inner: "#e3cdb3", tip: "#3a2418", eye: "#2e1a0e" }, // ember
  { base: "#d9d2c7", dark: "#a79c90", cream: "#f7f2e8", inner: "#ece0d2", tip: "#8b8075", eye: "#2c1e14" }, // frost
  { base: "#55504c", dark: "#2a2623", cream: "#d3c7b6", inner: "#d8c7b2", tip: "#161311", eye: "#3a2414" }, // night
  { base: "#c19a63", dark: "#7a5a36", cream: "#f3e6cc", inner: "#ead6bc", tip: "#4a3420", eye: "#4a2c17" }, // sand
  { base: "#8a8f94", dark: "#4c5157", cream: "#eef0f0", inner: "#e6dcd2", tip: "#2a2d31", eye: "#3b2a1c" }, // smoke
];
if (COATS.length !== KINDS) throw new Error("one coat for each kind");
/** On a dark ground a black coat is lost: there the night pup is sooty grey, with paler points. */
const ON_DARK: Partial<Record<number, Coat>> = {
  3: { base: "#7a726b", dark: "#4a443f", cream: "#e2d8c8", inner: "#e0d0bc", tip: "#2e2926", eye: "#3a2414" },
};
const coatOf = (kind: number, dark: boolean) => (dark && ON_DARK[kind]) || COATS[kind]!;

/** The meadow's own colours, for the Colour switch: dark and light. */
const MEADOW = { dark: { ground: "#1d281b", grass: "#33472c" }, light: { ground: "#e3ead3", grass: "#aebf8e" } };

interface PupView {
  model: PupModel;
  holder: THREE.Group;
  squash: THREE.Group;
  anim: Animator;
  face: Face;
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
  look: [{ x: number; v: number }, { x: number; v: number }];
  kind: number;
}

export class DenView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 200);
  private readonly sun = new THREE.DirectionalLight("#fff1dc", 2.3);
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private grass: THREE.InstancedMesh | null = null;
  private readonly grassMat: THREE.MeshBasicMaterial;
  private readonly sway = { value: 0 };
  private readonly ball: THREE.Mesh;
  private readonly shadowTex: THREE.Texture;
  private readonly views = new Map<string, PupView>();
  private geometry: PupGeometry | null = null;
  private look: WallpaperLook | null = null;
  private w = 1;
  private h = 1;
  private unit = 85;
  private t = 0;

  constructor(canvas: HTMLCanvasElement, private readonly shells = 4) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.rotation.x = -ELEV;
    this.camera.position.set(0, 60 * Math.sin(ELEV), 60 * Math.cos(ELEV));
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8a7f70", 1.35));
    this.sun.position.set(-3, 9, 7);
    this.scene.add(this.sun, this.sun.target);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.grassMat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
    this.grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uSway = this.sway;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uSway;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float s = sin(uSway * 1.3 + wp.x * 0.8 + wp.z * 0.5) * 0.6 + sin(uSway * 2.7 + wp.x * 2.1) * 0.25;
transformed.x += s * position.y * position.y * 3.0;`);
    };
    this.shadowTex = blobTexture();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshStandardMaterial({ color: "#d9573c", roughness: 0.5 }));
    this.ball.visible = false;
    this.scene.add(this.ball);
  }

  /** Build the shared pup mesh: done once, before the first frame. */
  prepare(step = 0.0155) {
    if (!this.geometry) this.geometry = buildPupGeometry({ step });
  }

  resize(w: number, h: number, dpr: number, unit: number) {
    this.w = w;
    this.h = h;
    this.unit = unit;
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(w, h, false);
    this.camera.left = 0;
    this.camera.right = w / unit;
    this.camera.top = 0;
    this.camera.bottom = -h / unit;
    this.camera.updateProjectionMatrix();
    const gw = w / unit + 4, gd = h / (unit * SLANT) + 4;
    this.ground.scale.set(gw, gd, 1);
    this.ground.position.set(w / unit / 2, -0.001, h / (unit * SLANT) / 2);
    this.sun.target.position.set(w / unit / 2, 0, h / (unit * SLANT) / 2);
    this.sun.position.set(this.sun.target.position.x - 3, 9, this.sun.target.position.z + 7);
    this.plantGrass();
  }

  setLook(look: WallpaperLook) {
    this.look = look;
    const own = look.colour ? (look.dark ? MEADOW.dark : MEADOW.light) : null;
    const ground = new THREE.Color(own ? own.ground : look.page);
    this.ground.material.color.copy(ground);
    this.renderer.setClearColor(ground);
    // Grass a step from the ground toward the text: there, but quiet.
    this.grassMat.color.copy(own ? new THREE.Color(own.grass) : new THREE.Color(look.page).lerp(new THREE.Color(look.text), 0.12));
    for (const v of this.views.values()) {
      (v.ring.material as THREE.MeshBasicMaterial).color.set(look.attention);
      setCoat(v.model.fur, coatOf(v.kind, look.dark));
    }
  }

  /** On the clock's step: pups meet their views, and each body moves a step toward its pose. */
  step(yard: Yard, dt: number) {
    this.t += dt;
    this.sway.value = this.t;
    this.sync(yard);
    for (const p of yard.pups.values()) {
      const v = this.views.get(p.id);
      if (v) this.pose(p, v, dt, yard);
    }
  }

  /** A still picture: every body straight into its pose. */
  settle(yard: Yard) {
    this.sync(yard);
    for (const p of yard.pups.values()) {
      const v = this.views.get(p.id);
      if (v) for (let i = 0; i < 90; i++) this.pose(p, v, 1 / 60, yard);
    }
  }

  draw(yard: Yard) {
    const u = this.unit;
    for (const p of yard.pups.values()) {
      const v = this.views.get(p.id);
      if (!v) continue;
      const gx = p.x / u, gz = p.y / (u * SLANT);
      v.holder.position.set(gx, COM.y * p.size + p.hop * p.size, gz);
      v.holder.scale.setScalar(p.size);
      const dz = Math.sin(p.heading) / SLANT, dx = Math.cos(p.heading);
      v.holder.rotation.set(0, Math.atan2(-dz, dx), 0);
      v.shadow.position.set(gx, 0.002, gz);
      v.shadow.scale.setScalar(p.size * (1 - Math.min(0.4, p.hop * 0.8)));
      (v.shadow.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - Math.min(0.6, p.hop));
      const calling = p.state === "needs-you" && !p.leaving;
      v.ring.visible = calling;
      if (calling) {
        v.ring.position.set(gx, 0.003, gz);
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
        v.ring.scale.setScalar(p.size * (1 + 0.12 * pulse));
        (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * pulse;
      }
    }
    if (yard.ball) {
      const b = yard.ball;
      const bounce = Math.abs(Math.sin(Math.min(b.t, 1.2) * 8)) * Math.max(0, 1 - b.t / 1.2) * 0.35;
      this.ball.position.set(b.x / u, 0.075 + bounce, b.y / (u * SLANT));
      this.ball.visible = true;
    } else this.ball.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  /** Pups that came get a body; pups gone lose theirs. */
  private sync(yard: Yard) {
    for (const [id, v] of this.views) {
      if (yard.pups.has(id)) continue;
      this.scene.remove(v.holder, v.shadow, v.ring);
      this.views.delete(id);
    }
    for (const p of yard.pups.values()) {
      const have = this.views.get(p.id);
      if (have && have.kind === p.kind) continue;
      if (have) { this.scene.remove(have.holder, have.shadow, have.ring); this.views.delete(p.id); }
      this.views.set(p.id, this.makeView(p));
    }
  }

  private makeView(p: Pup): PupView {
    this.prepare();
    const model = buildPup({ coat: coatOf(p.kind, this.look?.dark ?? false), shells: this.shells, geometry: this.geometry });
    // Coarser strands than up close: at this size, fine ones only fizz.
    model.fur.density.value = 105;
    const { holder, squash } = mountPup(model);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, toneMapped: false, color: "#000000" }));
    shadow.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.55, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, color: this.look?.attention ?? "#e8b04a" }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(holder, shadow, ring);
    return { model, holder, squash, anim: new Animator(model), face: makeFace(model), shadow, ring, look: [{ x: 0, v: 0 }, { x: 0, v: 0 }], kind: p.kind };
  }

  /** What the pup's body does this step, from what it is doing in the yard. */
  private pose(p: Pup, v: PupView, dt: number, yard: Yard) {
    const m: Motion = { t: this.t + p.seed * 10, ears: 0.3, wag: 0.25 };
    let name = "stand", lid = 0, mouth = 0;
    switch (p.act) {
      case "move":
        m.speed = p.speed;
        m.phase = p.phase;
        m.ears = p.state === "needs-you" ? -0.2 : 0.4;
        m.wag = p.chasing ? 0.9 : p.state === "working" ? 0.35 : 0.25;
        break;
      case "sit": name = "sit"; m.wag = p.state === "ready" ? 0.45 : 0.3; break;
      case "sniff": name = "sniff"; m.wag = 0.2; break;
      case "bow": name = "bow"; m.wag = 1; m.ears = 1; m.pant = 1; mouth = 0.3; break;
      case "sleep": name = "sleep"; lid = 1; m.ears = -0.6; m.wag = p.pet * 0.6; break;
      case "pet": name = "sit"; lid = 0.9; m.ears = -0.8; m.wag = 1; m.tilt = 0.22 * Math.sin(this.t * 1.7); mouth = 0.2; break;
    }
    if (p.hop > 0.12) { name = "air"; m.vy = p.hopV; }
    if (p.yip > 0) mouth = 0.85;
    if (p.state === "resting" && p.act !== "sleep") m.ears = -0.3;
    // The head turns to the pointer when it is near.
    let want: [number, number] = [0, 0];
    if (p.look && name !== "sleep") {
      const u = yard.unit;
      const target = new THREE.Vector3(p.look.x / u, 0.55, p.look.y / (u * SLANT));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, v.holder.rotation.y, 0));
      const head = new THREE.Vector3(0.3, 0.66 - COM.y, 0).multiplyScalar(p.size).applyQuaternion(q).add(v.holder.position);
      const d = target.sub(head).applyQuaternion(q.invert());
      want = [clamp(Math.atan2(-d.z, d.x), -1.0, 1.0), clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.26)];
    }
    for (let i = 0; i < 2; i++) {
      const s = v.look[i]!;
      s.v += (160 * (want[i]! - s.x) - 2 * Math.sqrt(160) * s.v) * dt;
      s.x += s.v * dt;
    }
    m.look = [v.look[0].x, v.look[1].x];
    v.anim.update(dt, name, m);
    updateFace(v.face, dt, this.t + p.seed * 10, { lidTarget: lid, mouth, camera: this.camera, light: this.sun });
  }

  /** Tufts of grass over the ground, as many as the window's size wants, the same each time: a few
   *  short blades fanned out from one root, soft against the ground. */
  private plantGrass() {
    if (this.grass) { this.scene.remove(this.grass); this.grass.dispose(); }
    const pts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = -0.7 + (1.4 * i) / 4, h = 0.07 + 0.035 * (1 - Math.abs(a));
      const bx = Math.sin(a) * 0.012, tx = Math.sin(a) * 0.05;
      pts.push(bx - 0.008, 0, 0, bx + 0.008, 0, 0, tx, h, 0);
    }
    const tuft = new THREE.BufferGeometry();
    tuft.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const count = Math.round(Math.min(260, Math.max(60, (this.w * this.h) / 7000)));
    const grass = new THREE.InstancedMesh(tuft, this.grassMat, count);
    let s = 7;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const W = this.w / this.unit, D = this.h / (this.unit * SLANT);
    for (let i = 0; i < count; i++) {
      p.set(r() * W, 0, r() * D);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.6);
      const k = 0.8 + r() * 0.7;
      sc.set(k, k, k);
      m4.compose(p, q, sc);
      grass.setMatrixAt(i, m4);
    }
    this.grass = grass;
    this.scene.add(grass);
  }
}

function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  // The blob is drawn black; its alpha is the gradient.
  return t;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
