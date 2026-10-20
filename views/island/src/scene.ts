// The islands in three.js, built from the packed models: hex tiles, forests, hills and fields; a
// workshop for every agent and the village it builds, one lot a step for every finished turn; and
// the agent itself, walking to its work. Every model is drawn instanced, so a hundred agents cost
// what ten do, and the light follows the hour.
import * as THREE from "three";
import { N8AOPostPass } from "n8ao";
import { BloomEffect, BlendFunction, BrightnessContrastEffect, EffectComposer, HueSaturationEffect, EffectPass, KernelSize, NoiseEffect, RenderPass, TiltShiftEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import type { Assets, Move, Who } from "./assets";
import { Pins } from "./pins";
import { Atmosphere } from "./atmosphere";
import { LOTS, STEPS, hash, tilesApart, houseOf, keepOf, random, skyAt, townOf, type Biome, type Cell, type Island, type Mood, type Sky, type Spot } from "./world";

export interface Palette {
  mode: "dark" | "light";
  working: string; attention: string; idle: string; exited: string; failed: string; done: string; accent: string;
}
export interface Pick { kind: "agent" | "island"; id: string }

/** What green turns to on each kind of island: its grass, and the leaves its trees pick from. Every
 *  season shares the same greens; it differs in how many trees turn. */
const GREENS = [0x5f9d42, 0x6fae49, 0x4f8a3d, 0x83b74f, 0x679f45];
const TINT: Record<Biome, { grass: number; leaves: number[]; turned: number[]; share: number }> = {
  meadow: { grass: 0x6aa847, leaves: GREENS, turned: [0xd98b3a, 0xe0a640], share: 0.08 },
  blossom: { grass: 0x72ad4a, leaves: GREENS, turned: [0xd9c35a, 0xe39a48], share: 0.16 },
  autumn: { grass: 0x86ab49, leaves: GREENS, turned: [0xe08a34, 0xd2682e, 0xe4ae42], share: 0.45 },
  snow: { grass: 0xd8e4dc, leaves: [0x8fb39a, 0x7aa486], turned: [0xe2ece6, 0xd2e2d8], share: 0.55 },
};
/** The beach round every coast. */
const SAND = 0xe6d3a3;
const CAMP = ["barrel", "crate_A_big", "sack", "wheelbarrow"];
/** Who works for each agent CLI; others by their name. */
const WHO: Record<string, Who> = { claude: "knight", codex: "mage", gemini: "rogue", cursor: "barbarian" };
const whoOf = (agent: string | undefined): Who => WHO[agent ?? ""] ?? (["barbarian", "knight", "mage", "rogue"] as Who[])[hash(agent ?? "x") % 4]!;
/** Steps a lot shows: ground laid, the frame up, the house finished. */
const STAGE = ["building_stage_A", "building_stage_C"];
const SEA = -0.3;

const GREY = new THREE.Color(0xd9dde3), FLAME = new THREE.Color(2.4, 1.1, 0.3), EMBER = new THREE.Color(2, 1.2, 0.5), RED = new THREE.Color(), DARK = new THREE.Color(0x333333);
const V3 = new THREE.Vector3(), SITE = new THREE.Vector3(), WORK = new THREE.Vector3();
const C2 = new THREE.Color(), M4 = new THREE.Matrix4(), M5 = new THREE.Matrix4(), M6 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
const compose = (x: number, y: number, z: number, ry: number, sx: number, sy = sx, sz = sx) => M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(0, ry, 0)), S.set(sx, sy, sz));
const backOut = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
/** A hex turn: buildings line up with their tile. */
const hexTurn = (a: number) => Math.round(a / (Math.PI / 3)) * (Math.PI / 3);

// ── many copies of the packed models ────────────────────────────────────────
interface Item { name: string; x: number; y: number; z: number; ry: number; s: number; tint?: number; owner?: string; born?: number; spin?: boolean; hide?: boolean }
class Batch {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.InstancedMesh; items: Item[] }[] = [];
  /** What it draws now. */
  items: Item[] = [];
  private growing: { mesh: THREE.InstancedMesh; i: number; item: Item }[] = [];
  private spinning: { mesh: THREE.InstancedMesh; i: number; item: Item }[] = [];
  constructor(private assets: Assets, private material: (name: string) => THREE.Material) {}
  set(items: Item[]): void {
    this.items = items;
    for (const p of this.parts) { this.group.remove(p.mesh); p.mesh.dispose(); }
    this.parts = []; this.growing = []; this.spinning = [];
    const byName = new Map<string, Item[]>();
    for (const it of items) { const l = byName.get(it.name); if (l) l.push(it); else byName.set(it.name, [it]); }
    for (const [name, list] of byName) {
      const geo = this.assets.kit.model.get(name);
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, this.material(name), list.length);
      mesh.castShadow = !name.startsWith("cloud");
      mesh.receiveShadow = true;
      const tinted = list.some((it) => it.tint !== undefined);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, this.matrix(it, 1, 0));
        if (tinted) mesh.setColorAt(i, C.setHex(it.tint ?? 0xffffff));
        if (it.born) this.growing.push({ mesh, i, item: it });
        if (it.spin) this.spinning.push({ mesh, i, item: it });
      });
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.parts.push({ mesh, items: list });
    }
  }
  private matrix(it: Item, grown: number, turn: number): THREE.Matrix4 {
    if (it.hide) return compose(it.x, it.y, it.z, 0, 0);
    const m = compose(it.x, it.y, it.z, it.ry, it.s * (0.55 + 0.45 * Math.min(1, grown)), it.s * grown, it.s * (0.55 + 0.45 * Math.min(1, grown)));
    if (!it.spin) return m;
    const p = this.assets.kit.part.get(it.name);
    if (!p) return m;
    return m.multiply(M5.makeTranslation(p.hub.x, p.hub.y, p.hub.z)).multiply(M6.makeRotationAxis(p.axle, turn)).multiply(M5.makeTranslation(-p.hub.x, -p.hub.y, -p.hub.z));
  }
  /** Raises what was just built and turns the sails; true while anything still grows. */
  step(now: number, t: number, still: boolean): boolean {
    let busy = false;
    const touched = new Set<THREE.InstancedMesh>();
    this.growing = this.growing.filter(({ mesh, i, item }) => {
      const k = still ? 1 : Math.min(1, (now - item.born!) / 900);
      mesh.setMatrixAt(i, this.matrix(item, k >= 1 ? 1 : Math.max(0.001, backOut(k)), t * 0.8));
      touched.add(mesh);
      if (k < 1) { busy = true; return true; }
      return false;
    });
    if (!still) for (const { mesh, i, item } of this.spinning) { mesh.setMatrixAt(i, this.matrix(item, 1, t * 0.8)); touched.add(mesh); }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    return busy;
  }
  /** Every copy where its item now says. */
  redraw(): void {
    for (const p of this.parts) { p.items.forEach((it, i) => p.mesh.setMatrixAt(i, this.matrix(it, 1, 0))); p.mesh.instanceMatrix.needsUpdate = true; }
  }
}

