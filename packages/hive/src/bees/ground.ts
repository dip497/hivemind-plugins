/**
 * Bees' ground, laid out in character cells from a fixed seed, so the same window shows the same
 * meadow each time: grass along the bottom, flowers standing out of it in a few colours, and a skep
 * (a straw hive) on a stand in one lower corner, with its door, its landing board and the places a
 * resting bee sits on it. Only the flowers move: they sway.
 */

/** The cells everything is drawn in, from the window's shorter side as Hivemind's own scenes do. */
export interface Grid { cw: number; ch: number; cols: number; rows: number }

export function gridOf(w: number, h: number): Grid {
  const cw = Math.min(13, Math.max(7, Math.round(Math.min(w, h) / 110)));
  const ch = Math.round(cw * 1.45);
  return { cw, ch, cols: Math.ceil(w / cw), rows: Math.ceil(h / ch) };
}

/** A small seeded generator (mulberry32), apart from Math.random, which the bees' flight keeps. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FlowerKind = "daisy" | "sun" | "tulip" | "lavender" | "clover" | "poppy" | "buttercup";
export const FLOWER_KINDS: readonly FlowerKind[] = ["daisy", "sun", "tulip", "lavender", "clover", "poppy", "buttercup"];

/** A cell of a flower's head, from the top of its stem: in its petals' colour or its heart's, on a
 *  block of it or bare. */
export interface HeadCell { dx: number; dy: number; glyph: string; heart: boolean; block: boolean }

/** Each kind's head, as rows of `<part><glyph>` (p a petal, h its heart; a capital on a block),
 *  its stem's top under the cell marked by the row holding `*`'s column; `..` is no cell. */
const HEADS: Record<FlowerKind, { rows: string[]; at: [number, number] }> = {
  // A daisy's petals round its heart.
  daisy: { rows: [".. p' ..", "p- H@ p-", ".. p, .."], at: [1, 1] },
  // A sunflower's rays.
  sun: { rows: ["p\\ p| p/", "p- H@ p-", "p/ .. p\\"], at: [1, 1] },
  // A tulip's cup, its petals' tips.
  tulip: { rows: ["pv pV pv", "P( P# P)"], at: [1, 1] },
  // A spike of lavender, its florets in whorls.
  lavender: { rows: ["p'", "P:", "P;", "P:"], at: [0, 3] },
  // A clover's round head.
  clover: { rows: ["P( H% P)"], at: [1, 0] },
  // A poppy, open, its dark heart.
  poppy: { rows: ["P/ P- P\\", "P( H@ P)"], at: [1, 1] },
  buttercup: { rows: ["H*"], at: [0, 0] },
};

export const HEAD_CELLS: Record<FlowerKind, HeadCell[]> = Object.fromEntries(FLOWER_KINDS.map((k) => {
  const { rows, at } = HEADS[k];
  const cells: HeadCell[] = [];
  rows.forEach((row, r) => row.trim().split(/\s+/).forEach((tok, c) => {
    if (tok === "..") return;
    const p = tok[0]!;
    cells.push({ dx: c - at[0], dy: r - at[1], glyph: tok.slice(1), heart: p.toLowerCase() === "h", block: p !== p.toLowerCase() });
  }));
  return [k, cells];
})) as Record<FlowerKind, HeadCell[]>;

export interface Flower {
  kind: FlowerKind;
  /** Its stem's column, the row it stands on, and how many cells tall it is to its head. */
  c: number;
  foot: number;
  height: number;
  /** Where in its sway it starts. */
  phase: number;
  /** A pair of leaves on its stem, so many cells up (0 for none). */
  leaves: number;
  /** Its colour, of the palette's flowers. */
  colour: number;
}

/** How many cells over from its foot a flower's `k`th cell up has swayed at time `t`. */
export function sway(f: Flower, k: number, t: number) {
  const lean = Math.pow(k / f.height, 1.5);
  return Math.round(1.25 * lean * Math.sin(t * 0.55 + f.phase) + 0.35 * lean * Math.sin(t * 1.7 + f.phase * 3));
}

/** One still cell of the grass or the hive: its glyph, its colour, on a block or bare. */
export interface GroundCell { c: number; r: number; glyph: string; colour: string; block: boolean }

/** The skep: where it stands in cells, and what a bee needs of it in pixels. */
export interface Hive {
  /** Its middle column, its top row, its width and height in cells, and its board's row. */
  cx: number;
  top: number;
  w: number;
  h: number;
  board: number;
  /** Which way the meadow is: 1 when it stands at the left, -1 at the right. */
  open: 1 | -1;
  /** Its outline in pixels, board and stand included. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The middle of its door, in pixels: where a bee goes in and comes out. */
  door: { x: number; y: number };
  /** Where a resting bee sits on it, in pixels, the first ones first. */
  perches: { x: number; y: number }[];
}

