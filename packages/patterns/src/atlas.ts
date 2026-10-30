/**
 * A glyph atlas: each character a pattern draws, drawn once in the face the wallpaper brings, white
 * on black, in a row of slots a cell wide, as a texture a shader samples. Each glyph's coverage (the
 * share of its slot it inks) is measured as it is drawn, so a ramp of tones can be ordered by the
 * face itself, not by guesswork.
 */
import { texture, type GL } from "./gl";

export interface Atlas {
  tex: WebGLTexture;
  /** How many glyphs; each glyph's slot (1-based, 0 meaning none), and its coverage, 0 … 1. */
  count: number;
  slot: Map<string, number>;
  coverage: Map<string, number>;
  /** A slot's width, its padding either side and a cell's width, as shares of the atlas's width. */
  slotU: number;
  padU: number;
  cellU: number;
}

const PAD = 2;

/** Draw `glyphs` (each one character) in cells of `w` by `h` device pixels, in `font` (a CSS font,
 *  its size in device pixels), and upload them. */
export function glyphAtlas(gl: GL, glyphs: readonly string[], w: number, h: number, font: string, old?: Atlas): Atlas {
  if (old) gl.deleteTexture(old.tex);
  const unique = [...new Set(glyphs)];
  const slotW = w + PAD * 2;
  const width = slotW * unique.length;
  const canvas = new OffscreenCanvas(width, h);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, h);
  g.fillStyle = "#fff";
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  unique.forEach((ch, k) => g.fillText(ch, k * slotW + slotW / 2, h / 2 + h * 0.03));
  const img = g.getImageData(0, 0, width, h).data;
  const red = new Uint8Array(width * h);
  for (let i = 0; i < red.length; i++) red[i] = img[i * 4]!;
  const coverage = new Map<string, number>();
  unique.forEach((ch, k) => {
    let sum = 0;
    for (let y = 0; y < h; y++) for (let x = k * slotW + PAD; x < k * slotW + PAD + w; x++) sum += red[y * width + x]!;
    coverage.set(ch, sum / (255 * w * h));
  });
  return {
    tex: texture(gl, width, h, true, red, "r8"),
    count: unique.length,
    slot: new Map(unique.map((ch, k) => [ch, k + 1])),
    coverage,
    slotU: slotW / width,
    padU: PAD / width,
    cellU: w / width,
  };
}

/** `steps` glyphs of `candidates`, from the faintest to the densest in this face, spread as evenly
 *  over its coverage as the candidates allow. */
export function rampOf(atlas: Atlas, candidates: readonly string[], steps: number): string[] {
  const sorted = [...new Set(candidates)].sort((a, b) => atlas.coverage.get(a)! - atlas.coverage.get(b)!);
  const lo = atlas.coverage.get(sorted[0]!)!;
  const hi = atlas.coverage.get(sorted[sorted.length - 1]!)!;
  const out: string[] = [];
  for (let k = 0; k < steps; k++) {
    const want = lo + ((hi - lo) * k) / (steps - 1);
    let best = sorted[0]!;
    for (const ch of sorted) if (Math.abs(atlas.coverage.get(ch)! - want) < Math.abs(atlas.coverage.get(best)! - want)) best = ch;
    out.push(best);
  }
  return out;
}
