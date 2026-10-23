// Colour maths for the theme tests: parsing the CSS colours a theme is written in (hex, rgb() and
// oklch()), WCAG contrast, OKLCH, colour-blindness simulation and how far apart two colours look.
// Whether a theme is valid is the app's to say (its theme-format.ts); this only measures.
export type RGB = [number, number, number];

/** A colour of the kinds a theme is written in (hex, rgb() and oklch()) as sRGB 0–1, gamut-clipped,
 *  with its alpha. */
export function parseColor(c: string): { rgb: RGB; alpha: number } | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) : 1 };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const ch = (x: string) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x) / 255);
    const a = p[3] === undefined ? 1 : p[3].endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    const rgb = [ch(p[0]!), ch(p[1]!), ch(p[2]!)] as RGB;
    return rgb.some(Number.isNaN) || Number.isNaN(a) ? null : { rgb, alpha: a };
  }
  m = /^oklch\(([^)]*)\)$/.exec(s);
  if (m) {
    const [body, alphaPart] = m[1]!.split("/");
    const p = body!.trim().split(/\s+/);
    if (p.length !== 3) return null;
    const L = p[0]!.endsWith("%") ? parseFloat(p[0]!) / 100 : parseFloat(p[0]!);
    const C = parseFloat(p[1]!), H = parseFloat(p[2]!);
    const a = alphaPart === undefined ? 1 : alphaPart.trim().endsWith("%") ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart);
    if ([L, C, H, a].some(Number.isNaN)) return null;
    return { rgb: oklchToSrgb(L, C, H), alpha: a };
  }
  return null;
}

export function oklchToSrgb(L: number, C: number, H: number): RGB {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  }) as RGB;
}

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const luminance = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG 2 contrast ratio. */
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
export const rgbOf = (c: string) => {
  const p = parseColor(c);
  if (!p) throw new Error(`not a colour: ${c}`);
  return p.rgb;
};

/** Machado, Oliveira and Fernandes (2009), severity 1, applied in linear light. */
const CVD = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
} as const;
export function simulate(rgb: RGB, kind: keyof typeof CVD): RGB {
  const lin = rgb.map(linear);
  return CVD[kind].map((row) => {
    const v = Math.min(1, Math.max(0, row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  }) as RGB;
}
/** sRGB 0–1 as OKLCH: lightness 0–1, chroma, hue in degrees. */
export function oklchOf(rgb: RGB): { L: number; C: number; H: number } {
  const [L, a, b] = oklab(rgb);
  return { L: L!, C: Math.hypot(a!, b!), H: ((Math.atan2(b!, a!) * 180) / Math.PI + 360) % 360 };
}
function oklab(rgb: RGB) {
  const [r, g, b] = rgb.map(linear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** CIE76 distance in OKLab ×100: how far apart two colours look (≈2 is just noticeable). */
export function deltaE(x: RGB, y: RGB) {
  const p = oklab(x), q = oklab(y);
  return 100 * Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}
