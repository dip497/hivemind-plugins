/**
 * Bees' bees: eight species, told apart by build as much as by colour, so they read apart even
 * where their colours are close. A species is drawn in cells, facing right: rows of
 * cells, each a character in one of the bee's parts (its two bands, thorax, head, sting and one
 * part of its own), on a block of that part's colour or bare.
 */

/** The parts of a bee a cell is drawn in: its abdomen's two bands, its thorax, its head, the thin
 *  parts (sting, antenna) and one of its own (a bumblebee's pale tail, a sweat bee's green sheen). */
export type Part = "a" | "b" | "t" | "h" | "s" | "x";
export const PARTS: readonly Part[] = ["a", "b", "t", "h", "s", "x"];

export type SpeciesId = "honey" | "bumble" | "carpenter" | "mason" | "leafcutter" | "sweat" | "mining" | "redtail";
/** Every species, each in the colony at least once. */
export const SPECIES: readonly SpeciesId[] = ["honey", "bumble", "carpenter", "mason", "leafcutter", "sweat", "mining", "redtail"];

/** One cell of a bee, from its body's top-left. */
export interface BeeCell {
  dx: number;
  dy: number;
  glyph: string;
  part: Part;
  block: boolean;
}

export interface Shape {
  /** The body, facing right. */
  cells: BeeCell[];
  /** The same, facing left: mirrored, its characters turned round. */
  left: BeeCell[];
  /** Its size in cells, wings and all. */
  w: number;
  h: number;
  /** The body cell its point is (where it is), and the cells its wings beat in, over its back. */
  anchor: { dx: number; dy: number };
  wings: { dx: number; dy: number }[];
  /** Where a load hangs under it: pollen, or a leafcutter's leaf. */
  load: { dx: number; dy: number };
}

/** A body as rows of cells, each `<part><glyph>`: a capital part sits on a block of its colour,
 *  a small one is bare; `..` is no cell. `W` marks where a wing beats, `*` the point of the bee
 *  (its thorax, drawn fuzzy), `L` where a load hangs. */
const BODIES: Record<SpeciesId, string[]> = {
  // Amber with dark bands, a fuzzy brown thorax: the bee in every picture.
  honey: [
    ".. .. W_ W_ .. s'",
    ".. a( B= A= T% ..",
    "a( A| B| A| T* Ho",
    ".. .. L. .. .. ..",
  ],
  // Round and fuzzy: a white tail, a black band, a yellow one, a yellow thorax.
  bumble: [
    ".. .. W_ W_ .. s'",
    ".. X% B% A% T% ..",
    "x( X% B% A% T* Ho",
    ".. .. L. .. .. ..",
  ],
  // Big and glossy black, the light catching its back, a yellow thorax.
  carpenter: [
    ".. .. W_ W_ .. s'",
    ".. b( B' B' T# ..",
    "b( B0 B0 B0 T* Ho",
    ".. .. L. .. .. ..",
  ],
  // Small, dark and blue, fuzzy all over.
  mason: [
    ".. W_ W_ .. s'",
    ".. b( B= T% ..",
    "b( B= B= T* Ho",
    ".. L. .. .. ..",
  ],
  // Grey, pale-banded, flat-backed: it carries a cut leaf under it.
  leafcutter: [
    ".. .. W_ W_ .. s'",
    ".. A[ A= A= T% ..",
    "a[ B= A= B= T* Ho",
    ".. .. L. .. .. ..",
  ],
  // Slim, a banded abdomen, a metallic green thorax and head.
  sweat: [
    ".. .. W_ W_ s' ..",
    ".. a) B) A) X% ..",
    "a) A) B) A) X* Xo",
    ".. .. L. .. .. ..",
  ],
  // Furry and tawny all over.
  mining: [
    ".. .. W_ W_ .. s'",
    ".. a( A% A% T% ..",
    "a( A% A% A% T* Ho",
    ".. .. L. .. .. ..",
  ],
  // Black, a red tail.
  redtail: [
    ".. .. W_ W_ .. s'",
    ".. a( B% B% T% ..",
    "a( A% B% B% T* Ho",
    ".. .. L. .. .. ..",
  ],
};

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "/": "\\", "\\": "/", "'": "'", "`": "'" };

function shapeOf(rows: string[]): Shape {
  const cells: BeeCell[] = [];
  const wings: { dx: number; dy: number }[] = [];
  let anchor = { dx: 0, dy: 0 };
  let load = { dx: 0, dy: 0 };
  let w = 0;
  rows.forEach((row, dy) => {
    const tokens = row.trim().split(/\s+/);
    w = Math.max(w, tokens.length);
    tokens.forEach((tok, dx) => {
      if (tok === "..") return;
      const [p, g] = [tok[0]!, tok.slice(1)];
      if (p === "W") { wings.push({ dx, dy }); return; }
      if (p === "L") { load = { dx, dy }; return; }
      const star = g === "*";
      if (star) anchor = { dx, dy };
      const part = p.toLowerCase() as Part;
      // The point of the bee is its thorax; `*` stands for its fuzz.
      cells.push({ dx, dy, glyph: star ? (part === "x" ? "#" : "%") : g, part, block: p !== part });
    });
  });
  const left = cells.map((c) => ({ ...c, dx: w - 1 - c.dx, glyph: MIRROR[c.glyph] ?? c.glyph }));
  return { cells, left, w, h: rows.length, anchor, wings, load };
}

export const SHAPES: Record<SpeciesId, Shape> = Object.fromEntries(SPECIES.map((s) => [s, shapeOf(BODIES[s])])) as Record<SpeciesId, Shape>;

/** Its wings at time `t`: beating fast in flight (three strokes, a blur in characters), folded flat
 *  along its back when it has landed. Facing right; mirrored for left. */
export function wingGlyphs(flying: boolean, t: number, phase: number): [string, string] {
  if (!flying) return ["_", "_"];
  switch (Math.floor(t * 22 + phase) % 3) {
    case 0: return ["\\", "/"];
    case 1: return ["-", "-"];
    default: return ["/", "\\"];
  }
}
