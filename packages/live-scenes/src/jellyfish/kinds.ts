/**
 * Jellyfish's jellies, seen from the side as they swim up the water: each kind's bell (a dome wider
 * than it is tall, its rim scalloped), its tentacles and its oral arms, its beat, and the pattern
 * that shows through its bell.
 */
export type JellyKind = "moon" | "pelagia" | "nettle" | "crystal" | "lionsmane" | "friedegg" | "spotted" | "atolla";

/** The kinds, in the order the deep is stocked with them. */
export const JELLY_KINDS: JellyKind[] = ["moon", "pelagia", "nettle", "crystal", "lionsmane", "friedegg", "spotted", "atolla"];

/** What a point of a bell is (`JellyShape.pattern`): its own gel, its marking, its second, or the
 *  gleam where the light from above catches its crown. */
export const BELL = 0;
export const MARK = 1;
export const MARK2 = 2;
export const GLEAM = 3;

export interface JellyShape {
  /** The bell's half-width and its height, as shares of the jelly's length: a dome, wider than it
   *  is tall. */
  w: number;
  h: number;
  /** The dome's profile, its height `(1 - u²)^dome` of the way up `u` across: ½ a half ellipse,
   *  more a rounder crown over sloping shoulders. */
  dome: number;
  /** Its height `u` across (-1 to 1) as a share of `h`, where its outline is not the plain dome (a
   *  fried egg's yolk standing up from its brim). */
  top?(u: number): number;
  /** Lobes round its rim, the scallops between the notches, and how far they hang below it, as a
   *  share of the bell's height. */
  lobes: number;
  scallop: number;
  /** Lights round its rim, in its second colour: one in every lobe (1), or every other (2). */
  rimLights?: number;
  /** Tentacles from the rim: how many, how long against the jelly's length, and whether they are a
   *  fine fringe (a moon jelly's) rather than long threads. */
  tentacles: number;
  reach: number;
  fringe: boolean;
  /** Threads drawn for each tentacle: a lion's mane hangs hundreds. */
  threads?: number;
  /** One tentacle much longer than the rest (an atolla's), against the jelly's length. */
  trailer?: number;
  /** Oral arms from under the middle, frilly: how many, how long, how wide near the bell (shares of
   *  the jelly's length), and how many turns their ribbons twist down their length. */
  arms: number;
  armReach: number;
  armWidth: number;
  twist: number;
  /** Beats a second when it drifts. */
  rate: number;
  /**
   * The pattern in the bell at `u` across (-1 to 1) and `vt` up it, a share of its height there:
   * 0 at the rim, 1 on its outline; below 0 the scallops of its rim, -1 their lowest. `v` is the
   * height as a share of the bell's own. BELL its own gel, MARK its marking, MARK2 its second (a
   * band at its rim, a yolk's rim; its rim's lights are drawn in it too), GLEAM the light on its
   * crown. Tabulated once (render.ts), never called per frame.
   */
  pattern(u: number, vt: number, v: number): number;
  /** How much more of its marking and its second there is than of the gel round them, as steps of
   *  its light (0 to 1): what makes them show through it. */
  lift: [number, number];
  /** How much thicker its own gel is than a plain bell's, in the same steps: a fried egg's brim is
   *  milky, not clear. */
  body?: number;
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
/** A meridian's angle round a dome seen from the side, `u` across: it runs as `asin(u)`, so its
 *  stripes crowd together toward its edges as a dome's do. */
const round = (u: number) => Math.asin(clamp1(u));
/** The light on a crown: a crescent along it up on its left, where the light from above catches it. */
const gleam = (u: number, vt: number) => u > -0.6 && u < -0.2 && vt > 0.74 && vt < 0.9 && Math.abs(u + 0.4) < 0.2 - (vt - 0.82) ** 2 * 6;
/** Dots in rows round a dome, each row's half a step on from the last: `across` of them round its
 *  front, `up` rows, each `r` of a step across. */
const dots = (u: number, vt: number, across: number, up: number, r: number) => {
  const row = Math.floor(vt * up);
  const gu = (round(u) / Math.PI) * across + (row % 2) * 0.5;
  const fu = gu - Math.floor(gu) - 0.5;
  const fv = vt * up - row - 0.5;
  // Narrower toward its edges, where the dome turns away and a dot is seen at a slant.
  return fu * fu * (1 + 2 * u * u) + fv * fv < r * r;
};

export const JELLY_SHAPES: Record<JellyKind, JellyShape> = {
  // Aurelia: wide and flat, its four horseshoe gonads showing through it, a fringe of fine short
  // tentacles all round, four short frilled arms.
  moon: {
    w: 0.56, h: 0.36, dome: 0.75, lobes: 8, scallop: 0.2, tentacles: 26, reach: 0.32, fringe: true,
    arms: 4, armReach: 0.5, armWidth: 0.06, twist: 1.2, rate: 0.5,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      if (vt < 0.05) return BELL;
      // Four loops: two to the front and lower, two behind, higher and smaller.
      for (const [cu, cv, ru, rv] of [[-0.24, 0.42, 0.2, 0.3], [0.24, 0.42, 0.2, 0.3], [-0.64, 0.5, 0.15, 0.27], [0.64, 0.5, 0.15, 0.27]] as const) {
        const d = Math.hypot((u - cu) / ru, (vt - cv) / rv);
        if (d < 1.12 && d > 0.55) return MARK;
      }
      return BELL;
    },
    lift: [0.3, 0.3],
  },
  // Pelagia: a deeper dome, mauve, warty, long thin tentacles and long frilled arms.
  pelagia: {
    w: 0.46, h: 0.44, dome: 0.65, lobes: 8, scallop: 0.2, tentacles: 8, reach: 1.6, fringe: false,
    arms: 4, armReach: 1.15, armWidth: 0.07, twist: 2.2, rate: 0.7,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      if (vt < 0) return BELL;
      // Warts in rows round the dome, a darker band of them at its rim.
      if (vt < 0.9 && dots(u, vt, 9, 3, 0.21)) return vt < 0.3 ? MARK2 : MARK;
      return BELL;
    },
    lift: [0.25, 0.15],
  },
  // Chrysaora: gold, its dark stripes running from the crown to the rim, the longest reddish
  // tentacles of them all and long ribbons of arms.
  nettle: {
    w: 0.5, h: 0.42, dome: 0.7, lobes: 16, scallop: 0.18, tentacles: 8, reach: 2.3, fringe: false,
    arms: 4, armReach: 1.5, armWidth: 0.075, twist: 2.6, rate: 0.6,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      // Sixteen stripes from the crown, each widening toward the rim, its lobes dark.
      if (vt < 0) return Math.abs(Math.sin(round(u) * 8)) < 0.42 ? MARK : BELL;
      return vt < 0.93 && Math.abs(Math.sin(round(u) * 8)) < 0.26 + 0.18 * (1 - vt) ? MARK : BELL;
    },
    lift: [0.1, 0.1],
  },
  // Aequorea: nearly clear, a flat crystal of a dome, its canals fine lines from its crown, a ring
  // of green lights round its rim, many fine tentacles.
  crystal: {
    w: 0.58, h: 0.34, dome: 0.6, lobes: 12, scallop: 0.18, rimLights: 1, tentacles: 24, reach: 0.6, fringe: true,
    arms: 1, armReach: 0.35, armWidth: 0.05, twist: 1, rate: 0.55,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      return vt > 0.1 && vt < 0.84 && Math.abs(Math.sin(round(u) * 6)) < 0.17 ? MARK : BELL;
    },
    lift: [0.2, 0.5],
  },
  // Cyanea: big and red, its rim deeply lobed, its folds darker toward the rim, a paler crown, a
  // mane of fine tentacles hanging from under it.
  lionsmane: {
    w: 0.62, h: 0.4, dome: 0.75, lobes: 8, scallop: 0.3, tentacles: 14, reach: 1.8, fringe: false, threads: 3,
    arms: 4, armReach: 0.9, armWidth: 0.08, twist: 1.6, rate: 0.4,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      if (vt > 0.62 && Math.abs(u) < 0.36) return MARK2;
      // Eight folds, broad and dark toward the rim, into its lobes.
      return vt < 0.66 && Math.abs(Math.cos(round(u) * 4)) < 0.3 + 0.2 * Math.min(1, -vt) ? MARK : BELL;
    },
    lift: [0.06, 0.12],
  },
  // Cotylorhiza: a flat pale brim, a domed yolk standing up in its middle, short arms tipped in
  // violet.
  friedegg: {
    w: 0.62, h: 0.32, dome: 0.55, lobes: 12, scallop: 0.18, tentacles: 8, reach: 0.4, fringe: true,
    arms: 6, armReach: 0.6, armWidth: 0.06, twist: 1.4, rate: 0.45,
    top: (u) => Math.max(0.44 * Math.pow(Math.max(0, 1 - u * u), 0.55), Math.sqrt(Math.max(0, 1 - (u / 0.5) ** 2))),
    pattern: (u, vt, v) => {
      if (Math.hypot(u / 0.5, v) < 0.98) return Math.hypot((u + 0.2) / 0.14, (v - 0.72) / 0.1) < 1 ? GLEAM : MARK;
      return vt >= 0 && Math.hypot(u / 0.6, v / 0.52) < 1 ? MARK2 : BELL;
    },
    lift: [0.3, 0.12],
    body: 0.16,
  },
  // Mastigias: a round olive dome dotted white, no tentacles, eight thick frilled arms.
  spotted: {
    w: 0.48, h: 0.44, dome: 0.6, lobes: 12, scallop: 0.18, tentacles: 0, reach: 0, fringe: false,
    arms: 8, armReach: 0.75, armWidth: 0.085, twist: 0.9, rate: 0.75,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      if (vt < 0.04) return BELL;
      return vt < 0.94 && dots(u, vt, 10, 3.2, 0.17) ? MARK : BELL;
    },
    lift: [0.38, 0.1],
  },
  // Atolla: a deep-sea crown jelly, dark red, a groove round its crown, the thick segments of its
  // margin under it, a ring of blue lights at its rim, a fringe of short tentacles and one long
  // trailing one.
  atolla: {
    w: 0.58, h: 0.34, dome: 0.65, lobes: 16, scallop: 0.2, rimLights: 1, tentacles: 18, reach: 0.45, fringe: true, trailer: 2.4,
    arms: 0, armReach: 0, armWidth: 0, twist: 0, rate: 0.5,
    pattern: (u, vt) => {
      if (gleam(u, vt)) return GLEAM;
      if (vt < 0) return BELL;
      if (Math.abs(vt - 0.6) < 0.09) return MARK;
      return vt < 0.5 && Math.abs(Math.sin(round(u) * 8)) < 0.22 ? MARK : BELL;
    },
    lift: [0.06, 0.5],
  },
};

/** The dome's height `u` across, as a share of the bell's: the kind's own profile, or the plain
 *  dome. */
export const topOf = (shape: JellyShape, u: number) => (shape.top ? shape.top(u) : Math.pow(Math.max(0, 1 - u * u), shape.dome));
