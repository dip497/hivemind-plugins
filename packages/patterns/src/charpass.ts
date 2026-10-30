/**
 * Characters over a light: each cell's glyph and colour, as a pattern sets them (Life's live cells),
 * drawn sharp from an atlas of the bundled face, over a picture of light that shows between them,
 * sampled smoothly so a glow falls off round and never steps from cell to cell. A cell the pattern
 * leaves empty has no character at all, so large areas stay the clean picture. Bright glyphs bloom,
 * and their bloom falls off round too.
 *
 * Passes: each cell's bloom from its glyph and colour (blurred) → the screen, where each pixel
 * samples its cell's glyph from the atlas over the picture.
 */
import { glyphAtlas, type Atlas } from "./atlas";
import { BLUR, bindTex, blur, dropTarget, pass, program, target, type GL, type Program, type Target } from "./gl";

/** How the characters are drawn over the picture. */
export interface CharLook {
  /** The theme is light: glyphs are ink on the picture, and their bloom a darkening. */
  ink: boolean;
  /** How much bright glyphs bloom, and the tone (brightness on dark, darkness on paper) they start
   *  blooming at. */
  bloom: number;
  bloomFrom: number;
}

/** Each cell's bloom: what its glyph gives off, by its colour and how much of the cell it covers. */
const GLOW = `
uniform sampler2D uCells;
uniform float uCoverage[64];
uniform float uFrom;
uniform int uInk;
void main() {
  vec4 c = texelFetch(uCells, ivec2(gl_FragCoord.xy), 0);
  int slot = int(c.a * 255.0 + 0.5);
  if (slot == 0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float cov = uCoverage[min(slot, 63)];
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
uniform float uBloomK;
uniform int uInk;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 cf = px / uCell;
  ivec2 cell = ivec2(floor(cf));
  vec2 inCell = fract(cf);
  vec4 c = texelFetch(uCells, cell, 0);
  float slot = floor(c.a * 255.0 + 0.5);
  float cov = slot > 0.5 ? texture(uAtlas, vec2((slot - 1.0) * uSlotU + uPadU + inCell.x * uCellU, inCell.y)).r : 0.0;
  // The light under this pixel, and the glyphs' bloom: both smooth, a texel a cell.
  vec2 grid = vec2(textureSize(uCells, 0));
  vec3 pic = texture(uPicture, cf / grid).rgb;
  vec3 glow = texture(uBloom, cf / grid).rgb;
  vec3 col = uInk == 1 ? mix(pic, c.rgb, cov) * (vec3(1.0) - glow * uBloomK) : pic + c.rgb * cov + glow * uBloomK;
  outColor = vec4(col, 1.0);
}`;

export class CharPass {
  private glow: Program;
  private screen: Program;
  private blurP: Program;
  private atlas: Atlas | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;
  private bloomC: Target | null = null;
  private coverage = new Float32Array(64);
  cols = 0;
  rows = 0;

  /** `glyphs`: every character a pattern sets, to be in the atlas. */
  constructor(private gl: GL, private glyphs: readonly string[]) {
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
    this.atlas = glyphAtlas(gl, this.glyphs, Math.max(4, Math.round(cw)), Math.max(6, Math.round(ch)), font, this.atlas ?? undefined);
    this.coverage.fill(0);
    for (const [g, k] of this.atlas.slot) if (k < 64) this.coverage[k] = this.atlas.coverage.get(g)!;
    if (cols !== this.cols || rows !== this.rows || !this.bloomA) {
      for (const t of [this.bloomA, this.bloomB, this.bloomC]) dropTarget(gl, t);
      this.cols = cols;
      this.rows = rows;
      this.bloomA = target(gl, cols, rows);
      this.bloomB = target(gl, cols, rows);
      this.bloomC = target(gl, cols, rows);
    }
  }

  /** Draw `cells` (a texel a cell, rows top first: rgb, and a glyph slot / 255 in alpha, 0 for
   *  none) over `picture` (the same size) on the screen of `w` by `h` device pixels, in cells of
   *  `cw` by `ch`. */
  draw(picture: WebGLTexture, cells: WebGLTexture, look: CharLook, w: number, h: number, cw: number, ch: number) {
    const gl = this.gl;
    if (!this.atlas || !this.bloomA) return;
    pass(gl, this.glow, this.bloomA, (p) => {
      bindTex(gl, p, "uCells", cells, 0);
      gl.uniform1fv(p.at("uCoverage"), this.coverage);
      gl.uniform1f(p.at("uFrom"), look.bloomFrom);
      gl.uniform1i(p.at("uInk"), look.ink ? 1 : 0);
    });
    blur(gl, this.blurP, this.bloomA.tex, this.bloomB!, this.bloomC!, 2.2);
    pass(gl, this.screen, { w, h }, (p) => {
      bindTex(gl, p, "uCells", cells, 0);
      bindTex(gl, p, "uPicture", picture, 1);
      bindTex(gl, p, "uBloom", this.bloomC!.tex, 2);
      bindTex(gl, p, "uAtlas", this.atlas!.tex, 3);
      gl.uniform2f(p.at("uView"), w, h);
      gl.uniform2f(p.at("uCell"), cw, ch);
      gl.uniform1f(p.at("uSlotU"), this.atlas!.slotU);
      gl.uniform1f(p.at("uPadU"), this.atlas!.padU);
      gl.uniform1f(p.at("uCellU"), this.atlas!.cellU);
      gl.uniform1f(p.at("uBloomK"), look.bloom);
      gl.uniform1i(p.at("uInk"), look.ink ? 1 : 0);
    });
  }
}
