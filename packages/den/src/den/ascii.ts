/**
 * The Den drawn in characters: the yard is rendered into a texture with what each surface is
 * written into its alpha (ground, grass, fur, face, the ball, the ring of a pup that needs you),
 * then a full-screen pass draws each cell of a grid as one coloured character, chosen by what the
 * surface is, how bright it is and which way its edges run, over a dim blurred copy of the yard.
 * A last pass blurs the top and bottom of the window like a photograph of a model.
 *
 * The approach (classes in alpha, glyphs by class and brightness, the tilt-shift on a golden-angle
 * disc) follows JDhruv14/ascii-diorama (MIT, © 2026 JDhruv14); see the wallpaper's LICENSE.
 */
import * as THREE from "three";

/** What a surface is, written into the alpha of the yard's render as cls / 16. */
export const CLS = { ground: 1, grass: 2, fur: 3, face: 4, ball: 5, ring: 6, flower: 7 } as const;

/** Mark `mat` as a surface of class `cls`, after whatever it already does to its shader. */
export function tag<M extends THREE.Material>(mat: M, cls: number): M {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>\n  gl_FragColor.a = ${(cls / 16).toFixed(4)};`,
    );
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|cls${cls}`;
  return mat;
}

/** The ground as a meadow: its colour drifts between darker and paler patches of grass, with
 *  specks of flowers, all grass to the glyph pass but for the flowers. With `on` at 0 it is the
 *  material's own colour, tone on tone, and grass all over. */
export function meadow(mat: THREE.MeshBasicMaterial, on: { value: number }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMeadow = on;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGround;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec2 vGround; uniform float uMeadow;
float mh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(mh(i), mh(i+vec2(1,0)), f.x), mix(mh(i+vec2(0,1)), mh(i+vec2(1,1)), f.x), f.y); }
float mf(vec2 p){ return mn(p) * .55 + mn(p * 2.3 + 3.) * .3 + mn(p * 5.1 + 7.) * .15; }
float flowerHere = 0.;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  float a = mf(vGround * .35), b = mf(vGround * 1.1 + 9.);
  vec3 c = diffuseColor.rgb;
  vec3 patchy = mix(c * vec3(.42, .5, .4), c * vec3(1.3, 1.34, 1.08), smoothstep(.36, .64, a));
  patchy = mix(patchy, patchy * vec3(1.18, 1.1, .82), smoothstep(.6, .8, b) * .6);
  // Flowers: a few cells in a hundred, in patches, white, yellow or pink.
  vec2 fc = floor(vGround * 7.);
  float f = mh(fc) * smoothstep(.45, .7, mf(vGround * .6 + 21.));
  if (uMeadow > .5 && f > .84) {
    float k = mh(fc + 4.);
    patchy = k < .4 ? vec3(.95, .93, .86) : k < .75 ? vec3(.95, .8, .3) : vec3(.92, .55, .62);
    flowerHere = 1.;
  }
  diffuseColor.rgb = mix(c * (.85 + .3 * a), patchy, uMeadow);
}`)
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.a = flowerHere > .5 ? 7. / 16. : 2. / 16.;");
  };
  mat.customProgramCacheKey = () => "den-meadow";
}

/** A see-through surface (a shadow) that shades what is under it and keeps that surface's class. */
export function keepClass<M extends THREE.Material>(mat: M): M {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

const GLYPHS = " .,'`:;-~=+*oO$&%8#@/\\|_—";
const GI = Object.fromEntries([...GLYPHS].map((c, i) => [c, i])) as Record<string, number>;
const g = (c: string) => GI[c]!.toFixed(1);