// ── particles: smoke, sparks, fire, dust ────────────────────────────────────
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array; private grow: Float32Array; private drag: Float32Array;
  private next = 0;
  live = 0;
  constructor(private cap: number, additive: boolean) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.grow = new Float32Array(cap); this.drag = new Float32Array(cap);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, pointMaterial(additive));
    this.points.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, grow = 0, drag = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow; this.drag[i] = drag;
  }
  step(dt: number, gravity: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) { this.alpha[i] = 0; continue; }
      live++;
      this.life[i]! -= dt;
      const k = 1 - this.drag[i]! * dt;
      this.vel[i * 3]! *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * k - gravity * dt; this.vel[i * 3 + 2]! *= k;
      this.pos[i * 3]! += this.vel[i * 3]! * dt; this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt; this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.size[i]! += this.grow[i]! * dt;
      const t = Math.max(0, this.life[i]! / this.max[i]!);
      this.alpha[i] = Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 8 + 0.15);
    }
    this.live = live;
    const g = this.points.geometry;
    for (const n of ["position", "color", "size", "alpha"]) (g.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
  clear(): void { this.life.fill(0); this.alpha.fill(0); this.step(0, 0); }
}
/** Soft round points sized in the world; `strength` scales every point's light. */
function pointMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { scale: { value: 300 }, strength: { value: 1 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vColor; varying float vAlpha; uniform float scale;
      void main() { vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha; uniform float strength;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = vAlpha * smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vColor * strength, a); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ── each agent, on screen ───────────────────────────────────────────────────
interface Worker {
  tileId: string; spot: Spot; island: Island; who: Who; agent?: string;
  home: THREE.Vector3; out: THREE.Vector3; side: THREE.Vector3;
  door: THREE.Vector3; fire: THREE.Vector3; seat: THREE.Vector3; chimney: THREE.Vector3;
  pos: THREE.Vector3; heading: number; mood: Mood; activity: number; subagents: number; phase: number;
  turns: number; cheerUntil: number;
}
interface Tie { a: string; b: string; kind: "spawn" | "pipe"; line: THREE.Line }

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
  private composer: EffectComposer;
  private bloom: BloomEffect;
  private tilt: TiltShiftEffect;
  private tiltPass: EffectPass;
  /** Soft shadow where things meet: a house on its tile, a tree in a forest. The first thing dropped when frames run slow. */
  private ao: N8AOPostPass;
  private noise: NoiseEffect;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private fill = new THREE.HemisphereLight(0xdfefff, 0x6b7a5a, 0.6);
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sea: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private shore: THREE.DataTexture | null = null;
  private light: { day: THREE.Texture; night: THREE.Texture };
  private land: Batch;
  private beach: Batch;
  private town: Batch;
  private clouds: Batch;
  private cloudItems: Item[] = [];
  private landMaterial: THREE.MeshStandardMaterial;
  /** The trees' own copy of it, which sways in the wind. */
  private treeMaterial: THREE.MeshStandardMaterial;
  private wind = { value: 0 };
  private kitMaterial: THREE.MeshStandardMaterial;
  private smoke = new Particles(2400, false);
  private sparks = new Particles(2400, true);
  private glows: THREE.Points;
  private people = new Map<string, THREE.InstancedMesh>();
  private workers = new Map<string, Worker>();
  private order: Worker[] = [];
  private islands = new Map<string, Island>();
  private spots = new Map<string, Spot>();
  private ties: Tie[] = [];
  private columns = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.09, 7, 10, 1, true).translate(0, 3.5, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, fog: false }), 256);
  private ripples = new THREE.InstancedMesh(new THREE.RingGeometry(0.42, 0.52, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }), 256);
  private calling: string[] = [];
  /** What every agent is doing, readable from the overview. */
  private pins = new Pins();
  /** Soft clouds, shore mist and birds. */
  private air = new Atmosphere();
  /** A soft dark patch on the ground under every building and tree, so nothing floats without shadows. */
  private blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1d2a1a, alphaMap: blobTexture(), transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 1);
  private pal!: Palette;
  hour = 12;
  private now: Sky = skyAt(12);
  private ray = new THREE.Raycaster();
  /** The camera: what it looks at, how far, how turned and how tilted; `goal` is where it is going. */
  readonly view = { x: 0, z: 0, dist: 60, yaw: 0.75, pitch: 0.82 };
  readonly goal = { x: 0, z: 0, dist: 60, yaw: 0.75, pitch: 0.82 };
  reduced = false;
  shadows = true;
  effects = true;
  bounds = 30;
  /** How much it draws, stepped down while frames come too slowly: 0 is everything; 1 drops the
   *  multisampling; 2 also the focus blur and draws at one pixel a point; 3 also the shadows and effects. */
  quality = 0;
  private size = { w: 1, h: 1 };
  /** Drawn without a graphics card: no camera effects, no shadows, so it stays responsive. */
  readonly software: boolean;
  /** What draws it. */
  readonly gpu: string;

  constructor(private assets: Assets) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, depth: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.info.autoReset = false;
    const gl = this.renderer.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.software = /llvmpipe|swiftshader|software|softpipe/i.test(this.gpu);
    if (this.software) this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.light = { day: pmrem.fromEquirectangular(assets.skyDay).texture, night: pmrem.fromEquirectangular(assets.skyNight).texture };
    pmrem.dispose();
    this.scene.environment = this.light.day;
    this.scene.fog = new THREE.Fog(0xcfe6ee, 80, 400);
    this.kitMaterial = assets.kit.material;
    this.kitMaterial.envMapIntensity = 1;
    this.landMaterial = tinted(assets.kit.material);
    this.treeMaterial = tinted(assets.kit.material, this.wind);
    const leafy = (n: string) => n === "hex_grass" || /^(trees_|tree_single|hills_|mountain_)/.test(n);
    const material = (n: string) => (/^(trees_|tree_single)/.test(n) ? this.treeMaterial : leafy(n) ? this.landMaterial : this.kitMaterial);
    this.land = new Batch(assets, material);
    this.town = new Batch(assets, material);
    this.beach = new Batch(assets, () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
    this.clouds = new Batch(assets, () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, fog: false }));
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial());
    this.sky.renderOrder = -1;
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), seaMaterial());
    this.sea.position.y = SEA;
    this.glows = new THREE.Points(new THREE.BufferGeometry(), pointMaterial(true));
    this.glows.frustumCulled = false;
    this.scene.add(this.sky, this.sea, this.sun, this.sun.target, this.fill, this.land.group, this.beach.group, this.town.group, this.clouds.group, this.glows, this.smoke.points, this.sparks.points);
    for (const m of [this.columns, this.ripples]) { m.count = 0; m.frustumCulled = false; m.setColorAt(0, C.set(0xffffff)); this.scene.add(m); }
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1; this.scene.add(this.blobs);
    this.scene.add(this.pins.mesh, this.air.clouds, this.air.birds);
    // Every pose of every worker: one instanced mesh each, filled each frame with whoever holds it.
    for (const [who, moves] of assets.people.poses) for (const [move, frames] of moves) frames.forEach((g, f) => {
      const m = new THREE.InstancedMesh(g, assets.people.materials.get(who)!, 8);
      m.count = 0; m.castShadow = true; m.frustumCulled = false; m.visible = false;
      this.people.set(`${who}:${move}:${f}`, m);
      this.scene.add(m);
    });
    // The picture: bloom for lit windows and fire, a narrow band in focus like a model town, a soft
    // edge, a little grain, and filmic colour.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: this.software ? 0 : 4 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
    // A tile is about two units across: shade a third of one, fading over the same.
    Object.assign(this.ao.configuration, { aoRadius: 0.7, distanceFalloff: 1, intensity: 2.4, halfRes: true, color: new THREE.Color(0x101a24) });
    this.composer.addPass(this.ao);
    this.tilt = new TiltShiftEffect({ focusArea: 0.5, feather: 0.4, kernelSize: KernelSize.SMALL, offset: 0.06 });
    this.bloom = new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.6, mipmapBlur: true, radius: 0.72 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    this.noise.blendMode.opacity.value = 0.18;
    this.tiltPass = new EffectPass(this.camera, this.tilt);
    this.composer.addPass(this.tiltPass);
    this.composer.addPass(new EffectPass(this.camera, this.bloom, new VignetteEffect({ offset: 0.32, darkness: 0.42 }), this.noise, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new HueSaturationEffect({ saturation: 0.04 }), new BrightnessContrastEffect({ contrast: 0.08 })));
    this.setHour(12);
    this.setEffects(true);
  }

  setPalette(p: Palette): void {
    this.pal = p;
    this.pins.setColors({ working: p.working, calling: p.attention, done: p.done, failed: p.failed, idle: p.idle, gone: p.exited });
    for (const t of this.ties) (t.line.material as THREE.LineDashedMaterial).color.set(t.kind === "pipe" ? p.accent : p.working);
  }

  /** The light of hour `h` (0–24): the sun, the sky, the sea and how bright the windows are. */
  setHour(h: number): void {
    this.hour = h;
    const s = (this.now = skyAt(h));
    this.sun.color.setHex(s.key);
    this.sun.intensity = s.keyI * 0.95;
    this.fill.color.setHex(s.above);
    this.fill.groundColor.setHex(s.below);
    this.fill.intensity = s.ambientI * 0.45;
    const night = s.lamps > 0.55;
    this.scene.environment = night ? this.light.night : this.light.day;
    this.scene.environmentIntensity = night ? 0.8 : 0.35 + s.keyI * 0.08;
    (this.scene.fog as THREE.Fog).color.setHex(s.horizon);
    const u = this.sky.material.uniforms, w = this.sea.material.uniforms;
    u.top!.value.setHex(s.top); u.horizon!.value.setHex(s.horizon); u.stars!.value = s.lamps;
    w.deep!.value.setHex(s.deep); w.shallow!.value.setHex(s.shallow); w.horizon!.value.setHex(s.horizon); w.sky!.value.setHex(s.top);
    w.sunColor!.value.setHex(s.key).multiplyScalar(night ? 0.6 : 1.4);
    this.bloom.intensity = 0.45 + s.lamps * 1.1;
    (this.glows.material as THREE.ShaderMaterial).uniforms.strength!.value = s.lamps * 3.2;
    this.placeSun();
  }
  /** Where the light comes from: east in the morning, overhead at noon, the moon high at night. */
  private placeSun(): void {
    const s = this.now, b = this.bounds;
    const day = this.hour >= 6 && this.hour <= 19;
    const az = day ? Math.PI * ((this.hour - 6) / 13) : Math.PI * 0.3;
    const up = Math.max(0.18, s.height);
    const d = new THREE.Vector3(Math.cos(az) * Math.sqrt(1 - up * up), up, -Math.sin(az) * Math.sqrt(1 - up * up) * 0.6 - 0.4).normalize();
    this.sun.position.copy(d).multiplyScalar(b * 2 + 60);
    this.sun.target.position.set(0, 0, 0);
    this.sky.material.uniforms.sunDir!.value.copy(d);
    this.sea.material.uniforms.sunDir!.value.copy(d);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -b - 6; c.right = c.top = b + 6; c.near = 1; c.far = b * 5 + 140;
    c.updateProjectionMatrix();
  }

  resize(w: number, h: number): void {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.pins.setViewport(w, h);
    const s = this.renderer.getPixelRatio() * h * 0.5;
    for (const p of [this.smoke.points, this.sparks.points, this.glows]) (p.material as THREE.ShaderMaterial).uniforms.scale!.value = s;
  }

  // ── building the world from the workspace ──────────────────────────────────
  build(islands: Map<string, Island>, spots: Map<string, Spot>, agents: Map<string, string | undefined>, links: { a: string; b: string; kind: "spawn" | "pipe" }[]): void {
    const keep = new Map(this.workers);
    this.islands = islands;
    this.spots = spots;
    let far = 20;
    const items: Item[] = [], beach: Item[] = [];
    for (const isl of islands.values()) {
      far = Math.max(far, Math.hypot(isl.x, isl.z) + isl.r);
      const tint = TINT[isl.biome];
      const rand = random(isl.seed ^ 0x51ed27);
      const leaf = () => rand() < tint.share ? tint.turned[Math.floor(rand() * tint.turned.length)]! : tint.leaves[Math.floor(rand() * tint.leaves.length)]!;
      const middle = isl.cells[0]!;
      const at = (c: Cell, name: string, s = 1, tintOf?: number, dx = 0, dz = 0, ry = (c.turn * Math.PI) / 3) => items.push({ name, x: c.x + dx, y: 0, z: c.z + dz, ry, s, ...(tintOf !== undefined ? { tint: tintOf } : {}) });
      const onShore = (c: Cell) => isl.cells.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 2.2).length < 7;
      const tree = (c: Cell, s: number, dx: number, dz: number) => at(c, rand() < 0.5 ? "tree_single_A" : "tree_single_B", s, leaf(), dx, dz, rand() * 6.28);
      const rock = (c: Cell, s: number, dx: number, dz: number) => at(c, ["rock_single_A", "rock_single_C", "rock_single_E"][Math.floor(rand() * 3)]!, s, undefined, dx, dz, rand() * 6.28);
      const spread = () => (rand() - 0.5) * 1.1;
      for (const c of isl.cells) {
        // Each tile its own shade of the island's grass, a little lighter and yellower by the shore.
        const shore = onShore(c);
        C.setHex(tint.grass).lerp(C2.setHex(rand() < 0.5 ? 0xa9bd5c : 0x5f9e4a), rand() * 0.3).lerp(C2.setHex(0xb8bf6a), shore ? 0.12 : 0).multiplyScalar(0.93 + rand() * 0.12);
        items.push({ name: "hex_grass", x: c.x, y: 0, z: c.z, ry: 0, s: 1, tint: C.getHex() });
        if (shore) beach.push({ name: "hex_grass", x: c.x, y: -0.17, z: c.z, ry: 0, s: 1.17, tint: SAND });
        if (c.use === "forest") at(c, ["trees_A_large", "trees_B_large", "trees_A_medium", "trees_B_medium"][Math.floor(rand() * 4)]!, 1, leaf());
        else if (c.use === "hill") at(c, isl.cells.length > 60 && rand() < 0.35 ? (rand() < 0.5 ? "mountain_A_grass_trees" : "mountain_B_grass") : rand() < 0.5 ? "hills_A_trees" : "hills_B", 1, C.getHex());
        else if (c.use === "field") at(c, "building_grain");
        else if (c.use === "grass") {
          // No tile left bare: a few trees, a rock, and near the keep the village's barrels and carts.
          const r = rand(), town = tilesApart(c, middle) <= 2;
          if (town && r < 0.45) {
            for (let k = 0; k < 2; k++) at(c, CAMP[Math.floor(rand() * CAMP.length)]!, 1.25, undefined, spread(), spread(), rand() * 6.28);
            tree(c, 0.8 + rand() * 0.2, spread(), spread());
          } else if (r < 0.6) {
            const n = 2 + Math.floor(rand() * 2);
            for (let k = 0; k < n; k++) tree(c, 0.7 + rand() * 0.35, spread(), spread());
            if (rand() < 0.5) rock(c, 1, spread(), spread());
          } else if (r < 0.8) at(c, "trees_A_small", 1, leaf());
          else { tree(c, 0.85 + rand() * 0.25, spread(), spread()); rock(c, 1.2, spread(), spread()); }
        }
      }
      // Lilies and reeds in the shallows.
      for (const c of isl.cells) {
        if (onShore(c) && rand() < 0.3) {
          const a = rand() * Math.PI * 2;
          const x = c.x + Math.cos(a) * 1.6, z = c.z + Math.sin(a) * 1.6;
          if (isl.cells.some((o) => Math.hypot(o.x - x, o.z - z) < 1.3)) continue;
          items.push({ name: rand() < 0.6 ? "waterlily_A" : "waterplant_A", x, y: SEA + 0.01, z, ry: rand() * 6.28, s: 1.6 });
        }
      }
    }
    // A bridge from each worktree to the island it was made from.
    for (const isl of islands.values()) {
      const p = isl.parentId ? islands.get(isl.parentId) : undefined;
      if (!p) continue;
      let best: [Cell, Cell] | null = null, bd = Infinity;
      for (const a of p.cells) for (const b of isl.cells) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = [a, b]; } }
      if (!best) continue;
      const [a, b] = best, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) - 1.9, ux = dx / (len + 1.9), uz = dz / (len + 1.9);
      const n = Math.max(1, Math.round(len / 1.9));
      for (let i = 0; i < n; i++) {
        const k = 0.95 + (i + 0.5) * (len / n);
        items.push({ name: "building_bridge_A", x: a.x + ux * k, y: 0, z: a.z + uz * k, ry: Math.atan2(ux, uz), s: 1 });
      }
    }
    this.land.set(items);
    this.beach.set(beach);
    this.bounds = far;
    this.makeShore(far + 12);
    this.makeClouds(far);
    this.air.build([...this.islands.values()].map((i) => ({ x: i.x, z: i.z, r: i.r })), far);
    // Every agent's places.
    this.workers.clear();
    this.order = [];
    for (const spot of spots.values()) {
      if (!spot.agent) continue;
      const isl = islands.get(spot.islandId)!;
      const before = keep.get(spot.tileId);
      const ry = hexTurn(Math.PI / 2 - spot.facing);
      const out = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const side = new THREE.Vector3(out.z, 0, -out.x);
      const home = new THREE.Vector3(spot.x, 0, spot.z);
      const along = (o: number, s: number) => home.clone().addScaledVector(out, o).addScaledVector(side, s);
      const agent = agents.get(spot.tileId);
      const w: Worker = {
        tileId: spot.tileId, spot, island: isl, who: whoOf(agent), agent,
        home, out, side, door: along(0.95, 0), fire: along(0.85, -0.62), seat: along(0.55, -0.98), chimney: along(-0.25, 0.3).setY(1.15),
        pos: before?.pos.clone() ?? along(0.95, 0.2), heading: before?.heading ?? ry, mood: before?.mood ?? "idle", activity: before?.activity ?? 0,
        subagents: before?.subagents ?? 0, phase: (hash(spot.tileId) % 1000) / 160, turns: before?.turns ?? 0, cheerUntil: 0,
      };
      this.workers.set(spot.tileId, w);
      this.order.push(w);
    }
    for (const m of this.people.values()) if (m.instanceMatrix.count < this.order.length * 5) {
      const bigger = new THREE.InstancedMesh(m.geometry, m.material, Math.max(8, this.order.length * 5));
      bigger.castShadow = true; bigger.frustumCulled = false; bigger.count = 0; bigger.visible = false;
      this.scene.remove(m); m.dispose(); this.scene.add(bigger);
      for (const [k, v] of this.people) if (v === m) this.people.set(k, bigger);
    }
    this.buildTown(new Set());
    // Which agent started which, and which feeds which.
    for (const t of this.ties) { this.scene.remove(t.line); t.line.geometry.dispose(); }
    this.ties = [];
    for (const l of links) {
      const a = this.workers.get(l.a), b = this.workers.get(l.b);
      if (!a || !b) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.arc(a.door, b.door).getPoints(48)), new THREE.LineDashedMaterial({ color: l.kind === "pipe" ? this.pal.accent : this.pal.working, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.8 }));
      line.computeLineDistances();
      this.scene.add(line);
      this.ties.push({ ...l, line });
    }
    this.placeSun();
    this.applyShadows();
    // Every material's program now, not on the frame something first shows.
    this.renderer.compile(this.scene, this.camera);
  }

  /** The villages: each agent's workshop and lots, each island's keep, tents, and the window lights. */
  private buildTown(fresh: Set<string>): void {
    const items: Item[] = [], glow: number[] = [], glowCol: number[] = [];
    const now = performance.now();
    const warm = new THREE.Color(1, 0.62, 0.28);
    const light = (x: number, y: number, z: number, k = 1) => { glow.push(x, y, z); glowCol.push(warm.r * k, warm.g * k, warm.b * k); };
    const turnsOn = new Map<string, number>();
    for (const w of this.order) turnsOn.set(w.island.id, (turnsOn.get(w.island.id) ?? 0) + w.turns);
    for (const isl of this.islands.values()) {
      const c = isl.cells[0]!;
      const keep = keepOf(turnsOn.get(isl.id) ?? 0);
      const name = `building_${keep}_${isl.colour}`;
      const born = fresh.has(`keep:${isl.id}`) ? now : undefined;
      items.push({ name, x: c.x, y: 0, z: c.z, ry: Math.PI / 6, s: keep === "castle" ? 1 : 1.15, born });
      if (keep === "windmill") items.push({ name: `building_windmill_top_${isl.colour}`, x: c.x, y: 0, z: c.z, ry: Math.PI / 6, s: 1.15, spin: true });
      items.push({ name: `flag_${isl.colour}`, x: c.x + 0.85, y: 0, z: c.z + 0.6, ry: 0.4, s: 2.2 });
      light(c.x, keep === "castle" ? 1.6 : 0.5, c.z + 0.55, keep === "castle" ? 1.6 : 1);
      for (const t of isl.cells.filter((x) => x.use === "tent")) {
        items.push({ name: "tent", x: t.x, y: 0, z: t.z, ry: (t.turn * Math.PI) / 3, s: 1.7 });
        items.push({ name: "barrel", x: t.x + 0.55, y: 0, z: t.z + 0.3, ry: 0, s: 1.4 });
      }
    }
    for (const w of this.order) {
      const ry = hexTurn(Math.PI / 2 - w.spot.facing);
      const colour = w.island.colour;
      items.push({ name: `building_blacksmith_${colour}`, x: w.home.x, y: 0, z: w.home.z, ry, s: 1, owner: w.tileId });
      items.push({ name: "resource_lumber", x: w.fire.x, y: 0, z: w.fire.z, ry: ry + 0.6, s: 0.55 });
      light(w.door.x - w.out.x * 0.3, 0.42, w.door.z - w.out.z * 0.3);
      const steps = townOf(LOTS, w.turns);
      w.spot.lots.forEach((lot, i) => {
        const s = steps[i] ?? 0;
        const face = hexTurn(Math.atan2(w.home.x - lot.x, w.home.z - lot.z));
        const born = fresh.has(`${w.tileId}:${i}`) ? now : undefined;
        if (s === 0) {
          // The next lot: its timber waiting. Later ones stay meadow until their turn comes.
          if (i === steps.length) items.push({ name: "resource_lumber", x: lot.x, y: 0, z: lot.z, ry: face + 0.4, s: 1.2 });
          else {
            const leaves = TINT[w.island.biome].leaves;
            items.push({ name: i % 2 ? "tree_single_A" : "tree_single_B", x: lot.x + 0.35, y: 0, z: lot.z - 0.2, ry: face, s: 0.85, tint: leaves[i % leaves.length]! });
            items.push({ name: "rock_single_C", x: lot.x - 0.4, y: 0, z: lot.z + 0.3, ry: face, s: 1 });
          }
          return;
        }
        if (s < 3) {
          items.push({ name: "building_dirt", x: lot.x, y: 0, z: lot.z, ry: face, s: 0.9 });
          items.push({ name: STAGE[s - 1]!, x: lot.x, y: 0, z: lot.z, ry: face, s: 1.15, owner: w.tileId, born });
          if (s === 2) items.push({ name: "building_scaffolding", x: lot.x, y: 0, z: lot.z, ry: face, s: 0.82, born });
          items.push({ name: "resource_stone", x: lot.x + 0.7, y: 0, z: lot.z - 0.3, ry: face, s: 1 });
          return;
        }
        const house = houseOf(i);
        items.push({ name: `building_${house}_${colour}`, x: lot.x, y: 0, z: lot.z, ry: face, s: house === "market" ? 1 : 1.1, owner: w.tileId, born });
        light(lot.x + Math.sin(face) * 0.42, 0.38, lot.z + Math.cos(face) * 0.42);
        if (i % 2 === 0) items.push({ name: i % 4 === 0 ? "barrel" : "crate_A_big", x: lot.x + Math.sin(face + 1) * 0.7, y: 0, z: lot.z + Math.cos(face + 1) * 0.7, ry: face, s: 1.3 });
      });
    }
    this.town.set(items);
    this.findTops();
    this.placeBlobs();
    const g = this.glows.geometry;
    g.setAttribute("position", new THREE.Float32BufferAttribute(glow, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(glowCol, 3));
    g.setAttribute("size", new THREE.Float32BufferAttribute(new Array(glow.length / 3).fill(0.55), 1));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(new Array(glow.length / 3).fill(1), 1));
  }

  /** How far every patch of sea is from land, for the shallows and the foam. */
  private makeShore(half: number): void {
    const N = 512, step = (half * 2) / N, x0 = -half, z0 = -half;
    const d = new Float32Array(N * N).fill(1e9);
    const R = 2 / Math.sqrt(3);
    for (const isl of this.islands.values()) for (const c of isl.cells) {
      const i0 = Math.max(0, Math.floor((c.x - 1 - x0) / step)), i1 = Math.min(N - 1, Math.ceil((c.x + 1 - x0) / step));
      const j0 = Math.max(0, Math.floor((c.z - R - z0) / step)), j1 = Math.min(N - 1, Math.ceil((c.z + R - z0) / step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = Math.abs(x0 + (i + 0.5) * step - c.x), dz = Math.abs(z0 + (j + 0.5) * step - c.z);
        if (dx <= 1 && dz <= R - dx / Math.sqrt(3)) d[j * N + i] = 0;
      }
    }
    // Two sweeps of a chamfer distance.
    const a = step, b = step * Math.SQRT2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let v = d[j * N + i]!;
      if (i > 0) v = Math.min(v, d[j * N + i - 1]! + a);
      if (j > 0) { v = Math.min(v, d[(j - 1) * N + i]! + a); if (i > 0) v = Math.min(v, d[(j - 1) * N + i - 1]! + b); if (i < N - 1) v = Math.min(v, d[(j - 1) * N + i + 1]! + b); }
      d[j * N + i] = v;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      let v = d[j * N + i]!;
      if (i < N - 1) v = Math.min(v, d[j * N + i + 1]! + a);
      if (j < N - 1) { v = Math.min(v, d[(j + 1) * N + i]! + a); if (i < N - 1) v = Math.min(v, d[(j + 1) * N + i + 1]! + b); if (i > 0) v = Math.min(v, d[(j + 1) * N + i - 1]! + b); }
      d[j * N + i] = v;
    }
    const px = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) px[k] = Math.min(255, Math.round((d[k]! / 12) * 255));
    this.shore?.dispose();
    const t = (this.shore = new THREE.DataTexture(px, N, N, THREE.RedFormat, THREE.UnsignedByteType));
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    const u = this.sea.material.uniforms;
    u.shore!.value = t;
    u.box!.value.set(x0, z0, half * 2, half * 2);
  }

  private placeBlobs(): void {
    const list: Item[] = [];
    for (const batch of [this.land, this.town]) for (const it of batch.items) if (!it.hide && !it.spin && /^(building_(?!grain|dirt|bridge)|trees_|tree_single|tent)/.test(it.name) && this.assets.kit.model.get(it.name)?.boundingBox) list.push(it);
    if (this.blobs.instanceMatrix.count < list.length) {
      const bigger = new THREE.InstancedMesh(this.blobs.geometry, this.blobs.material, list.length + 64);
      bigger.frustumCulled = false; bigger.renderOrder = 1;
      this.scene.remove(this.blobs); this.blobs.dispose(); this.blobs = bigger; this.scene.add(bigger);
    }
    list.forEach((it, i) => {
      const b = this.assets.kit.model.get(it.name)!.boundingBox!;
      const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * it.s * 1.25;
      this.blobs.setMatrixAt(i, compose(it.x, 0.012, it.z, it.ry, size));
    });
    this.blobs.count = list.length;
    this.blobs.instanceMatrix.needsUpdate = true;
  }
  /** The highest point on each tile of each island, for its name to float above. */
  private tops = new Map<string, THREE.Vector3[]>();
  private findTops(): void {
    const best = new Map<string, Map<string, THREE.Vector3>>();
    for (const isl of this.islands.values()) best.set(isl.id, new Map(isl.cells.map((c) => [`${c.q},${c.r}`, new THREE.Vector3(c.x, 0, c.z)])));
    const heightOf = (name: string, s: number) => ((this.assets.kit.model.get(name)?.boundingBox?.max.y ?? 0) * s);
    for (const batch of [this.land, this.town]) for (const it of batch.items) {
      if (it.hide) continue;
      const h = heightOf(it.name, it.s);
      if (h <= 0) continue;
      for (const isl of this.islands.values()) {
        if (Math.hypot(it.x - isl.x, it.z - isl.z) > isl.r + 1) continue;
        let near: Cell | null = null, d = 1.3;
        for (const c of isl.cells) { const e = Math.hypot(c.x - it.x, c.z - it.z); if (e < d) { d = e; near = c; } }
        const p = near && best.get(isl.id)!.get(`${near.q},${near.r}`);
        if (p && h > p.y) p.y = h;
        break;
      }
    }
    this.tops = new Map([...best].map(([id, m]) => [id, [...m.values()]]));
  }
  /** Where an island's name goes on screen: above the highest thing on it, over its keep. */
  islandLabelAt(id: string, w: number, h: number): { x: number; y: number } | null {
    const isl = this.islands.get(id), pts = this.tops.get(id);
    if (!isl || !pts) return null;
    const keep = this.screenOf(V3.set(isl.cells[0]!.x, 0, isl.cells[0]!.z), w, h);
    if (!keep) return null;
    let top = Infinity, x0 = Infinity, x1 = -Infinity;
    for (const p of pts) {
      const s = this.screenOf(p, w, h);
      if (!s) continue;
      top = Math.min(top, s.y);
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    }
    if (!Number.isFinite(top)) return null;
    return { x: Math.max(x0, Math.min(x1, keep.x)), y: top - 10 };
  }

  private makeClouds(far: number): void {
    const rand = random(0xc10d);
    this.cloudItems = Array.from({ length: Math.min(12, 3 + Math.round(far / 14)) }, () => ({ name: rand() < 0.5 ? "cloud_big" : "cloud_small", x: (rand() * 2 - 1) * (far + 20), y: 9 + rand() * 3, z: (rand() * 2 - 1) * (far + 20), ry: rand() * 6.28, s: 0.9 + rand() * 0.6 }));
    this.clouds.set(this.cloudItems);
  }
  /** Fewer clouds when the agents rest, more when they are all at work. */
  private weather(): number {
    const working = this.order.filter((w) => w.mood === "working").length;
    return this.order.length ? 0.25 + 0.75 * (working / this.order.length) : 0.3;
  }

  /** Draw less (a higher level) or everything again (0). */
  setQuality(level: number): void {
    level = Math.max(0, Math.min(3, Math.round(level)));
    if (level === this.quality) return;
    this.quality = level;
    this.renderer.setPixelRatio(this.software || level >= 2 ? 1 : Math.min(devicePixelRatio || 1, 1.5));
    this.resize(this.size.w, this.size.h);
    this.tiltPass.enabled = level < 2;
    this.ao.enabled = level === 0;
    this.applyShadows();
    this.setEffects(this.wantEffects);
  }
  private wantEffects = true;
  private applyShadows(): void {
    const on = this.shadows && !this.software && this.order.length <= 60 && this.quality < 3;
    if (this.renderer.shadowMap.enabled !== on) { this.renderer.shadowMap.enabled = on; this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; }); }
    this.sun.castShadow = on;
    this.composer.multisampling = this.order.length > 60 || this.software || this.quality >= 1 ? 0 : 4;
  }
  setShadows(on: boolean): void { this.shadows = on; this.applyShadows(); }
  setEffects(on: boolean): void {
    this.wantEffects = on;
    this.effects = on && !this.software && this.quality < 3;
    // Without the effects pass, the renderer maps the light to the screen itself.
    this.renderer.toneMapping = this.effects ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  }

  private arc(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 2 + a.distanceTo(b) * 0.2;
    return new THREE.QuadraticBezierCurve3(a.clone().setY(1.2), mid, b.clone().setY(1.2));
  }

  // ── what the agents are doing ──────────────────────────────────────────────
  setMood(tileId: string, mood: Mood): void {
    const w = this.workers.get(tileId);
    if (!w || w.mood === mood) return;
    w.mood = mood;
  }
  setActivity(tileId: string, level: number): void { const w = this.workers.get(tileId); if (w) w.activity = level; }
  setSubagents(tileId: string, n: number): void { const w = this.workers.get(tileId); if (w) w.subagents = Math.min(4, Math.max(0, n)); }
  /** How many turns each agent has finished today; `grow` raises what the new turns built. */
  setTurns(counts: Map<string, number>, grow: boolean): void {
    const fresh = new Set<string>();
    const before = new Map<string, number>();
    for (const w of this.order) before.set(w.island.id, (before.get(w.island.id) ?? 0) + w.turns);
    let changed = false;
    for (const w of this.order) {
      const n = counts.get(w.tileId) ?? 0;
      if (n === w.turns) continue;
      changed = true;
      const was = townOf(LOTS, w.turns), now = townOf(LOTS, n);
      now.forEach((s, i) => { if (s !== (was[i] ?? 0)) fresh.add(`${w.tileId}:${i}`); });
      if (n > w.turns && grow) { w.cheerUntil = performance.now() + 2600; this.dust(w, now.length - 1); }
      w.turns = n;
    }
    if (!changed) return;
    const after = new Map<string, number>();
    for (const w of this.order) after.set(w.island.id, (after.get(w.island.id) ?? 0) + w.turns);
    for (const [id, n] of after) if (keepOf(n) !== keepOf(before.get(id) ?? 0)) fresh.add(`keep:${id}`);
    this.buildTown(grow && !this.reduced ? fresh : new Set());
  }
  /** A puff of dust where a lot just went up. */
  private dust(w: Worker, i: number): void {
    const lot = w.spot.lots[Math.max(0, i)];
    if (!lot || this.reduced) return;
    const c = new THREE.Color(0xe8dcc4);
    for (let k = 0; k < 30; k++) { const a = (k / 30) * Math.PI * 2; this.smoke.emit(lot.x, 0.15, lot.z, Math.cos(a) * 1.3, 0.25 + Math.random() * 0.3, Math.sin(a) * 1.3, 1.1, 0.5, c, 0.7, 2.4); }
  }

  /** A finished turn: sparks over the workshop. */
  burst(tileId: string): void {
    const w = this.workers.get(tileId);
    if (!w || this.reduced || !this.pal) return;
    const c = new THREE.Color(this.pal.done || this.pal.working).multiplyScalar(2.5), c2 = new THREE.Color(1.6, 1.3, 0.6);
    for (let i = 0; i < 46; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = 1.6 + Math.random() * 0.8, r = Math.sqrt(1 - u * u);
      this.sparks.emit(w.home.x, 3, w.home.z, Math.cos(a) * r * s, u * s + 0.5, Math.sin(a) * r * s, 1 + Math.random() * 0.4, 0.2, i % 3 ? c : c2, -0.08, 1.6);
    }
  }
  /** A new agent arrived: a puff where it stands. */
  arrive(tileId: string): void {
    const w = this.workers.get(tileId);
    if (!w || this.reduced) return;
    const c = new THREE.Color(0xffffff);
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; this.smoke.emit(w.pos.x, 0.15, w.pos.z, Math.cos(a) * 1.1, 0.35, Math.sin(a) * 1.1, 0.9, 0.4, c, 0.6, 2.5); }
  }

  // ── the camera ──────────────────────────────────────────────────────────────
  flyTo(x: number, z: number, dist: number): void {
    Object.assign(this.goal, { x, z, dist });
    this.goal.pitch = Math.min(this.goal.pitch, 0.95);
    if (this.reduced) Object.assign(this.view, this.goal);
  }
  flyToAgent(tileId: string): boolean {
    const w = this.workers.get(tileId);
    if (!w) return false;
    this.flyTo(w.home.x, w.home.z, 16);
    return true;
  }
  /** An agent in its place: its whole island in sight within `share` of the screen's width, or the
   *  agent itself when its island is too big to see whole from near enough to read. */
  flyToPlace(tileId: string, share: number): boolean {
    const w = this.workers.get(tileId);
    if (!w) return false;
    const i = w.island, k = Math.tan((this.camera.fov * Math.PI) / 360);
    const fit = (i.r * 1.1) / (Math.max(0.2, share) * k * this.camera.aspect);
    if (fit > 60) this.flyTo(w.home.x, w.home.z, 22);
    else this.flyTo(i.x, i.z, Math.max(18, fit));
    return true;
  }
  flyToIsland(id: string): boolean {
    const i = this.islands.get(id);
    if (!i) return false;
    this.flyTo(i.x, i.z, Math.max(18, i.r * 3.4));
    return true;
  }
  /** Everything in sight, the near shore too: the tilt makes the near side larger. */
  overview(): void {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of this.islands.values()) { x0 = Math.min(x0, i.x - i.r); x1 = Math.max(x1, i.x + i.r); z0 = Math.min(z0, i.z - i.r); z1 = Math.max(z1, i.z + i.r); }
    if (!Number.isFinite(x0)) { this.flyTo(0, 0, 40); return; }
    // The nearest distance at which every shore is on screen, from where the camera will look.
    const cam = this.camera.clone(), g = this.goal;
    const pts: THREE.Vector3[] = [];
    for (const i of this.islands.values()) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pts.push(new THREE.Vector3(i.x + Math.cos(a) * i.r, 0, i.z + Math.sin(a) * i.r)); }
    const fits = (x: number, z: number, d: number) => {
      const fx = Math.cos(g.yaw), fz = Math.sin(g.yaw);
      cam.position.set(x + fx * Math.cos(g.pitch) * d, Math.sin(g.pitch) * d, z + fz * Math.cos(g.pitch) * d);
      cam.lookAt(x, 0.3, z);
      cam.updateMatrixWorld();
      let top = -1, bottom = 1, left = 1, right = -1;
      for (const p of pts) { V.copy(p).project(cam); top = Math.max(top, V.y); bottom = Math.min(bottom, V.y); left = Math.min(left, V.x); right = Math.max(right, V.x); }
      return { ok: top < 0.78 && bottom > -0.92 && left > -0.94 && right < 0.94, dy: (top + bottom) / 2, dx: (left + right) / 2 };
    };
    let x = (x0 + x1) / 2, z = (z0 + z1) / 2, d = 20;
    while (d < 600 && !fits(x, z, d).ok) d *= 1.08;
    // Then centre what is on screen: the near shore looks bigger than the far one.
    for (let k = 0; k < 6; k++) {
      const f = fits(x, z, d), half = d * Math.tan((this.camera.fov * Math.PI) / 360);
      const fx = Math.cos(g.yaw), fz = Math.sin(g.yaw);
      x += (fz * f.dx * this.camera.aspect - fx * f.dy / Math.sin(g.pitch)) * half;
      z += (-fx * f.dx * this.camera.aspect - fz * f.dy / Math.sin(g.pitch)) * half;
    }
    while (d < 600 && !fits(x, z, d).ok) d *= 1.04;
    while (d > 12 && fits(x, z, d / 1.04).ok) d /= 1.04;
    this.flyTo(x, z, d);
  }
  hasAgent(tileId: string): boolean { return this.workers.has(tileId); }

  /** Moves toward the goal; true while it is still moving. */
  private moveCamera(dt: number, lead: number): boolean {
    const k = 1 - Math.exp(-dt * 2.6);
    let moving = false;
    for (const key of ["x", "z", "dist", "yaw", "pitch"] as const) {
      const d = this.goal[key] - this.view[key];
      if (Math.abs(d) > 0.0005) { this.view[key] += d * k; moving = true; } else this.view[key] = this.goal[key];
    }
    const v = this.view;
    const fx = Math.cos(v.yaw), fz = Math.sin(v.yaw);
    // `lead` is how far left of the middle, as a share of the width, the place belongs: with a
    // terminal docked on the right, the middle of the open space. Look that far to the right.
    const shift = lead * 2 * v.dist * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    const sx = fz * shift, sz = -fx * shift;
    this.camera.position.set(v.x + sx + fx * Math.cos(v.pitch) * v.dist, Math.sin(v.pitch) * v.dist, v.z + sz + fz * Math.cos(v.pitch) * v.dist);
    this.camera.lookAt(v.x + sx, 0.3, v.z + sz);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = v.dist * 2; fog.far = v.dist * 6 + 220;
    const u = this.sea.material.uniforms;
    u.fogNear!.value = fog.near; u.fogFar!.value = fog.far;
    this.sky.position.copy(this.camera.position);
    // Close up, a narrow band in focus, like a model town; far out, almost all of it.
    this.tilt.focusArea = THREE.MathUtils.clamp(0.42 + v.dist / 160, 0.5, 0.92);
    return moving;
  }

  // ── each frame ──────────────────────────────────────────────────────────────
  /** Draw one frame at time `t` (seconds), `dt` since the last; true when something is still moving. */
  frame(t: number, dt: number, lead: number): boolean {
    let moving = this.moveCamera(dt, lead);
    const reduced = this.reduced, now = performance.now();
    this.sea.material.uniforms.time!.value = reduced ? 0 : t;
    this.sky.material.uniforms.time!.value = reduced ? 0 : t;
    this.wind.value = reduced ? 0 : t;
    if (this.town.step(now, t, reduced)) moving = true;
    this.moveWorkers(t, dt, now);
    if (this.air.update(t, this.now, this.weather(), reduced)) moving = true;
    if (this.pins.update(this.order, this.camera, this.view.dist, this.size.h, t, reduced) && !reduced) moving = true;
    // A thin light over every agent calling the person, and a ring on the ground.
    const call = C.set(this.pal?.attention ?? "#f59e0b");
    const pulse = reduced ? 1 : 0.75 + Math.sin(t * 4) * 0.25, ripple = reduced ? 0.5 : (t * 0.8) % 1;
    let beacon = 0;
    this.calling = [];
    for (const w of this.order) {
      if (w.mood !== "calling" || beacon >= 256) continue;
      const i = beacon++;
      this.calling.push(w.tileId);
      this.columns.setMatrixAt(i, compose(w.pos.x, 0.9, w.pos.z, 0, pulse, 1, pulse));
      // By night the light glows; by day it is paint, which reads on a bright sea.
      this.columns.setColorAt(i, C2.copy(call).multiplyScalar(1 + this.now.lamps * 2 * pulse));
      this.ripples.setMatrixAt(i, compose(w.pos.x, 0.03, w.pos.z, 0, 0.7 + ripple * 1.6, 1, 0.7 + ripple * 1.6));
      this.ripples.setColorAt(i, C2.copy(call).multiplyScalar((1 + this.now.lamps * 2) * (1 - ripple)));
    }
    for (const m of [this.columns, this.ripples]) { m.count = beacon; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    if (!reduced) {
      // Clouds drift on the wind, as many as there is work.
      const cover = this.weather(), lim = this.bounds + 24;
      const shown = Math.round(this.cloudItems.length * cover);
      this.cloudItems.forEach((c, i) => { c.x += dt * (0.5 + (i % 3) * 0.15); if (c.x > lim) c.x = -lim; c.hide = i >= shown; });
      this.clouds.redraw();
      for (const tie of this.ties) {
        const a = this.workers.get(tie.a), b = this.workers.get(tie.b);
        if (!a || !b || Math.random() > 1.4 * dt) continue;
        const curve = this.arc(a.door, b.door), p = curve.getPoint(0), q = curve.getPoint(0.04);
        const c = new THREE.Color(tie.kind === "pipe" ? this.pal.accent : this.pal.working).multiplyScalar(2);
        const v = q.sub(p).multiplyScalar(25 / Math.max(1, a.door.distanceTo(b.door) * 0.25));
        this.sparks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 0.9, 0.22, c, 0, 0);
      }
      this.smoke.step(dt, -0.05);
      this.sparks.step(dt, 1.8);
      moving = true;
    } else if (this.smoke.live || this.sparks.live) { this.smoke.clear(); this.sparks.clear(); }
    if (beacon) moving = true;
    this.noise.blendMode.opacity.value = reduced ? 0 : 0.18;
    this.renderer.info.reset();
    if (this.effects) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    return moving;
  }

  /** Where each worker goes and what it does there, and every pose drawn where it stands. */
  private moveWorkers(t: number, dt: number, now: number): void {
    for (const m of this.people.values()) m.count = 0;
    const reduced = this.reduced, r = Math.random;
    const put = (who: Who, move: Move, time: number, x: number, z: number, ry: number, s = 1) => {
      const frames = this.assets.people.poses.get(who)?.get(move);
      if (!frames) return;
      const len = this.assets.people.length.get(who)?.get(move) ?? 1;
      const f = reduced ? 0 : Math.floor(((time / len) % 1) * frames.length);
      const m = this.people.get(`${who}:${move}:${f}`)!;
      m.setMatrixAt(m.count++, compose(x, 0, z, ry, s));
    };
    const red = RED.set(this.pal?.failed ?? "#ef4444").lerp(DARK, 0.35);
    for (const w of this.order) {
      if (w.mood === "gone") continue;
      // Working: at the lot it is building, or at the forge once the village is whole.
      const steps = townOf(LOTS, w.turns);
      let building = steps.findIndex((s) => s < STEPS);
      if (building < 0) building = steps.length;
      const lot = w.spot.lots[building];
      const site = lot ? SITE.set(lot.x, 0, lot.z) : null;
      const workAt = site ? WORK.set(w.home.x - site.x, 0, w.home.z - site.z).normalize().multiplyScalar(0.78).add(site) : WORK.copy(w.door).addScaledVector(w.side, 0.55);
      const target = w.mood === "working" || w.mood === "failed" ? workAt : w.mood === "calling" ? w.door : w.seat;
      const dx = target.x - w.pos.x, dz = target.z - w.pos.z, len = Math.hypot(dx, dz);
      const walking = len > 0.05 && !reduced;
      if (reduced) w.pos.copy(target);
      else if (walking) { const step = Math.min(len, dt * 1.1); w.pos.x += (dx / len) * step; w.pos.z += (dz / len) * step; }
      // Face where it walks; then its work, the camera when calling, the fire when resting.
      const face = walking ? Math.atan2(dx, dz)
        : w.mood === "working" || w.mood === "failed" ? Math.atan2((site?.x ?? w.home.x) - w.pos.x, (site?.z ?? w.home.z) - w.pos.z)
        : w.mood === "calling" ? Math.atan2(this.camera.position.x - w.pos.x, this.camera.position.z - w.pos.z)
        : Math.atan2(w.fire.x - w.pos.x, w.fire.z - w.pos.z);
      let d = face - w.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      w.heading = reduced ? face : w.heading + d * Math.min(1, dt * 8);
      const time = t + w.phase;
      const move: Move = walking ? "walk" : w.cheerUntil > now ? "cheer" : w.mood === "working" ? "work" : w.mood === "idle" || w.mood === "done" ? "sit" : "idle";
      put(w.who, move, move === "work" ? time * (0.8 + w.activity * 0.5) : time, w.pos.x, w.pos.z, w.heading);
      // Helpers (its subagents) carry timber round the site.
      for (let k = 0; k < w.subagents; k++) {
        const a = (reduced ? 0 : t * 0.5) + (k / w.subagents) * Math.PI * 2 + w.phase;
        put(w.who === "rogue" ? "barbarian" : "rogue", "walk", time + k, workAt.x + Math.cos(a) * 0.9, workAt.z + Math.sin(a) * 0.9, a + Math.PI, 0.72);
      }
      if (reduced) continue;
      if (w.mood === "working") {
        if (r() < (1 + w.activity * 1.6) * dt) this.smoke.emit(w.chimney.x, w.chimney.y, w.chimney.z, (r() - 0.5) * 0.15 + 0.2, 0.55 + r() * 0.25, (r() - 0.5) * 0.15, 3.2, 0.32, GREY, 0.45, 0.15);
        if (!walking && r() < (2.5 + w.activity * 4) * dt) this.sparks.emit(workAt.x + (site ? (site.x - workAt.x) * 0.5 : 0), 0.3, workAt.z + (site ? (site.z - workAt.z) * 0.5 : 0), (r() - 0.5) * 1.6, 0.8 + r() * 1.2, (r() - 0.5) * 1.6, 0.4 + r() * 0.3, 0.1, EMBER, 0, 0.6);
      } else if (w.mood === "failed") {
        if (r() < 2 * dt) this.smoke.emit(w.chimney.x, w.chimney.y, w.chimney.z, (r() - 0.5) * 0.12, 0.45, (r() - 0.5) * 0.12, 3.6, 0.42, red, 0.5, 0.1);
      } else if (w.mood === "idle" || w.mood === "done") {
        if (r() < 9 * dt) this.sparks.emit(w.fire.x + (r() - 0.5) * 0.12, 0.08, w.fire.z + (r() - 0.5) * 0.12, (r() - 0.5) * 0.1, 0.35 + r() * 0.3, (r() - 0.5) * 0.1, 0.5 + r() * 0.3, 0.2, FLAME, -0.25, 0.4);
        if (r() < 0.6 * dt) this.smoke.emit(w.fire.x, 0.45, w.fire.z, 0.04, 0.4, 0, 1.8, 0.16, GREY, 0.25, 0.2);
      }
    }
    for (const m of this.people.values()) { m.visible = m.count > 0; if (m.count) m.instanceMatrix.needsUpdate = true; }
  }

  // ── where things are on screen, and what is under the pointer ─────────────
  /** Where a world point is on screen, in CSS pixels; null when behind or out of sight. */
  screenOf(p: THREE.Vector3, w: number, h: number, margin = 0): { x: number; y: number; inside: boolean } | null {
    V.copy(p).project(this.camera);
    if (V.z > 1) return null;
    const x = ((V.x + 1) / 2) * w, y = ((1 - V.y) / 2) * h;
    return { x, y, inside: x >= margin && x <= w - margin && y >= margin && y <= h - margin };
  }
  agentAnchor(tileId: string, lift = 1.0): THREE.Vector3 | null {
    const w = this.workers.get(tileId);
    return w ? new THREE.Vector3(w.pos.x, lift + (w.mood === "calling" ? 0.3 : 0), w.pos.z) : null;
  }
  pick(nx: number, ny: number): Pick | null {
    // From afar, the pin over a worker is what the person aims at.
    const pinned = this.pins.pick(((nx + 1) / 2) * this.size.w, ((1 - ny) / 2) * this.size.h, this.camera, this.size.w, this.size.h);
    if (pinned) return { kind: "agent", id: pinned };
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    // A worker near the ray first: its height, not just its feet.
    let best: Worker | null = null, bd = 0.7;
    for (const w of this.order) {
      const d = this.ray.ray.distanceSqToSegment(new THREE.Vector3(w.pos.x, 0, w.pos.z), new THREE.Vector3(w.pos.x, 0.65, w.pos.z));
      if (Math.sqrt(d) < bd) { bd = Math.sqrt(d); best = w; }
    }
    if (best) return { kind: "agent", id: best.tileId };
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4), p)) return null;
    for (const isl of this.islands.values()) {
      if (Math.hypot(isl.x - p.x, isl.z - p.z) > isl.r + 1) continue;
      let cell: Cell | null = null, cd = 1.2;
      for (const c of isl.cells) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < cd) { cd = d; cell = c; } }
      if (!cell) continue;
      if (cell.owner && this.workers.has(cell.owner)) return { kind: "agent", id: cell.owner };
      return { kind: "island", id: isl.id };
    }
    return null;
  }
  /** The ground under a screen point, for panning. */
  groundUnder(nx: number, ny: number): THREE.Vector3 | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }
  get triangles(): number { return this.renderer.info.render.triangles; }
  get drawCalls(): number { return this.renderer.info.render.calls; }
  /** For checks: how many lots stand at each step, over every village. */
  get lots(): number[] {
    const out = [0, 0, 0, 0];
    for (const w of this.order) { const s = townOf(LOTS, w.turns); for (let i = 0; i < LOTS; i++) out[s[i] ?? 0]!++; }
    return out;
  }
}

