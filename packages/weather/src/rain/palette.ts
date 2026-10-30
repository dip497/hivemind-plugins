/**
 * Rain on Glass's colours. By night (a dark theme): a city's lights out of focus behind the glass,
 * street lamps in amber, shop signs in neon, cars' lights, windows, on dark blue; the drops on the
 * glass catch each light as a bright point of its colour. By day (a light theme): a grey-white
 * overcast street, its lights pale, and the drops dark on it as ink, with a white glint.
 *
 * Every light is drawn over the ground with plain alpha (never added), so the brightest the ground
 * behind the glass can be is the brightest of these colours: the panels' text is tested over each
 * of them (tests/weather.test.ts).
 */
import type { Oklch } from "../colour";
import type { CharLook } from "../chars";
import type { SkyLook } from "../sky";

/** The kinds of light in the city, by index: the layout (city.ts) names them so. */
export const LIGHTS = ["amber", "orange", "warm", "magenta", "cyan", "red", "green", "shade"] as const;
export type Light = (typeof LIGHTS)[number];

export interface RainPalette extends SkyLook {
  chars: CharLook;
  /** The buildings along the street, out of focus. */
  building: Oklch;
  /** Each light's colour at its middle, as seen through clear glass. */
  lights: Record<Light, Oklch>;
  /** How opaque a light is at most through clear glass, and through the condensation (softer,
   *  wider). */
  clearAlpha: number;
  fogAlpha: number;
  /** The condensation's haze over the view. */
  veil: { colour: Oklch; alpha: number };
  /** Its grains, the finest droplets, as characters. */
  grain: { colour: Oklch; alpha: number };
  /** A drop with nothing bright behind it, and the bright point a drop makes of each light. */
  drop: Oklch;
  lens: Record<Light, Oklch>;
  /** A glint on a drop as it runs, and a tap's ring. */
  glint: Oklch;
}

const dark: RainPalette = {
  chars: { under: 0.75, wash: 0, over: 1.45, bloom: 0.65, floor: 0.13, full: 0.42, dots: 0.42, ink: false, edge: 0.12 },
  sky: [[0.14, 0.035, 262], [0.155, 0.04, 268], [0.19, 0.045, 290], [0.17, 0.04, 300]],
  glow: { colour: [0.36, 0.08, 45], alpha: 0.28, x: 0.56, y: 1.05, r: 0.62 },
  grid: { colour: [1, 0, 0], alpha: 0.022 },
  building: [0.115, 0.028, 275],
  lights: {
    amber: [0.44, 0.11, 70],
    orange: [0.42, 0.13, 50],
    warm: [0.44, 0.045, 85],
    magenta: [0.41, 0.17, 345],
    cyan: [0.43, 0.09, 215],
    red: [0.4, 0.15, 25],
    green: [0.43, 0.11, 155],
    shade: [0.11, 0.03, 270],
  },
  clearAlpha: 0.9,
  fogAlpha: 0.66,
  veil: { colour: [0.36, 0.022, 255], alpha: 0.28 },
  grain: { colour: [0.62, 0.02, 250], alpha: 0.6 },
  drop: [0.58, 0.03, 250],
  lens: {
    amber: [0.88, 0.14, 75],
    orange: [0.82, 0.15, 55],
    warm: [0.93, 0.04, 90],
    magenta: [0.78, 0.19, 345],
    cyan: [0.85, 0.12, 210],
    red: [0.72, 0.18, 25],
    green: [0.85, 0.16, 150],
    shade: [0.5, 0.035, 250],
  },
  glint: [0.95, 0.02, 240],
};

const light: RainPalette = {
  chars: { under: 1, wash: 0.25, over: 0.55, bloom: 0.1, floor: 0.84, full: 0.9, dots: 0.9, ink: true, edge: 0.14 },
  sky: [[0.915, 0.008, 250], [0.895, 0.01, 245], [0.875, 0.012, 240], [0.86, 0.014, 235]],
  glow: { colour: [1, 0, 0], alpha: 0.32, x: 0.35, y: -0.15, r: 0.75 },
  grid: { colour: [0.3, 0.02, 250], alpha: 0.03 },
  building: [0.8, 0.014, 245],
  lights: {
    amber: [0.88, 0.085, 78],
    orange: [0.86, 0.09, 58],
    warm: [0.95, 0.03, 90],
    magenta: [0.84, 0.085, 350],
    cyan: [0.85, 0.065, 215],
    red: [0.83, 0.1, 25],
    green: [0.85, 0.075, 150],
    shade: [0.79, 0.014, 250],
  },
  clearAlpha: 0.85,
  fogAlpha: 0.45,
  veil: { colour: [0.975, 0.004, 250], alpha: 0.58 },
  grain: { colour: [0.62, 0.012, 250], alpha: 0.45 },
  drop: [0.4, 0.02, 250],
  lens: {
    amber: [0.55, 0.11, 70],
    orange: [0.53, 0.12, 50],
    warm: [0.5, 0.04, 80],
    magenta: [0.5, 0.13, 345],
    cyan: [0.5, 0.08, 220],
    red: [0.5, 0.13, 25],
    green: [0.5, 0.1, 150],
    shade: [0.46, 0.02, 250],
  },
  glint: [0.995, 0.005, 240],
};

export const RAIN_PALETTE = { dark, light };
