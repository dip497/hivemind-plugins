/**
 * Glyph Rain's colours, in OKLCH. At night, a deep indigo sky and rain that runs from a pale cyan
 * head through teal and blue into violet as its tail fades; the far columns dimmer. By day, ink on
 * paper under a cool sky warming toward the ground: cobalt heads, indigo tails fading through slate
 * into the page; the far columns paler.
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
    ground: [[0.9, 0.03, 245], [0.95, 0.016, 90], [0.88, 0.04, 76]],
    glow: { colour: [0.99, 0.02, 92], alpha: 0.55 },
    head: [0.36, 0.17, 264],
    tail: [[0.27, 0.1, 270], [0.42, 0.09, 255], [0.66, 0.06, 240]],
    haze: [0.93, 0.022, 82],
  },
};
