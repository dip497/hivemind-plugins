/**
 * The glade's shaders, one pass each. Every pass works at the art's own resolution (the glow at half
 * and a quarter of it), one fragment an art pixel, so the light, the fog, the water and the rain all
 * step in whole art pixels and the picture stays pixel art; a blit scales the finished picture up.
 *
 *   still   the still layers into the frame's layers, grass and leaves leaning a pixel in the wind
 *   sprite  the moving things into the same layers, behind and in front of the still ones by depth
 *   light   each pixel lit: moonlight, every lamp and flame, fog and ground mist that glow round them
 *   water   the pond's mirror of what stands beyond it, rain, ripples
 *   bright / blur   the glow round bright things, at half and a quarter of the art's size
 *   show    the finished picture: the glow added, the tone, the look (its own colours or the theme's);
 *           a blit then scales it up to the screen, each art pixel a block
 *
 * The frame's layers: colour (albedo), normal and material, height and depth, glow. Rows run top
 * down in every texture here: row 0 of the art is row 0 of each.
 */

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

export const QUAD_VS = HEAD + /* glsl */ `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

const LAYERS_OUT = /* glsl */ `
layout(location = 0) out vec4 oAlb;
layout(location = 1) out vec4 oNrm;
layout(location = 2) out vec4 oDat;
layout(location = 3) out vec4 oEmi;
uniform float uZMax;
`;

export const STILL_FS = HEAD + LAYERS_OUT + /* glsl */ `
uniform sampler2D sAlb, sNrm, sDat, sEmi;
uniform float uTime, uWind;
uniform ivec2 uSize;

