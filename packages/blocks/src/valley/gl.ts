/**
 * Block Valley in WebGL2, in one context. The land is one mesh built once (only the faces of blocks
 * that face open air, a column's side as one tall face whose blocks the shader draws), in chunks of
 * 16 by 16 columns so those out of sight are not drawn; trees go with the chunk they stand in. The
 * clouds are a mesh per shape, moved by an offset; the birds and the dropped blocks are rebuilt each
 * frame, being few. The shader gives each block its flat colours by material and face (top, toward
 * the light, away from it), lays grass over dirt over stone down a column's side, shows the seams
 * between stacked blocks near the camera, runs streaks down falling water and lays the light's
 * glitter on still water, and tints all of it toward the haze with distance; the sky behind is
 * drawn from the line of sight, with its sun or moon. By night the village's windows and lanterns
 * glow, a soft light round each drawn over the rest.
 *
 * It draws into a picture of a pixel to every CSS pixel, then copies that onto the canvas at its
 * full size: at a pixel ratio of 2 a picture pixel covers four of the screen's.
 */
import { rgbOf } from "../colour";
import { clamp, seededRandom } from "../rng";
import { SPECK_DARK } from "../textures";
import { idx, inLand, Mat, MATS, SIZE, type Land } from "./terrain";
import type { ValleyPalette } from "./palette";
import type { Valley, Vec3 } from "./valley";

/** CSS pixels to a pixel of the picture. */
export const PIXEL = 1;
const CHUNK = 16;
const FLOATS = 4;