const VERT = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const GLYPH_FRAG = `precision highp float;
uniform sampler2D uScene, uAtlas; uniform vec2 uGrid; uniform float uTime, uN, uDark;
in vec2 vUv; out vec4 outColor;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float lum(vec3 c){ return dot(c, vec3(.25, .6, .15)); }
vec3 grade(vec3 c){
  c = max(c, 0.); c = c / (1. + c * .12); c = pow(c, vec3(1./2.2));
  c = mix(c, c*c*(3.-2.*c), .45);
  float l = lum(c); return clamp(mix(vec3(l), c, 1.18), 0., 1.);
}
void main(){
  vec2 gp = vUv * uGrid, cell = floor(gp), cuv = (cell + .5) / uGrid;
  ivec2 sz = textureSize(uScene, 0);
  float lod = log2(float(sz.x) / uGrid.x) + .05;
  vec3 col = grade(textureLod(uScene, cuv, lod).rgb);
  float cls = floor(texelFetch(uScene, ivec2(cuv * vec2(sz)), 0).a * 16. + .5);
  float L = lum(col);
  // On a light ground, brightness reads the other way round: dark ink on pale paper.
  float T = uDark > .5 ? L : 1. - L;
  vec2 e = 1. / uGrid;
  float lx0 = lum(grade(textureLod(uScene, cuv - vec2(e.x, 0), lod).rgb)), lx1 = lum(grade(textureLod(uScene, cuv + vec2(e.x, 0), lod).rgb));
  float ly0 = lum(grade(textureLod(uScene, cuv - vec2(0, e.y), lod).rgb)), ly1 = lum(grade(textureLod(uScene, cuv + vec2(0, e.y), lod).rgb));
  vec2 grad = vec2(lx1 - lx0, (ly1 - ly0) * .55); float mag = length(grad);
  float a4 = mod(atan(grad.y, grad.x) + .3927, 3.14159) / .7854;
  float edge = a4 < 1. ? ${g("|")} : a4 < 2. ? ${g("\\")} : a4 < 3. ? ${g("—")} : ${g("/")};
  // Wind over the grass, slow enough that a glyph holds a while before it turns.
  float w = vn(cell * vec2(.05, .09) + vec2(-uTime * .22, uTime * .05)) * 2. - 1.;
  float n = h21(cell);
  float gl = ${g(" ")};
  if (cls < 1.5) {          // the yard's ground: calm, a scatter of specks
    gl = n < .82 ? ${g(" ")} : n < .9 ? ${g(".")} : n < .95 ? ${g(",")} : n < .98 ? ${g("'")} : ${g(":")};
  } else if (cls < 2.5) {   // grass: its darkest a speck, else a blade that leans with the wind
    gl = T < .2 ? (n < .6 ? ${g(" ")} : ${g(".")}) : T < .3 ? (n < .5 ? ${g(",")} : ${g(".")}) : T < .38 ? (n < .5 ? ${g(":")} : ${g(";")})
      : (w < -.22 ? ${g("\\")} : w > .22 ? ${g("/")} : ${g("|")});
  } else if (cls < 3.5) {   // fur
    gl = T < .2 ? ${g(":")} : T < .34 ? ${g("%")} : T < .48 ? ${g("&")} : T < .62 ? ${g("$")} : T < .78 ? ${g("8")} : ${g("#")};
    if (mag > .2) gl = edge;
  } else if (cls < 4.5) {   // eyes, nose, mouth
    gl = L < .2 ? ${g("@")} : L < .6 ? ${g("O")} : ${g("*")};
  } else if (cls < 5.5) {   // the ball
    gl = ${g("O")};
  } else if (cls < 6.5) {   // the ring under a pup that needs you
    gl = w > 0. ? ${g("*")} : ${g("+")};
  } else if (cls < 7.5) {   // flowers: small, so they never read as eyes
    gl = n < .6 ? ${g("+")} : ${g(":")};
  }
  vec2 gv = gp - cell, dx = dFdx(gp), dy = dFdy(gp);
  float ink = smoothstep(.12, .78, textureGrad(uAtlas, vec2((gl + gv.x) / uN, 1. - gv.y), dx / uN, dy).r);
  vec3 paper = grade(textureLod(uScene, vUv, lod + 1.2).rgb);
  vec3 c = uDark > .5
    ? mix(paper * .3, col * 1.32 + .012, ink)
    : mix(mix(paper, vec3(1.), .08), col * .72, ink);
  outColor = vec4(c, 1.);
}`;

const TILT_FRAG = `precision highp float;
uniform sampler2D uA; uniform vec2 uRes; uniform float uFocus, uBand, uMax;
in vec2 vUv; out vec4 outColor;
void main(){
  float dy = abs(vUv.y - uFocus);
  float r = pow(smoothstep(uBand, uBand + .3, dy), 1.6) * uMax;
  if (r < .25) { outColor = vec4(texture(uA, vUv).rgb, 1.); return; }
  float lod = max(log2(r / 4.), 0.);
  vec3 c = vec3(0.);
  for (int i = 0; i < 24; i++) {
    float t = float(i) + .5, a = t * 2.39996, rr = sqrt(t / 24.) * r;
    c += textureLod(uA, vUv + vec2(cos(a), sin(a)) * rr / uRes, lod).rgb;
  }
  outColor = vec4(c / 24., 1.);
}`;

/** The glyph and tilt-shift passes, drawn after the yard. */
export class AsciiPass {
  private scene: THREE.WebGLRenderTarget;
  private art: THREE.WebGLRenderTarget;
  private readonly glyph: THREE.RawShaderMaterial;
  private readonly tilt: THREE.RawShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly post = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private atlasFont = "";

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const opts = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter } as const;
    this.scene = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.HalfFloatType });
    this.art = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false });
    this.glyph = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: GLYPH_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uScene: { value: this.scene.texture }, uAtlas: { value: null }, uGrid: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uN: { value: GLYPHS.length }, uDark: { value: 1 } },
    });
    this.tilt = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: TILT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uA: { value: this.art.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: 0.5 }, uBand: { value: 0.3 }, uMax: { value: 14 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.glyph);
    this.quad.frustumCulled = false;
    this.post.add(this.quad);
  }

  /** The window's size in CSS pixels, and its pixel ratio. A cell is about 6.5 x 11.5 CSS pixels. */
  resize(w: number, h: number, dpr: number) {
    this.scene.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    this.art.setSize(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    (this.glyph.uniforms.uGrid!.value as THREE.Vector2).set(Math.max(1, Math.round(w / 6.5)), Math.max(1, Math.round(h / 11.5)));
    (this.tilt.uniforms.uRes!.value as THREE.Vector2).set(w * dpr, h * dpr);
  }

  /** The characters in the terminals' font, and which way round the ground is. */
  setLook(font: string, dark: boolean) {
    this.glyph.uniforms.uDark!.value = dark ? 1 : 0;
    if (font === this.atlasFont) return;
    this.atlasFont = font;
    const tw = 64, th = 120, c = document.createElement("canvas");
    c.width = tw * GLYPHS.length;
    c.height = th;
    const x = c.getContext("2d")!;
    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#fff";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = `bold 96px ${font || "monospace"}`;
    [...GLYPHS].forEach((ch, i) => {
      if (ch === "—") x.fillRect(i * tw, th * 0.44, tw, th * 0.12);
      else x.fillText(ch, (i + 0.5) * tw, th * 0.52);
    });
    const old = this.glyph.uniforms.uAtlas!.value as THREE.Texture | null;
    const t = new THREE.CanvasTexture(c);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    t.flipY = false;
    this.glyph.uniforms.uAtlas!.value = t;
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
