/**
 * The coast drawn in characters: the scene is rendered into a texture with what each surface is in
 * its alpha (scene.ts), then a full-screen pass draws each cell of a grid as one coloured character,
 * chosen by what the surface is, how bright it is and which way its edges run, over a dim blurred
 * copy of the scene; a last pass blurs the top and bottom of the window like a photograph of a
 * model, a tilt-shift.
 *
 * In its own colours the characters take the scene's: bright on dim paper on a dark theme, dark ink
 * on pale paper on a light one. In the theme's colours every character is a step from the page to
 * the text, and the paper is the page.
 *
 * The approach (classes in alpha, a glyph per class and brightness, edges by direction, the
 * tilt-shift on a golden-angle disc) follows JDhruv14/ascii-diorama (MIT); see the LICENSE.
 */
import * as THREE from "three";
import { CLS } from "./scene";

const GLYPHS = " .,'`:;-~=+*oO$&%8#@/\\|_^v—";
const GI = Object.fromEntries([...GLYPHS].map((c, i) => [c, i])) as Record<string, number>;
const g = (c: string) => GI[c]!.toFixed(1);
const c = (k: number) => (k + 0.5).toFixed(1);

/** A cell, in CSS pixels. */
export const CELL = { w: 7, h: 13 };

const VERT = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const GLYPH_FRAG = `precision highp float;
uniform sampler2D uScene, uAtlas; uniform vec2 uGrid; uniform float uTime, uN, uDark, uOwn;
uniform vec3 uPage, uText;
in vec2 vUv; out vec4 outColor;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float lum(vec3 c){ return dot(c, vec3(.25, .6, .15)); }
vec3 grade(vec3 c){
  c = max(c, 0.); c = c / (1. + c * .12); c = pow(c, vec3(1./2.2));
  c = mix(c, c*c*(3.-2.*c), .5);
  float l = lum(c); return clamp(mix(vec3(l), c, 1.25), 0., 1.);
}
void main(){
  vec2 gp = vUv * uGrid, cell = floor(gp), cuv = (cell + .5) / uGrid;
  ivec2 sz = textureSize(uScene, 0);
  float lod = log2(float(sz.x) / uGrid.x) + .05;
  vec3 col = grade(textureLod(uScene, cuv, lod).rgb);
  float cls = floor(texelFetch(uScene, ivec2(cuv * vec2(sz)), 0).a * 16. + .5);
  float L = lum(col);
  vec2 e = 1. / uGrid;
  float lx0 = lum(grade(textureLod(uScene, cuv - vec2(e.x, 0), lod).rgb)), lx1 = lum(grade(textureLod(uScene, cuv + vec2(e.x, 0), lod).rgb));
  float ly0 = lum(grade(textureLod(uScene, cuv - vec2(0, e.y), lod).rgb)), ly1 = lum(grade(textureLod(uScene, cuv + vec2(0, e.y), lod).rgb));
  vec2 grad = vec2(lx1 - lx0, (ly1 - ly0) * .55); float mag = length(grad);
  float a4 = mod(atan(grad.y, grad.x) + .3927, 3.14159) / .7854;
  float edge = a4 < 1. ? ${g("|")} : a4 < 2. ? ${g("\\")} : a4 < 3. ? ${g("—")} : ${g("/")};
  // The wind, slow enough that a character holds a while before it turns.
  float w = vn(cell * vec2(.05, .09) + vec2(-uTime * .25, uTime * .06)) * 2. - 1.;
  float n = h21(cell);
  float gl = ${g(" ")};
  if (cls < ${c(CLS.grass)}) {
    gl = L < .1 ? ${g(".")} : L < .17 ? ${g(":")} : n < .06 ? ${g(",")} : (w < -.2 ? ${g("\\")} : w > .2 ? ${g("/")} : ${g("|")});
  } else if (cls < ${c(CLS.flower)}) {
    gl = L < .45 ? ${g("+")} : ${g("*")};
  } else if (cls < ${c(CLS.leaf)}) {
    gl = L < .1 ? ${g(".")} : L < .2 ? ${g(":")} : L < .32 ? ${g("*")} : L < .45 ? ${g("+")} : ${g("o")};
  } else if (cls < ${c(CLS.wood)}) {
    gl = L < .14 ? ${g(":")} : mag > .1 ? edge : ${g("|")};
  } else if (cls < ${c(CLS.sand)}) {
    gl = L < .3 ? ${g(":")} : L < .55 ? ${g(";")} : n < .5 ? ${g(".")} : ${g(",")};
  } else if (cls < ${c(CLS.water)}) {
    // Water: its brightness, broken by the wind and a little per cell, so no row reads as a rule.
    float wl = L + .12 * w + .1 * (n - .5);
    gl = wl < .08 ? ${g(".")} : wl < .15 ? ${g("-")} : wl < .55 ? (n < .8 ? ${g("~")} : ${g("-")}) : ${g("=")};
  } else if (cls < ${c(CLS.foam)}) {
    // Foam: a froth of characters, not a row of one.
    gl = n < .35 ? ${g("*")} : n < .6 ? ${g("%")} : n < .8 ? ${g("o")} : ${g("#")};
  } else if (cls < ${c(CLS.rock)}) {
    gl = L < .14 ? ${g(".")} : L < .26 ? ${g(":")} : L < .38 ? ${g("%")} : ${g("#")};
    if (mag > .12) gl = edge;
  } else if (cls < ${c(CLS.path)}) {
    gl = L < .3 ? ${g(":")} : L < .5 ? ${g("=")} : ${g("—")};
  } else if (cls < ${c(CLS.roof)}) {
    gl = mag > .2 ? edge : L < .3 ? ${g("=")} : ${g("#")};
  } else if (cls < ${c(CLS.wall)}) {
    gl = mag > .22 ? edge : ${g("#")};
  } else if (cls < ${c(CLS.light)}) {
    gl = L < .5 ? ${g("o")} : ${g("*")};
  } else if (cls < ${c(CLS.hull)}) {
    gl = mag > .2 ? edge : ${g("=")};
  } else if (cls < ${c(CLS.sail)}) {
    gl = mag > .2 ? edge : ${g("#")};
  } else {
    gl = ${g("v")};
  }
  vec2 gv = gp - cell, dx = dFdx(gp), dy = dFdy(gp);
  float ink = smoothstep(.12, .78, textureGrad(uAtlas, vec2((gl + gv.x) / uN, 1. - gv.y), dx / uN, dy).r);
  vec3 blur = grade(textureLod(uScene, vUv, lod + 1.2).rgb);
  vec3 o;
  if (uOwn > .5) {
    // Light: pale paper, the scene's colour in it faintly, and the ink the scene's colour, deepened.
    o = uDark > .5 ? mix(blur * .22, col * 1.15 + .01, ink) : mix(mix(blur, vec3(1.), .8), pow(col, vec3(1.6)) * .78, ink);
  } else {
    // The theme's two colours: brightness becomes a step from the page toward the text, and on a
    // light theme the darker the scene, the darker the ink.
    float k = uDark > .5 ? clamp(.1 + L * .8, 0., .85) : clamp(1.15 - L * .95, .2, 1.);
    o = mix(mix(uPage, uText, .05 + .1 * lum(blur)), mix(uPage, uText, k), ink);
  }
  outColor = vec4(o, 1.);
}`;

