/**
 * Skyline's colours: the picture's, before it is turned into characters (ascii.ts), and how it is
 * turned. At night: a deep blue-black sky warming to violet and rose over the roofs where the
 * city's light rises, a moon in its halo, the buildings dark against it in their materials (the
 * back row hazy, each side wall in shade), warm and cool windows, lamps, headlights. By day, late in
 * the afternoon: a clear blue sky warming to gold over the roofs, a low sun, white clouds; buildings
 * in warm concrete, sand stone, terracotta brick and blue glass, sunlit on their faces and in cool
 * shade on their side walls, the glass holding the sky, the back row blue with distance; painted
 * crisp, in mid-tones, with the windows set as characters over them. Every wide stretch of it is
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
  /** Each material's face, the back row's, the shade on a side wall (a share of the face's light,
   *  tinted toward the shadow's colour), and the haze over the back row. */
  face: Record<Material, Oklch>;
  back: Oklch;
  shade: number;
  shadow: { colour: Oklch; mix: number };
  haze: { colour: Oklch; alpha: number };
  /** What each window state shows (city.ts's WindowState); the back row's mixed into its face. At
   *  night a pane of light in the picture; by day, `panes`, a character and its ink, on a facade
   *  painted flat. */
  windows: [Oklch, Oklch, Oklch, Oklch, Oklch];
  panes: [string, Oklch][] | null;
  /** Glass by day holds the sky: its top and its foot, and the sky's light slanting across it. */
  glass: [Oklch, Oklch] | null;
  reflection: Oklch | null;
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
  style: Omit<AsciiStyle, "paper" | "rim"> & { paper: Oklch; rim: Oklch };
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
  shadow: { colour: [0, 0, 0], mix: 0 },
  haze: { colour: [0.34, 0.08, 330], alpha: 0.3 },
  windows: [[0.17, 0.025, 258], [0.9, 0.14, 82], [0.82, 0.15, 62], [0.92, 0.05, 222], [0.66, 0.11, 52]],
  panes: null,
  glass: null,
  reflection: null,
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
  style: { dark: true, ink: 1.45, ground: 0.55, soft: 1.5, paper: [0, 0, 0], bloom: 1.3, bloomFrom: 0.28, edge: 0.3, edgeInk: 2.1, rim: [0.46, 0.05, 290], from: 0.2, to: 0.75 },
};

const day: SkylinePalette = {
  sky: [[0.78, 0.1, 243], [0.8, 0.09, 240], [0.835, 0.07, 235], [0.87, 0.05, 220], [0.89, 0.065, 68]],
  glow: { colour: [0.92, 0.085, 68], alpha: 0.5 },
  light: { disc: [0.995, 0.03, 95], halo: [0.95, 0.09, 82], at: [0.13, 0.19], size: 0.04 },
  star: [0.6, 0.02, 90],
  stars: false,
  face: { grey: [0.83, 0.03, 72], brick: [0.78, 0.1, 40], glass: [0.82, 0.06, 232], stone: [0.88, 0.07, 82] },
  back: [0.81, 0.045, 250],
  shade: 0.74,
  shadow: { colour: [0.52, 0.08, 268], mix: 0.35 },
  haze: { colour: [0.88, 0.04, 240], alpha: 0.12 },
  windows: [[0.62, 0.07, 235], [0.4, 0.03, 255], [0.95, 0.02, 220], [0.6, 0.04, 70], [0.86, 0.1, 85]],
  panes: [["#", [0.56, 0.08, 245]], ["#", [0.4, 0.045, 258]], ["=", [0.52, 0.07, 52]], ["#", [0.68, 0.08, 228]], ["=", [0.56, 0.035, 250]]],
  glass: [[0.88, 0.045, 222], [0.785, 0.085, 242]],
  reflection: [0.93, 0.035, 215],
  backMix: 0.6,
  looker: [0.88, 0.12, 80],
  lit: false,
  pavement: [0.88, 0.025, 78],
  road: [0.78, 0.01, 255],
  mark: [0.97, 0.01, 95],
  lamp: [0.45, 0.015, 260],
  paints: [[0.58, 0.18, 27], [0.52, 0.13, 250], [0.93, 0.005, 250], [0.55, 0.12, 150], [0.35, 0.02, 260], [0.6, 0.13, 320]],
  taxi: [0.82, 0.16, 92],
  head: [0.97, 0.04, 95],
  tail: [0.55, 0.2, 25],
  beacon: [0.58, 0.22, 27],
  strobe: [0.99, 0.005, 90],
  plane: [0.42, 0.02, 250],
  cloud: [[0.995, 0.006, 90], [0.88, 0.03, 255]],
  fireworks: [[0.7, 0.17, 70], [0.56, 0.23, 27], [0.58, 0.19, 150], [0.5, 0.19, 255], [0.52, 0.22, 320], [0.6, 0.13, 200]],
  style: { dark: false, ink: 0.6, ground: 0, soft: 0, paper: [0.985, 0.006, 90], bloom: 0, bloomFrom: 0, edge: null, edgeInk: 0.36, rim: [0.34, 0.03, 250], from: 0.36, to: 0.8 },
};

export const SKYLINE_PALETTE = { dark: night, light: day };