const LAND_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in uvec4 a_info;
uniform mat4 u_vp;
uniform vec3 u_offset;
uniform float u_scale;
out vec3 v_pos;
flat out uint v_mat;
flat out uint v_face;
flat out float v_top;
void main() {
  vec3 p = a_pos * u_scale + u_offset;
  v_pos = p;
  v_mat = a_info.x;
  v_face = a_info.y;
  v_top = float(a_info.z) * u_scale + u_offset.y;
  gl_Position = u_vp * vec4(p, 1.0);
}`;

const LAND_FS = `#version 300 es
precision highp float;
in vec3 v_pos;
flat in uint v_mat;
flat in uint v_face;
flat in float v_top;
uniform vec3 u_cols[${MATS * 3}];
uniform vec3 u_eye;
uniform vec3 u_fog;
uniform float u_fogDistance;
uniform float u_time;
uniform vec3 u_light;
uniform vec3 u_glint;
out vec4 o;
float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
void main() {
  uint m = v_mat;
  // Top; the sides toward the light (+x, -z); the sides away.
  int shade = v_face == 0u ? 0 : (v_face == 1u || v_face == 4u) ? 1 : 2;
  float depth = v_top - v_pos.y;
  if (v_face != 0u && v_face != 5u) {
    if (m == ${Mat.Grass}u) { if (depth > 0.22) m = depth > 3.0 ? ${Mat.Stone}u : ${Mat.Dirt}u; }
    else if (m == ${Mat.Snow}u) { if (depth > 1.4) m = ${Mat.Stone}u; }
    else if (m == ${Mat.Sand}u) { if (depth > 1.0) m = depth > 3.0 ? ${Mat.Stone}u : ${Mat.Dirt}u; }
    else if (m == ${Mat.Dirt}u) { if (depth > 3.0) m = ${Mat.Stone}u; }
  }
  vec3 c = u_cols[int(m) * 3 + shade];
  float d = distance(v_pos, u_eye);
  if (m == ${Mat.Water}u) {
    if (v_face == 0u) {
      // The light's glitter on still water, where the line of sight bounces toward it.
      vec3 r = reflect(normalize(v_pos - u_eye), vec3(0.0, 1.0, 0.0));
      float toward = pow(max(dot(r, u_light), 0.0), 90.0);
      float sparkle = hash(vec3(floor(v_pos.xz * 6.0), floor(u_time * 1.5)));
      c = mix(c, u_glint, sparkle > 1.0 - toward * 0.45 ? 0.75 : 0.0);
    } else {
      // Falling water: streaks of foam running down it.
      float lane = hash(vec3(floor((v_pos.x + v_pos.z) * 4.0), 3.0, 7.0));
      float s = fract(v_pos.y * 0.45 + u_time * 1.4 + lane);
      c = mix(c, u_glint, s > 0.62 ? 0.55 : 0.0);
    }
  } else if (v_face != 0u && v_face != 5u && m != ${Mat.Cloud}u && m != ${Mat.Window}u && d < 42.0) {
    // The seams between stacked blocks down a side, near the camera only: far off they would
    // shimmer.
    vec2 uv = v_face < 3u ? v_pos.zy : v_pos.xy;
    vec2 f = fract(uv + 0.0001);
    if (f.y < 0.05 || f.x < 0.035) c *= mix(${1 - SPECK_DARK}, 1.0, smoothstep(26.0, 42.0, d));
  }
  float haze = 1.0 - exp(-pow(d / u_fogDistance, 2.0) * 0.6931);
  if (m == ${Mat.Window}u) haze *= 0.4;
  o = vec4(mix(c, u_fog, haze), 1.0);
}`;

const SKY_VS = `#version 300 es
precision highp float;
out vec2 v_ndc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  v_ndc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform vec3 u_forward;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_tan;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_fog;
uniform vec3 u_sun;
uniform vec3 u_disc;
uniform vec3 u_glow;
uniform float u_glowAlpha;
uniform float u_stars;
out vec4 o;
void main() {
  vec3 d = normalize(u_forward + u_right * v_ndc.x * u_tan.x + u_up * v_ndc.y * u_tan.y);
  float e = d.y;
  // Up from the horizon to the zenith, and below it into the haze, with no edge between.
  vec3 c = mix(u_horizon, u_zenith, pow(clamp(e * 1.6, 0.0, 1.0), 0.7));
  c = mix(c, u_fog, smoothstep(0.03, -0.15, e));
  float a = acos(clamp(dot(d, u_sun), -1.0, 1.0));
  c = mix(c, u_glow, u_glowAlpha * exp(-a * 7.0));
  // The sun: a square disc, as everything here is blocks.
  vec3 sx = normalize(cross(u_sun, vec3(0.0, 1.0, 0.0)));
  vec3 sy = cross(sx, u_sun);
  vec2 q = vec2(dot(d, sx), dot(d, sy));
  if (dot(d, u_sun) > 0.0 && max(abs(q.x), abs(q.y)) < 0.02) {
    c = u_disc;
    // By night it is the moon: darker squares of its seas on it.
    vec2 cell = floor((q + 0.02) / 0.008);
    if (u_stars > 0.5 && fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) > 0.72) c = mix(c, u_glow, 0.35);
  } else if (dot(d, u_sun) > 0.0 && max(abs(q.x), abs(q.y)) < 0.025) c = mix(c, u_disc, 0.35);
  if (u_stars > 0.5 && e > 0.08) {
    vec3 g = floor(d * 260.0);
    float s = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (s > 0.9965) c = mix(c, vec3(0.95, 0.94, 0.9), clamp(e * 2.0, 0.0, 0.85));
  }
  o = vec4(c, 1.0);
}`;

const GLOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
uniform mat4 u_vp;
uniform float u_size;
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  gl_PointSize = clamp(u_size / max(p.w, 0.5), 2.0, 256.0);
}`;

const GLOW_FS = `#version 300 es
precision highp float;
uniform vec3 u_colour;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  o = vec4(u_colour * exp(-r * 3.5) * (1.0 - r) * 0.6, 1.0);
}`;

/** Geometry being built: positions and, for each vertex, its material, face and column top. */
class Mesh {
  private f: number[] = [];
  private info: number[] = [];
  idx: number[] = [];
  get vertices() { return this.f.length / 3; }