// How many pixels a swaying pixel leans in the wind now: -1, 0 or 1.
int lean(ivec2 p, vec4 d) {
  if (d.a <= 0.) return 0;
  float w = sin(uTime * 1.3 + float(p.x) * 0.045 + float(p.y) * 0.02) * 0.6 + sin(uTime * 0.47 + float(p.x) * 0.017) * 0.4;
  return clamp(int(floor(w * uWind * d.a * 1.7 + 0.5)), -1, 1);
}
vec4 dat(ivec2 p) { return texelFetch(sDat, clamp(p, ivec2(0), uSize - 1), 0); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), l = p - ivec2(1, 0), r = p + ivec2(1, 0);
  vec4 d0 = dat(p), dl = dat(l), dr = dat(r);
  int o0 = lean(p, d0), ol = lean(l, dl), or_ = lean(r, dr);
  ivec2 src = p;
  // A neighbour leaning onto this pixel shows here if this one leant away, or is behind it.
  bool fromL = ol == 1 && (o0 != 0 || dl.g >= d0.g);
  bool fromR = or_ == -1 && (o0 != 0 || dr.g >= d0.g);
  if (fromL && (!fromR || dl.g >= dr.g)) src = l;
  else if (fromR) src = r;
  // A pixel that leant away shows what is beside it: the ground or sky it stood against.
  else if (o0 != 0) { ivec2 f = p + ivec2(o0, 0); src = dat(f).a > 0. ? p + ivec2(2 * o0, 0) : f; }
  src = clamp(src, ivec2(0), uSize - 1);
  oAlb = texelFetch(sAlb, src, 0);
  oNrm = texelFetch(sNrm, src, 0);
  oDat = texelFetch(sDat, src, 0);
  oEmi = texelFetch(sEmi, src, 0);
  gl_FragDepth = 1. - clamp(oDat.g / uZMax, 0., 1.);
}`;

export const SPRITE_VS = HEAD + /* glsl */ `
layout(location = 0) in vec4 iDst;   // left, top, width, height in art pixels
layout(location = 1) in vec4 iSrc;   // atlas left, top; the foot row it stands on; a depth nudge
layout(location = 2) in vec4 iFx;    // mirrored (0/1), glow, how much of it shows (0 to 1), lift
layout(location = 3) in vec4 iTint;  // a colour it is tinted, and how much of its colour is the tint
uniform vec2 uSize;
out vec2 vLocal;
flat out vec4 vDst, vSrc, vFx, vTint;
void main() {
  // Two triangles a quad: vertices 0 to 5.
  int v = gl_VertexID % 6;
  vec2 c = vec2(v == 1 || v == 2 || v == 4 ? 1. : 0., v == 2 || v == 4 || v == 5 ? 1. : 0.);
  vec2 px = iDst.xy + c * iDst.zw;
  gl_Position = vec4(px / uSize * 2. - 1., 0., 1.);
  vLocal = c * iDst.zw;
  vDst = iDst; vSrc = iSrc; vFx = iFx; vTint = iTint;
}`;

export const SPRITE_FS = HEAD + LAYERS_OUT + /* glsl */ `
uniform sampler2D aAlb, aNrm, aDat, aEmi;
in vec2 vLocal;
flat in vec4 vDst, vSrc, vFx, vTint;
float bayer(ivec2 p) {
  int i = (p.y & 3) * 4 + (p.x & 3);
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.;
}
void main() {
  ivec2 l = ivec2(floor(vLocal));
  int w = int(vDst.z);
  ivec2 t = ivec2(int(vSrc.x) + (vFx.x > 0.5 ? w - 1 - l.x : l.x), int(vSrc.y) + l.y);
  vec4 a = texelFetch(aAlb, t, 0);
  if (a.a < 0.5 || vFx.z <= bayer(ivec2(gl_FragCoord.xy))) discard;
  vec4 n = texelFetch(aNrm, t, 0), d = texelFetch(aDat, t, 0), e = texelFetch(aEmi, t, 0);
  if (vFx.x > 0.5) n.x = 1. - n.x;
  oAlb = vec4(mix(a.rgb, vTint.rgb, vTint.a), 1.);
  oNrm = n;
  float z = vSrc.z * 2. + d.g + vSrc.w;
  oDat = vec4(d.r + vFx.w, z, 0., 0.);
  oEmi = vec4(e.rgb * vTint.rgb * vFx.y, 0.5);
  gl_FragDepth = 1. - clamp(z / uZMax, 0., 1.);
}`;

/** How many lights the light pass takes at once. */
export const MAX_LIGHTS = 32;

export const LIGHT_FS = HEAD + /* glsl */ `
uniform sampler2D gAlb, gNrm, gDat, gEmi;
uniform int uLights;
uniform vec4 uLightPos[${MAX_LIGHTS}];  // x, height, depth, reach
uniform vec4 uLightCol[${MAX_LIGHTS}];  // linear colour times power
uniform vec3 uMoonDir, uMoon, uSkyAmb, uGroundAmb, uFog;
uniform float uFogK, uFogMax, uMist, uTime, uZFront, uSkyLift, uStars, uWet, uStillGlow;
uniform vec3 uSkyTop, uSkyBottom;
uniform float uSkyMix;
uniform int uRows;
out vec4 oCol;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(gAlb, p, 0), nm = texelFetch(gNrm, p, 0), d = texelFetch(gDat, p, 0), em = texelFetch(gEmi, p, 0);
  int mat = int(nm.a * 255. + 0.5);
  // The still lamps' glow (marked 1) is the look's to dim by day; a sprite's (marked a half) its own.
  vec3 alb = lin(a.rgb), emi = lin(em.rgb) * (em.a > 0.75 ? uStillGlow : 1.);
  float row = float(p.y), x = float(p.x) + 0.5;
  if (mat == 4) {
    // The sky: its own colour (or, by day, the day's), its stars twinkling, the moon.
    float t = row / float(uRows);
    vec3 day = mix(uSkyTop, uSkyBottom, clamp(t * 1.6, 0., 1.));
    vec3 c = mix(alb * uSkyLift, day, uSkyMix);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + hash(vec2(p)) * 3.) + hash(vec2(p) + 7.) * 6.283);
    c += emi * uStars * (em.r < 0.9 ? tw : 1.);
    c = mix(c, uFog, clamp(t * t * 0.6 * uFogMax, 0., 1.));
    oCol = vec4(c, float(mat) / 255.);
    return;
  }
  vec3 n = normalize(nm.xyz * 2. - 1.);
  vec3 P = vec3(x, d.r, d.g);
  // Moonlight and the sky's own light from above; the ground's from below.
  vec3 light = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) + uMoon * max(0., dot(n, uMoonDir));
  vec3 glowFog = vec3(0.);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLights) break;
    vec3 L = uLightPos[i].xyz - P;
    float dist = length(L), reach = uLightPos[i].w;
    float att = clamp(1. - dist / reach, 0., 1.);
    att *= att;
    float nl = max(0., dot(n, L / max(dist, 0.001)));
    // Leaves let the light through a little from behind.
    if (mat == 2) nl = 0.3 + 0.7 * nl;
    light += uLightCol[i].rgb * att * nl;
    glowFog += uLightCol[i].rgb * exp(-dist * dist / (reach * reach * 0.12));
  }
  vec3 c = alb * light;
  // Wet ground after rain shines where a light is low behind it.
  if (mat == 1 && n.y > 0.9) c += glowFog * uWet * 0.05;
  // Fog by distance; ground mist low down, drifting.
  // Fog begins past the clearing's near half: the camp stands clear, the far forest grey.
  float far = max(0., uZFront - d.g - 120.);
  // Fog lies thickest low down: the crowns stand dark against the sky above it.
  float fog = (1. - exp(-far * uFogK)) * uFogMax * mix(1., 0.22, smoothstep(10., 90., d.r));
  float mist = exp(-d.r / 7.) * uMist * (0.55 + 0.45 * vnoise(vec2(x * 0.03 - uTime * 0.25, d.g * 0.05 + uTime * 0.04)));
  fog = clamp(max(fog, mist), 0., 0.97);
  vec3 fogCol = uFog + glowFog * 0.08;
  c = mix(c, fogCol, fog);
  c += emi * (1. - fog * 0.65);
  oCol = vec4(c, float(mat) / 255.);
}`;

export const WATER_FS = HEAD + /* glsl */ `
uniform sampler2D tLit, gDat;
uniform float uTime, uRain;
uniform vec4 uRipples[4];  // x, row, start time, strength
uniform ivec2 uSize;
uniform vec3 uRainCol;
uniform vec4 uSheen;  // the sky's colour on the water, and how much the moon glints
out vec4 oCol;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 lit(ivec2 q) { return texelFetch(tLit, clamp(q, ivec2(0), uSize - 1), 0).rgb; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 me = texelFetch(tLit, p, 0);
  int mat = int(me.a * 255. + 0.5);
  vec3 c = me.rgb;
  float x = float(p.x), row = float(p.y);
  if (mat == 3) {
    // The pond mirrors what stands beyond it, about its far bank, wavering; rings where it was touched.
    float m = texelFetch(gDat, p, 0).b;
    float ring = 0.;
    for (int i = 0; i < 4; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (r.z < 0. || age > 3.) continue;
      float dd = length(vec2(x - r.x, (row - r.y) * 2.6));
      ring += r.w * exp(-age * 1.2) * smoothstep(1.2, 0., abs(dd - age * 14.)) ;
    }
    // Rain on the water: little rings at random, coming and going.
    vec2 cell = floor(vec2(x / 5., row / 3.));
    float rt = fract(uTime * 0.9 + hash(cell) * 7.);
    float rr = length(vec2(x - (cell.x + 0.5) * 5., (row - (cell.y + 0.5) * 3.) * 2.));
    ring += uRain * step(hash(cell + 3.), uRain * 0.6) * smoothstep(1., 0., abs(rr - rt * 4.)) * (1. - rt);
    float wob = sin(row * 1.7 - uTime * 2.2) * 0.6 + sin(row * 0.6 + uTime * 1.3) * 0.5;
    int dx = int(floor(wob + ring * 2. + 0.5));
    // Seen from above, the water shows what stands far beyond it: the mirror is stretched.
    int src = int(m - (row - m) * 3.2);
    vec3 refl = lit(ivec2(p.x + dx, src));
    int below = int(texelFetch(tLit, clamp(ivec2(p.x + dx, src), ivec2(0), uSize - 1), 0).a * 255. + 0.5);
    if (below == 3) refl = vec3(0.);
    // Toward the far bank it shows more of the sky's sheen; moonlight glints dance on it.
    float far = clamp(1. - (row - m) / 14., 0., 1.);
    vec2 gc = floor(vec2(x / 3. + sin(row * 0.9 + uTime * 0.7) * 1.5, row));
    float glint = step(0.955, hash(gc + floor(uTime * 1.5) * 0.37)) * uSheen.a;
    c = c * 0.6 + refl * vec3(0.55, 0.62, 0.72) + uSheen.rgb * (0.4 + far * 0.6) + vec3(0.03, 0.04, 0.05) * ring + vec3(0.5, 0.55, 0.65) * glint * (0.3 + ring);
  }
  // Rain: streaks falling on a slant, in whole pixels, lit by what they fall in front of.
  if (uRain > 0.01) {
    float col = floor(x + row * 0.25);
    float speed = 90. + hash(vec2(col, 1.)) * 50.;
    float ph = fract((row + uTime * speed) / 23. + hash(vec2(col, 2.)));
    float on = step(ph, 0.12) * step(hash(vec2(col, floor((row + uTime * speed) / 23.))), uRain * 0.55);
    c = mix(c, uRainCol + c * 0.9, on * 0.55);
  }
  oCol = vec4(c, me.a);
}`;

export const BRIGHT_FS = HEAD + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 oCol;
void main() {
  vec3 c = vec3(0.);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i & 1, i >> 1) - 0.5;
    vec3 s = texture(tSrc, vUv + o * uTexel).rgb;
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    c += s * smoothstep(uThreshold, uThreshold * 2.5, l);
  }
  oCol = vec4(c * 0.25, 1.);
}`;

