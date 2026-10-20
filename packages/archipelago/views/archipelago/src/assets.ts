// The packed models and skies, read into what the scene draws: every kit model as one geometry
// for instancing, every worker's moves as a few poses baked into plain geometry (so a hundred
// workers are a few dozen draws, not a hundred animated skeletons), and the two skies as light.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface Kit {
  /** Each model by name, its parts merged and its base at y = 0. */
  model: Map<string, THREE.BufferGeometry>;
  /** A part that turns on its own (a windmill's sails): the point it turns round and which way its axle points. */
  part: Map<string, { hub: THREE.Vector3; axle: THREE.Vector3 }>;
  material: THREE.MeshStandardMaterial;
}
export type Who = "barbarian" | "knight" | "mage" | "rogue";
export type Move = "walk" | "idle" | "sit" | "cheer" | "work";
export interface People {
  /** Each pose of each move of each worker, ready to draw: `poses.get(who).get(move)[frame]`. */
  poses: Map<Who, Map<Move, THREE.BufferGeometry[]>>;
  materials: Map<Who, THREE.MeshStandardMaterial>;
  /** How long each worker's moves take, in seconds. */
  length: Map<Who, Map<Move, number>>;
}
export interface Assets { kit: Kit; people: People; skyDay: THREE.DataTexture; skyNight: THREE.DataTexture }

const bytes = (b64: string) => { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out.buffer; };

function parse(buf: ArrayBuffer): Promise<GLTF> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Textures load as images: the page may show a blob: image but not fetch one.
  loader.register((parser) => { (parser as unknown as { textureLoader: THREE.Loader }).textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: "island_images" }; });
  return new Promise((resolve, reject) => loader.parse(buf, "", resolve, reject));
}

/** A model's meshes as one geometry where the model stands, with only position, normal and uv;
 *  the parts in `apart` are left out. (Its node carries how its packed numbers scale, so keep it.) */
function merged(root: THREE.Object3D, apart: THREE.Object3D[] = []): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || apart.some((a) => a === o || isUnder(o, a))) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(k)) { g.deleteAttribute(k); continue; }
      // Packed as small integers that cannot hold a placed model: read them out as numbers first.
      const at = g.getAttribute(k), out = new Float32Array(at.count * at.itemSize);
      for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) out[i * at.itemSize + c] = at.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(out, at.itemSize));
    }
    g.applyMatrix4(m.matrixWorld);
    placeUvs(g, m);
    parts.push(g);
  });
  return join(parts);
}
/** Packing moved each part's texture coordinates and left the shift on its material; put them back
 *  where they point, so every part can share one plain material. */
function placeUvs(g: THREE.BufferGeometry, m: THREE.Mesh): void {
  const map = (m.material as THREE.MeshStandardMaterial).map;
  const uv = g.getAttribute("uv");
  if (!map || !uv) return;
  map.updateMatrix();
  const out = new Float32Array(uv.count * 2), p = new THREE.Vector2();
  for (let i = 0; i < uv.count; i++) { p.set(uv.getX(i), uv.getY(i)).applyMatrix3(map.matrix); out[i * 2] = p.x; out[i * 2 + 1] = p.y; }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2));
}
/** A material whose texture is not shifted, for coordinates already put back. */
function plain(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const out = m.clone();
  if (m.map) { out.map = m.map.clone(); out.map.offset.set(0, 0); out.map.repeat.set(1, 1); out.map.rotation = 0; out.map.needsUpdate = true; }
  return out;
}
const isUnder = (o: THREE.Object3D, a: THREE.Object3D): boolean => { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; };
function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const c = p.getAttribute("position").count;
    // Quantized attributes come back as their stored integers; read them as numbers.
    for (let i = 0; i < c; i++) {
      const P = p.getAttribute("position"), N = p.getAttribute("normal"), U = p.getAttribute("uv");
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], (o + i) * 3);
      if (N) nor.set([N.getX(i), N.getY(i), N.getZ(i)], (o + i) * 3);
      if (U) uv.set([U.getX(i), U.getY(i)], (o + i) * 2);
    }
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

async function readKit(b64: string): Promise<Kit> {
  const gltf = await parse(bytes(b64));
  const model = new Map<string, THREE.BufferGeometry>();
  const part: Kit["part"] = new Map();
  let material: THREE.MeshStandardMaterial | null = null;
  for (const node of [...gltf.scene.children]) {
    node.traverse((o) => { if (!material && (o as THREE.Mesh).isMesh) material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; });
    const apart = node.children.filter((c) => c.name.includes("_top_"));
    for (const c of apart) {
      c.updateWorldMatrix(true, false);
      part.set(c.name, { hub: new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), axle: new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 2).normalize() });
      model.set(c.name, merged(c));
    }
    const g = merged(node, apart);
    g.computeBoundingBox();
    model.set(node.name, g);
  }
  return { model, part, material: plain(material!) };
}