  quad(v: number[], mat: number, face: number, top: number) {
    const base = this.vertices;
    this.f.push(...v);
    for (let k = 0; k < 4; k++) this.info.push(mat, face, clamp(Math.round(top), 0, 255), 0);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A box's faces, but those `skip` says are against another block. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number, top = y1, skip: (face: number) => boolean = () => false) {
    if (!skip(0)) this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], mat, 0, top);
    if (!skip(1)) this.quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], mat, 1, top);
    if (!skip(2)) this.quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], mat, 2, top);
    if (!skip(3)) this.quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], mat, 3, top);
    if (!skip(4)) this.quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], mat, 4, top);
    if (!skip(5)) this.quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], mat, 5, top);
  }

  /** The vertices interleaved as the shader reads them: three floats, then four bytes. */
  pack(): ArrayBuffer {
    const n = this.vertices;
    const buf = new ArrayBuffer(n * FLOATS * 4);
    const f32 = new Float32Array(buf);
    const u8 = new Uint8Array(buf);
    for (let v = 0; v < n; v++) {
      f32[v * FLOATS] = this.f[v * 3]!;
      f32[v * FLOATS + 1] = this.f[v * 3 + 1]!;
      f32[v * FLOATS + 2] = this.f[v * 3 + 2]!;
      for (let k = 0; k < 4; k++) u8[v * FLOATS * 4 + 12 + k] = this.info[v * 4 + k]!;
    }
    return buf;
  }
}

interface Drawn { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }
interface Chunk { start: number; count: number; min: Vec3; max: Vec3 }

/** The leaves round a tree's trunk top: a broad crown or a pine's cone, as offsets. */
export function crown(pine: boolean, trunk: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const layers = pine ? [[2, -2], [1, -1], [1, 0], [0, 1]] : [[2, -1], [2, 0], [1, 1], [0, 2]];
  for (const [r, dz] of layers) {
    for (let a = -r!; a <= r!; a++) for (let b = -r!; b <= r!; b++) {
      if (r! >= 2 && Math.abs(a) === r && Math.abs(b) === r) continue;
      out.push([a, trunk + dz!, b]);
    }
  }
  return out;
}

/** The cells of a cloud shape, from `seed`: flat underneath, heaped toward the middle. */
export function cloudCells(seed: number, small = false): [number, number, number][] {
  const rnd = seededRandom(700 + seed);
  const w = small ? 4 : 7 + Math.floor(rnd() * 6);
  const d = small ? 3 : 4 + Math.floor(rnd() * 4);
  const out: [number, number, number][] = [];
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < w; i++) {
      const r = ((i + 0.5 - w / 2) / (w / 2)) ** 2 + ((j + 0.5 - d / 2) / (d / 2)) ** 2;
      if (r > 1.05 + rnd() * 0.3) continue;
      out.push([i - w / 2, 0, j - d / 2]);
      if (r < 0.45 + rnd() * 0.2) out.push([i - w / 2, 1, j - d / 2]);
    }
  }
  return out;
}

