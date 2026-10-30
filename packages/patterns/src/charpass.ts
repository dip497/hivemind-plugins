/**
 * A picture turned into characters, the way a good ASCII shader does it. Each cell takes its colour
 * from the picture there, and its glyph from the picture's tone on a ramp ordered by the face's own
 * coverage; where the picture has an edge (a Sobel on its tone), a glyph that runs along it
 * (`| _ / \`), so outlines are drawn in lines rather than filled. A pattern may set a cell's glyph
 * and colour itself (Life's live cells), in `force`. Between the glyphs the picture itself shows,
 * dimmed, so there is no grid and no bare ground; bright cells bloom.
 *
 * Passes: the picture at cell resolution → each cell's glyph and colour → their bloom (blurred) →
 * the screen, where each pixel samples its cell's glyph from the atlas.
 */
import { glyphAtlas, rampOf, type Atlas } from "./atlas";
import { BLUR, bindTex, blur, dropTarget, pass, program, target, type GL, type Program, type Target } from "./gl";

/** How a pattern's picture is turned into characters. */
export interface CharLook {
  /** The theme is light: glyphs are ink on the picture, the darker the inkier. */
  ink: boolean;
  /** How much of the picture shows between the glyphs (0 … 1). */
  ground: number;
  /** A glyph's colour: the picture's there, times this (dark) or darkened by it (light). */
  gain: number;
  /** The tone (0 … 1, brightness on dark, darkness on paper) that reaches the ramp's densest glyph. */
  full: number;
  /** How strong a tone step must be for an edge glyph; 0 for none. */
  edge: number;
  /** How much bright cells bloom, and the tone they start blooming at. */
  bloom: number;
  bloomFrom: number;
  /** The paper (light) or the dark a glyph-less cell sits on, rgb 0 … 1. */
  base: [number, number, number];
}

/** Candidates for the tone ramp, faint to dense; the face orders them. */
const RAMP = [" ", ".", "`", "'", ",", ":", ";", "-", "~", "=", "+", "*", "x", "o", "%", "#", "&", "@"];
const STEPS = 10;
/** Edge glyphs: a vertical edge, a horizontal one, and the two diagonals. */
const EDGES = ["|", "_", "/", "\\"];

const PICK = `
uniform sampler2D uPic;
uniform sampler2D uForce;
uniform int uHasForce;
uniform float uRamp[${STEPS}];
uniform float uEdgeSlots[4];
uniform float uEdge;
uniform float uGain;
uniform float uFull;
uniform int uInk;
uniform vec3 uBase;
uniform ivec2 uGrid;
float tone(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float b = dot(uBase, vec3(0.2126, 0.7152, 0.0722));
  return uInk == 1 ? max(0.0, b - l) / max(0.05, b) : l;
}
float at(ivec2 p) { return tone(texelFetch(uPic, clamp(p, ivec2(0), uGrid - 1), 0).rgb); }
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  if (uHasForce == 1) {
    vec4 f = texelFetch(uForce, cell, 0);
    if (f.a > 0.0) { outColor = f; return; }
  }
  vec3 c = texelFetch(uPic, cell, 0).rgb;
  float t = at(cell);
  float gx = at(cell + ivec2(1, -1)) + 2.0 * at(cell + ivec2(1, 0)) + at(cell + ivec2(1, 1))
           - at(cell + ivec2(-1, -1)) - 2.0 * at(cell + ivec2(-1, 0)) - at(cell + ivec2(-1, 1));
  float gy = at(cell + ivec2(-1, 1)) + 2.0 * at(cell + ivec2(0, 1)) + at(cell + ivec2(1, 1))
           - at(cell + ivec2(-1, -1)) - 2.0 * at(cell + ivec2(0, -1)) - at(cell + ivec2(1, -1));
  int k = int(clamp(t / uFull, 0.0, 0.999) * float(${STEPS}));
  float slot = uRamp[k];
  if (uEdge > 0.0 && length(vec2(gx, gy)) > uEdge) {
    float ax = abs(gx), ay = abs(gy);
    // Rows run down: a step brighter to the right and below runs along "/".
    slot = ax > ay * 2.0 ? uEdgeSlots[0] : ay > ax * 2.0 ? uEdgeSlots[1] : (gx * gy > 0.0 ? uEdgeSlots[2] : uEdgeSlots[3]);
  }
  vec3 col = uInk == 1 ? c * (1.0 - uGain) : min(vec3(1.0), c * uGain);
  outColor = vec4(col, slot / 255.0);
}`;

const GLOW = `
uniform sampler2D uCells;
uniform float uCoverage[64];
uniform float uFrom;
uniform int uInk;
void main() {
  vec4 c = texelFetch(uCells, ivec2(gl_FragCoord.xy), 0);
  int slot = int(c.a * 255.0 + 0.5);
  float cov = slot > 0 ? uCoverage[min(slot, 63)] : 0.0;
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float amount = uInk == 1 ? smoothstep(uFrom, 1.0, 1.0 - l) : smoothstep(uFrom, 1.0, l);
  outColor = vec4((uInk == 1 ? vec3(1.0) - c.rgb : c.rgb) * amount * (0.4 + cov), 1.0);
}`;