/** The clip each worker plays while it works. */
const WORK: Record<Who, string> = { barbarian: "Chop", knight: "Chop", mage: "Cast", rogue: "Use" };
const POSES: Record<Move, number> = { walk: 8, idle: 3, sit: 1, cheer: 6, work: 6 };
const CLIP: Record<Exclude<Move, "work">, string> = { walk: "Walk", idle: "Idle", sit: "Sit", cheer: "Cheer" };
/** How tall a worker stands, in tiles' units (a house is about one). */
const HEIGHT = 0.8;

async function readPeople(workersB64: string, movesB64: string): Promise<People> {
  const [w, m] = await Promise.all([parse(bytes(workersB64)), parse(bytes(movesB64))]);
  const clips = new Map(m.animations.map((a) => [a.name, a]));
  const poses = new Map<Who, Map<Move, THREE.BufferGeometry[]>>();
  const materials = new Map<Who, THREE.MeshStandardMaterial>();
  const length = new Map<Who, Map<Move, number>>();
  for (const who of ["barbarian", "knight", "mage", "rogue"] as Who[]) {
    // Packing named each one's parts after it ("Barbarian:Rig", read as "BarbarianRig").
    const prefix = who[0]!.toUpperCase() + who.slice(1);
    const body = new THREE.Group();
    for (const n of [...w.scene.children]) if (n.name.startsWith(prefix)) body.add(n.clone(true));
    if (!body.children.length) throw new Error(`no ${who} among the packed workers`);
    // The four share bone names, so loading them together numbered the later ones; their moves
    // name the bones plainly.
    body.traverse((o) => { o.name = o.name.replace(/_\d+$/, ""); });
    // Cloning a skinned rig needs its bones rebound to the clone's own.
    const bones = new Map<string, THREE.Bone>();
    body.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
    body.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (!s.isSkinnedMesh) return;
      s.bind(new THREE.Skeleton(s.skeleton.bones.map((b) => bones.get(b.name.replace(/_\d+$/, ""))!), s.skeleton.boneInverses), s.bindMatrix);
      if (!materials.has(who)) materials.set(who, plain(s.material as THREE.MeshStandardMaterial));
    });
    const mixer = new THREE.AnimationMixer(body);
    const byMove = new Map<Move, THREE.BufferGeometry[]>();
    const lengths = new Map<Move, number>();
    let scale = 1, floor = 0;
    for (const move of Object.keys(POSES) as Move[]) {
      const clip = clips.get(move === "work" ? WORK[who] : CLIP[move]);
      if (!clip) continue;
      mixer.stopAllAction();
      const act = mixer.clipAction(clip);
      act.reset().play();
      const frames: THREE.BufferGeometry[] = [];
      const n = POSES[move];
      for (let f = 0; f < n; f++) {
        mixer.setTime((clip.duration * f) / n);
        body.updateMatrixWorld(true);
        const g = pose(body);
        if (move === "idle" && f === 0) { g.computeBoundingBox(); floor = g.boundingBox!.min.y; scale = HEIGHT / Math.max(0.01, g.boundingBox!.max.y - floor); }
        frames.push(g);
      }
      act.stop();
      byMove.set(move, frames);
      lengths.set(move, clip.duration);
    }
    for (const frames of byMove.values()) for (const g of frames) { g.translate(0, -floor, 0); g.scale(scale, scale, scale); g.computeVertexNormals(); }
    poses.set(who, byMove);
    length.set(who, lengths);
  }
  return { poses, materials, length };
}

/** Where every vertex of a posed body is now, as one plain geometry. */
function pose(body: THREE.Object3D): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.geometry;
    const P = src.getAttribute("position"), U = src.getAttribute("uv");
    const idx = src.index;
    const count = idx ? idx.count : P.count;
    const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh;
    const placed = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      if (skinned) (m as THREE.SkinnedMesh).getVertexPosition(i, v); else v.fromBufferAttribute(P, i);
      v.applyMatrix4(m.matrixWorld);
      placed.set([v.x, v.y, v.z], i * 3);
    }
    for (let k = 0; k < count; k++) {
      const i = idx ? idx.getX(k) : k;
      pos.set(placed.subarray(i * 3, i * 3 + 3), k * 3);
      if (U) uv.set([U.getX(i), U.getY(i)], k * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    placeUvs(g, m);
    parts.push(g);
  });
  return join(parts);
}

function readSky(b64: string): THREE.DataTexture {
  const tex = new HDRLoader().parse(bytes(b64));
  const t = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat, tex.type);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function loadAssets(): Promise<Assets> {
  const a = await import("./archipelago-assets.js");
  const [kit, people] = await Promise.all([readKit(a.kit), readPeople(a.workers, a.moves)]);
  return { kit, people, skyDay: readSky(a.skyDay), skyNight: readSky(a.skyNight) };
}