export class ValleyGL {
  readonly gl: WebGL2RenderingContext;
  lost = false;
  private land: { drawn: Drawn; chunks: Chunk[] } | null = null;
  private glows: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number } | null = null;
  private glowProg: WebGLProgram;
  private g: Record<string, WebGLUniformLocation | null> = {};
  private clouds: { drawn: Drawn; shapes: { start: number; count: number }[] } | null = null;
  private dyn: Drawn;
  private landProg: WebGLProgram;
  private skyProg: WebGLProgram;
  private skyVao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private s: Record<string, WebGLUniformLocation | null> = {};
  private fbo: WebGLFramebuffer;
  private colour: WebGLRenderbuffer;
  private depth: WebGLRenderbuffer;
  private size = { w: 0, h: 0, W: 0, H: 0 };
  private palette: ValleyPalette | null = null;
  private cols = new Float32Array(MATS * 9);

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, onLost: () => void) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      onLost();
    });
    this.landProg = program(gl, LAND_VS, LAND_FS);
    this.skyProg = program(gl, SKY_VS, SKY_FS);
    this.glowProg = program(gl, GLOW_VS, GLOW_FS);
    for (const n of ["u_vp", "u_offset", "u_scale", "u_cols", "u_eye", "u_fog", "u_fogDistance", "u_time", "u_light", "u_glint"]) this.u[n] = gl.getUniformLocation(this.landProg, n);
    for (const n of ["u_vp", "u_size", "u_colour"]) this.g[n] = gl.getUniformLocation(this.glowProg, n);
    for (const n of ["u_forward", "u_right", "u_up", "u_tan", "u_zenith", "u_horizon", "u_fog", "u_sun", "u_disc", "u_glow", "u_glowAlpha", "u_stars"]) this.s[n] = gl.getUniformLocation(this.skyProg, n);
    this.skyVao = gl.createVertexArray()!;
    this.dyn = this.drawn(new ArrayBuffer(0), new Uint32Array(0), gl.DYNAMIC_DRAW);
    this.fbo = gl.createFramebuffer()!;
    this.colour = gl.createRenderbuffer()!;
    this.depth = gl.createRenderbuffer()!;
  }

  private drawn(data: ArrayBuffer, index: Uint32Array, usage: number): Drawn {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_BYTE, FLOATS * 4, 12);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, usage);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: index.length };
  }

  /** The land's mesh, chunk by chunk: each column's top, its sides down to its lower neighbours,
   *  the water's surface, and the trees. */
  build(land: Land) {
    const mesh = new Mesh();
    const glows: number[] = [];
    const chunks: Chunk[] = [];
    const H = (i: number, j: number) => (inLand(i, j) ? land.height[idx(i, j)]! : -1);
    const byChunk = new Map<number, Land["trees"]>();
    for (const t of land.trees) {
      const k = Math.floor(t.j / CHUNK) * 64 + Math.floor(t.i / CHUNK);
      byChunk.set(k, [...(byChunk.get(k) ?? []), t]);
    }
    for (let cj = 0; cj < SIZE / CHUNK; cj++) {
      for (let ci = 0; ci < SIZE / CHUNK; ci++) {
        const start = mesh.idx.length;
        let lo = Infinity;
        let hi = 0;
        for (let j = cj * CHUNK; j < (cj + 1) * CHUNK; j++) {
          for (let i = ci * CHUNK; i < (ci + 1) * CHUNK; i++) {
            const h = H(i, j);
            const ground = land.top[idx(i, j)]!;
            lo = Math.min(lo, h);
            hi = Math.max(hi, h + 8);
            mesh.quad([i, h, j + 1, i + 1, h, j + 1, i + 1, h, j, i, h, j], ground, 0, h);
            const wl = land.water[idx(i, j)]!;
            if (wl) mesh.quad([i, wl - 0.12, j + 1, i + 1, wl - 0.12, j + 1, i + 1, wl - 0.12, j, i, wl - 0.12, j], Mat.Water, 0, wl);
            // Each side down to the neighbour there, if it is lower; none at the land's edge. Water
            // falls from a column to a lower neighbour's water (the waterfall) as a face of its own.
            const sides: [number, number, number, number[]][] = [
              [1, 0, 1, [i + 1, 0, j + 1, i + 1, 0, j, i + 1, 1, j, i + 1, 1, j + 1]],
              [-1, 0, 2, [i, 0, j, i, 0, j + 1, i, 1, j + 1, i, 1, j]],
              [0, 1, 3, [i, 0, j + 1, i + 1, 0, j + 1, i + 1, 1, j + 1, i, 1, j + 1]],
              [0, -1, 4, [i + 1, 0, j, i, 0, j, i, 1, j, i + 1, 1, j]],
            ];
            const span = (v: number[], bottom: number, top: number) => {
              const q = v.slice();
              for (let k = 1; k < 12; k += 3) q[k] = q[k] === 0 ? bottom : top;
              return q;
            };
            for (const [a, b, face, v] of sides) {
              const n = H(i + a, j + b);
              if (n < 0) continue;
              if (n < h) mesh.quad(span(v, n, h), ground, face, h);
              const nw = land.water[idx(i + a, j + b)]!;
              if (wl && nw < wl) {
                const bottom = Math.max(n, nw ? nw - 0.12 : 0, h);
                if (bottom < wl - 0.12) mesh.quad(span(v, bottom, wl - 0.12), Mat.Water, face, wl);
              }
            }
          }
        }
        // The trees standing in this chunk: trunk, then crown, only the faces open to the air.
        for (const t of byChunk.get(cj * 64 + ci) ?? []) {
          const h = H(t.i, t.j);
          const cells = crown(t.pine, t.trunk);
          const filled = new Set(cells.map(([a, y, b]) => `${a},${y},${b}`));
          for (let y = 0; y < t.trunk; y++) filled.add(`0,${y},0`);
          const open = (a: number, y: number, b: number) => (face: number) => {
            const [da, dy, db] = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]][face]!;
            return filled.has(`${a + da!},${y + dy!},${b + db!}`);
          };
          for (let y = 0; y < t.trunk; y++) mesh.box(t.i + 0.25, h + y, t.j + 0.25, t.i + 0.75, h + y + 1, t.j + 0.75, Mat.Wood, h + y + 1, (f) => f === 5 || (f === 0 && filled.has(`0,${y + 1},0`)));
          for (const [a, y, b] of cells) mesh.box(t.i + a, h + y, t.j + b, t.i + a + 1, h + y + 1, t.j + b + 1, t.pine ? Mat.Pine : Mat.Leaves, h + y + 1, open(a, y, b));
          hi = Math.max(hi, h + t.trunk + 3);
        }
        // The bushes in this chunk: a mound of leaves and a smaller one on it.
        for (const b of land.bushes) {
          if (Math.floor(b.i / CHUNK) !== ci || Math.floor(b.j / CHUNK) !== cj) continue;
          const y = H(b.i, b.j);
          mesh.box(b.i + 0.05, y, b.j + 0.05, b.i + 0.95, y + 0.7, b.j + 0.95, Mat.Leaves);
          mesh.box(b.i + 0.3, y + 0.7, b.j + 0.25, b.i + 0.8, y + 1.05, b.j + 0.75, Mat.Leaves);
        }
        // The fields in this chunk: rows of crops on the tilled ground, a fence round them.
        for (const f of land.fields) {
          if (Math.floor(f.i / CHUNK) !== ci || Math.floor(f.j / CHUNK) !== cj) continue;
          field(mesh, f);
          hi = Math.max(hi, f.floor + 2);
        }
        // The village's houses and lanterns standing in this chunk.
        for (const o of land.houses) {
          if (Math.floor(o.i / CHUNK) !== ci || Math.floor(o.j / CHUNK) !== cj) continue;
          house(mesh, o, glows);
          hi = Math.max(hi, o.floor + 4);
        }
        for (const l of land.lanterns) {
          if (Math.floor(l.i / CHUNK) !== ci || Math.floor(l.j / CHUNK) !== cj) continue;
          const [x, z, y] = [l.i + 0.5, l.j + 0.5, l.y];
          mesh.box(x - 0.06, y, z - 0.06, x + 0.06, y + 1.3, z + 0.06, Mat.Wood);
          mesh.box(x - 0.15, y + 1.3, z - 0.15, x + 0.15, y + 1.6, z + 0.15, Mat.Window);
          mesh.box(x - 0.18, y + 1.6, z - 0.18, x + 0.18, y + 1.68, z + 0.18, Mat.Wood);
          glows.push(x, y + 1.45, z);
        }
        chunks.push({ start, count: mesh.idx.length - start, min: [ci * CHUNK - 3, lo - 1, cj * CHUNK - 3], max: [(ci + 1) * CHUNK + 3, hi + 1, (cj + 1) * CHUNK + 3] });
      }
    }
    if (this.land) this.free(this.land.drawn);
    this.land = { drawn: this.drawn(mesh.pack(), new Uint32Array(mesh.idx), this.gl.STATIC_DRAW), chunks };
    // The lights' places, for their glow.
    const gl = this.gl;
    if (this.glows) gl.deleteBuffer(this.glows.vbo);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(glows), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.glows = { vao, vbo, count: glows.length / 3 };
    // The clouds: four shapes and a small puff, each about its middle.
    const clouds = new Mesh();
    const shapes: { start: number; count: number }[] = [];
    for (let s = 0; s < 5; s++) {
      const start = clouds.idx.length;
      const cells = cloudCells(s, s === 4);
      const filled = new Set(cells.map(([a, y, b]) => `${a},${y},${b}`));
      for (const [a, y, b] of cells) {
        clouds.box(a, y, b, a + 1, y + 1, b + 1, Mat.Cloud, 0, (face) => {
          const [da, dy, db] = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]][face]!;
          return filled.has(`${a + da!},${y + dy!},${b + db!}`);
        });
      }
      shapes.push({ start, count: clouds.idx.length - start });
    }
    if (this.clouds) this.free(this.clouds.drawn);
    this.clouds = { drawn: this.drawn(clouds.pack(), new Uint32Array(clouds.idx), this.gl.STATIC_DRAW), shapes };
  }

  private free(d: Drawn) {
    const gl = this.gl;
    gl.deleteBuffer(d.vbo);
    gl.deleteBuffer(d.ibo);
    gl.deleteVertexArray(d.vao);
  }

  setPalette(p: ValleyPalette) {
    this.palette = p;
    p.mats.forEach((s, m) => {
      [s.top, s.left, s.right].forEach((c, k) => {
        const rgb = rgbOf(c);
        this.cols.set([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255], (m * 3 + k) * 3);
      });
    });
  }

  /** The canvas is W by H device pixels, for a window of w by h CSS pixels: the picture drawn is a
   *  pixel to every PIXEL CSS pixels. */
  resize(W: number, H: number, w: number, h: number) {
    const gl = this.gl;
    this.canvas.width = W;
    this.canvas.height = H;
    const fw = Math.max(1, Math.round(w / PIXEL));
    const fh = Math.max(1, Math.round(h / PIXEL));
    this.size = { w: fw, h: fh, W, H };
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.colour);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, fw, fh);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, fw, fh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colour);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(v: Valley) {
    const gl = this.gl;
    const p = this.palette;
    if (this.lost || !p || !this.land || !this.clouds || gl.isContextLost()) return;
    const cam = v.camera;
    const vp = multiply(perspective(cam.fovY, cam.aspect, 0.3, 320), view(cam.eye, cam.forward, cam.up, cam.right));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size.w, this.size.h);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    // The sky first, from the line of sight through each pixel.
    gl.useProgram(this.skyProg);
    const t = Math.tan(cam.fovY / 2);
    const s = this.s;
    gl.uniform3fv(s.u_forward!, cam.forward);
    gl.uniform3fv(s.u_right!, cam.right);
    gl.uniform3fv(s.u_up!, cam.up);
    gl.uniform2f(s.u_tan!, t * cam.aspect, t);
    gl.uniform3fv(s.u_zenith!, unit(p.zenith));
    gl.uniform3fv(s.u_horizon!, unit(p.horizon));
    gl.uniform3fv(s.u_fog!, unit(p.fog));
    const sun = normalize(p.sun.dir);
    gl.uniform3fv(s.u_sun!, sun);
    gl.uniform3fv(s.u_disc!, unit(p.sun.disc));
    gl.uniform3fv(s.u_glow!, unit(p.sun.glow));
    gl.uniform1f(s.u_glowAlpha!, p.sun.alpha);
    gl.uniform1f(s.u_stars!, p.stars ? 1 : 0);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Then the land, the clouds and what moves.
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.landProg);
    const u = this.u;
    gl.uniformMatrix4fv(u.u_vp!, false, vp);
    gl.uniform3fv(u.u_cols!, this.cols);
    gl.uniform3fv(u.u_eye!, cam.eye);
    gl.uniform3fv(u.u_fog!, unit(p.fog));
    gl.uniform1f(u.u_fogDistance!, p.fogDistance);
    gl.uniform1f(u.u_time!, v.time);
    gl.uniform3fv(u.u_light!, sun);
    gl.uniform3fv(u.u_glint!, unit(p.glint));
    gl.uniform3f(u.u_offset!, 0, 0, 0);
    gl.uniform1f(u.u_scale!, 1);
    const planes = frustum(vp);
    gl.bindVertexArray(this.land.drawn.vao);
    for (const c of this.land.chunks) if (c.count && boxVisible(planes, c.min, c.max)) gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, c.start * 4);
    gl.bindVertexArray(this.clouds.drawn.vao);
    for (const c of v.clouds) {
      const shape = this.clouds.shapes[c.puff >= 0 ? 4 : c.shape % 4]!;
      const scale = c.puff >= 0 ? clamp(c.puff / 0.5, 0, 1) * clamp((9 - c.puff) / 1.5, 0, 1) : 1;
      if (scale <= 0.01) continue;
      gl.uniform3f(u.u_offset!, c.x, c.y, c.z);
      gl.uniform1f(u.u_scale!, scale);
      gl.drawElements(gl.TRIANGLES, shape.count, gl.UNSIGNED_INT, shape.start * 4);
    }
    gl.uniform3f(u.u_offset!, 0, 0, 0);
    gl.uniform1f(u.u_scale!, 1);
    this.drawMoving(v);
    gl.disable(gl.CULL_FACE);
    // By night, a soft light round each lit window and lantern, laid over what is in front of it.
    if (p.lights && this.glows?.count) {
      gl.useProgram(this.glowProg);
      gl.uniformMatrix4fv(this.g.u_vp!, false, vp);
      gl.uniform1f(this.g.u_size!, (this.size.h / 2 / t) * 2.6);
      gl.uniform3fv(this.g.u_colour!, unit(p.lights));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.bindVertexArray(this.glows.vao);
      gl.drawArrays(gl.POINTS, 0, this.glows.count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    // Onto the canvas, at its full size, pixel for pixel.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.size.w, this.size.h, 0, 0, this.size.W, this.size.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The birds and the dropped blocks, built afresh: there are few of them. */
  private drawMoving(v: Valley) {
    const gl = this.gl;
    const mesh = new Mesh();
    for (const b of v.birds) {
      const at = v.birdAt(b);
      const cx = Math.cos(at.heading);
      const cz = Math.sin(at.heading);
      const px = -cz;
      const pz = cx;
      const piece = (along: number, across: number, up: number, len: number, wide: number, tall: number) => {
        const x = at.x + cx * along + px * across;
        const z = at.z + cz * along + pz * across;
        const y = at.y + up;
        const hx = Math.abs(cx) * len + Math.abs(px) * wide;
        const hz = Math.abs(cz) * len + Math.abs(pz) * wide;
        mesh.box(x - hx, y - tall, z - hz, x + hx, y + tall, z + hz, Mat.Bird);
      };
      // A small V: each wing two thin pieces, rising toward its tip and beating a little.
      for (const side of [-1, 1]) {
        piece(-0.04, side * 0.16, 0.05 + at.wing * 0.03, 0.05, 0.16, 0.025);
        piece(-0.1, side * 0.44, 0.15 + at.wing * 0.1, 0.04, 0.14, 0.022);
      }
    }
    for (const d of v.drops) mesh.box(d.i, d.y, d.j, d.i + 1, d.y + 1, d.j + 1, d.mat, d.y + 1);
    if (!mesh.idx.length) return;
    gl.bindVertexArray(this.dyn.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pack(), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dyn.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.idx), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_INT, 0);
  }
}

