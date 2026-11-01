/**
 * Fireflies' sky, painted once per size and look into the backdrop: a gradient from the top of the
 * window down, dark (or light) over most of it and gathering to a glow along the horizon, the glow
 * rising a little higher over the middle of the meadow, a dome; and the stars, steady, from a fixed
 * seed, most faint and a few bright, thinning toward the horizon, where there is more air to see
 * them through. The glow is the horizon's own colour, so the sky is nowhere lighter (or darker) than
 * its stops, which the palette test measures.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { prng, TAU } from "../math";
import type { FireflyPalette } from "./palette";

/** How far down the window the stars come, as a share of its height. */
const STARS_TO = 0.7;

/** The sky's colour at `v` of the way down the window. */
export function skyAt(p: FireflyPalette, v: number): Rgb {
  const at = p.skyAt;
  const last = p.water.length - 1;
  if (v <= at[0]!) return rgbOf(p.water[0]!);
  for (let i = 1; i <= last; i++) {
    if (v <= at[i]!) return mix(rgbOf(p.water[i - 1]!), rgbOf(p.water[i]!), (v - at[i - 1]!) / (at[i]! - at[i - 1]!));
  }
  return rgbOf(p.water[last]!);
}

export function paintSky(g: Draw2D, W: number, H: number, dpr: number, p: FireflyPalette, seed: number) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  const grad = g.createLinearGradient(0, 0, 0, H);
  p.water.forEach((c, i) => grad.addColorStop(p.skyAt[i]!, css(rgbOf(c))));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // The glow's dome: wide and low, the horizon's colour fading out.
  const horizon = rgbOf(p.water[p.water.length - 1]!);
  const rx = W * 0.62;
  const ry = H * 0.34;
  g.setTransform(dpr, 0, 0, (dpr * ry) / rx, dpr * W * 0.5, dpr * H);
  const dome = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  dome.addColorStop(0, cssAlpha(horizon, 0.7));
  dome.addColorStop(0.45, cssAlpha(horizon, 0.3));
  dome.addColorStop(1, cssAlpha(horizon, 0));
  g.fillStyle = dome;
  g.fillRect(-rx, -rx, rx * 2, rx);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (p.stars > 0) paintStars(g, W, H, dpr, p, seed);
}

/** The stars: a few to each 15,000 px² of sky, each a soft point on a device pixel, the brightest
 *  with a faint glow round it; white, some a little blue, some a little warm. */
function paintStars(g: Draw2D, W: number, H: number, dpr: number, p: FireflyPalette, seed: number) {
  const rnd = prng(seed);
  const n = Math.round((W * H) / 15000);
  const [L, C, h] = p.star;
  for (let i = 0; i < n; i++) {
    const x = (Math.round(rnd() * W * dpr) + 0.5) / dpr;
    const v = STARS_TO * Math.pow(rnd(), 1.35);
    const y = (Math.round(v * H * dpr) + 0.5) / dpr;
    const bright = Math.pow(rnd(), 2.8);
    const hue = rnd();
    const tint = rgbOf(hue < 0.25 ? [L, C + 0.03, 250] : hue > 0.8 ? [L - 0.03, C + 0.04, 75] : [L, C, h]);
    const sky = skyAt(p, v);
    // Fainter toward the horizon.
    const level = p.stars * (0.2 + 0.8 * bright) * (1 - 0.55 * (v / STARS_TO));
    const colour = mix(sky, tint, level);
    const r = (0.42 + 0.7 * bright) * Math.max(1, 1.6 / dpr);
    if (bright > 0.55) {
      const glow = g.createRadialGradient(x, y, 0, x, y, r * 5);
      glow.addColorStop(0, cssAlpha(tint, 0.22 * level));
      glow.addColorStop(1, cssAlpha(tint, 0));
      g.fillStyle = glow;
      g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    }
    g.fillStyle = css(colour);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
}
