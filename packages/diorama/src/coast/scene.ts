/**
 * The coast in 3D: the ground, the sea, the grass, the trees, the lanterns along the path, the
 * cottages, a lighthouse now and then, boats and gulls. Each is a mesh whose shader puts it where
 * the world (world.ts) says, around the camera's window: the ground and the sea are grids that
 * follow the camera, and everything repeated (blades, trees, lanterns) is an instance on a lattice
 * that wraps round the window, so nothing is ever made or thrown away while it runs.
 *
 * Every surface writes what it is into its alpha (CLS / 16) for the character pass (ascii.ts).
 */
import * as THREE from "three";
import { WORLD_GLSL } from "./world";

export const CLS = {
  grass: 1, flower: 2, leaf: 3, wood: 4, sand: 5, water: 6, foam: 7, rock: 8, path: 9,
  roof: 10, wall: 11, light: 12, hull: 13, sail: 14, bird: 15,
} as const;

/** The window the ground, the sea and the instances cover, round the camera's target. */
const WIN = { w: 112, d: 88 };

/** What every shader shares: the time, where the window is, the sun, the pointer's gust, ripples. */
export interface Shared {
  uTime: { value: number };
  uCenter: { value: THREE.Vector2 };
  uGust: { value: THREE.Vector3 };
  uRipples: { value: THREE.Vector4[] };
}

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec2 uCenter;
uniform vec3 uGust;
uniform vec4 uRipples[4];
const vec3 SUN = normalize(vec3(-.45, .8, .42));
${WORLD_GLSL}
// Lit by a low warm sun from the front left and a sky fill.
// Colours are written as they look on screen; light works on them in linear light.
vec3 lit(vec3 c, vec3 n) { float l = max(dot(n, SUN), 0.); return pow(c, vec3(2.2)) * (vec3(.42, .46, .52) + vec3(1.05, .97, .85) * l); }
// Shade drifting over everything from clouds out of sight.
float cloud(vec2 p) { return 1. - .22 * smoothstep(.52, .78, wn(p * .6 + vec2(uTime * 1.6, uTime * .4), 64.)); }
// Where a lattice instance of spacing s, numbered (i, j) in a window of n.x by n.y, is in the world
// now: on the cell nearest the window's middle that is i, j modulo n.
vec2 wrapCell(float i, float j, vec2 n, float s) {
  vec2 lo = floor(uCenter / s) - floor(n * .5), k = vec2(i, j);
  // The first cell at or after the window's near edge that is k modulo n.
  return k + n * ceil((lo - k) / n);
}
`;

const cls = (k: number) => (k / 16).toFixed(4);

// ── the ground ────────────────────────────────────────────────────────────────────────────────

const GROUND_VERT = /* glsl */ `
${COMMON}
varying vec3 vW; varying vec3 vN;
void main() {
  vec2 p = position.xz + floor(uCenter);
  float h = ground(p);
  float e = .3;
  vec3 n = normalize(vec3(ground(p - vec2(e, 0.)) - ground(p + vec2(e, 0.)), 2. * e, ground(p - vec2(0., e)) - ground(p + vec2(0., e))));
  vW = vec3(p.x, h, p.y); vN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;

const GROUND_FRAG = /* glsl */ `
${COMMON}
uniform float uTree;
varying vec3 vW; varying vec3 vN;
void main() {
  vec2 p = vW.xz; vec3 n = normalize(vN);
  float d = inland(p), b = beachW(p.x), steep = 1. - n.y;
  float k; vec3 c;
  float grain = wn(p, .5);
  if (vW.y < .25 || (d < b + .9 && steep < .42)) {
    // Sand, wet and darker at the water's edge.
    c = mix(vec3(.80, .66, .42), vec3(.94, .84, .62), smoothstep(.0, 1.4, d) * (.8 + .2 * grain)); k = ${cls(CLS.sand)};
  } else if (steep > .42) {
    // Cliff faces: banded stone.
    float band = .5 + .5 * sin(vW.y * 3.1 + wn(p, 4.) * 3.);
    c = mix(vec3(.30, .28, .27), vec3(.56, .50, .43), band * .6 + grain * .4); k = ${cls(CLS.rock)};
  } else if (pathD(p) < 1.15) {
    // The clifftop path: pale gravel, its stones.
    c = mix(vec3(.72, .64, .52), vec3(.86, .80, .68), grain); k = ${cls(CLS.path)};
  } else {
    float f = wf(p, 16.);
    c = mix(vec3(.22, .42, .17), vec3(.52, .70, .28), f);
    c = mix(c, vec3(.62, .66, .30), smoothstep(.62, .8, wn(p + 77., 32.)) * .5);
    k = ${cls(CLS.grass)};
  }
  // Dappled shade under the trees: one in each cell of the tree lattice, where the woods are.
  float w = woody(p);
  if (w > .02) {
    vec2 sp = p + SUN.xz / SUN.y * 2.2;
    vec2 cell = floor(sp / uTree);
    float shade = 0.;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      vec2 cc = cell + vec2(float(i), float(j)), cm = vec2(mod(cc.x, PERIOD / uTree), cc.y);
      if (h12(cm) > w) continue;
      vec2 at = (cc + .25 + .5 * vec2(h12(cm + 3.1), h12(cm + 7.7))) * uTree;
      shade = max(shade, 1. - smoothstep(.9, 1.7, length(sp - at)));
    }
    c *= 1. - .45 * shade;
  }
  gl_FragColor = vec4(lit(c, n) * cloud(p), k);
}`;

// ── the sea ───────────────────────────────────────────────────────────────────────────────────

const SEA_VERT = /* glsl */ `
${COMMON}
varying vec2 vP;
void main() { vec2 p = position.xz + floor(uCenter); vP = p; gl_Position = projectionMatrix * viewMatrix * vec4(p.x, 0., p.y, 1.); }`;

const SEA_FRAG = /* glsl */ `
${COMMON}
varying vec2 vP;
void main() {
  vec2 p = vP;
  float g = ground(p), depth = max(0., -g), d = inland(p);
  // Kept well below white, so most of the sea draws as ~ and -, and only foam is bright.
  vec3 shallow = vec3(.20, .55, .54), mid = vec3(.09, .38, .50), deep = vec3(.05, .19, .34);
  vec3 c = mix(shallow, mid, smoothstep(.2, 1.6, depth));
  c = mix(c, deep, smoothstep(1.6, 5., depth));
  // Caustic light in the shallows.
  c += .08 * smoothstep(.6, .9, wn(p * 1.3 + vec2(uTime * .4, 0.), 2.)) * (1. - smoothstep(.5, 2., depth));
  float foam = 0.;
  // Waves rolling in to the shore, breaking where it shoals, and the swash running up the sand.
  float wave = sin(-d * 1.7 - uTime * 1.25 + wn(p, 8.) * 5.);
  foam = max(foam, smoothstep(.78, .95, wave) * (1. - smoothstep(.6, 2.6, depth)));
  float swash = -.35 - .45 * (.5 + .5 * sin(uTime * .8 + wn(p, 16.) * 6.));
  foam = max(foam, smoothstep(swash - .25, swash, d) * step(d, .05));
  // Round the rocks.
  foam = max(foam, smoothstep(-.55, -.2, g) * step(g, 0.) * step(.3, wn(p * 2. + uTime * .3, 1.)));
  // Whitecaps out at sea, few.
  foam = max(foam, smoothstep(.93, .97, wn(p + vec2(uTime * .9, uTime * .2), 2.)) * smoothstep(3., 5., depth));
  // Rings where the sea was clicked.
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.z < 0. || age > 3.5) continue;
    float ring = abs(length(p - r.xy) - age * 2.6);
    foam = max(foam, (1. - smoothstep(.15, .5, ring)) * (1. - age / 3.5));
  }
  vec3 col = mix(c, vec3(.96, .98, .96), foam);
  gl_FragColor = vec4(lit(col, vec3(0., 1., 0.)) * cloud(p), foam > .5 ? ${cls(CLS.foam)} : ${cls(CLS.water)});
}`;

// ── grass and flowers ─────────────────────────────────────────────────────────────────────────

// Every lattice and row divides the world's period, so the world comes round without a jump.
const GRASS = { s: 0.32 };

const GRASS_VERT = /* glsl */ `
${COMMON}
attribute vec2 cell;
varying vec3 vC; varying float vK;
void main() {
  vec2 n = vec2(${(WIN.w / GRASS.s).toFixed(1)}, ${(WIN.d / GRASS.s).toFixed(1)});
  vec2 c = wrapCell(cell.x, cell.y, n, ${GRASS.s.toFixed(3)});
  vec2 cm = vec2(mod(c.x, PERIOD / ${GRASS.s.toFixed(3)}), c.y);
  vec2 p = (c + vec2(h12(cm), h12(cm + 5.3))) * ${GRASS.s.toFixed(3)};
  float g = grassy(p), fl = flowery(p);
  float isFlower = step(.6, h12(cm + 9.1)) * step(.3, fl);
  float tall = (.32 + .3 * h12(cm + 2.2)) * g * (1. - .45 * isFlower);
  if (g < .3) tall = 0.;
  float base = ground(p);
  // Wind in waves across the grass, and a gust round the pointer.
  float wind = .22 * sin(uTime * 1.4 + p.x * .35 + p.y * .22) + .1 * sin(uTime * 2.7 + p.x * 1.3);
  vec2 away = p - uGust.xy; float gust = uGust.z * exp(-dot(away, away) / 18.);
  vec2 lean = vec2(wind, wind * .3) + normalize(away + 1e-4) * gust * .8;
  float yaw = h12(cm + 4.4) * 6.283;
  vec2 side = vec2(cos(yaw), sin(yaw)) * .07;
  float up = position.y;
  vec3 w = vec3(p.x + side.x * position.x + lean.x * up * up * tall, base + up * tall, p.y + side.y * position.x + lean.y * up * up * tall);
  vec3 grass = mix(vec3(.18, .40, .14), vec3(.56, .76, .30), h12(cm + 1.7) * .7 + up * .5);
  float hue = h12(cm + 6.6);
  vec3 petal = hue < .35 ? vec3(.97, .96, .90) : hue < .6 ? vec3(.98, .82, .30) : hue < .82 ? vec3(.93, .52, .62) : vec3(.66, .55, .92);
  vC = lit(mix(grass, petal, isFlower * smoothstep(.5, .9, up)), normalize(vec3(-lean.x, 1., -lean.y))) * cloud(p);
  vK = isFlower > .5 ? ${cls(CLS.flower)} : ${cls(CLS.grass)};
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

const FLAT_FRAG = /* glsl */ `
varying vec3 vC; varying float vK;
void main() { gl_FragColor = vec4(vC, vK); }`;

// ── trees ─────────────────────────────────────────────────────────────────────────────────────

const TREE = { s: 3.2 };

const TREE_VERT = /* glsl */ `
${COMMON}
attribute vec2 cell;
attribute float part; // 0 crown, 1 trunk
varying vec3 vC; varying float vK;
void main() {
  vec2 n = vec2(${(WIN.w / TREE.s).toFixed(1)}, ${(WIN.d / TREE.s).toFixed(1)});
  vec2 c = wrapCell(cell.x, cell.y, n, ${TREE.s.toFixed(2)});
  vec2 cm = vec2(mod(c.x, PERIOD / ${TREE.s.toFixed(2)}), c.y);
  vec2 p = (c + .25 + .5 * vec2(h12(cm + 3.1), h12(cm + 7.7))) * ${TREE.s.toFixed(2)};
  float here = step(h12(cm), woody(p));
  float size = (.85 + .5 * h12(cm + 1.1)) * here;
  float base = ground(p);
  float sway = .06 * sin(uTime * 1.1 + p.x * .4) * position.y;
  vec3 w = vec3(p.x + position.x * size + sway, base + position.y * size, p.y + position.z * size);
  float t = h12(cm + 2.9);
  vec3 leaf = t < .1 ? vec3(.86, .58, .20) : t < .16 ? vec3(.78, .30, .20) : mix(vec3(.12, .32, .14), vec3(.30, .52, .20), h12(cm + 8.8));
  vec3 col = part > .5 ? vec3(.36, .25, .17) : leaf * (.8 + .35 * (position.y / 2.6));
  vC = lit(col, normalize(normal)) * cloud(p);
  vK = part > .5 ? ${cls(CLS.wood)} : ${cls(CLS.leaf)};
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

// ── things along the coast: lanterns, cottages, a lighthouse, boats, gulls ───────────────────

/** A row of things every `every` units along x, `count` of them round the camera. */
const ALONG = /* glsl */ `
float slotX(float k, float count, float every) { return (floor(uCenter.x / every) + k - floor(count * .5)) * every; }
vec2 pathAt(float x) { return vec2(x, shoreZ(x) - (beachW(x) + 2.6 + pathIn(x))); }
`;

const PROP_VERT = (place: string) => /* glsl */ `
${COMMON}
${ALONG}
attribute float slot;
attribute float part;
varying vec3 vC; varying float vK;
${place}
void main() {
  vec3 w; vec3 col; float k; vec3 nrm = normalize(normal);
  placeIt(position, slot, part, w, col, k);
  vC = lit(col, nrm) * cloud(w.xz) + (k > ${cls(CLS.light)} - .001 && k < ${cls(CLS.light)} + .001 ? vec3(.5, .35, .1) : vec3(0.));
  vK = k;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;

const LANTERN = /* glsl */ `
void placeIt(vec3 v, float slot, float part, out vec3 w, out vec3 col, out float k) {
  float x = slotX(slot, 28., 6.4);
  vec2 at = pathAt(x) + vec2(0., .95);
  w = vec3(at.x + v.x, ground(at) + v.y, at.y + v.z);
  col = part > .5 ? vec3(1., .82, .45) : vec3(.30, .22, .16);
  k = part > .5 ? ${cls(CLS.light)} : ${cls(CLS.wood)};
}`;

const COTTAGE = /* glsl */ `
void placeIt(vec3 v, float slot, float part, out vec3 w, out vec3 col, out float k) {
  float x0 = slotX(slot, 6., 32.), id = mod(x0 / 32., PERIOD / 32.);
  float x = x0 + 9. * (h12(vec2(id, 5.)) - .5);
  float here = step(.3, h12(vec2(id, 9.)));
  vec2 at = pathAt(x) - vec2(0., 4.2 + 1.5 * h12(vec2(id, 2.)));
  w = vec3(at.x + v.x * here, ground(at) - .1 + v.y * here, at.y + v.z * here);
  float hue = h12(vec2(id, 4.));
  vec3 roof = hue < .55 ? vec3(.78, .25, .16) : hue < .8 ? vec3(.20, .38, .62) : vec3(.86, .64, .26);
  col = part > 1.5 ? vec3(.22, .16, .12) : part > .5 ? roof : vec3(.95, .91, .83);
  k = part > 1.5 ? ${cls(CLS.wood)} : part > .5 ? ${cls(CLS.roof)} : ${cls(CLS.wall)};
}`;

const LIGHTHOUSE = /* glsl */ `
void placeIt(vec3 v, float slot, float part, out vec3 w, out vec3 col, out float k) {
  float x = slotX(slot, 2., 256.) + 40.;
  vec2 at = vec2(x, shoreZ(x) - beachW(x) - 3.4);
  w = vec3(at.x + v.x, ground(at) - .2 + v.y, at.y + v.z);
  float band = step(.5, fract(v.y / 1.6));
  col = part > .5 ? vec3(1., .9, .55) : mix(vec3(.96, .95, .92), vec3(.80, .20, .16), band);
  k = part > .5 ? ${cls(CLS.light)} : band > .5 ? ${cls(CLS.roof)} : ${cls(CLS.wall)};
}`;

const BOAT = /* glsl */ `
void placeIt(vec3 v, float slot, float part, out vec3 w, out vec3 col, out float k) {
  float every = 25.6;
  float x0 = slotX(slot, 7., every);
  float seed = h12(vec2(mod(x0 / every, PERIOD / every), 1.));
  float x = x0;
  x += mod(uTime * (.25 + .3 * seed), every) - every * .5;
  float z = shoreZ(x) + 6. + 14. * seed;
  float bob = .06 * sin(uTime * 1.6 + seed * 9.);
  float roll = .05 * sin(uTime * 1.2 + seed * 5.);
  w = vec3(x + v.x, .02 + v.y + bob + v.z * roll, z + v.z);
  vec3 hull = seed < .4 ? vec3(.80, .22, .18) : seed < .7 ? vec3(.18, .34, .62) : vec3(.92, .90, .84);
  col = part > .5 ? vec3(.97, .95, .90) : hull;
  k = part > .5 ? ${cls(CLS.sail)} : ${cls(CLS.hull)};
}`;

const GULL = /* glsl */ `
void placeIt(vec3 v, float slot, float part, out vec3 w, out vec3 col, out float k) {
  float seed = h12(vec2(slot, 13.));
  float a = uTime * (.12 + .1 * seed) + seed * 6.283;
  vec2 c = vec2(uCenter.x + (seed - .5) * 60., shoreZ(uCenter.x) + (h12(vec2(slot, 2.)) - .5) * 30.);
  vec2 at = c + vec2(cos(a) * (8. + 6. * seed), sin(a) * 4.);
  float flap = sin(uTime * 7. + seed * 20.) * abs(v.x);
  vec2 dir = normalize(vec2(-sin(a), cos(a) * .5));
  w = vec3(at.x + dir.x * v.z - dir.y * v.x, 7. + 3. * seed + v.y + flap * .6, at.y + dir.y * v.z + dir.x * v.x);
  col = vec3(.96, .96, .94);
  k = ${cls(CLS.bird)};
}`;

// ── building it ───────────────────────────────────────────────────────────────────────────────

function material(vert: string, frag: string, shared: Shared, extra: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { ...shared, ...extra }, side });
}

/** A lattice of `nx` by `nz` instances of `geo`, each told its cell. */
function lattice(geo: THREE.BufferGeometry, nx: number, nz: number) {
  const g = new THREE.InstancedBufferGeometry().copy(geo as THREE.InstancedBufferGeometry);
  const cells = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { cells[(j * nx + i) * 2] = i; cells[(j * nx + i) * 2 + 1] = j; }
  g.setAttribute("cell", new THREE.InstancedBufferAttribute(cells, 2));
  g.instanceCount = nx * nz;
  return g;
}
/** `count` instances of `geo`, each told its slot. */
function slots(geo: THREE.BufferGeometry, count: number) {
  const g = new THREE.InstancedBufferGeometry().copy(geo as THREE.InstancedBufferGeometry);
  g.setAttribute("slot", new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
  g.instanceCount = count;
  return g;
}
/** Geometries merged, each vertex told which part it belongs to. */
function parts(...gs: THREE.BufferGeometry[]) {
  const pos: number[] = [], nrm: number[] = [], part: number[] = [];
  gs.forEach((g0, k) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); part.push(k); }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("part", new THREE.Float32BufferAttribute(part, 1));
  return out;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** The coast's meshes in `scene`, on the shared uniforms. Their shaders put them round the camera
 *  wherever it is along the coast, so their own bounds (round the origin) say nothing: never culled. */
export function buildCoast(scene: THREE.Scene, shared: Shared) {
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  };
  const plane = (step: number) => new THREE.PlaneGeometry(WIN.w, WIN.d, Math.round(WIN.w / step), Math.round(WIN.d / step)).rotateX(-Math.PI / 2);

  // The ground's grid moves with the camera by whole units, a multiple of its spacing, so its
  // points always land on the same places of the world and it never shimmers.
  put(plane(0.5), material(GROUND_VERT, GROUND_FRAG, shared, { uTree: { value: TREE.s } }));
  put(plane(4), material(SEA_VERT, SEA_FRAG, shared));

  // A blade: one bent triangle, its base two points and its tip one (y from 0 to 1).
  const blade = new THREE.BufferGeometry();
  blade.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const nG = { x: Math.round(WIN.w / GRASS.s), z: Math.round(WIN.d / GRASS.s) };
  put(lattice(blade, nG.x, nG.z), material(GRASS_VERT, FLAT_FRAG, shared, {}, THREE.DoubleSide));

  // A tree: a crown of a few rounded clumps over a short trunk.
  const crown = (r: number, x: number, y: number, z: number) => at(new THREE.IcosahedronGeometry(r, 1), x, y, z);
  const tree = parts(
    crown(0.95, 0, 1.9, 0), crown(0.7, 0.55, 1.6, 0.25), crown(0.65, -0.5, 1.55, -0.2), crown(0.6, 0.1, 2.5, 0.1),
    at(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6), 0, 0.6, 0),
  );
  // The crown clumps are part 0 to 3 and the trunk part 4: as crown (0) and trunk (1).
  const tp = tree.getAttribute("part") as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) > 3.5 ? 1 : 0);
  const nT = { x: Math.round(WIN.w / TREE.s), z: Math.round(WIN.d / TREE.s) };
  put(lattice(tree, nT.x, nT.z), material(TREE_VERT, FLAT_FRAG, shared));

  const prop = (geo: THREE.BufferGeometry, count: number, place: string, side: THREE.Side = THREE.FrontSide) =>
    put(slots(geo, count), material(PROP_VERT(place), FLAT_FRAG, shared, {}, side));

  prop(parts(at(new THREE.BoxGeometry(0.12, 1.0, 0.12), 0, 0.5, 0), at(new THREE.BoxGeometry(0.32, 0.34, 0.32), 0, 1.15, 0)), 28, LANTERN);

  // A cottage: walls, a gabled roof, a door.
  const roof = new THREE.CylinderGeometry(1.25, 1.25, 2.9, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
  roof.scale(1, 0.75, 1.05);
  prop(parts(at(new THREE.BoxGeometry(2.6, 1.6, 1.9), 0, 0.8, 0), at(roof, 0, 1.95, 0), at(new THREE.BoxGeometry(0.45, 0.8, 0.05), 0.5, 0.4, 0.97)), 6, COTTAGE, THREE.DoubleSide);

  prop(parts(at(new THREE.CylinderGeometry(0.62, 0.9, 7, 14), 0, 3.5, 0), at(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 10), 0, 7.4, 0)), 2, LIGHTHOUSE);

  const hull = new THREE.CylinderGeometry(0.55, 0.3, 2.6, 8, 1).rotateZ(Math.PI / 2).scale(1, 0.55, 0.9);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.3, 0, 0, 2.6, 0, 1.1, 0.35, 0], 3));
  prop(parts(at(hull, 0, 0.2, 0), at(sail, -0.3, 0, 0)), 7, BOAT, THREE.DoubleSide);

  const gull = new THREE.BufferGeometry();
  gull.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.18, -0.9, 0.25, 0, 0, 0, -0.18, 0, 0, 0.18, 0.9, 0.25, 0, 0, 0, -0.18], 3));
  prop(parts(gull), 10, GULL, THREE.DoubleSide);
}
