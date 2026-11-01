/**
 * Fireflies' light, as sprites painted once per look and drawn scaled each frame: a light's soft
 * glow round it, its bright core, and the ring at the front of a click's burst. Each is one colour
 * with its strength in its alpha, so a glow drawn added to the night adds that colour times it, and
 * on a dusk sky tints it. Smooth to the edge, with no stop between: a radial gradient's stops show
 * as rings once a glow is scaled up past its sprite.
 */
import type { Rgb } from "../colour";

/** A sprite `size` across in `colour`, its alpha at each distance from its middle (0 there, 1 at
 *  its edge) `alpha(d)`. */
function sprite([r, g, b]: Rgb, size: number, alpha: (d: number) => number): OffscreenCanvas {
  const out = new OffscreenCanvas(size, size);
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = d >= 1 ? 0 : Math.round(255 * Math.min(1, alpha(d)));
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** A light's glow: strong in its middle, a long soft fall round it, gone by its edge. */
export const haloSprite = (colour: Rgb) => sprite(colour, 96, (d) => (1 - d * d) ** 2 * (0.22 + 0.78 * Math.exp((-d * d) / 0.1)));

/** A light's core: small and bright. */
export const coreSprite = (colour: Rgb) => sprite(colour, 32, (d) => (1 - d * d) ** 2 * Math.exp((-d * d) / 0.09));

/** A burst's front: a soft ring. Nothing within it: a faint fill scaled up shows its alpha's steps
 *  as rings of its own. */
export const ringSprite = (colour: Rgb) => sprite(colour, 160, (d) => (1 - d * d) * Math.exp(-(((d - 0.8) / 0.07) ** 2)));
