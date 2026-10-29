/**
 * Jellyfish's jellies, seen from the side as they swim up the water: each kind's bell (a dome wider
 * than it is tall, its rim scalloped), its tentacles and its oral arms, its beat, and the pattern
 * that shows through its bell.
 */
export type JellyKind = "moon" | "pelagia" | "nettle" | "crystal" | "lionsmane" | "friedegg" | "spotted" | "atolla";

/** The kinds, in the order the deep is stocked with them. */
export const JELLY_KINDS: JellyKind[] = ["moon", "pelagia", "nettle", "crystal", "lionsmane", "friedegg", "spotted", "atolla"];

export interface JellyShape {
  /** The bell's half-width and its height, as shares of the jelly's length: a dome, wider than it
   *  is tall. */
  w: number;
  h: number;
  /** The dome's profile, its height `(1 - u²)^dome` of the way up `u` across: ½ a half ellipse,
   *  more a rounder crown over sloping shoulders. */
  dome: number;
  /** Lobes round its rim, the scallops between the notches. */
  lobes: number;
  /** Tentacles from the rim: how many, how long against the jelly's length, and whether they are a
   *  fine fringe (a moon jelly's) rather than long threads. */
  tentacles: number;
  reach: number;
  fringe: boolean;
  /** One tentacle much longer than the rest (an atolla's), against the jelly's length. */
  trailer?: number;
  /** Oral arms from under the middle, frilly: how many, how long. */
  arms: number;
  armReach: number;
  /** Beats a second when it drifts. */
  rate: number;
  /** The pattern in the bell at `u` across (-1 to 1) and `v` up it (0 the rim, 1 the top): 0 the
   *  bell's own colour, 1 its marking, 2 its second (a ring of lights, a yolk's rim). */
  pattern(u: number, v: number): number;
  /** The characters its marking and its second are drawn in. */
  marks: [string, string];
}

export const JELLY_SHAPES: Record<JellyKind, JellyShape> = {
  // Aurelia: wide and flat, four horseshoe gonads showing through it, a fringe of fine short
  // tentacles all round, four short frilled arms.
  moon: {
    w: 0.56, h: 0.36, dome: 0.75, lobes: 8, tentacles: 20, reach: 0.32, fringe: true, arms: 4, armReach: 0.5, rate: 0.5,
    pattern: (u, v) => {
      const ring = Math.abs(Math.hypot((Math.abs(u) - 0.3) / 0.5, (v - 0.32) / 0.62) - 0.5);
      return v > 0.08 && v < 0.7 && ring < 0.12 ? 1 : 0;
    },
    marks: ["oO", "o"],
  },
  // Pelagia: a deeper dome, mauve, warty, long thin tentacles and long frilled arms.
  pelagia: {
    w: 0.46, h: 0.44, dome: 0.65, lobes: 8, tentacles: 6, reach: 1.6, fringe: false, arms: 4, armReach: 1.15, rate: 0.7,
    pattern: (u, v) => {
      if (v > 0.9) return 0;
      const gu = (u + 1) * 5;
      const gv = v * 4;
      return (gu - Math.floor(gu) - 0.5) ** 2 + (gv - Math.floor(gv) - 0.5) ** 2 < 0.06 && Math.floor(gv + Math.floor(gu)) % 2 === 0 ? 1 : 0;
    },
    marks: ["o*", "."],
  },
  // Chrysaora: gold, its dark stripes running from the crown to the rim, the longest reddish
  // tentacles of them all and long ribbons of arms.
  nettle: {
    w: 0.5, h: 0.42, dome: 0.7, lobes: 16, tentacles: 7, reach: 2.3, fringe: false, arms: 4, armReach: 1.5, rate: 0.6,
    pattern: (u, v) => (v < 0.88 && Math.abs(Math.sin((Math.asin(Math.max(-1, Math.min(1, u))) * 8))) < 0.32 ? 1 : 0),
    marks: ["|!", "~"],
  },
  // Aequorea: nearly clear, a flat crystal of a dome, its canals fine lines, a ring of green
  // lights round its rim, many fine tentacles.
  crystal: {
    w: 0.58, h: 0.34, dome: 0.6, lobes: 12, tentacles: 18, reach: 0.6, fringe: true, arms: 1, armReach: 0.35, rate: 0.55,
    pattern: (u, v) => (v < 0.14 ? (Math.floor((u + 1) * 7) % 2 ? 2 : 0) : v < 0.86 && Math.abs(Math.sin(u * 13)) < 0.13 ? 1 : 0),
    marks: [":|", "*"],
  },
  // Cyanea: big and red, its rim deeply lobed, a mane of fine tentacles hanging from under it.
  lionsmane: {
    w: 0.62, h: 0.4, dome: 0.75, lobes: 8, tentacles: 14, reach: 1.8, fringe: false, arms: 4, armReach: 0.9, rate: 0.4,
    pattern: (u, v) => (v < 0.6 && Math.abs(Math.sin(u * 9)) < 0.3 ? 1 : 0),
    marks: ["%&", "*"],
  },
  // Cotylorhiza: flat and pale, a domed yolk in its middle, short arms tipped in violet.
  friedegg: {
    w: 0.62, h: 0.32, dome: 0.55, lobes: 12, tentacles: 6, reach: 0.4, fringe: true, arms: 6, armReach: 0.6, rate: 0.45,
    pattern: (u, v) => {
      const d = Math.hypot(u / 0.5, (v - 0.55) / 0.5);
      return d < 0.8 ? 1 : d < 1 ? 2 : 0;
    },
    marks: ["@o", "o"],
  },
  // Mastigias: a round olive dome dotted white, no tentacles, eight thick frilled arms.
  spotted: {
    w: 0.48, h: 0.44, dome: 0.6, lobes: 12, tentacles: 0, reach: 0, fringe: false, arms: 8, armReach: 0.75, rate: 0.75,
    pattern: (u, v) => {
      const gu = (u + 1) * 4.5 + (Math.floor(v * 4) % 2) * 0.5;
      const gv = v * 4;
      return (gu - Math.floor(gu) - 0.5) ** 2 + (gv - Math.floor(gv) - 0.5) ** 2 < 0.07 ? 1 : 0;
    },
    marks: ["o.", "o"],
  },
  // Atolla: a deep-sea crown jelly, dark red, a groove round its crown, a ring of blue lights at its
  // rim, a fringe of short tentacles and one long trailing one.
  atolla: {
    w: 0.58, h: 0.34, dome: 0.65, lobes: 16, tentacles: 14, reach: 0.45, fringe: true, trailer: 2.4, arms: 0, armReach: 0, rate: 0.5,
    pattern: (u, v) => (Math.abs(v - 0.45) < 0.09 ? 1 : v < 0.14 && Math.floor((u + 1) * 8) % 2 === 0 ? 2 : 0),
    marks: ["=-", "*"],
  },
};
