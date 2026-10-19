// The islands in three.js: land, sea, trees, a workshop for each agent and the agent working at it.
// Everything that repeats is drawn as one instanced mesh, so a hundred agents cost what ten do.
import * as THREE from "three";
import { groundAt, hash, heightAt, random, type Biome, type Island, type Mood, type Spot } from "./world";

export interface Palette {
  mode: "dark" | "light";
  working: string; attention: string; idle: string; exited: string; failed: string; done: string; accent: string;
}

const LAND: Record<Biome, { sand: number; grass: number; grass2: number; rock: number; peak: number; crowns: number[]; pine: boolean }> = {
  meadow: { sand: 0xe9d8a6, grass: 0x7cc25b, grass2: 0x5ea34a, rock: 0x8e8a7c, peak: 0xb4ae9e, crowns: [0x3f8f3a, 0x58a845, 0x6fb84f], pine: false },
  blossom: { sand: 0xf1e1c4, grass: 0x9fd47c, grass2: 0x86c46a, rock: 0xa89c94, peak: 0xcfc4bc, crowns: [0xf4a6c3, 0xf8c5d8, 0xee8fb3], pine: false },
  autumn: { sand: 0xe9d09c, grass: 0xd8a44b, grass2: 0xc68b3b, rock: 0x907b65, peak: 0xb09d86, crowns: [0xe0702e, 0xf0a13a, 0xc94f28], pine: false },
  snow: { sand: 0xdde6ee, grass: 0xf3f6fa, grass2: 0xe3eaf2, rock: 0x98a4b0, peak: 0xffffff, crowns: [0x2f6b5e, 0x3c7d6d, 0x285e53], pine: true },
};
/** Each agent's colours, from its catalog id, so different CLIs look different. */
const COAT: Record<string, number> = { claude: 0xd97757, codex: 0x3f6fd8, cursor: 0x2b2b2b, droid: 0xe8b43a, kiro: 0x8b5cf6, pi: 0x14b8a6, openclaw: 0xe2463a, gemini: 0x4f8df5 };
const coatOf = (agent: string | undefined) => COAT[agent ?? ""] ?? [0xd97757, 0x3f6fd8, 0x14b8a6, 0xe8b43a, 0x8b5cf6, 0xe2463a][hash(agent ?? "x") % 6]!;

const BEAM = new THREE.Color(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) => {
  Q.setFromEuler(E.set(rx, ry, rz));
  mesh.setMatrixAt(i, M4.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)));
};

// ── particles: smoke, sparks, fireworks ─────────────────────────────────────
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
    const m = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 300 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main() { vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = vAlpha * smoothstep(0.5, 0.15, d); gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
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
  clear(): void { this.life.fill(0); this.alpha.fill(0); }
}

// ── what each agent is, on screen ───────────────────────────────────────────
interface Worker {
  tileId: string; spot: Spot; island: Island; index: number; agent?: string;
  ground: number; door: THREE.Vector3; work: THREE.Vector3; beacon: THREE.Vector3; fire: THREE.Vector3; rest: THREE.Vector3; chimney: THREE.Vector3;
  pos: THREE.Vector3; mood: Mood; activity: number; subagents: number; phase: number; arrived: number;
}
interface Tie { a: string; b: string; kind: "spawn" | "pipe"; line: THREE.Line }

