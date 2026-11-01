/**
 * Shoal's sea bed: a sand floor along the bottom with rocks on it, branching coral, sea fans, tube
 * sponges and brain coral, meadows of seagrass, and kelp rising well above it all. What is solid
 * (sand, rock, a brain coral, a sponge) is cells as the sharks are, blocks with their grain on
 * them, lit from above, their tops shaped in the cells' parts; what is thin in life (a coral's
 * branches, a fan's rays, seagrass, kelp) is drawn as lines from cell to cell. Laid out once per
 * grid from a fixed seed, so a window shows the same reef each time; the seagrass and the kelp are
 * the only parts that move, swaying in the current from the root, their tips the most.
 */
import type { Blade } from "../blades";
import { WHOLE } from "../cells";
import { clamp, prng } from "../math";

/** The bed's colours, by the name a cell gives. */
export type BedColour = "sand" | "rock" | "coral0" | "coral1" | "coral2" | "fan" | "brain";

/** One still cell of the bed: its glyph and its colour, on a block of that colour or bare. A
 *  block covers the cell's `parts` (cells.ts), and is lit `shade` (0 … 1). A cell of a coral's
 *  branch or a fan's ray is a line to it `from` the cell it grew out of, `thick` (0 … 1) as it is
 *  near its root; at a branch's `tip`, its polyp. A sponge's top is its `mouth`. */
export interface BedCell {
  c: number;
  r: number;
  glyph: string;
  colour: BedColour;
  block: boolean;
  parts: number;
  shade: number;
  from?: { c: number; r: number };
  thick?: number;
  tip?: boolean;
  mouth?: boolean;
}

/** The parts of a cell its block covers when what it is part of rises `left` and `right` cells
 *  (over its two halves) above the bottom of the column it stands in, the cell `j` cells up. */
export function partsUnder(left: number, right: number, j: number) {
  let mask = 0;
  for (let row = 0; row < 3; row++) {
    // The height of this row of parts' middle above the column's bottom.
    const h = j + (2.5 - row) / 3;
    if (h < left) mask |= 1 << (row * 2);
    if (h < right) mask |= 2 << (row * 2);
  }
  return mask;
}

/** A blade of seagrass, its colour (0–2), or a strand of kelp. */
export interface Weed extends Blade {
  colour: number;
  kelp: boolean;
}

export class Seabed {
  cells: BedCell[] = [];
  weeds: Weed[] = [];

