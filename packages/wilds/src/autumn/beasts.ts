/**
 * The fox and the deer that cross the bottom of Autumn Wood, drawn in cells, facing right (the
 * renderer mirrors them to walk left). Each row is a string: a letter is a block of one of the
 * beast's colours with a character on it, any other character is drawn alone in the beast's coat
 * (or, for `.` and `=`, its dark ink), and a space is nothing. Legs (`L`) are drawn as the gait has
 * them: upright, or striding, the lowest row of each leg swinging.
 */
import type { Beast } from "./forest";

export interface Sprite {
  rows: string[];
  /** Per letter: which of the beast's colours its block is (0 its coat, 1 its pale parts, 2 its
   *  dark parts), and the character drawn on it. */
  cells: Record<string, [tone: 0 | 1 | 2, glyph: string]>;
}

export const SPRITES: Record<Beast, Sprite> = {
  fox: {
    rows: [
      "                 A A   ",
      "  ,TTT,  ,BBBBBBBHHHE= ",
      " TTTTTTTBBBBBBBBBWWH'  ",
      "wTTTT'  'BBBBBBBW      ",
      "         L L   L L     ",
      "         L L   L L     ",
    ],
    cells: {
      A: [0, "^"],
      H: [0, "%"],
      E: [0, "o"],
      B: [0, "%"],
      T: [0, "#"],
      W: [1, ":"],
      w: [1, "'"],
    },
  },
  deer: {
    rows: [
      "              \\ | | /  ",
      "               \\|_|/   ",
      "               <HHHE   ",
      "                HHHHH= ",
      "               NNH     ",
      "   ,BBBBBBBBBBBNN      ",
      "  wBBBBBBBBBBBBB       ",
      "   BBBBBBBBBBBBB       ",
      "    L L      L L       ",
      "    L L      L L       ",
      "    L L      L L       ",
    ],
    cells: {
      H: [0, ":"],
      E: [0, "o"],
      N: [0, ":"],
      B: [0, ":"],
      w: [1, "'"],
    },
  },
};
