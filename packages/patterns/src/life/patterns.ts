/**
 * Known shapes of the Game of Life, as cells: what a click drops (a glider, a small spaceship, an
 * R-pentomino) and what the board sows where it has gone quiet (long-lived seeds that grow into a
 * few minutes of life, and a fleet of gliders).
 */

/** A shape's live cells, `[column, row]` from its top left. */
export type Shape = readonly (readonly [number, number])[];

/** A shape drawn as rows of `O` (alive) and `.` (dead). */
function shape(rows: string): Shape {
  const cells: [number, number][] = [];
  rows.trim().split("\n").forEach((line, r) => [...line.trim()].forEach((ch, c) => { if (ch === "O") cells.push([c, r]); }));
  return cells;
}

/** Moves a cell a quarter of the way round a diagonal every four generations. */
export const GLIDER = shape(`
.O.
..O
OOO`);

/** The lightweight spaceship: flies straight, two cells every four generations. */
export const SPACESHIP = shape(`
.O..O
O....
O...O
OOOO.`);

/** Five cells that churn for over a thousand generations before they settle. */
export const R_PENTOMINO = shape(`
.OO
OO.
.O.`);

/** Seven cells that grow for over five thousand generations. */
export const ACORN = shape(`
.O.....
...O...
OO..OOO`);

export const B_HEPTOMINO = shape(`
O.OO
OOO.
.O..`);

export const PI_HEPTOMINO = shape(`
OOO
O.O
O.O`);

/** Four gliders setting off from the corners of a square, each out along its own diagonal: the
 *  glider above flies down and right, so it sits in the bottom right corner, and so on round. */
export const FLEET = [
  ...GLIDER.map(([c, r]) => [c + 8, r + 8] as const),
  ...GLIDER.map(([c, r]) => [2 - c, 2 - r] as const),
  ...GLIDER.map(([c, r]) => [2 - r, c + 8] as const),
  ...GLIDER.map(([c, r]) => [r + 8, 2 - c] as const),
] as Shape;

/** What a click drops, one at random. */
export const DROPS = { glider: GLIDER, spaceship: SPACESHIP, "r-pentomino": R_PENTOMINO } as const;

/** What a quiet part of the board is sown with (`null`: a patch of noise), and how often each. */
export const SEEDS: readonly { shape: Shape | null; weight: number }[] = [
  { shape: R_PENTOMINO, weight: 3 },
  { shape: B_HEPTOMINO, weight: 2 },
  { shape: PI_HEPTOMINO, weight: 2 },
  { shape: ACORN, weight: 1 },
  { shape: FLEET, weight: 1 },
  { shape: null, weight: 3 },
];

/** `s` turned a quarter `turns` times and mirrored when `flip`, centred on its middle cell. */
export function orient(s: Shape, turns: number, flip: boolean): [number, number][] {
  let cells = s.map(([c, r]) => [flip ? -c : c, r] as [number, number]);
  for (let k = 0; k < (turns & 3); k++) cells = cells.map(([c, r]) => [-r, c]);
  const [minC, maxC] = [Math.min(...cells.map((p) => p[0])), Math.max(...cells.map((p) => p[0]))];
  const [minR, maxR] = [Math.min(...cells.map((p) => p[1])), Math.max(...cells.map((p) => p[1]))];
  const [mc, mr] = [Math.floor((minC + maxC) / 2), Math.floor((minR + maxR) / 2)];
  return cells.map(([c, r]) => [c - mc, r - mr]);
}