/** A field: crops in rows on the soil, a fence of posts and two rails round it, a gap for a gate. */
function field(mesh: Mesh, f: Land["fields"][number]) {
  const { i, j, w, d, floor: y } = f;
  if (f.rowsAlongX) for (let b = 0; b < d; b += 2) mesh.box(i + 0.15, y, j + b + 0.2, i + w - 0.15, y + 0.45, j + b + 0.8, Mat.Crop);
  else for (let a = 0; a < w; a += 2) mesh.box(i + a + 0.2, y, j + 0.15, i + a + 0.8, y + 0.45, j + d - 0.15, Mat.Crop);
  const x0 = i - 0.3;
  const x1 = i + w + 0.3;
  const z0 = j - 0.3;
  const z1 = j + d + 0.3;
  const post = (x: number, z: number) => mesh.box(x - 0.06, y, z - 0.06, x + 0.06, y + 0.75, z + 0.06, Mat.Wood);
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    for (const h of [0.32, 0.6]) mesh.box(Math.min(ax, bx) - 0.03, y + h, Math.min(az, bz) - 0.03, Math.max(ax, bx) + 0.03, y + h + 0.06, Math.max(az, bz) + 0.03, Mat.Wood);
  };
  for (const x of [x0, i + w / 2, x1]) { post(x, z0); post(x, z1); }
  for (const z of [z0, j + d / 2, z1]) { post(x0, z); post(x1, z); }
  rail(x0, z0, x1, z0);
  rail(x0, z1, i + w / 2 - 0.6, z1);
  rail(i + w / 2 + 0.6, z1, x1, z1);
  rail(x0, z0, x0, z1);
  rail(x1, z0, x1, z1);
}