  build(cols: number, rows: number) {
    const rnd = prng(0x5eabed + cols * 131 + rows);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const bottom = rows - 1;
    const band = Math.max(6, Math.min(15, Math.round(rows * 0.17)));
    /** One cell a place: the last laid wins, so coral stands in front of the sand behind it. */
    const at = new Map<number, BedCell>();
    const put = (c: number, r: number, glyph: string, colour: BedColour, block = true, more: Partial<BedCell> = {}) => {
      if (c < 0 || c >= cols || r < 0 || r > bottom) return;
      at.set(r * cols + c, { c, r, glyph, colour, block, parts: WHOLE, shade: 0.6, ...more });
    };
    /** Where the bed's top is in each column: what stands on it stands here. */
    const ground = Array.from({ length: cols }, () => bottom);
    const stand = (c: number) => ground[Math.max(0, Math.min(cols - 1, c))]! - 1;

    // The sand: the bottom row whole, low dunes over it, their tops in the cells' parts. Grains
    // here and there, fewer up the dunes.
    const d1 = rnd() * 9;
    const d2 = rnd() * 9;
    const duneAt = (x: number) => 1 + clamp(0.55 + 0.55 * (Math.sin(x * 0.11 + d1) + 0.6 * Math.sin(x * 0.29 + d2)), 0, 1.15);
    for (let c = 0; c < cols; c++) {
      const left = duneAt(c + 0.25);
      const right = duneAt(c + 0.75);
      put(c, bottom, rnd() < 0.3 ? pick([".", ",", "."]) : " ", "sand", true, { shade: 0.42 });
      const top = partsUnder(left, right, 1);
      if (top) put(c, bottom - 1, rnd() < 0.12 ? "." : " ", "sand", true, { parts: top, shade: 0.62 });
      if ((top & 3) === 3) ground[c] = bottom - 1;
    }

    /** A low mound `w` wide and up to `h` tall on the bed at `c0`, cell by cell: its round top in
     *  the cells' parts, each cell lit from above and the left (`parts`, `shade`). */
    const mound = (c0: number, w: number, h: number, cell: (i: number, j: number, more: Partial<BedCell>) => void) => {
      const height = (x: number) => h * Math.sqrt(Math.max(0, 1 - 4 * x * x)) + 0.35;
      for (let i = 0; i < w; i++) {
        const left = Math.max(0.4, height((i + 0.25) / w - 0.5));
        const right = Math.max(0.4, height((i + 0.75) / w - 0.5));
        const x = (i + 0.5) / w - 0.5;
        const tall = Math.max(1, Math.ceil(Math.max(left, right) - 1 / 6));
        for (let j = 0; j < tall; j++) cell(i, j, { parts: partsUnder(left, right, j), shade: clamp(0.3 + (0.45 * (j + 0.5)) / Math.max(left, right) - 0.35 * x, 0, 1) });
        ground[c0 + i] = Math.min(ground[c0 + i]!, stand(c0 + i) + 1 - tall);
      }
    };
    // The reef in slots along the bed, one thing to a slot, so each stands apart with sand and
    // seagrass between: a slot is some eight cells, and one in nine is left open.
    const slot = 8;
    const slots = Math.max(3, Math.floor(cols / slot));
    const width = cols / slots;
    const kinds = ["branch", "branch", "fan", "brain", "sponge", "rock", "branch", "open"] as const;
    const colours = ["coral0", "coral2", "coral0", "coral1", "coral2"] as const;
    let branches = 0;
    for (let n = 0; n < slots; n++) {
      const kind = rnd() < 1 / 9 ? "open" : pick(kinds);
      const mid = Math.round((n + 0.5) * width + (rnd() - 0.5) * width * 0.3);
      const most = Math.max(4, Math.floor(width) - 2);
      if (kind === "rock") {
        const w = Math.min(most, 4 + Math.floor(rnd() * 5));
        const c0 = mid - (w >> 1);
        mound(c0, w, 1 + Math.floor(rnd() * 2.6), (i, j, more) => put(c0 + i, stand(c0 + i) - j, pick([".", ":", " ", " "]), "rock", true, more));
      } else if (kind === "brain") {
        const w = Math.min(most + 2, 6 + Math.floor(rnd() * 5));
        const c0 = mid - (w >> 1);
        // Its grooves wind over it: rows of waves, each row a step along from the last.
        mound(c0, w, 2 + Math.floor(rnd() * 2.5), (i, j, more) => put(c0 + i, stand(c0 + i) - j, (i + j) % 3 === 2 ? " " : "~", "brain", true, more));
      } else if (kind === "sponge") {
        // Tubes side by side, open at the top: lit down their left side.
        const k = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < k; i++) {
          const c = mid - (k >> 1) + i;
          const tall = 2 + Math.floor(rnd() * Math.min(5, band - 4));
          const base = stand(c);
          const colour = pick(["coral1", "coral1", "coral2"] as const);
          for (let j = 0; j < tall; j++) {
            const top = j === tall - 1;
            put(c, base - j, top ? " " : j % 2 ? ":" : " ", colour, true, { parts: top ? 60 : WHOLE, shade: 0.4 + (0.3 * j) / tall, mouth: top });
          }
        }
      } else if (kind === "fan") {
        // A round net spread over a short stem: rays from the stem's top out to its rim, and the
        // net's crossings between them.
        const h = Math.max(5, Math.min(band - 1, 5 + Math.floor(rnd() * (band - 4))));
        const base = stand(mid);
        put(mid, base, " ", "fan", false, { from: { c: mid, r: base + 1 }, thick: 1 });
        const cy = base - 1 - (h - 1) * 0.55;
        const ry = (h - 1) * 0.55;
        const rx = Math.min(most / 2, ry * 1.25);
        for (let r = base - h + 1; r < base; r++) {
          for (let c = mid - Math.ceil(rx); c <= mid + Math.ceil(rx); c++) {
            const d = ((c - mid) / (rx + 0.5)) ** 2 + ((r - cy) / (ry + 0.5)) ** 2;
            if (d > 1 || r > base - 1) continue;
            if (d > 0.62) {
              // A ray to every other cell of the rim.
              if ((c + r) % 2 === 0) put(c, r, " ", "fan", false, { from: { c: mid, r: base }, thick: 0 });
              else put(c, r, ".", "fan", false);
            } else put(c, r, (c + r) % 2 === 0 ? "+" : " ", "fan", false);
          }
        }
      } else if (kind === "branch") {
        // A trunk that forks as it grows, a polyp at the end of each branch.
        const colour = colours[branches++ % colours.length]!;
        const tall = Math.max(4, Math.min(band, 4 + Math.floor(rnd() * (band - 3))));
        const lo = mid - (most >> 1);
        const hi = mid + (most >> 1);
        // Each cell of a branch is a line to it from the cell it grew out of, thinner as it climbs.
        const grow = (c: number, r: number, dir: number, left: number, forks: number, from: { c: number; r: number }) => {
          for (let n = 0; n < left; n++) {
            if (c <= lo || c >= hi) dir = c <= lo ? 1 : -1;
            const thick = clamp((stand(mid) - r) / tall, 0, 1);
            if (n === left - 1) {
              put(c, r, pick(["o", "*", "o"]), colour, false, { from, thick: 1 - thick, tip: true });
              return;
            }
            if (forks > 0 && n > 0 && rnd() < 0.5) {
              put(c, r, " ", colour, false, { from, thick: 1 - thick });
              grow(c - 1, r - 1, -1, left - n - 1, forks - 1, { c, r });
              grow(c + 1, r - 1, 1, left - n - 1 - (rnd() < 0.35 ? 1 : 0), forks - 1, { c, r });
              return;
            }
            put(c, r, " ", colour, false, { from, thick: 1 - thick });
            from = { c, r };
            r -= 1;
            c += dir;
            if (rnd() < 0.32) dir = dir === 0 ? (rnd() < 0.5 ? -1 : 1) : 0;
          }
        };
        grow(mid, stand(mid), 0, tall, 4, { c: mid, r: stand(mid) + 1 });
      }
    }