/** The kit's material, with its greens turned to each instance's colour: one texture, every season. */
function tinted(base: THREE.MeshStandardMaterial, wind?: { value: number }): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.onBeforeCompile = (s) => {
    if (wind) {
      // Trees lean with the wind, more toward their tops, each in its own time.
      s.uniforms.uWind = wind;
      s.vertexShader = "uniform float uWind;\n" + s.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 at = instanceMatrix[3].xz;
        #else
          vec2 at = vec2(0.0);
        #endif
        float sway = max(position.y, 0.0) * max(position.y, 0.0);
        transformed.x += sway * 0.05 * sin(uWind * 1.7 + at.x * 0.7 + at.y * 0.4);
        transformed.z += sway * 0.035 * sin(uWind * 1.3 + at.y * 0.6);`);
    }
    s.fragmentShader = s.fragmentShader.replace("#include <color_fragment>", `
      #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        float green = smoothstep(0.015, 0.09, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
        float plain = step(2.99, vColor.r + vColor.g + vColor.b);
        float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb * (0.62 + l * 1.3), green * (1.0 - plain));
      #endif`);
  };
  m.customProgramCacheKey = () => (wind ? "island-tinted-wind" : "island-tinted");
  return m;
}

/** A round patch, dark in the middle and gone at the edge. */
function blobTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "#fff"); r.addColorStop(0.45, "#aaa"); r.addColorStop(1, "#000");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, stars: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float stars; uniform float time; varying vec3 vDir;
      float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        float y = max(vDir.y, 0.0);
        vec3 c = mix(horizon, top, pow(y, 0.55));
        float sun = max(dot(vDir, sunDir), 0.0);
        c += horizon * pow(sun, 8.0) * 0.35 * (1.0 - stars);
        vec3 cell = floor(vDir * 260.0);
        float s = step(0.9975, h(cell)) * smoothstep(0.05, 0.3, y) * stars;
        c += vec3(s) * (0.7 + 0.3 * sin(time * 2.0 + h(cell + 1.0) * 30.0));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function seaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      time: { value: 0 }, deep: { value: new THREE.Color() }, shallow: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sky: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, fogNear: { value: 80 }, fogFar: { value: 400 },
      shore: { value: null }, box: { value: new THREE.Vector4(-1, -1, 2, 2) },
    },
    vertexShader: `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 horizon; uniform vec3 sky; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float fogNear; uniform float fogFar; uniform sampler2D shore; uniform vec4 box; varying vec3 vWorld;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      // A few long swells, their slope worked out exactly, so the sea has no seams.
      vec2 slope(vec2 p) {
        vec2 s = vec2(0.0);
        vec2 dirs[5] = vec2[5](vec2(0.8, 0.6), vec2(-0.5, 0.86), vec2(0.97, -0.24), vec2(-0.83, -0.56), vec2(0.2, 0.98));
        float ks[5] = float[5](0.55, 0.9, 1.6, 2.7, 4.1);
        for (int i = 0; i < 5; i++) {
          float k = ks[i], a = 0.12 / (1.0 + float(i) * 0.9);
          s += dirs[i] * a * k * cos(dot(dirs[i], p) * k + time * sqrt(9.8 * k) * 0.45);
        }
        return s;
      }
      void main() {
        vec2 uv = (vWorld.xz - box.xy) / box.zw;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float d = mix(12.0, texture2D(shore, uv).r * 12.0, inside);
        vec2 p = vWorld.xz;
        vec2 sl = slope(p);
        vec3 nrm = normalize(vec3(-sl.x, 1.0, -sl.y));
        float far = smoothstep(25.0, 140.0, distance(cameraPosition, vWorld));
        nrm = normalize(mix(nrm, vec3(0.0, 1.0, 0.0), far * 0.85));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(nrm, v), 0.0), 5.0);
        // Depth from the shore: sand seen through clear water at the beach, turquoise over the shelf,
        // then the deep blue of open sea, broken up so it is never one flat colour.
        float wob = n(p * 0.08 + time * 0.01) * 1.6 - 0.8;
        float shelf = d + wob;
        vec3 sandy = mix(shallow, vec3(0.93, 0.86, 0.66), 0.35);
        vec3 c = mix(sandy, shallow, smoothstep(0.0, 1.4, shelf));
        c = mix(c, mix(shallow, deep, 0.55), smoothstep(1.2, 4.5, shelf));
        c = mix(c, deep, smoothstep(4.0, 10.0, shelf));
        // Light dancing on the shallow sand.
        float cau = n(p * 2.2 + vec2(time * 0.35, time * 0.2)) * n(p * 2.9 - vec2(time * 0.25, -time * 0.3));
        c += vec3(0.9, 1.0, 0.95) * smoothstep(0.25, 0.6, cau) * (1.0 - smoothstep(0.3, 2.6, d)) * 0.22 * (0.4 + 0.6 * sunColor.g);
        // The sky in the water, more at a glancing look.
        c = mix(c, mix(horizon, sky, 0.45), clamp(fres * 0.9, 0.0, 0.55));
        vec3 r = reflect(-v, nrm);
        c += sunColor * pow(max(dot(r, sunDir), 0.0), 380.0) * 0.28 * (1.0 - far) * smoothstep(0.05, 0.3, sunDir.y);
        // Foam: a broken white edge where water meets sand, and lines of surf rolling in toward it.
        float ripple = n(p * 1.3 + vec2(time * 0.3, -time * 0.2));
        float grain = n(p * 3.5 + vec2(-time * 0.4, time * 0.3));
        float edge = smoothstep(0.42, 0.06, d + (grain - 0.5) * 0.35);
        float surf = 0.0;
        for (int k = 0; k < 2; k++) {
          float ph = fract(d * 0.42 + time * 0.16 + float(k) * 0.5 + ripple * 0.25);
          surf += smoothstep(0.86, 0.95, ph) * smoothstep(1.0, 0.95, ph);
        }
        surf *= smoothstep(3.2, 0.5, d) * smoothstep(0.35, 0.7, grain + 0.2);
        float foam = clamp(edge + surf * 0.75, 0.0, 1.0);
        c = mix(c, vec3(0.97, 0.98, 1.0) * (0.55 + 0.45 * sunColor.g), foam * 0.92);
        c = mix(c, horizon, smoothstep(fogNear, fogFar, distance(cameraPosition, vWorld)));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