/** A house of the village: plank walls two blocks high with a lit window in each, a roof of
 *  three steps overhanging the walls, a chimney; its windows' glows added to `glows`. */
function house(mesh: Mesh, o: Land["houses"][number], glows: number[]) {
  const { i, j, w, d, floor: y } = o;
  mesh.box(i, y, j, i + w, y + 2, j + d, Mat.Plank);
  const mx = i + w / 2;
  const mz = j + d / 2;
  for (const [x0, z0, x1, z1, gx, gz] of [
    [i + w, mz - 0.3, i + w + 0.06, mz + 0.3, i + w + 0.3, mz],
    [i - 0.06, mz - 0.3, i, mz + 0.3, i - 0.3, mz],
    [mx - 0.3, j + d, mx + 0.3, j + d + 0.06, mx, j + d + 0.3],
    [mx - 0.3, j - 0.06, mx + 0.3, j, mx, j - 0.3],
  ] as const) {
    mesh.box(x0, y + 0.7, z0, x1, y + 1.35, z1, Mat.Window);
    glows.push(gx, y + 1.02, gz);
  }
  mesh.box(i - 0.4, y + 2, j - 0.4, i + w + 0.4, y + 2.45, j + d + 0.4, Mat.Roof);
  mesh.box(i + 0.3, y + 2.45, j + 0.3, i + w - 0.3, y + 2.9, j + d - 0.3, Mat.Roof);
  mesh.box(i + 0.95, y + 2.9, j + 0.95, i + w - 0.95, y + 3.3, j + d - 0.95, Mat.Roof);
  mesh.box(i + w - 0.9, y + 2.4, j + 0.4, i + w - 0.4, y + 3.7, j + 0.9, Mat.Stone);
}

// ── helpers ───────────────────────────────────────────────────────────────

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

const unit = (c: readonly [number, number, number]) => {
  const rgb = rgbOf(c);
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
};
const normalize = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

function perspective(fovY: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function view(eye: Vec3, f: Vec3, u: Vec3, r: Vec3) {
  const m = new Float32Array(16);
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  m[15] = 1;
  return m;
}

function multiply(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    out[c * 4 + r] = s;
  }
  return out;
}

/** The six planes of what the camera sees, from its view and projection. */
function frustum(m: Float32Array): number[][] {
  const row = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!];
  const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
  const add = (a: number[], b: number[], s: number) => a.map((v, k) => v + s * b[k]!);
  return [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), add(r3, r2, 1), add(r3, r2, -1)];
}

function boxVisible(planes: number[][], min: Vec3, max: Vec3) {
  for (const [a, b, c, d] of planes) {
    const x = a! > 0 ? max[0] : min[0];
    const y = b! > 0 ? max[1] : min[1];
    const z = c! > 0 ? max[2] : min[2];
    if (a! * x + b! * y + c! * z + d! < 0) return false;
  }
  return true;
}
