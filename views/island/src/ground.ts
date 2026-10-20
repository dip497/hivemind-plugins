// What grows on the open ground: tufts of grass and wildflowers over every meadow, each tuft three
// blades dark at the root and light at the tip, swaying in one wind so neighbours move together.
// Every tuft on every island is one instanced mesh, one draw call; from far off, where a tuft is
// smaller than a pixel, it is not drawn at all.
import * as THREE from "three";
import { random } from "./world";

/** Tufts on each open tile, and the share of them in flower. */
const PER_TILE = 30, FLOWERS = 0.12;
/** Drawn only while the camera is nearer than this. */
const NEAR = 70;
const BLOOMS = [0xfff6e0, 0xffd84a, 0xf28fb0, 0xb9a4ff];

export interface Meadow { x: number; y: number; z: number; grass: number }

export class Tufts {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private wind = { value: 0 };

  constructor() {
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), tuftMaterial(this.wind), 1);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Scatters tufts over these tiles: grass of each tile's own green, and a few flowers among it. */
  build(meadows: readonly Meadow[]): void {
    const n = meadows.length * PER_TILE;
    if (this.mesh.instanceMatrix.count < n) {
      const old = this.mesh;
      const next = new THREE.InstancedMesh(old.geometry, old.material, n + 64);
      next.frustumCulled = false;
      old.parent?.add(next);
      old.parent?.remove(old);
      old.dispose();
      this.mesh = next;
    }
    const rand = random(0x9a55), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let i = 0;
    for (const t of meadows) for (let k = 0; k < PER_TILE; k++) {
      // Anywhere inside the hexagon, not on a grid.
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.86;
      const flower = rand() < FLOWERS;
      const size = flower ? 0.6 + rand() * 0.3 : 0.75 + rand() * 0.6;
      m.compose(p.set(t.x + Math.cos(a) * r, t.y, t.z + Math.sin(a) * r), q.setFromAxisAngle(up, rand() * Math.PI), s.set(size, size * (0.8 + rand() * 0.5), size));
      this.mesh.setMatrixAt(i, m);
      if (flower) c.setHex(BLOOMS[Math.floor(rand() * BLOOMS.length)]!);
      else c.setHex(t.grass).multiplyScalar(0.92 + rand() * 0.22);
      this.mesh.setColorAt(i, c);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Sways them, and draws them only while the camera is close enough to see them. */
  update(t: number, distance: number, reduced: boolean): void {
    this.wind.value = reduced ? 0 : t;
    this.mesh.visible = this.mesh.count > 0 && distance < NEAR;
  }
}

/** Four blades fanned out from their root; `tip` is 0 at the root and 1 at the top. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], tip: number[] = [], col: number[] = [];
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI + 0.3, cx = Math.cos(a), cz = Math.sin(a), lean = 0.05 * (b - 1.5);
    const w = 0.045, h = 0.17 + (b % 2) * 0.06;
    pos.push(-cx * w, 0, -cz * w, cx * w, 0, cz * w, lean + cz * 0.01, h, -cx * 0.01 + lean);
    tip.push(0, 0, 1);
    // Darker in the shade at its root.
    col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.1, 1.1, 1.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("tip", new THREE.Float32BufferAttribute(tip, 1));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function tuftMaterial(wind: { value: number }): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uWind = wind;
    s.vertexShader = "uniform float uWind;\nattribute float tip;\n" + s.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      // One wind over the whole meadow: neighbouring tufts lean together, only their tips move.
      vec2 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
      float gust = sin(uWind * 1.9 + at.x * 0.55 + at.y * 0.3) * 0.6 + sin(uWind * 3.1 + at.x * 1.3) * 0.25;
      transformed.x += tip * gust * 0.06;
      transformed.z += tip * gust * 0.03;`).replace("#include <beginnormal_vertex>", `
      // Blades catch the light from above, like the ground they grow from.
      vec3 objectNormal = vec3(0.0, 1.0, 0.0);
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
      #endif`);
  };
  m.customProgramCacheKey = () => "island-tufts";
  return m;
}