const SCREEN = `
uniform sampler2D uCells;
uniform sampler2D uPicture;
uniform sampler2D uBloom;
uniform sampler2D uAtlas;
uniform vec2 uView;
uniform vec2 uCell;
uniform float uSlotU, uPadU, uCellU;
uniform float uGround, uBloomK;
uniform int uInk;
uniform vec3 uBase;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 uv = px / uView;
  vec2 cf = px / uCell;
  vec2 inCell = fract(cf);
  vec4 c = texelFetch(uCells, ivec2(floor(cf)), 0);
  float slot = floor(c.a * 255.0 + 0.5);
  float cov = slot > 0.5 ? texture(uAtlas, vec2((slot - 1.0) * uSlotU + uPadU + inCell.x * uCellU, inCell.y)).r : 0.0;
  vec3 pic = texture(uPicture, uv).rgb;
  vec3 glow = texture(uBloom, uv).rgb;
  vec3 col;
  if (uInk == 1) {
    vec3 under = mix(uBase, pic, uGround);
    col = mix(under, c.rgb, cov) * (vec3(1.0) - glow * uBloomK);
  } else {
    col = mix(uBase, pic, uGround) + c.rgb * cov + glow * uBloomK;
  }
  outColor = vec4(col, 1.0);
}`;

export class CharPass {
  private pick: Program;
  private glow: Program;
  private screen: Program;
  private blurP: Program;
  private atlas: Atlas | null = null;
  private cells: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;
  private bloomC: Target | null = null;
  private ramp: number[] = [];
  private edges: number[] = [];
  private coverage = new Float32Array(64);
  cols = 0;
  rows = 0;

  /** `extra`: characters a pattern sets itself (in `force`), to be in the atlas too. */
  constructor(private gl: GL, private extra: readonly string[] = []) {
    this.pick = program(gl, PICK);
    this.glow = program(gl, GLOW);
    this.screen = program(gl, SCREEN);
    this.blurP = program(gl, BLUR);
  }

  /** A cell's glyph slot in the atlas (0 for none). */
  slot(ch: string) {
    return this.atlas?.slot.get(ch) ?? 0;
  }

  /** The grid (`cols` by `rows` cells of `cw` by `ch` device pixels) and the face to draw in. */
  layout(cols: number, rows: number, cw: number, ch: number, font: string) {
    const gl = this.gl;
    this.atlas = glyphAtlas(gl, [...RAMP, ...EDGES, ...this.extra], Math.max(4, Math.round(cw)), Math.max(6, Math.round(ch)), font, this.atlas ?? undefined);
    this.ramp = rampOf(this.atlas, RAMP, STEPS).map((g) => this.atlas!.slot.get(g)!);
    this.ramp[0] = 0;
    this.edges = EDGES.map((g) => this.atlas!.slot.get(g)!);
    this.coverage.fill(0);
    for (const [g, k] of this.atlas.slot) if (k < 64) this.coverage[k] = this.atlas.coverage.get(g)!;
    if (cols !== this.cols || rows !== this.rows || !this.cells) {
      for (const t of [this.cells, this.bloomA, this.bloomB, this.bloomC]) dropTarget(gl, t);
      this.cols = cols;
      this.rows = rows;
      this.cells = target(gl, cols, rows, false);
      this.bloomA = target(gl, cols, rows);
      this.bloomB = target(gl, cols, rows);
      this.bloomC = target(gl, cols, rows);
    }
  }

  /** Draw `picture` (rows top first, at cell resolution) in characters over the screen of `w` by `h`
   *  device pixels in cells of `cw` by `ch`; `force` (cell resolution, rgb and a glyph slot / 255 in
   *  alpha, 0 for none) sets cells' glyphs and colours where a pattern wants them. */
  draw(picture: WebGLTexture, force: WebGLTexture | null, look: CharLook, w: number, h: number, cw: number, ch: number) {
    const gl = this.gl;
    if (!this.atlas || !this.cells) return;
    pass(gl, this.pick, this.cells, (p) => {
      bindTex(gl, p, "uPic", picture, 0);
      if (force) bindTex(gl, p, "uForce", force, 1);
      gl.uniform1i(p.at("uHasForce"), force ? 1 : 0);
      gl.uniform1fv(p.at("uRamp"), this.ramp);
      gl.uniform1fv(p.at("uEdgeSlots"), this.edges);
      gl.uniform1f(p.at("uEdge"), look.edge);
      gl.uniform1f(p.at("uGain"), look.gain);
      gl.uniform1f(p.at("uFull"), look.full);
      gl.uniform1i(p.at("uInk"), look.ink ? 1 : 0);
      gl.uniform3fv(p.at("uBase"), look.base);
      gl.uniform2i(p.at("uGrid"), this.cols, this.rows);
    });
    pass(gl, this.glow, this.bloomA!, (p) => {
      bindTex(gl, p, "uCells", this.cells!.tex, 0);
      gl.uniform1fv(p.at("uCoverage"), this.coverage);
      gl.uniform1f(p.at("uFrom"), look.bloomFrom);
      gl.uniform1i(p.at("uInk"), look.ink ? 1 : 0);
    });
    blur(gl, this.blurP, this.bloomA!.tex, this.bloomB!, this.bloomC!, 2.2);
    pass(gl, this.screen, { w, h }, (p) => {
      bindTex(gl, p, "uCells", this.cells!.tex, 0);
      bindTex(gl, p, "uPicture", picture, 1);
      bindTex(gl, p, "uBloom", this.bloomC!.tex, 2);
      bindTex(gl, p, "uAtlas", this.atlas!.tex, 3);
      gl.uniform2f(p.at("uView"), w, h);
      gl.uniform2f(p.at("uCell"), cw, ch);
      gl.uniform1f(p.at("uSlotU"), this.atlas!.slotU);
      gl.uniform1f(p.at("uPadU"), this.atlas!.padU);
      gl.uniform1f(p.at("uCellU"), this.atlas!.cellU);
      gl.uniform1f(p.at("uGround"), look.ground);
      gl.uniform1f(p.at("uBloomK"), look.bloom);
      gl.uniform1i(p.at("uInk"), look.ink ? 1 : 0);
      gl.uniform3fv(p.at("uBase"), look.base);
    });
  }
}
