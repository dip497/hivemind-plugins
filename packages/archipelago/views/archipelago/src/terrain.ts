// The ground of every island as one smooth mesh, in place of hexagon tiles: a coast that follows the
// tiles but wanders, a beach that slopes into the sea, and land that rolls up inland to the island's
// middle. The same two functions shape the mesh and tell the rest of the scene where land is and how
// high it stands, so a house, a worker or you stands exactly on what is drawn.
import * as THREE from "three";

/** Grid spacing of the ground mesh, in world units (a tile is about two across). */
const STEP = 0.3;
/** Land is where `land()` is at least COAST; up to DRY it is beach. */
export const COAST = 0.5, DRY = 0.66;
/** Where the beach meets the water, just above the sea at -0.3, and how deep the sea floor drops. */
const SAND_TOP = 0.03, FLOOR = -0.7;
const BUCKET = 2;

export interface GroundTile { x: number; z: number; lift: number }
export interface GroundIsland { id: string; x: number; z: number; r: number; seed: number; grass: number; tiles: GroundTile[] }

const SAND = new THREE.Color(0xe8d6a6), WET = new THREE.Color(0xb9a77c);

export class Terrain {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private buckets = new Map<string, { t: GroundTile; island: number }[]>();
  private islands: GroundIsland[] = [];

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
  }

  /** How much land is here: about 1 on a tile's middle, COAST at the shore, 0 out at sea. */
  land(x: number, z: number): number { this.sample(x, z); return this.at.land; }
  /** How high the ground stands here; under the sea where there is no land. */
  height(x: number, z: number): number { this.sample(x, z); return this.at.height; }
  /** The last sample, kept in one object: the scene asks hundreds of times a frame. */
  private at = { land: 0, height: 0, island: -1 };

  build(islands: readonly GroundIsland[]): void {
    this.islands = [...islands];
    this.buckets.clear();
    this.islands.forEach((isl, i) => {
      for (const t of isl.tiles) {
        const k = `${Math.floor(t.x / BUCKET)},${Math.floor(t.z / BUCKET)}`;
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        b.push({ t, island: i });
      }
    });
    const pos: number[] = [], col: number[] = [], index: number[] = [];
    const grass = new THREE.Color(), c = new THREE.Color();
    this.islands.forEach((isl, i) => {
      const x0 = isl.x - isl.r - 2.5, z0 = isl.z - isl.r - 2.5, n = Math.ceil((isl.r * 2 + 5) / STEP) + 1;
      const base = pos.length / 3, mine: boolean[] = [];
      for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
        const x = x0 + k * STEP, z = z0 + j * STEP;
        this.sample(x, z);
        const s = this.at;
        pos.push(x, s.height, z);
        mine.push(s.island === i && s.land > COAST - 0.14);
        // Sand at the water, the island's own green inland, broken up a little.
        grass.setHex(isl.grass).multiplyScalar(0.94 + noise(x * 0.9, z * 0.9) * 0.12);
        const dry = smooth(COAST + 0.02, DRY + 0.06, s.land);
        c.copy(WET).lerp(SAND, smooth(COAST - 0.06, COAST + 0.06, s.land)).lerp(grass, dry);
        col.push(c.r, c.g, c.b);
      }
      for (let j = 0; j < n - 1; j++) for (let k = 0; k < n - 1; k++) {
        const a = base + j * n + k, b = a + 1, d = a + n, e = d + 1;
        const l = j * n + k;
        if (!(mine[l] || mine[l + 1] || mine[l + n] || mine[l + n + 1])) continue;
        index.push(a, d, b, b, d, e);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  /** Land, height and whose island, from the tiles near (x, z), into `at`. */
  private sample(x: number, z: number): void {
    let best = 0, island = -1, wsum = 0, hsum = 0;
    const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const b = this.buckets.get(`${bx + i},${bz + j}`);
      if (!b) continue;
      for (const { t, island: n } of b) {
        const d = Math.hypot(x - t.x, z - t.z);
        if (d > 1.9) continue;
        // A tile's pull: whole within its inner circle, nothing past a little beyond its corners.
        const k = smooth(1.5, 0.55, d);
        if (k > best) { best = k; island = n; }
        const w = Math.pow(smooth(1.9, 0, d), 3);
        wsum += w; hsum += w * t.lift;
      }
    }
    // A coast that wanders rather than following each tile's edge.
    const land = best + (noise(x * 0.55, z * 0.55) - 0.5) * 0.28 + (noise(x * 1.7 + 9, z * 1.7) - 0.5) * 0.08;
    const inland = wsum > 0 ? hsum / wsum : 0;
    const rolling = (noise(x * 0.35 + 3, z * 0.35) - 0.5) * 0.12;
    let height: number;
    if (land >= COAST) height = SAND_TOP + (Math.max(0, inland + rolling) + 0.02) * smooth(COAST, DRY + 0.1, land);
    else height = FLOOR + (SAND_TOP - FLOOR) * smooth(COAST - 0.32, COAST, land);
    this.at.land = land; this.at.height = height; this.at.island = island;
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
/** Smooth value noise, 0 to 1. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
