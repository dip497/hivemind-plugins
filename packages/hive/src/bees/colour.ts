/**
 * Bees' colours: its own palettes are set in OKLCH, so a palette's lightness reads as it is set on
 * any hue, and turned into the sRGB a canvas draws once per look, never per frame. The same maths
 * as Hivemind's own scenes (apps/desktop/src/renderer/src/live/colour.ts): a colour the screen
 * cannot show keeps its lightness and hue and loses chroma until it can.
 */

/** Lightness 0–1, chroma 0–0.37, hue in degrees. */
export type Oklch = readonly [l: number, c: number, h: number];
/** sRGB, each 0–255. */
export type Rgb = readonly [r: number, g: number, b: number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function labToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToLab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const inGamut = (c: readonly number[]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const toRgb = (lin: readonly number[]) => lin.map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255)) as unknown as Rgb;

/** An OKLCH colour as sRGB, its chroma cut to the screen's gamut where it is out of it. */
export function rgbOf([l, c, h]: Oklch): Rgb {
  const at = (chroma: number) => labToLinear(l, chroma * Math.cos((h * Math.PI) / 180), chroma * Math.sin((h * Math.PI) / 180));
  let lin = at(c);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    lin = at(lo);
  }
  return toRgb(lin);
}

/** `t` of the way from `a` to `b`, in OKLab: an even step in lightness, with no grey dip between hues. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const [la, aa, ba] = linearToLab(...(a.map((v) => toLinear(v / 255)) as [number, number, number]));
  const [lb, ab, bb] = linearToLab(...(b.map((v) => toLinear(v / 255)) as [number, number, number]));
  return toRgb(labToLinear(la + (lb - la) * t, aa + (ab - aa) * t, ba + (bb - ba) * t));
}

export const css = ([r, g, b]: Rgb) => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
export const cssAlpha = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${+a.toFixed(3)})`;