    // Between them, here and there on the sand: a pebble, a shell, a starfish.
    for (let c = 1; c < cols - 1; c++) {
      if (at.has(stand(c) * cols + c) || rnd() > 0.09) continue;
      const what = rnd();
      if (what < 0.5) put(c, stand(c), " ", "rock", true, { parts: what < 0.25 ? 48 : 16, shade: 0.5 });
      else put(c, stand(c), what < 0.8 ? "*" : "@", what < 0.8 ? "coral1" : "sand", false);
    }

    this.cells = [...at.values()];

    this.weeds = [];
    // Seagrass in meadows: a clump of blades over a stretch of the bed, of different heights, each
    // swaying a little out of step with the next, none more than a few cells above the reef.
    for (let m = Math.max(3, Math.round(cols / 30)); m > 0; m--) {
      const c0 = Math.floor(rnd() * cols);
      const span = 6 + Math.floor(rnd() * 10);
      const phase = rnd() * Math.PI * 2;
      for (let n = Math.round(span * (0.6 + rnd() * 0.5)); n > 0; n--) {
        const c = Math.min(cols - 1, c0 + Math.floor(rnd() * span));
        const foot = stand(c);
        const height = Math.max(2, Math.min(3 + Math.floor(rnd() * (band - 2)), foot - (bottom - band - 3)));
        this.weeds.push({ c, foot, height, reach: 2.2, rate: 0.7, wave: 0.42, phase: phase + rnd() * 1.2, colour: Math.floor(rnd() * 3), kelp: false });
      }
    }
    // Kelp: a few stands, two or three stalks from one holdfast, some much taller than others,
    // rising well above the reef, the tallest to near the middle of the window, swaying further and
    // slower, nearly in step.
    for (let k = Math.max(3, Math.round(cols / 40)); k > 0; k--) {
      const c = Math.floor(rnd() * cols);
      const tall = Math.max(band + 2, Math.round(rows * (0.2 + 0.3 * rnd() ** 1.5)));
      const phase = rnd() * Math.PI * 2;
      for (let n = rnd() < 0.5 ? 2 : 3; n > 0; n--) {
        const at = Math.min(cols - 1, c + (n === 3 ? -2 : n === 2 ? 2 : 0));
        const height = n === 1 ? tall : Math.max(band, Math.round(tall * (0.55 + 0.3 * rnd())));
        this.weeds.push({ c: at, foot: stand(at), height, reach: 4, rate: 0.45, wave: 0.16, phase: phase + rnd() * 0.6, slant: (n === 1 ? 0 : n === 2 ? 1 : -1) * height * 0.08, colour: 0, kelp: true });
      }
    }
  }
}
