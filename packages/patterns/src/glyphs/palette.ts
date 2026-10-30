/**
 * Glyph Rain's colours, in OKLCH. At night, a deep indigo sky and rain that runs from a pale cyan
 * head through teal and blue into violet as its tail fades; the far columns dimmer. By day, ink on
 * paper: dark heads, and tails fading through grey into the page; the far columns paler.
 */
import type { Oklch } from "../colour";

export interface RainPalette {
  /** The sky, top to bottom. */
  ground: Oklch[];
  /** A soft light low in the middle of the sky, and how strong (0 … 1). */
  glow: { colour: Oklch; alpha: number };
  /** A stream's head. */
  head: Oklch;
  /** Its tail, from just behind the head, through its middle, to its end, where it fades into the sky. */
  tail: [Oklch, Oklch, Oklch];
  /** The haze between the depths. */
  haze: Oklch;
}

export const RAIN_PALETTE: { dark: RainPalette; light: RainPalette } = {
  dark: {
    ground: [[0.135, 0.03, 292], [0.14, 0.032, 278], [0.148, 0.034, 255]],
    glow: { colour: [0.3, 0.07, 230], alpha: 0.18 },
    head: [0.95, 0.045, 192],
    tail: [[0.8, 0.12, 186], [0.6, 0.13, 250], [0.42, 0.14, 300]],
    haze: [0.2, 0.045, 268],
  },
  light: {
    ground: [[0.972, 0.008, 95], [0.965, 0.01, 90], [0.955, 0.013, 84]],
    glow: { colour: [0.99, 0.01, 95], alpha: 0.5 },
    head: [0.2, 0.035, 265],
    tail: [[0.36, 0.03, 262], [0.56, 0.018, 255], [0.78, 0.01, 250]],
    haze: [0.955, 0.01, 90],
  },
};