export const BLUR_FS = HEAD + /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 oCol;
void main() {
  float w[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 c = texture(tSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(tSrc, vUv + uStep * float(i)).rgb * w[i];
    c += texture(tSrc, vUv - uStep * float(i)).rgb * w[i];
  }
  oCol = vec4(c, 1.);
}`;

export const SHOW_FS = HEAD + /* glsl */ `
uniform sampler2D tArt, tGlow1, tGlow2;
uniform vec2 uArt;          // the art's size
uniform float uExposure, uGlow, uTheme, uDarkTheme, uVignette, uLo, uHi, uChroma;
uniform vec3 uPage, uText, uPaper;
out vec4 oCol;
float bayer(ivec2 p) {
  int i = (p.y & 3) * 4 + (p.x & 3);
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.;
}
void main() {
  ivec2 ap = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(tArt, ap, 0).rgb;
  vec2 uv = (vec2(ap) + 0.5) / uArt;
  c += (texture(tGlow1, uv).rgb * 0.6 + texture(tGlow2, uv).rgb * 0.9) * uGlow;
  c *= uExposure;
  // Darker toward the corners, a little.
  vec2 v = uv - 0.5;
  c *= 1. - uVignette * dot(v, v) * 1.6;
  // Tone: a soft shoulder, so the fire's heart is white without the rest going grey.
  c = c / (1. + c * 0.35);
  vec3 sc = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
  // A light theme's picture: its lightness pressed into the top of the range, its colours kept in
  // part, tinted toward the paper, so a frosted panel's text reads over all of it.
  float Ls = dot(sc, vec3(0.299, 0.587, 0.114));
  sc = clamp(vec3(mix(uLo, uHi, Ls)) + (sc - Ls) * uChroma, 0., 1.) * mix(vec3(1.), uPaper, step(0.01, uLo));
  if (uTheme > 0.5) {
    // The theme's two colours: each pixel a step from the page to the text by how bright it is.
    float L = dot(sc, vec3(0.299, 0.587, 0.114));
    float k = uDarkTheme > 0.5 ? clamp(0.04 + L * 0.95, 0., 0.9) : clamp(1.05 - L * 1.1, 0.06, 0.85);
    sc = mix(uPage, uText, k);
  }
  // Steps of colour in a pixel artist's dither, one pattern cell an art pixel.
  sc = floor(sc * 40. + bayer(ap)) / 40.;
  oCol = vec4(sc, 1.);
}`;