export interface Ground {
  grid: Grid;
  /** Low hills along the horizon, a far ridge and a near one, behind it all. */
  hills: GroundCell[];
  /** The grass behind the flowers (far, short and pale; middling), and the still part of the near
   *  grass in front of them, tall and darker. */
  back: GroundCell[];
  front: GroundCell[];
  /** The tops of the near grass's tall blades, which sway, each clump out of step. */
  tips: Tip[];
  /** The skep's cells. */
  hive: GroundCell[];
  flowers: Flower[];
  where: Hive;
}

/** The top of one tall blade of the near grass, which sways: its cells from `r` up, `c` its column
 *  there, a cell's character and colour each (the last its tip, or a seed head). */
export interface Tip {
  c: number;
  r: number;
  glyphs: string[];
  colours: string[];
  /** How far its tip swings, in cells, how fast, and where in its sway it starts: a clump's blades
   *  share a phase, near enough, and two clumps differ. */
  amp: number;
  rate: number;
  phase: number;
}

/** How many cells over a tip's `j`th cell (of `n`) has swayed at time `t`. */
export function tipSway(tip: Tip, j: number, t: number) {
  const n = tip.glyphs.length;
  return Math.round(tip.amp * Math.pow((j + 1) / n, 1.4) * Math.sin(t * tip.rate + tip.phase));
}

/** A blade's stem, its tip, and a seed head on a few. */
const STEMS = "|||!|l|i";
const TIPS = "',v^,'";
const SEEDS = "\u03c8Y;";

