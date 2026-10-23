// A small local checker for a package's theme member (`theme.json`), written to the table in the
// app's plan (docs/plans/sounds-and-themes.md, T2). It mirrors the app's
// `packages/hive-core/src/theme-format.ts` until the view SDK carries a copy of it; when it does,
// the Harbour test should read the theme with the app's own checker instead, as the other tests do.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const PALETTE_KEYS = ["bg", "bg2", "bg3", "bg4", "line", "line2", "fg", "fg2", "fg3", "select", "ok", "warn", "err"] as const;
export const ACCENT_IDS = ["graphite", "indigo", "volt", "ember", "ice", "pulse", "rose", "emerald", "amber", "violet"] as const;
export const WALLPAPER_KINDS = ["none", "aurora", "ember", "ice", "mesh", "sunset", "forest", "nebula", "mono"] as const;
/** Slots a later format fills (the 2026-10-22 gap review, §5): taken by nothing yet, refused by nobody. */
const RESERVED = ["icons", "cursors", "scene", "mascot", "screens", "words"];
const FIELDS = ["format", "name", "mode", "palette", "accent", "terminal", "radius", "fonts", "wallpaper", "sounds", ...RESERVED];
/** The app's `COLOR_RE` (settings-schema.ts). */
export const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|[a-z]{3,20})$/;
export const MOST_BYTES = 400 * 1024;

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
export const hexOf = (c: string) => "#" + rgbOf(c).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

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

/** The contrast pairs the app refuses a theme below (T2). */
export const REQUIRED_PAIRS = [["fg", "bg", 4.5], ["fg", "bg2", 4.5], ["fg2", "bg", 3]] as const;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isColor = (v: unknown) => typeof v === "string" && COLOR_RE.test(v);