const TILT_FRAG = `precision highp float;
uniform sampler2D uA; uniform vec2 uRes; uniform float uFocus, uBand, uMax;
in vec2 vUv; out vec4 outColor;
void main(){
  float dy = abs(vUv.y - uFocus);
  float r = pow(smoothstep(uBand, uBand + .32, dy), 1.6) * uMax;
  if (r < .25) { outColor = vec4(texture(uA, vUv).rgb, 1.); return; }
  float lod = max(log2(r / 4.), 0.);
  vec3 s = vec3(0.);
  for (int i = 0; i < 24; i++) {
    float t = float(i) + .5, a = t * 2.39996, rr = sqrt(t / 24.) * r;
    s += textureLod(uA, vUv + vec2(cos(a), sin(a)) * rr / uRes, lod).rgb;
  }
  outColor = vec4(s / 24., 1.);
}`;

const hex = (h: string) => {
  const v = parseInt(h.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return new THREE.Vector3(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

/** The glyph and tilt-shift passes, drawn after the scene. */
export class AsciiPass {
  private readonly scene: THREE.WebGLRenderTarget;
  private readonly art: THREE.WebGLRenderTarget;
  private readonly glyph: THREE.RawShaderMaterial;
  private readonly tilt: THREE.RawShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly post = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private font = "";

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const opts = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter } as const;
    this.scene = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.HalfFloatType });
    this.art = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false });
    this.glyph = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: GLYPH_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uScene: { value: this.scene.texture }, uAtlas: { value: null }, uGrid: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uN: { value: GLYPHS.length }, uDark: { value: 1 }, uOwn: { value: 1 }, uPage: { value: new THREE.Vector3() }, uText: { value: new THREE.Vector3() },
      },
    });
    this.tilt = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: TILT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uA: { value: this.art.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: 0.47 }, uBand: { value: 0.26 }, uMax: { value: 18 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glyph);
    this.quad.frustumCulled = false;
    this.post.add(this.quad);
  }

  /** The window's size in CSS pixels and its pixel ratio: the scene at CSS size, the characters at the screen's. */
  resize(w: number, h: number, dpr: number) {
    this.scene.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    this.art.setSize(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    (this.glyph.uniforms.uGrid!.value as THREE.Vector2).set(Math.max(1, Math.round(w / CELL.w)), Math.max(1, Math.round(h / CELL.h)));
    (this.tilt.uniforms.uRes!.value as THREE.Vector2).set(w * dpr, h * dpr);
  }

  /** The look: whose colours, which way round, and the terminals' font for the characters. */
  setLook(look: { page: string; text: string; dark: boolean; colour: boolean; mono: string }) {
    const u = this.glyph.uniforms;
    u.uDark!.value = look.dark ? 1 : 0;
    u.uOwn!.value = look.colour ? 1 : 0;
    // As written: this pass writes the screen's colours straight, so the theme's go in unconverted.
    (u.uPage!.value as THREE.Vector3).copy(hex(look.page));
    (u.uText!.value as THREE.Vector3).copy(hex(look.text));
    const font = `${look.mono}, monospace`;
    if (font === this.font) return;
    this.font = font;
    const tw = 64, th = 120, cv = document.createElement("canvas");
    cv.width = tw * GLYPHS.length;
    cv.height = th;
    const x = cv.getContext("2d")!;
    x.fillStyle = "#000";
    x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = "#fff";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = `bold 96px ${font}`;
    [...GLYPHS].forEach((ch, i) => {
      if (ch === "—") { x.fillRect(i * tw, th * 0.44, tw, th * 0.12); return; }
      // A tilde is a small squiggle in most fonts: drawn larger, so a cell of sea reads as a wave.
      x.font = ch === "~" ? `bold 168px ${font}` : `bold 96px ${font}`;
      x.fillText(ch, (i + 0.5) * tw, th * (ch === "~" ? 0.56 : 0.52));
    });
    const old = u.uAtlas!.value as THREE.Texture | null;
    const t = new THREE.CanvasTexture(cv);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    t.flipY = false;
    u.uAtlas!.value = t;
    old?.dispose();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    const r = this.renderer;
    this.glyph.uniforms.uTime!.value = time;
    r.setRenderTarget(this.scene);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    this.quad.material = this.glyph;
    r.setRenderTarget(this.art);
    r.render(this.post, this.cam);
    this.quad.material = this.tilt;
    r.setRenderTarget(null);
    r.render(this.post, this.cam);
  }
}
