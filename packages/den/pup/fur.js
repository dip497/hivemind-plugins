// Shell fur: the body is drawn several times, each copy pushed a little further out along
// its normal, and each outer copy keeps only the pixels that fall on a strand. Strands
// thin toward their tips, are darker at the root, lie back along the body, and swing
// with the pup's motion (uFlow, in the body's own space).
import * as THREE from 'three';

export function furMaterials(shells, shared) {
  const mats = [];
  for (let s = 0; s <= shells; s++) {
    const h = s / shells;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    m.alphaToCoverage = s > 0;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uShellH = { value: h };
      sh.uniforms.uFlow = shared.flow;
      sh.uniforms.uComb = shared.comb;
      sh.uniforms.uDensity = shared.density;
      sh.uniforms.uRim = shared.rim;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float furLen;
uniform float uShellH;
uniform vec3 uFlow;
uniform vec3 uComb;
varying vec3 vRest;
varying vec3 vRestN;
varying float vFurLen;`,
        )
        .replace(
          '#include <skinning_vertex>',
          `#include <skinning_vertex>
vRest = position;
vRestN = normal;
vFurLen = furLen;
{
  vec3 nrm = normalize(objectNormal);
  #ifdef USE_SKINNING
    vec3 comb = (skinMatrix * vec4(uComb, 0.0)).xyz;
  #else
    vec3 comb = uComb;
  #endif
  comb -= nrm * dot(comb, nrm);
  float h = uShellH;
  transformed += furLen * (nrm * h + comb * h * h + uFlow * h * h);
}`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uShellH;
uniform float uDensity;
uniform float uRim;
varying vec3 vRest;
varying vec3 vRestN;
varying float vFurLen;
float furHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// One strand per cell of a 2D lattice laid on the surface, jittered so no rows show.
// Returns coverage and the strand's random value.
vec2 strand(vec2 uv, float h) {
  vec2 cell = floor(uv);
  float rnd = furHash(cell);
  vec2 jit = vec2(furHash(cell + 17.0), furHash(cell + 41.0)) - 0.5;
  vec2 f = fract(uv) - 0.5 - jit * 0.4;
  float len = mix(0.45, 1.0, rnd);
  float r = 0.58 * (1.0 - h / len);
  float a = h > len ? 0.0 : 1.0 - smoothstep(r - 0.14, r, length(f));
  return vec2(a, rnd);
}
vec2 strands(vec2 uv, float h) {
  vec2 a = strand(uv, h);
  vec2 b = strand(uv * 1.0 + vec2(0.5, 0.5), h);
  return a.x > b.x ? a : b;
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float h = uShellH;
  if (h > 0.0) {
    // Lay the lattice on the plane the surface faces most, blending at the turns.
    vec3 w = pow(abs(normalize(vRestN)), vec3(6.0));
    w /= w.x + w.y + w.z;
    vec3 p = vRest * uDensity;
    vec2 sx = strands(p.yz, h), sy = strands(p.zx + 3.1, h), sz = strands(p.xy + 7.7, h);
    float a = sx.x * w.x + sy.x * w.y + sz.x * w.z;
    float rnd = sx.y * w.x + sy.y * w.y + sz.y * w.z;
    if (a < 0.1) discard;
    diffuseColor.a = a;
    diffuseColor.rgb *= 0.9 + 0.2 * rnd;
  }
  float deep = smoothstep(0.004, 0.02, vFurLen);
  diffuseColor.rgb *= mix(1.0, mix(0.42, 1.06, pow(h, 0.65)), deep);
}`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
  float nv = saturate(dot(normal, normalize(vViewPosition)));
  outgoingLight += diffuseColor.rgb * pow(1.0 - nv, 2.2) * uRim;
}
#include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'pup-fur-v2';
    mats.push(m);
  }
  return mats;
}

export function furShared() {
  return {
    flow: { value: new THREE.Vector3() },
    comb: { value: new THREE.Vector3(-0.55, -0.25, 0) },
    density: { value: 150 },
    rim: { value: 0.35 },
  };
}