/** Every problem with the theme in `dir`, each naming its field; none means the app would take it. */
export function checkTheme(dir: string): string[] {
  const out: string[] = [];
  let t: unknown;
  try { t = JSON.parse(readFileSync(path.join(dir, "theme.json"), "utf8")); } catch (e) { return [`theme.json: ${(e as Error).message}`]; }
  if (!isObj(t)) return ["theme.json: not an object"];

  for (const k of Object.keys(t)) if (!FIELDS.includes(k)) out.push(`${k}: not a theme field`);
  if (t.format !== 1) out.push("format: must be 1");
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 60) out.push("name: 1 to 60 characters");
  if (t.mode !== "dark" && t.mode !== "light") out.push('mode: "dark" or "light"');

  const palette = isObj(t.palette) ? t.palette : null;
  if (!palette) out.push("palette: required");
  else {
    for (const k of PALETTE_KEYS) if (!isColor(palette[k]) || !parseColor(palette[k] as string)) out.push(`palette.${k}: a colour`);
    for (const k of Object.keys(palette)) if (!(PALETTE_KEYS as readonly string[]).includes(k)) out.push(`palette.${k}: not a palette key`);
    if (!out.some((p) => p.startsWith("palette.")))
      for (const [a, b, least] of REQUIRED_PAIRS) {
        const c = contrast(rgbOf(palette[a] as string), rgbOf(palette[b] as string));
        if (c < least) out.push(`palette: ${a} on ${b} is ${c.toFixed(2)}:1, under ${least}:1`);
      }
  }

  if (typeof t.accent === "string") { if (!(ACCENT_IDS as readonly string[]).includes(t.accent)) out.push(`accent: no accent "${t.accent}"`); }
  else if (isObj(t.accent)) {
    for (const k of ["brand", "accent"]) if (!isColor(t.accent[k])) out.push(`accent.${k}: a colour`);
    if (t.accent.working !== undefined && !isColor(t.accent.working)) out.push("accent.working: a colour");
    for (const k of Object.keys(t.accent)) if (!["brand", "accent", "working"].includes(k)) out.push(`accent.${k}: not an accent field`);
  } else out.push("accent: an accent id or {brand, accent, working?}");

  if (t.terminal !== undefined) {
    const term = isObj(t.terminal) ? t.terminal : {};
    for (const k of ["background", "foreground", "cursor", "selection"]) if (!isColor(term[k])) out.push(`terminal.${k}: a colour`);
    if (!Array.isArray(term.ansi) || term.ansi.length !== 16 || !term.ansi.every(isColor)) out.push("terminal.ansi: 16 colours");
  }

  if (t.radius !== undefined && !(typeof t.radius === "number" && t.radius >= 0 && t.radius <= 24)) out.push("radius: 0 to 24");

  const file = (field: string, rel: unknown, exts: string[], most = MOST_BYTES) => {
    if (typeof rel !== "string" || !rel) return out.push(`${field}: a path in the theme's folder`);
    const abs = path.resolve(dir, rel);
    if (path.isAbsolute(rel) || !abs.startsWith(path.resolve(dir) + path.sep)) return out.push(`${field}: ${rel} is outside the theme's folder`);
    if (!exts.includes(path.extname(rel).toLowerCase())) return out.push(`${field}: ${rel} is not ${exts.join(" or ")}`);
    let size: number;
    try { size = statSync(abs).size; } catch { return out.push(`${field}: ${rel} is missing`); }
    if (size > most) out.push(`${field}: ${rel} is ${Math.round(size / 1024)} KB, over ${Math.round(most / 1024)} KB`);
  };

  if (t.fonts !== undefined) {
    if (!isObj(t.fonts)) out.push("fonts: {ui?, mono?}");
    else for (const [k, f] of Object.entries(t.fonts)) {
      if (k !== "ui" && k !== "mono") { out.push(`fonts.${k}: not a font slot`); continue; }
      if (!isObj(f) || typeof f.family !== "string" || !f.family || !Array.isArray(f.files) || !f.files.length) { out.push(`fonts.${k}: {family, files}`); continue; }
      f.files.forEach((x, i) => {
        if (!isObj(x)) return out.push(`fonts.${k}.files[${i}]: {path, weight?, style?}`);
        file(`fonts.${k}.files[${i}].path`, x.path, [".woff2"]);
        if (x.weight !== undefined && !(typeof x.weight === "number" || (typeof x.weight === "string" && /^\d{3}( \d{3})?$/.test(x.weight)))) out.push(`fonts.${k}.files[${i}].weight: a weight or a range`);
        if (x.style !== undefined && x.style !== "normal" && x.style !== "italic") out.push(`fonts.${k}.files[${i}].style: normal or italic`);
      });
    }
  }

  if (t.wallpaper !== undefined) {
    const w = t.wallpaper;
    if (typeof w === "string") { if (!(WALLPAPER_KINDS as readonly string[]).includes(w)) out.push(`wallpaper: no wallpaper "${w}"`); }
    else if (isObj(w)) {
      if ("image" in w === "video" in w) out.push("wallpaper: {image} or {video}");
      if ("image" in w) file("wallpaper.image", w.image, [".webp", ".jpg", ".jpeg", ".png", ".avif"], Infinity);
      if ("video" in w) file("wallpaper.video", w.video, [".mp4", ".webm"], Infinity);
      if (w.brightness !== undefined && !(typeof w.brightness === "number" && w.brightness >= 0.4 && w.brightness <= 1.1)) out.push("wallpaper.brightness: 0.4 to 1.1");
    } else out.push("wallpaper: a built-in kind, {image} or {video}");
  }

  if (t.sounds !== undefined) {
    if (!isObj(t.sounds)) out.push("sounds: {needs?, done?, error?}");
    else for (const [k, s] of Object.entries(t.sounds)) {
      if (!["needs", "done", "error"].includes(k)) out.push(`sounds.${k}: not a moment`);
      else file(`sounds.${k}`, s, [".ogg", ".mp3"]);
    }
  }
  return out;
}
