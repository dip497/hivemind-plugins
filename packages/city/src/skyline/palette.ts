/**
 * Skyline's colours: the picture's, before it is turned into characters (ascii.ts), and how it is
 * turned. At night: a deep blue-black sky warming to violet and rose over the roofs where the
 * city's light rises, a moon in its halo, the buildings dark against it in their materials (the
 * back row hazy, each side wall in shade), warm and cool windows, lamps, headlights. By day: a pale
 * sky and a low sun, white clouds, buildings in soft greys, cream stone and brick, sunlit on one
 * side, their glass catching the sky, drawn as ink on paper. The ground under the characters is
 * kept dark (or light) enough for the frosted panels' text over it (tests/city.test.ts).
 */
import type { AsciiStyle } from "../ascii";
import type { Oklch } from "../colour";
import type { Material } from "./city";

export interface SkylinePalette {
  /** The sky, top to the street, evenly spaced; the glow of the city (or of the haze) over the roofs. */
  sky: Oklch[];
  glow: { colour: Oklch; alpha: number };
  /** The moon (by night) or the sun (by day): its disc and its halo; where it is, as shares. */
  light: { disc: Oklch; halo: Oklch; at: [number, number]; size: number };
  star: Oklch;
  stars: boolean;
  /** Each material's face, the back row's, the shade on a side wall (a share of the face's light),
   *  and the haze over the back row. */
  face: Record<Material, Oklch>;
  back: Oklch;
  shade: number;
  haze: { colour: Oklch; alpha: number };
  /** What each window state shows (city.ts's WindowState); the back row's mixed into its face. */
  windows: [Oklch, Oklch, Oklch, Oklch, Oklch];
  backMix: number;
  looker: Oklch;
  /** Lights glow round them (at night). */
  lit: boolean;
  pavement: Oklch;
  road: Oklch;
  mark: Oklch;
  lamp: Oklch;
  paints: Oklch[];
  taxi: Oklch;
  head: Oklch;
  tail: Oklch;
  beacon: Oklch;
  strobe: Oklch;
  plane: Oklch;
  cloud: [Oklch, Oklch] | null;
  fireworks: Oklch[];
  /** How the picture is turned into characters. */
  style: Omit<AsciiStyle, "paper"> & { paper: Oklch };
}

const night: SkylinePalette = {
  sky: [[0.12, 0.035, 266], [0.15, 0.045, 272], [0.2, 0.065, 292], [0.27, 0.085, 322], [0.34, 0.09, 345]],
  glow: { colour: [0.5, 0.12, 40], alpha: 0.32 },
  light: { disc: [0.97, 0.035, 95], halo: [0.62, 0.05, 250], at: [0.82, 0.14], size: 0.05 },
  star: [0.92, 0.02, 90],
  stars: true,
  face: { grey: [0.2, 0.014, 262], brick: [0.23, 0.045, 32], glass: [0.2, 0.035, 245], stone: [0.24, 0.016, 75] },
  back: [0.27, 0.06, 295],
  shade: 0.62,
  haze: { colour: [0.34, 0.08, 330], alpha: 0.3 },
  windows: [[0.17, 0.025, 258], [0.9, 0.14, 82], [0.82, 0.15, 62], [0.92, 0.05, 222], [0.66, 0.11, 52]],
  backMix: 0.45,
  looker: [0.95, 0.15, 85],
  lit: true,
  pavement: [0.22, 0.012, 262],
  road: [0.12, 0.01, 262],
  mark: [0.5, 0.03, 90],
  lamp: [0.92, 0.13, 80],
  paints: [[0.4, 0.09, 25], [0.38, 0.07, 250], [0.45, 0.02, 260], [0.38, 0.07, 150], [0.5, 0.01, 90], [0.34, 0.05, 300]],
  taxi: [0.6, 0.12, 90],
  head: [1, 0.05, 95],
  tail: [0.66, 0.24, 25],
  beacon: [0.68, 0.24, 27],
  strobe: [1, 0, 0],
  plane: [0.45, 0.02, 260],
  cloud: null,
  fireworks: [[0.9, 0.16, 85], [0.74, 0.23, 25], [0.84, 0.21, 145], [0.76, 0.16, 245], [0.76, 0.21, 320], [0.98, 0.02, 95]],
  style: { dark: true, ink: 1.5, ground: 0.5, paper: [0, 0, 0], bloom: 1.25, bloomFrom: 0.3, edge: 0.3, edgeInk: 2.3, from: 0.05, to: 0.8 },
};

const day: SkylinePalette = {
  sky: [[0.8, 0.075, 240], [0.86, 0.06, 236], [0.91, 0.04, 228], [0.95, 0.025, 210], [0.97, 0.02, 90]],
  glow: { colour: [0.99, 0.03, 90], alpha: 0.5 },
  light: { disc: [1, 0.03, 95], halo: [0.97, 0.06, 90], at: [0.16, 0.12], size: 0.045 },
  star: [0.6, 0.02, 90],
  stars: false,
  face: { grey: [0.76, 0.012, 250], brick: [0.64, 0.09, 38], glass: [0.74, 0.045, 232], stone: [0.84, 0.03, 85] },
  back: [0.85, 0.03, 238],
  shade: 0.82,
  haze: { colour: [0.93, 0.025, 230], alpha: 0.35 },
  windows: [[0.88, 0.04, 228], [0.45, 0.025, 250], [0.97, 0.02, 220], [0.8, 0.025, 80], [0.9, 0.09, 85]],
  backMix: 0.5,
  looker: [0.88, 0.12, 80],
  lit: false,
  pavement: [0.84, 0.01, 80],
  road: [0.66, 0.006, 260],
  mark: [0.97, 0.01, 95],
  lamp: [0.86, 0.05, 90],
  paints: [[0.58, 0.18, 27], [0.52, 0.13, 250], [0.9, 0.005, 250], [0.55, 0.12, 150], [0.35, 0.02, 260], [0.6, 0.13, 320]],
  taxi: [0.82, 0.16, 92],
  head: [0.97, 0.04, 95],
  tail: [0.55, 0.2, 25],
  beacon: [0.58, 0.22, 27],
  strobe: [0.99, 0.005, 90],
  plane: [0.4, 0.02, 250],
  cloud: [[0.995, 0.005, 240], [0.88, 0.02, 250]],
  fireworks: [[0.7, 0.17, 70], [0.56, 0.23, 27], [0.58, 0.19, 150], [0.5, 0.19, 255], [0.52, 0.22, 320], [0.6, 0.13, 200]],
  style: { dark: false, ink: 0.42, ground: 0.45, paper: [0.985, 0.006, 90], bloom: 0.6, bloomFrom: 0, edge: 0.3, edgeInk: 0.38, from: 0.07, to: 0.62 },
};

export const SKYLINE_PALETTE = { dark: night, light: day };