export interface Pick { kind: "agent" | "island"; id: string }

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private sky = new THREE.HemisphereLight(0xdfefff, 0x6b7a5a, 1.4);
  private sea: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private root = new THREE.Group();
  private smoke = new Particles(2400, false);
  private sparks = new Particles(2400, true);
  private workers = new Map<string, Worker>();
  private order: Worker[] = [];
  private islands = new Map<string, Island>();
  private terrains: THREE.Mesh[] = [];
  private ties: Tie[] = [];
  /** A light column and a ripple for every agent calling the person: two draws, however many call. */
  private columns = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 18, 14, 1, true), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 256);
  private ripples = new THREE.InstancedMesh(new THREE.RingGeometry(0.75, 0.95, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 256);
  private calling: string[] = [];
  private meshes: Record<string, THREE.InstancedMesh> = {};
  private flags: { mesh: THREE.Mesh; base: THREE.Vector3; along: number[]; z: number[] }[] = [];
  private pal!: Palette;
  private ray = new THREE.Raycaster();
  /** The camera: what it looks at, how far, how turned and how tilted; `goal` is where it is going. */
  readonly view = { x: 0, z: 0, dist: 60, yaw: 0.75, pitch: 0.82 };
  readonly goal = { x: 0, z: 0, dist: 60, yaw: 0.75, pitch: 0.82 };
  reduced = false;
  shadows = true;
  bounds = 30;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.sky, this.root, this.smoke.points, this.sparks.points);
    this.scene.fog = new THREE.Fog(0xbfe3ef, 80, 260);
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, deep: { value: new THREE.Color() }, shallow: { value: new THREE.Color() }, glint: { value: new THREE.Color() }, fogColor: { value: new THREE.Color() }, fogNear: { value: 80 }, fogFar: { value: 260 }, still: { value: 0 }, islands: { value: Array.from({ length: 64 }, () => new THREE.Vector3()) }, count: { value: 0 }, foam: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 glint; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform float still; uniform vec3 islands[64]; uniform int count; uniform vec3 foam; varying vec3 vWorld;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float t = time * (1.0 - still);
          vec2 p = vWorld.xz * 0.18;
          float w = n(p + vec2(t * 0.15, t * 0.08)) * 0.6 + n(p * 2.3 - vec2(t * 0.11, -t * 0.2)) * 0.4;
          vec3 c = mix(deep, shallow, w * 0.35);
          float near = 0.0, edge = 0.0;
          for (int i = 0; i < 64; i++) {
            if (i >= count) break;
            float d = distance(vWorld.xz, islands[i].xy) / islands[i].z;
            near = max(near, smoothstep(1.55, 0.95, d));
            edge = max(edge, smoothstep(1.16, 1.02, d) * smoothstep(0.86, 0.98, d));
          }
          c = mix(c, shallow, near * 0.85);
          float sparkle = smoothstep(0.86, 0.9, n(vWorld.xz * 1.7 + vec2(t * 0.4, t * 0.25))) * 0.18;
          c = mix(c, glint, sparkle * (1.0 - near * 0.5));
          float lap = 0.55 + 0.45 * sin(t * 1.3 + vWorld.x * 0.7 + vWorld.z * 0.5);
          c = mix(c, foam, edge * (0.35 + 0.35 * lap));
          float d = distance(cameraPosition, vWorld);
          c = mix(c, fogColor, smoothstep(fogNear, fogFar, d));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -0.18;
    this.sea.receiveShadow = false;
    this.scene.add(this.sea);
    for (const m of [this.columns, this.ripples]) {
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, C.set(0xffffff));
      this.scene.add(m);
    }
  }

  setPalette(p: Palette): void {
    this.pal = p;
    const dark = p.mode === "dark";
    const u = this.sea.material.uniforms;
    u.deep!.value.setHex(dark ? 0x0c2340 : 0x3fa9c4);
    u.shallow!.value.setHex(dark ? 0x1d5c78 : 0x8fe6e0);
    u.glint!.value.setHex(dark ? 0x5c86b8 : 0xffffff);
    u.foam!.value.setHex(dark ? 0x9fc4d8 : 0xffffff);
    const fog = dark ? 0x0b1526 : 0xcdeaf2;
    u.fogColor!.value.setHex(fog);
    (this.scene.fog as THREE.Fog).color.setHex(fog);
    // Dusk, not midnight: the land keeps its colours, the lit windows and beacons stand out.
    this.sun.color.setHex(dark ? 0xffd2a8 : 0xfff1dc);
    this.sun.intensity = dark ? 1.25 : 2.3;
    this.sky.color.setHex(dark ? 0x9aa8d0 : 0xe2f1ff);
    this.sky.groundColor.setHex(dark ? 0x3a3448 : 0x7c8a62);
    this.sky.intensity = dark ? 1.15 : 1.5;
    // On a bright sea added light turns white: by day the beacons are painted amber instead.
    for (const m of [this.columns, this.ripples]) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.opacity = dark ? 1 : m === this.columns ? 0.6 : 0.85;
      mat.needsUpdate = true;
    }
    for (const t of this.ties) (t.line.material as THREE.LineDashedMaterial).color.set(t.kind === "pipe" ? p.accent : p.working);
    this.paintAll();
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    const s = this.renderer.getPixelRatio() * h * 0.5;
    for (const p of [this.smoke, this.sparks]) (p.points.material as THREE.ShaderMaterial).uniforms.scale!.value = s;
  }

  // ── building the world from the workspace ──────────────────────────────────
  build(islands: Map<string, Island>, spots: Map<string, Spot>, agents: Map<string, string | undefined>, links: { a: string; b: string; kind: "spawn" | "pipe" }[]): void {
    const keep = new Map(this.workers);
    this.root.clear();
    for (const m of this.terrains) { m.geometry.dispose(); }
    this.terrains = [];
    this.flags = [];
    for (const m of Object.values(this.meshes)) m.geometry.dispose();
    this.meshes = {};
    this.islands = islands;
    const all = [...spots.values()];
    const agentSpots = all.filter((s) => s.agent);
    let far = 20;
    const trees: { x: number; y: number; z: number; s: number; c: number; pine: boolean }[] = [];
    const rocks: { x: number; y: number; z: number; s: number; r: number }[] = [];
    const poles: THREE.Vector3[] = [];
    const lands: THREE.BufferGeometry[] = [];
    const flagPos: number[] = [], flagCol: number[] = [], flagAlong: number[] = [];
    const shore = this.sea.material.uniforms.islands!.value as THREE.Vector3[];
    let k0 = 0;
    for (const isl of islands.values()) {
      far = Math.max(far, Math.hypot(isl.x, isl.z) + isl.r);
      lands.push(this.terrain(isl, all));
      if (k0 < shore.length) shore[k0++]!.set(isl.x, isl.z, isl.r);
      // Trees and rocks where nobody builds.
      const rand = random(isl.seed ^ 0x51ed27);
      const look = LAND[isl.biome];
      const want = Math.round(isl.r * isl.r * 0.5);
      for (let k = 0, tries = 0; k < want && tries < want * 6; tries++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * isl.r;
        const x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d;
        const y = groundAt(isl, all, x, z);
        if (y < 0.25 || y > 3.6) continue;
        if (all.some((s) => s.islandId === isl.id && Math.hypot(s.x - x, s.z - z) < (s.agent ? 2.6 : 1.4))) continue;
        if (Math.hypot(x - isl.x, z - isl.z) < 1.2) continue;
        k++;
        if (rand() < 0.12) rocks.push({ x, y, z, s: 0.25 + rand() * 0.45, r: rand() * 6 });
        else trees.push({ x, y, z, s: 0.7 + rand() * 0.6, c: look.crowns[Math.floor(rand() * look.crowns.length)]!, pine: look.pine || rand() < 0.18 });
      }
      // The frame's own colour, on a flag at the top.
      const top = new THREE.Vector3(isl.x, heightAt(isl, isl.x, isl.z), isl.z);
      poles.push(top);
      const flag = new THREE.PlaneGeometry(1.1, 0.65, 6, 1).translate(0.55 + top.x + 0.04, top.y + 2.05, top.z).toNonIndexed();
      const fp = flag.getAttribute("position") as THREE.BufferAttribute;
      C.set(isl.color);
      for (let i = 0; i < fp.count; i++) { flagPos.push(fp.getX(i), fp.getY(i), fp.getZ(i)); flagCol.push(C.r, C.g, C.b); flagAlong.push(fp.getX(i) - top.x - 0.04); }
    }
    this.sea.material.uniforms.count!.value = k0;
    // All the land, one mesh.
    const land = new THREE.Mesh(mergeLand(lands), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    lands.forEach((g) => g.dispose());
    land.receiveShadow = true;
    land.castShadow = true;
    this.root.add(land);
    this.terrains.push(land);
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute("position", new THREE.Float32BufferAttribute(flagPos, 3).setUsage(THREE.DynamicDrawUsage));
    flagGeo.setAttribute("color", new THREE.Float32BufferAttribute(flagCol, 3));
    flagGeo.computeVertexNormals();
    const flags = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    flags.castShadow = true;
    this.root.add(flags);
    this.flags = [{ mesh: flags, base: new THREE.Vector3(), along: flagAlong, z: flagPos.filter((_, i) => i % 3 === 2) }];
    this.bounds = far;
    // A bridge from each worktree to the island it was made from.
    const planks: { x: number; y: number; z: number; ry: number }[] = [];
    for (const isl of islands.values()) {
      if (!isl.parentId) continue;
      const p = islands.get(isl.parentId);
      if (!p) continue;
      const dx = isl.x - p.x, dz = isl.z - p.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
      const from = p.r * 0.86, to = d - isl.r * 0.86;
      for (let s = from; s < to; s += 0.42) {
        const k = (s - from) / Math.max(to - from, 0.01);
        planks.push({ x: p.x + ux * s, y: 0.35 - Math.sin(k * Math.PI) * 0.25, z: p.z + uz * s, ry: -Math.atan2(uz, ux) });
      }
    }
    const inst = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cast = true) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(n, 1));
      m.count = n;
      m.castShadow = cast;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.meshes[name] = m;
      this.root.add(m);
      return m;
    };
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a6243 });
    const plank = inst("planks", new THREE.BoxGeometry(0.3, 0.06, 1.3), wood, planks.length);
    planks.forEach((p, i) => place(plank, i, p.x, p.y, p.z, p.ry));
    const pole = inst("poles", new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshLambertMaterial({ color: 0x5b4636 }), poles.length);
    poles.forEach((p, i) => place(pole, i, p.x, p.y, p.z));
    const round = trees.filter((t) => !t.pine), pines = trees.filter((t) => t.pine);
    const crown = inst("crowns", new THREE.IcosahedronGeometry(0.75, 0), new THREE.MeshLambertMaterial({ flatShading: true }), round.length);
    const pine = inst("pines", new THREE.ConeGeometry(0.62, 1.9, 7).translate(0, 0.95, 0), new THREE.MeshLambertMaterial({ flatShading: true }), pines.length);
    const trunk = inst("trunks", new THREE.CylinderGeometry(0.09, 0.13, 0.9, 5).translate(0, 0.45, 0), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trees.length);
    round.forEach((t, i) => { place(crown, i, t.x, t.y + 0.75 * t.s + 0.55 * t.s, t.z, t.x, t.s, t.s * 1.05, t.s); crown.setColorAt(i, C.setHex(t.c)); });
    pines.forEach((t, i) => { place(pine, i, t.x, t.y + 0.35 * t.s, t.z, t.x, t.s, t.s, t.s); pine.setColorAt(i, C.setHex(t.c)); });
    trees.forEach((t, i) => place(trunk, i, t.x, t.y - 0.05, t.z, 0, t.s));
    const rock = inst("rocks", new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x9a968c, flatShading: true }), rocks.length);
    rocks.forEach((r, i) => place(rock, i, r.x, r.y + r.s * 0.3, r.z, r.r, r.s, r.s * 0.7, r.s));
    // Workshops: walls, a roof, a chimney, a lit window, an anvil, a campfire; and the agent.
    const n = agentSpots.length;
    inst("walls", new THREE.BoxGeometry(1.25, 0.85, 1.05).translate(0, 0.425, 0), new THREE.MeshLambertMaterial({ color: 0xf2e6d0 }), n);
    inst("roofs", new THREE.ConeGeometry(1.05, 0.75, 4).rotateY(Math.PI / 4).translate(0, 1.22, 0), new THREE.MeshLambertMaterial({ flatShading: true }), n);
    inst("chimneys", new THREE.BoxGeometry(0.2, 0.55, 0.2).translate(0.32, 1.35, -0.18), new THREE.MeshLambertMaterial({ color: 0x8b6d5a }), n);
    inst("windows", new THREE.BoxGeometry(0.42, 0.34, 0.04).translate(0, 0.48, 0.535), new THREE.MeshBasicMaterial(), n, false);
    inst("anvils", new THREE.BoxGeometry(0.34, 0.22, 0.2).translate(0, 0.11, 0), new THREE.MeshLambertMaterial({ color: 0x4a4f57 }), n);
    inst("fires", new THREE.ConeGeometry(0.16, 0.42, 5).translate(0, 0.21, 0), new THREE.MeshBasicMaterial(), n, false);
    inst("bodies", new THREE.CapsuleGeometry(0.17, 0.3, 3, 8).translate(0, 0.32, 0), new THREE.MeshLambertMaterial(), n);
    inst("heads", new THREE.SphereGeometry(0.15, 10, 8).translate(0, 0.76, 0), new THREE.MeshLambertMaterial({ color: 0xf3d2b3 }), n);
    inst("helpers", new THREE.CapsuleGeometry(0.09, 0.14, 2, 6).translate(0, 0.16, 0), new THREE.MeshLambertMaterial(), n * 4);
    const tents = all.filter((s) => !s.agent);
    const tent = inst("tents", new THREE.ConeGeometry(0.5, 0.7, 4).translate(0, 0.35, 0), new THREE.MeshLambertMaterial({ color: 0xe8e2d4, flatShading: true }), tents.length);
    tents.forEach((s, i) => { const isl = islands.get(s.islandId)!; place(tent, i, s.x, groundAt(isl, all, s.x, s.z), s.z, s.facing); });
    // Every agent's places.
    this.workers.clear();
    this.order = [];
    agentSpots.forEach((spot, index) => {
      const isl = islands.get(spot.islandId)!;
      const g = groundAt(isl, all, spot.x, spot.z);
      const out = new THREE.Vector3(Math.cos(spot.facing), 0, Math.sin(spot.facing));
      const side = new THREE.Vector3(-out.z, 0, out.x);
      const at = (o: number, s: number) => new THREE.Vector3(spot.x + out.x * o + side.x * s, g, spot.z + out.z * o + side.z * s);
      const before = keep.get(spot.tileId);
      const w: Worker = {
        tileId: spot.tileId, spot, island: isl, index, agent: agents.get(spot.tileId), ground: g,
        door: at(0.7, 0), work: at(1.1, 0.45), beacon: at(1.75, -0.2), fire: at(1.25, -0.75), rest: at(1.25, -0.75).add(new THREE.Vector3(0.45, 0, 0.3)),
        chimney: new THREE.Vector3().copy(at(0, 0)).add(new THREE.Vector3(0, 1.75, 0)),
        pos: before?.pos.clone() ?? at(1.1, 0.45), mood: before?.mood ?? "idle", activity: before?.activity ?? 0,
        subagents: before?.subagents ?? 0, phase: (hash(spot.tileId) % 1000) / 160, arrived: before ? 0 : performance.now(),
      };
      w.chimney.set(spot.x + out.x * -0.18 + side.x * 0.32, g + 1.75, spot.z + out.z * -0.18 + side.z * 0.32);
      this.workers.set(spot.tileId, w);
      this.order.push(w);
      const ry = -spot.facing + Math.PI / 2;
      for (const k of ["walls", "roofs", "chimneys", "windows"]) place(this.meshes[k]!, index, spot.x, g, spot.z, ry);
      place(this.meshes.anvils!, index, w.work.x + (spot.x - w.work.x) * 0.35, g, w.work.z + (spot.z - w.work.z) * 0.35, ry);
      this.meshes.bodies!.setColorAt(index, C.setHex(coatOf(w.agent)));
      this.meshes.roofs!.setColorAt(index, C.setHex(coatOf(w.agent)).lerp(new THREE.Color(0x6d4c3d), 0.45));
    });
    for (const m of Object.values(this.meshes)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    const helpers = this.meshes.helpers!;
    for (let i = 0; i < n * 4; i++) helpers.setColorAt(i, C.setHex(0xfff3c4));
    // Which agent started which, and which feeds which.
    this.ties = [];
    for (const l of links) {
      const a = this.workers.get(l.a), b = this.workers.get(l.b);
      if (!a || !b) continue;
      const pts = this.arc(a.door, b.door).getPoints(40);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: l.kind === "pipe" ? this.pal.accent : this.pal.working, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.75 }));
      line.computeLineDistances();
      this.root.add(line);
      this.ties.push({ ...l, line });
    }
    // Light and shadow sized to the world.
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -far - 4; s.right = s.top = far + 4; s.near = 1; s.far = far * 4 + 60;
    s.updateProjectionMatrix();
    this.sun.position.set(far * 0.8 + 20, far * 1.6 + 30, far * 0.5 + 12);
    this.applyShadows();
    this.paintAll();
  }

  private applyShadows(): void {
    const on = this.shadows && this.order.length <= 60;
    if (this.renderer.shadowMap.enabled !== on) { this.renderer.shadowMap.enabled = on; this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; }); }
    this.sun.castShadow = on;
  }
  setShadows(on: boolean): void { this.shadows = on; this.applyShadows(); }

  private arc(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 2.5 + a.distanceTo(b) * 0.22;
    return new THREE.QuadraticBezierCurve3(a.clone().setY(a.y + 1.4), mid, b.clone().setY(b.y + 1.4));
  }

  /** Land for one island: a grid, every triangle coloured by how high it is, sunk under the sea past the shore. */
  private terrain(isl: Island, spots: Spot[]): THREE.BufferGeometry {
    const look = LAND[isl.biome];
    const seg = Math.max(26, Math.min(64, Math.round(isl.r * 3.4)));
    const size = isl.r * 2.5, step = size / seg, x0 = isl.x - size / 2, z0 = isl.z - size / 2;
    const hs: number[] = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) hs.push(groundAt(isl, spots, x0 + i * step, z0 + j * step));
    const pos: number[] = [], col: number[] = [];
    const rand = random(isl.seed ^ 0x7f4a7c15);
    const colour = (h: number, slope: number) => {
      if (h < 0.22) return C.setHex(look.sand);
      if (h > 3.4) return C.setHex(look.peak);
      if (slope > 0.75 || h > 2.6) return C.setHex(look.rock);
      return C.setHex(rand() < 0.5 ? look.grass : look.grass2);
    };
    const tri = (a: number[], b: number[], c: number[]) => {
      if (a[1]! < -0.6 && b[1]! < -0.6 && c[1]! < -0.6) return;
      const hi = Math.max(a[1]!, b[1]!, c[1]!), lo = Math.min(a[1]!, b[1]!, c[1]!);
      const k = colour((a[1]! + b[1]! + c[1]!) / 3, (hi - lo) / step);
      const jit = 0.94 + rand() * 0.1;
      for (const p of [a, b, c]) { pos.push(p[0]!, p[1]!, p[2]!); col.push(k.r * jit, k.g * jit, k.b * jit); }
    };
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const p = (ii: number, jj: number) => [x0 + ii * step, hs[jj * (seg + 1) + ii]!, z0 + jj * step];
        const a = p(i, j), b = p(i + 1, j), c = p(i, j + 1), d = p(i + 1, j + 1);
        if ((i + j) % 2) { tri(a, c, b); tri(b, c, d); } else { tri(a, c, d); tri(a, d, b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  // ── what the agents are doing ──────────────────────────────────────────────
  setMood(tileId: string, mood: Mood): void {
    const w = this.workers.get(tileId);
    if (!w || w.mood === mood) return;
    const was = w.mood;
    w.mood = mood;
    if (mood === "done" && was === "working") this.burst(tileId);
    this.paint(w);
  }
  setActivity(tileId: string, level: number): void { const w = this.workers.get(tileId); if (w) w.activity = level; }
  setSubagents(tileId: string, n: number): void { const w = this.workers.get(tileId); if (w) w.subagents = Math.min(4, Math.max(0, n)); }

  private paintAll(): void { if (this.meshes.windows) for (const w of this.order) this.paint(w); }
  private paint(w: Worker): void {
    const win = this.meshes.windows, fire = this.meshes.fires, walls = this.meshes.walls;
    if (!win || !fire || !walls || !this.pal) return;
    const dark = this.pal.mode === "dark";
    const glow: Record<Mood, string | number> = { working: dark ? 0xffd27a : 0xffe7a8, calling: this.pal.attention, failed: this.pal.failed, done: dark ? 0xffd27a : 0xfff1c9, idle: dark ? 0xc9a86a : 0xe9dcc0, gone: 0x2b2f36 };
    win.setColorAt(w.index, C.set(glow[w.mood]));
    fire.setColorAt(w.index, C.setHex(0xff8a2a));
    walls.setColorAt(w.index, C.setHex(w.mood === "gone" ? 0x8d8a85 : 0xf2e6d0));
    win.instanceColor!.needsUpdate = true;
    fire.instanceColor!.needsUpdate = true;
    walls.instanceColor!.needsUpdate = true;
  }

  /** A finished turn: fireworks over the workshop. */
  burst(tileId: string): void {
    const w = this.workers.get(tileId);
    if (!w || this.reduced) return;
    const c = new THREE.Color(this.pal.done || this.pal.working), c2 = new THREE.Color(0xfff2b0);
    const y = w.ground + 4.5;
    for (let i = 0; i < 70; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = 2.4 + Math.random() * 1.2;
      const r = Math.sqrt(1 - u * u);
      this.sparks.emit(w.door.x, y, w.door.z, Math.cos(a) * r * s, u * s + 0.6, Math.sin(a) * r * s, 1.1 + Math.random() * 0.5, 0.28, i % 3 ? c : c2, -0.1, 1.6);
    }
  }
  /** A new agent arrived: a puff where it stands. */
  arrive(tileId: string): void {
    const w = this.workers.get(tileId);
    if (!w || this.reduced) return;
    const c = new THREE.Color(this.pal.mode === "dark" ? 0xc7d3e6 : 0xffffff);
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; this.smoke.emit(w.work.x, w.ground + 0.2, w.work.z, Math.cos(a) * 1.4, 0.4, Math.sin(a) * 1.4, 0.9, 0.5, c, 0.6, 2.5); }
  }

  // ── the camera ──────────────────────────────────────────────────────────────
  /** Look at a place; `close` how near. */
  flyTo(x: number, z: number, dist: number): void {
    Object.assign(this.goal, { x, z, dist });
    this.goal.pitch = Math.min(this.goal.pitch, 0.95);
    if (this.reduced) Object.assign(this.view, this.goal);
  }
  flyToAgent(tileId: string): boolean {
    const w = this.workers.get(tileId);
    if (!w) return false;
    this.flyTo(w.door.x, w.door.z, 24);
    return true;
  }
  flyToIsland(id: string): boolean {
    const i = this.islands.get(id);
    if (!i) return false;
    this.flyTo(i.x, i.z, Math.max(22, i.r * 4));
    return true;
  }
  /** Everything in sight. */
  overview(): void {
    let cx = 0, cz = 0, n = 0;
    for (const i of this.islands.values()) { cx += i.x; cz += i.z; n++; }
    if (n) { cx /= n; cz /= n; }
    let r = 10;
    for (const i of this.islands.values()) r = Math.max(r, Math.hypot(i.x - cx, i.z - cz) + i.r);
    this.flyTo(cx, cz, r * 1.85 + 8);
  }
  hasAgent(tileId: string): boolean { return this.workers.has(tileId); }

  /** Moves toward the goal; true while it is still moving. */
  private moveCamera(dt: number, lead: number): boolean {
    const k = 1 - Math.exp(-dt * 3.2);
    let moving = false;
    for (const key of ["x", "z", "dist", "yaw", "pitch"] as const) {
      const d = this.goal[key] - this.view[key];
      if (Math.abs(d) > 0.0005) { this.view[key] += d * k; moving = true; } else this.view[key] = this.goal[key];
    }
    const v = this.view;
    const fx = Math.cos(v.yaw), fz = Math.sin(v.yaw);
    // With a terminal docked on the right, look a little to the right so the place stays in the open half.
    const sx = -fz * lead * v.dist * 0.28, sz = fx * lead * v.dist * 0.28;
    this.camera.position.set(v.x + sx + fx * Math.cos(v.pitch) * v.dist, Math.sin(v.pitch) * v.dist, v.z + sz + fz * Math.cos(v.pitch) * v.dist);
    this.camera.lookAt(v.x + sx, 0.6, v.z + sz);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = v.dist * 1.4; fog.far = v.dist * 4.2 + 60;
    const u = this.sea.material.uniforms;
    u.fogNear!.value = fog.near; u.fogFar!.value = fog.far;
    return moving;
  }

  // ── each frame ──────────────────────────────────────────────────────────────
  /** Draw one frame at time `t` (seconds), `dt` since the last; true when something is still moving. */
  frame(t: number, dt: number, lead: number): boolean {
    let moving = this.moveCamera(dt, lead);
    const reduced = this.reduced;
    this.sea.material.uniforms.time!.value = t;
    this.sea.material.uniforms.still!.value = reduced ? 1 : 0;
    const bodies = this.meshes.bodies, heads = this.meshes.heads, fires = this.meshes.fires, helpers = this.meshes.helpers;
    const grey = new THREE.Color(this.pal.mode === "dark" ? 0x9aa4b4 : 0xd9dde3), dusk = new THREE.Color(this.pal.mode === "dark" ? 0x6c7584 : 0x9a9a9a);
    const red = new THREE.Color(this.pal.failed).lerp(new THREE.Color(0x333333), 0.35), spark = new THREE.Color(0xffc861);
    let beacon = 0, helper = 0;
    const away = (p: THREE.Vector3, target: THREE.Vector3, step: number) => {
      const dx = target.x - p.x, dz = target.z - p.z, len = Math.hypot(dx, dz);
      if (len < 0.02) return false;
      if (reduced || len < step) { p.x = target.x; p.z = target.z; } else { p.x += (dx * step) / len; p.z += (dz * step) / len; }
      return true;
    };
    if (bodies && heads && fires && helpers) {
      for (const w of this.order) {
        const i = w.index;
        const target = w.mood === "calling" ? w.beacon : w.mood === "idle" || w.mood === "done" ? w.rest : w.work;
        const walking = away(w.pos, target, dt * 2.4);
        if (walking) moving = true;
        const y = w.ground;
        let bob = 0, lean = 0, squash = 1;
        if (!reduced) {
          if (walking) bob = Math.abs(Math.sin(t * 12 + w.phase)) * 0.12;
          else if (w.mood === "working") { const s = (t * (1.3 + w.activity * 0.5) + w.phase) % 1; bob = s < 0.15 ? -0.06 : Math.sin(s * Math.PI) * 0.05; lean = s < 0.2 ? 0.35 : 0; }
          else if (w.mood === "calling") bob = Math.abs(Math.sin(t * 5 + w.phase)) * 0.22;
          else if (w.mood === "idle" || w.mood === "done") squash = 0.82 + Math.sin(t * 1.4 + w.phase) * 0.02;
        } else if (w.mood === "idle" || w.mood === "done") squash = 0.82;
        if (w.mood === "failed") { squash = 0.7; lean = 0.6; }
        const look = Math.atan2(w.spot.x - w.pos.x, w.spot.z - w.pos.z) + (w.mood === "calling" ? Math.PI : 0);
        const fade = w.arrived && !reduced ? Math.min(1, (performance.now() - w.arrived) / 600) : 1;
        const sc = w.mood === "gone" ? 0 : fade;
        place(bodies, i, w.pos.x, y + bob, w.pos.z, look, sc, sc * squash, sc, lean);
        place(heads, i, w.pos.x, y + bob - (1 - squash) * 0.5, w.pos.z, look, sc, sc, sc, lean * 0.5);
        // Fire when resting by it.
        const lit = w.mood === "idle" || w.mood === "done";
        const flick = reduced ? 1 : 0.85 + Math.sin(t * 17 + w.phase * 3) * 0.1 + Math.sin(t * 7.3 + w.phase) * 0.08;
        place(fires, i, w.fire.x, w.ground, w.fire.z, t * (reduced ? 0 : 2), lit ? 1 : 0.0001, lit ? flick : 0.0001, lit ? 1 : 0.0001);
        // Helpers (its subagents) trot around it.
        for (let k = 0; k < 4; k++) {
          const show = k < w.subagents && w.mood !== "gone";
          const a = (reduced ? 0 : t * 1.6) + (k / Math.max(w.subagents, 1)) * Math.PI * 2;
          place(helpers, helper++, w.work.x + Math.cos(a) * 0.8, w.ground + (reduced ? 0 : Math.abs(Math.sin(t * 9 + k)) * 0.08), w.work.z + Math.sin(a) * 0.8, -a, show ? 1 : 0.0001);
        }
        if (reduced) continue;
        // Smoke and sparks, as busy as its terminal.
        const r = Math.random;
        if (w.mood === "working") {
          const rate = 1.2 + w.activity * 1.6;
          if (r() < rate * dt) this.smoke.emit(w.chimney.x, w.chimney.y, w.chimney.z, (r() - 0.5) * 0.2 + 0.25, 0.7 + r() * 0.3, (r() - 0.5) * 0.2, 3.2, 0.45, grey, 0.55, 0.15);
          const s = (t * (1.3 + w.activity * 0.5) + w.phase) % 1;
          if (s < dt * (1.3 + w.activity * 0.5) * 1.05 && !walking) {
            const ax = w.work.x + (w.spot.x - w.work.x) * 0.35, az = w.work.z + (w.spot.z - w.work.z) * 0.35;
            for (let k = 0; k < 4 + w.activity * 3; k++) this.sparks.emit(ax, w.ground + 0.3, az, (r() - 0.5) * 2.2, 1.2 + r() * 1.6, (r() - 0.5) * 2.2, 0.45 + r() * 0.3, 0.13, spark, -0.05, 0.6);
          }
        } else if (w.mood === "failed") {
          if (r() < 2.2 * dt) this.smoke.emit(w.chimney.x, w.chimney.y, w.chimney.z, (r() - 0.5) * 0.15, 0.55, (r() - 0.5) * 0.15, 3.6, 0.55, red, 0.6, 0.1);
        } else if (lit) {
          if (r() < 0.7 * dt) this.smoke.emit(w.fire.x, w.ground + 0.45, w.fire.z, 0.05, 0.5, 0, 1.8, 0.2, dusk, 0.3, 0.2);
          if (r() < 2 * dt) this.sparks.emit(w.fire.x, w.ground + 0.35, w.fire.z, (r() - 0.5) * 0.3, 0.9 + r() * 0.5, (r() - 0.5) * 0.3, 0.6, 0.08, spark, 0, 0.5);
        }
      }
      for (const m of [bodies, heads, fires, helpers]) m.instanceMatrix.needsUpdate = true;
    }
    // A light column over every agent calling the person, seen from anywhere. Additive, so a
    // dimmer colour is a fainter light.
    const day = this.pal.mode !== "dark", call = C.set(this.pal.attention), strong = day ? 1 : 0.42;
    const pulse = reduced ? 1 : 0.75 + Math.sin(t * 4) * 0.25, ripple = reduced ? 0.5 : (t * 0.8) % 1;
    this.calling = [];
    for (const w of this.order) {
      if (w.mood !== "calling" || beacon >= 256) continue;
      const i = beacon++;
      this.calling.push(w.tileId);
      place(this.columns, i, w.beacon.x, w.ground + 9, w.beacon.z, 0, pulse, 1, pulse);
      this.columns.setColorAt(i, day ? BEAM.copy(call) : BEAM.copy(call).multiplyScalar(strong * (reduced ? 1 : 0.7 + pulse * 0.3)));
      place(this.ripples, i, w.beacon.x, w.ground + 0.06, w.beacon.z, 0, 0.6 + ripple * 2.2);
      this.ripples.setColorAt(i, day ? BEAM.copy(call) : BEAM.copy(call).multiplyScalar(reduced ? 0.9 : 1 - ripple));
      moving = true;
    }
    for (const m of [this.columns, this.ripples]) { m.count = beacon; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // Flags wave; packets travel the ties.
    if (!reduced) {
      for (const f of this.flags) {
        const g = f.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < g.count; i++) { const x = f.along[i]!; g.setZ(i, f.z[i]! + Math.sin(x * 4 - t * 4 + f.z[i]! * 0.3) * 0.08 * x); }
        g.needsUpdate = true;
      }
      for (const tie of this.ties) {
        const a = this.workers.get(tie.a), b = this.workers.get(tie.b);
        if (!a || !b) continue;
        if (Math.random() < 1.6 * dt) {
          const curve = this.arc(a.door, b.door);
          const p = curve.getPoint(0), q = curve.getPoint(0.04);
          const c = new THREE.Color(tie.kind === "pipe" ? this.pal.accent : this.pal.working);
          const v = q.sub(p).multiplyScalar(25 / Math.max(1, a.door.distanceTo(b.door) * 0.25));
          this.sparks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 0.9, 0.3, c, 0, 0);
        }
      }
      this.smoke.step(dt, -0.05);
      this.sparks.step(dt, 2.2);
      if (this.order.length || this.smoke.live || this.sparks.live) moving = true;
    } else if (this.smoke.live || this.sparks.live) { this.smoke.clear(); this.sparks.clear(); this.smoke.step(0, 0); this.sparks.step(0, 0); }
    this.renderer.render(this.scene, this.camera);
    return moving;
  }

  // ── where things are on screen, and what is under the pointer ─────────────
  /** Where a world point is on screen, in CSS pixels; null when behind or out of sight. */
  screenOf(p: THREE.Vector3, w: number, h: number, margin = 0): { x: number; y: number; inside: boolean } | null {
    V.copy(p).project(this.camera);
    if (V.z > 1) return null;
    const x = ((V.x + 1) / 2) * w, y = ((1 - V.y) / 2) * h;
    return { x, y, inside: x >= margin && x <= w - margin && y >= margin && y <= h - margin };
  }
  agentAnchor(tileId: string, lift = 1.4): THREE.Vector3 | null {
    const w = this.workers.get(tileId);
    return w ? new THREE.Vector3(w.pos.x, w.ground + lift + (w.mood === "calling" ? 0.5 : 0), w.pos.z) : null;
  }
  islandAnchor(id: string): THREE.Vector3 | null {
    const i = this.islands.get(id);
    return i ? new THREE.Vector3(i.x, heightAt(i, i.x, i.z) + 3, i.z) : null;
  }
  pick(nx: number, ny: number): Pick | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const targets = [this.meshes.walls, this.meshes.roofs, this.meshes.bodies, this.meshes.heads].filter(Boolean) as THREE.Object3D[];
    const hit = this.ray.intersectObjects([...targets, this.columns, ...this.terrains], false)[0];
    if (!hit) return null;
    if (hit.object === this.columns && hit.instanceId !== undefined) { const id = this.calling[hit.instanceId]; return id ? { kind: "agent", id } : null; }
    if (hit.instanceId !== undefined && targets.includes(hit.object)) {
      const w = this.order[hit.instanceId];
      return w ? { kind: "agent", id: w.tileId } : null;
    }
    let isl: string | undefined, bestIsland = Infinity;
    for (const i of this.islands.values()) { const d = Math.hypot(i.x - hit.point.x, i.z - hit.point.z) / i.r; if (d < 1.2 && d < bestIsland) { bestIsland = d; isl = i.id; } }
    if (!isl) return null;
    // Land near a workshop counts as that agent.
    let best: Worker | null = null, bd = 1.6;
    for (const w of this.order) { const d = Math.hypot(w.spot.x - hit.point.x, w.spot.z - hit.point.z); if (d < bd) { bd = d; best = w; } }
    return best ? { kind: "agent", id: best.tileId } : { kind: "island", id: isl };
  }
  /** The ground under a screen point, for panning. */
  groundUnder(nx: number, ny: number): THREE.Vector3 | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }
  get triangles(): number { return this.renderer.info.render.triangles; }
  get drawCalls(): number { return this.renderer.info.render.calls; }
}

/** Many land geometries (position and colour, no index) as one. */
function mergeLand(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.getAttribute("position").array as Float32Array, o);
    col.set(p.getAttribute("color").array as Float32Array, o);
    nor.set(p.getAttribute("normal").array as Float32Array, o);
    o += p.getAttribute("position").count * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}