/** The ground for a window `w` by `h`, its hive in the lower corner `side` ("left" or "right"). */
export function layGround(w: number, h: number, side: "left" | "right"): Ground {
  const grid = gridOf(w, h);
  const { cols, rows, cw, ch } = grid;
  const rnd = prng(0xb33 + cols * 31 + rows);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const char = (s: string) => s[Math.floor(rnd() * s.length)]!;
  const bottom = rows - 1;

  // The skep, on a stand high enough to stand clear of the grass, its door facing the viewer.
  const hw = Math.max(13, Math.min(25, Math.round(cols * 0.105))) | 1;
  const hh = Math.max(8, Math.round(hw * 0.6));
  const half = (hw - 1) / 2;
  const cx = side === "left" ? Math.max(half + 3, Math.round(cols * 0.035) + half + 1) : Math.min(cols - half - 4, cols - Math.round(cols * 0.035) - half - 2);
  const lift = Math.max(3, Math.min(9, Math.round(rows * 0.09)));
  const board = bottom - lift;
  const top = board - hh;
  const hive: GroundCell[] = [];
  const widthAt = (j: number) => {
    // A dome: round at the top, its sides near upright below, drawn in a little at the foot.
    const y = (j + 0.5) / hh;
    const f = Math.pow(Math.sin(Math.min(1, y * 1.18) * Math.PI / 2), 0.55);
    return Math.round(half * f * (j === hh - 1 ? 0.94 : 1));
  };
  const doorAt = (c: number, j: number) => (j === hh - 1 && Math.abs(c - cx) <= 1) || (j === hh - 2 && c === cx);
  for (let j = 0; j < hh; j++) {
    const r = top + j;
    const wj = Math.max(1, widthAt(j));
    const grew = j === 0 ? wj : wj - widthAt(j - 1);
    for (let c = cx - wj; c <= cx + wj; c++) {
      if (doorAt(c, j)) { hive.push({ c, r, glyph: " ", colour: "door", block: true }); continue; }
      const left = c < cx;
      // Its outline bare, so the dome reads round: sloping where it widens, upright where it does not.
      if (c === cx - wj || c === cx + wj) {
        const glyph = j === 0 || grew > 1 ? (left ? "." : ".") : grew === 1 ? (left ? "/" : "\\") : left ? "(" : ")";
        hive.push({ c, r, glyph, colour: "rim", block: false });
        continue;
      }
      // Each coil a band, the bands told apart by tone; bound every few cells, set off row by row.
      const bind = (c - cx + j * 3 + 64) % 6 === 0;
      // Lit from the upper left: the far side in shade.
      const shade = (c - cx) / (wj + 1) > 0.55;
      hive.push({ c, r, glyph: j === 0 ? "-" : bind ? ":" : "=", colour: shade ? "shade" : j % 2 ? "coil" : "straw", block: true });
    }
  }
  // A knob of straw on its crown, the board it stands on and the stand's legs.
  hive.push({ c: cx, r: top - 1, glyph: "o", colour: "straw", block: false });
  for (let c = cx - half - 2; c <= cx + half + 2; c++) hive.push({ c, r: board, glyph: c === cx - half - 2 ? "[" : c === cx + half + 2 ? "]" : "=", colour: "board", block: true });
  for (const c of [cx - half + 1, cx + half - 1]) for (let r = board + 1; r <= bottom; r++) hive.push({ c, r, glyph: "|", colour: "board", block: false });

  // Two ridges of hills along the horizon, close to the sky in tone, the nearer one lower: blocks
  // with a grain of texture here and there.
  const hills: GroundCell[] = [];
  const p1 = rnd() * 9;
  const p2 = rnd() * 9;
  const ridge = (c: number, base: number, amp: number, f: number, ph: number) =>
    Math.max(1, Math.round(base + amp * (0.62 * Math.sin(c * f + ph) + 0.38 * Math.sin(c * f * 2.3 + ph * 1.7))));
  for (let c = 0; c < cols; c++) {
    const hf = ridge(c, rows * 0.13, rows * 0.045, 0.045, p1);
    const hn = ridge(c, rows * 0.08, rows * 0.03, 0.07, p2);
    for (let k = 0; k <= Math.max(hf, hn); k++) {
      hills.push({ c, r: bottom - k, glyph: rnd() < 0.05 ? char(".,'") : " ", colour: k <= hn ? "hillNear" : "hillFar", block: true });
    }
  }

  // The grass in three layers, every blade its own height and lean: far, short and pale, then a
  // middling one, both behind the flowers; then the near grass in front of them, tall and darker,
  // in clumps reaching up to a fifth or a quarter of the window, a seed head on some. Under the
  // hive's stand it is cropped short, so the skep stands clear. Each cell holds one character: the
  // nearest blade's, and none where a flower's stem or the hive's stand is.
  const back = new Map<number, GroundCell>();
  const front = new Map<number, GroundCell>();
  const tips: Tip[] = [];
  const key = (c: number, r: number) => r * cols + c;
  const underHive = (c: number) => Math.abs(c - cx) <= half + 2;
  /** One blade from row `bottom` up, `h` cells, leaning `lean` cells by its tip. The top `moving`
   *  cells sway, drawn each frame (`tips`); the rest go into `cells`. */
  const blade = (cells: Map<number, GroundCell>, c0: number, h: number, lean: number, colour: string, top: string, topColour: string, moving = 0, sway?: { amp: number; rate: number; phase: number }) => {
    let below = 0;
    const t: Tip | null = moving && sway ? { c: 0, r: 0, glyphs: [], colours: [], ...sway } : null;
    for (let k = 0; k < h; k++) {
      const off = Math.round(lean * Math.pow(k / Math.max(1, h - 1), 1.6));
      const glyph = k === h - 1 ? top : off > below ? "/" : off < below ? "\\" : char(STEMS);
      below = off;
      const cell = { c: c0 + off, r: bottom - k, glyph, colour: k === h - 1 ? topColour : colour, block: false };
      if (cell.c < 0 || cell.c >= cols) continue;
      if (t && k >= h - moving) {
        if (!t.glyphs.length) { t.c = cell.c; t.r = cell.r; }
        t.glyphs.push(glyph === "/" || glyph === "\\" ? "|" : glyph);
        t.colours.push(cell.colour);
      } else cells.set(key(cell.c, cell.r), cell);
    }
    if (t) tips.push(t);
  };
  const tallest = Math.max(7, Math.round(rows * 0.25));
  const a = rnd() * 9;
  for (let c = 0; c < cols; c++) {
    const far = Math.max(2, Math.round(3 + 1.6 * Math.sin(c * 0.07 + a) + rnd() * 2));
    blade(back, c, far, Math.round(rnd() * 2 - 1), "far", char(TIPS), "far");
    if (rnd() < 0.6) {
      const h = underHive(c) ? Math.min(lift - 1, 3) : 3 + Math.floor(rnd() * 6);
      const seed = rnd() < 0.15;
      blade(back, c, h, Math.round((rnd() - 0.5) * 2.4), "mid", seed ? char(SEEDS) : char(TIPS), seed ? "seed" : "mid");
    }
  }
  // The near grass's height along the meadow, for the flowers to stand above.
  const nearAt = new Array<number>(cols).fill(0);
  let c = 0;
  while (c < cols) {
    // A clump: a few blades together, much of a height, leaning the same way and swaying in step.
    const n = 2 + Math.floor(rnd() * 4);
    const tall = 5 + (tallest - 5) * (0.35 + 0.65 * rnd());
    const leanAll = (rnd() - 0.5) * 3;
    const sway = { amp: 0.8 + rnd() * 0.9, rate: 0.7 + rnd() * 0.6, phase: rnd() * Math.PI * 2 };
    for (let i = 0; i < n && c < cols; i++, c++) {
      if (rnd() < 0.2) continue;
      let h = Math.max(3, Math.round(tall * (0.65 + 0.35 * rnd())));
      if (underHive(c)) h = Math.min(h, lift - 1);
      const lean = Math.round(leanAll + (rnd() - 0.5) * 1.5);
      const seed = h > 6 && rnd() < 0.25;
      const moving = h >= 5 && !underHive(c) ? Math.min(3, h - 2) : 0;
      blade(front, c, h, lean, "near", seed ? char(SEEDS) : char(TIPS), seed ? "seed" : "tip", moving, { ...sway, phase: sway.phase + rnd() * 0.5 });
      nearAt[c] = Math.max(nearAt[c]!, h);
    }
    // Between clumps, short grass now and then.
    const gap = Math.floor(rnd() * 3);
    for (let i = 0; i < gap && c < cols; i++, c++) {
      const h = 2 + Math.floor(rnd() * 2);
      blade(front, c, h, 0, "near", char(TIPS), "tip");
      nearAt[c] = Math.max(nearAt[c]!, h);
    }
  }

  // Flowers among the grass in drifts: a few of one kind together, the tall ones further apart, a
  // gap now and then, each standing a little above the grass round it; none in front of the hive.
  const flowers: Flower[] = [];
  const clear = (c: number) => Math.abs(c - cx) > half + 4 && c > 1 && c < cols - 2;
  const grassBy = (c: number) => Math.max(nearAt[c - 1] ?? 0, nearAt[c] ?? 0, nearAt[c + 1] ?? 0);
  c = 2 + Math.floor(rnd() * 3);
  while (c < cols - 2) {
    if (!clear(c)) { c += 1; continue; }
    const kind = pick(FLOWER_KINDS);
    const low = kind === "clover" || kind === "buttercup";
    const colour = Math.floor(rnd() * 3);
    const n = 1 + Math.floor(rnd() * (low ? 4 : 2.6));
    const apart = low ? 2 : kind === "lavender" ? 2 : 4;
    let at = c;
    for (let i = 0; i < n && clear(at); i++) {
      const above = low ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 6);
      const height = Math.max(4, grassBy(at) + above);
      flowers.push({ kind, c: at, foot: bottom, height, phase: rnd() * Math.PI * 2, leaves: height > 4 && rnd() < 0.7 ? 1 + Math.floor(rnd() * Math.min(3, height - 3)) : 0, colour });
      at += apart + Math.floor(rnd() * 2);
    }
    c = at + 1 + Math.floor(rnd() * 4) + (rnd() < 0.12 ? 7 : 0);
  }

  // One character a cell: the near grass hides what is behind it there; a flower's stem, its
  // leaves and the hive keep their cells to themselves; a tip by a flower's stem is left out.
  for (const k of front.keys()) back.delete(k);
  const keep = (c: number, r: number) => { back.delete(key(c, r)); front.delete(key(c, r)); };
  for (const f of flowers) {
    for (let k = 0; k < f.height; k++) keep(f.c, f.foot - k);
    if (f.leaves) { keep(f.c - 1, f.foot - f.leaves); keep(f.c + 1, f.foot - f.leaves); }
  }
  for (const h of hive) keep(h.c, h.r);
  const stems = new Set(flowers.map((f) => f.c));
  const swaying = tips.filter((t) => !stems.has(t.c) && !stems.has(t.c - 1) && !stems.has(t.c + 1));

  const px = (cc: number) => cc * cw + cw / 2;
  const py = (rr: number) => rr * ch + ch / 2;
  // Where resting bees sit: on its landing board by the door, then up its sides and on its crown.
  const perches = [
    { c: cx - 4, r: board - 1 }, { c: cx + 5, r: board - 1 },
    { c: cx - Math.round(half * 0.45), r: top + 2 }, { c: cx + Math.round(half * 0.5), r: top + 3 },
    { c: cx - Math.round(half * 0.7), r: top + Math.round(hh * 0.6) }, { c: cx + Math.round(half * 0.72), r: top + Math.round(hh * 0.66) },
    { c: cx + 1, r: top - 1 }, { c: cx - Math.round(half * 0.2), r: top + Math.round(hh * 0.45) },
  ].map((p) => ({ x: px(p.c), y: py(p.r) }));
  const where: Hive = {
    cx, top, w: hw, h: hh, board, open: side === "left" ? 1 : -1,
    box: { x0: (cx - half - 2) * cw, y0: (top - 1) * ch, x1: (cx + half + 3) * cw, y1: rows * ch },
    door: { x: px(cx), y: py(board - 1) },
    perches,
  };
  return { grid, hills, back: [...back.values()], front: [...front.values()], tips: swaying, hive, flowers, where };
}

/** Where a flower's head is at time `t`, in pixels: where a bee lands on it. */
export function headOf(f: Flower, grid: Grid, t: number) {
  const off = sway(f, f.height, t);
  return { x: (f.c + off) * grid.cw + grid.cw / 2, y: (f.foot - f.height) * grid.ch + grid.ch / 2 };
}
