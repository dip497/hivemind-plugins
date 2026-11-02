/**
 * The Den's yard: one pup for each agent, living in the open ground between your tiles. It knows
 * no canvas; the drawing reads it, and a test runs it alone.
 *
 * Everything is in CSS pixels of the window. A pup's (x, y) is where its feet touch the ground on
 * screen; its body rises above that. `unit` is how many pixels one pup-unit is (a pup is about 0.95
 * units long), so the pups are the same size to the eye on any screen.
 *
 * What each agent's state looks like:
 * - working: it potters about between open spots, trotting, and stops to sniff the ground;
 * - ready: it goes somewhere open and sits, wagging, watching the pointer;
 * - needs you: it runs to the open side of its agent's tile and play-bows there, hopping and
 *   yipping, until you answer;
 * - resting: it walks down to the bottom of the window and curls up asleep.
 *
 * The pointer: pups near it turn their heads to it; rubbing it back and forth over a pup pets it
 * (it sits, shuts its eyes and wags). A click on open ground drops a ball the nearest free pup runs
 * to pounce on; a turn finished well makes that agent's pup leap.
 */
import type { WallpaperCreature, WallpaperTile } from "@hivemind/view-sdk";

export type PupState = WallpaperCreature["state"];
/** What a pup's body is doing, which picks its pose: moving at a walk, trot or run, or still. */
export type Act = "move" | "sit" | "sniff" | "bow" | "sleep" | "pet";

export interface Pup {
  readonly id: string;
  /** Its program's coat: 0 to KINDS-1, the same for every agent of one program. */
  kind: number;
  size: number;
  state: PupState;
  /** A number of its own from its id, for the variety that is only its. */
  readonly seed: number;
  x: number;
  y: number;
  /** Where it faces, on screen: 0 to the right, π/2 down (toward you). */
  heading: number;
  /** How fast it goes now, in units a second. */
  speed: number;
  goal: { x: number; y: number } | null;
  /** How fast it wants to get to `goal`, in units a second. */
  pace: number;
  act: Act;
  /** Seconds in its act, and until it next decides what to do. */
  actT: number;
  next: number;
  /** The gait's phase, in radians, locked to the ground covered. */
  phase: number;
  /** Height of a hop, in units, and how fast it rises. */
  hop: number;
  hopV: number;
  /** How petted it is (0 to 1), and how much rubbing it has had lately (pixels). */
  pet: number;
  rub: number;
  /** Seconds left of an open-mouthed yip. */
  yip: number;
  /** Where it looks, on screen, or null for straight ahead. */
  look: { x: number; y: number } | null;
  /** On its way out of the window, and dropped once out of sight. */
  leaving: boolean;
  /** The state it was placed for when the picture was last settled. */
  settledAs: PupState | null;
  /** Chasing the ball. */
  chasing: boolean;
  /** The corners it goes by on the way to `goal`, round the tiles in the way, in order. */
  path: { x: number; y: number }[];
  /** What the path was worked out for: that goal, those tiles. */
  pathFor: { goal: { x: number; y: number } | null; tiles: number };
  /** The next corner, while it has one. */
  via: { x: number; y: number } | null;
  /** Seconds without getting closer to where it is going, and the nearest it has been. */
  stuck: number;
  nearest: number;
  /** The goal those two are measured against: a new goal starts them afresh. */
  tracking: { x: number; y: number } | null;
}

/** A tile grown by where a pup's feet may not go: its body rises above its feet and is half a body wide. */
interface Box { x0: number; y0: number; x1: number; y1: number }

export const KINDS = 6;
export const kindOf = (k: number) => Math.min(KINDS - 1, Math.max(0, Math.floor(k * KINDS)));
export const hash = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
};

/** Paces, in units a second. */
export const PACE = { walk: 0.8, trot: 1.5, run: 2.7 };

export class Yard {
  readonly pups = new Map<string, Pup>();
  w = 1440;
  h = 900;
  unit = 85;
  tiles: readonly WallpaperTile[] = [];
  pointer = { x: 0, y: 0, on: false };
  /** Counts each change of the tiles, so a path worked out for older ones is worked out again. */
  private tileVersion = 0;
  ball: { x: number; y: number; t: number } | null = null;
  private stocked = false;
  private t = 0;

  constructor(private readonly rand: () => number = Math.random) {}

  resize(w: number, h: number) {
    const sx = this.w ? w / this.w : 1, sy = this.h ? h / this.h : 1;
    if (this.stocked) for (const p of this.pups.values()) { p.x *= sx; p.y *= sy; if (p.goal) { p.goal.x *= sx; p.goal.y *= sy; } }
    this.w = w;
    this.h = h;
    this.unit = Math.min(130, Math.max(70, Math.min(w, h) * 0.125));
  }

  setTiles(tiles: readonly WallpaperTile[]) {
    this.tiles = tiles;
    this.tileVersion++;
  }

  /** The agents now: new ones arrive (placed where they belong if the yard is just stocked, else
   *  trotting in from an edge), known ones take their new state, gone ones walk off. */
  meet(creatures: readonly WallpaperCreature[]) {
    const fresh: Pup[] = [];
    for (const p of this.pups.values()) if (!creatures.some((c) => c.id === p.id) && !p.leaving) this.leave(p);
    for (const c of creatures) {
      const p = this.pups.get(c.id);
      if (p) {
        if (p.leaving) { p.leaving = false; p.goal = null; }
        if (p.state !== c.state) { p.state = c.state; this.decide(p, true); }
        p.kind = kindOf(c.kind);
        p.size = c.size;
        continue;
      }
      const np = this.newPup(c);
      this.pups.set(c.id, np);
      if (this.stocked) this.enterFromEdge(np);
      else fresh.push(np);
    }
    this.placeInTurn(fresh);
    this.stocked = true;
  }

  point(x: number, y: number, on: boolean) {
    const moved = on && this.pointer.on ? Math.hypot(x - this.pointer.x, y - this.pointer.y) : 0;
    this.pointer = { x, y, on };
    if (!on || moved === 0) return;
    // Rubbing over a pup pets it.
    for (const p of this.pups.values()) if (!p.leaving && this.over(p, x, y)) p.rub = Math.min(160, p.rub + moved);
  }

  /** A click on empty canvas: on a pup (the app took you to its agent), it hops; on open ground,
   *  a ball drops there for the nearest free pup. */
  click(x: number, y: number, id: string | null) {
    if (id) {
      const p = this.pups.get(id);
      if (p) this.hopUp(p, 2.2);
      return;
    }
    if (this.covered(x, y, 0)) return;
    this.ball = { x, y, t: 0 };
    // The pup with the shortest way there, round the tiles, not the nearest as the crow flies.
    let best: Pup | null = null, bd = Infinity;
    for (const p of this.pups.values()) {
      if (p.leaving || p.state === "needs-you" || p.state === "resting") continue;
      let d = 0, at = { x: p.x, y: p.y };
      for (const c of [...this.route(p, { x, y }), { x, y }]) { d += Math.hypot(c.x - at.x, c.y - at.y); at = c; }
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      for (const p of this.pups.values()) p.chasing = false;
      best.chasing = true;
      best.goal = { x, y };
      best.pace = PACE.run;
      best.act = "move";
      best.actT = 0;
    }
  }

  /** That agent finished a turn well: its pup leaps for joy. */
  done(id: string) {
    const p = this.pups.get(id);
    if (p && !p.leaving) { this.hopUp(p, 3.2); p.yip = 0.25; }
  }

  /** Which pup is under a point: the body as it is drawn, not its box. */
  hit(x: number, y: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const p of this.pups.values()) {
      if (p.leaving) continue;
      const u = this.unit * p.size;
      const cx = p.x, cy = p.y - 0.36 * u - p.hop * u * 0.77;
      const dx = (x - cx) / (0.48 * u), dy = (y - cy) / (0.42 * u);
      const d = dx * dx + dy * dy;
      if (d < 1 && d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  /** Is (x, y) over a pup's body? */
  private over(p: Pup, x: number, y: number) {
    const u = this.unit * p.size;
    return Math.abs(x - p.x) < 0.48 * u && y < p.y + 0.12 * u && y > p.y - 0.8 * u;
  }

  step(dt: number) {
    this.t += dt;
    if (this.ball) {
      this.ball.t += dt;
      if (this.ball.t > 12) this.ball = null;
    }
    for (const p of this.pups.values()) this.stepPup(p, dt);
    for (const p of [...this.pups.values()]) if (p.leaving && this.outOfSight(p)) this.pups.delete(p.id);
    this.separate(dt);
  }

  /** A still picture: each pup that is new or changed state since the last one is put where its
   *  state belongs, settled; the others stay where they are. */
  settle() {
    const moved: Pup[] = [];
    for (const p of [...this.pups.values()]) {
      if (p.leaving) { this.pups.delete(p.id); continue; }
      if (p.settledAs !== p.state) moved.push(p);
    }
    this.placeInTurn(moved);
    this.ball = null;
  }

  // ── each pup ─────────────────────────────────────────────────────────────

  private newPup(c: WallpaperCreature): Pup {
    return {
      id: c.id, kind: kindOf(c.kind), size: c.size, state: c.state, seed: hash(c.id),
      x: this.w / 2, y: this.h / 2, heading: Math.PI / 2, speed: 0, goal: null, pace: PACE.walk,
      act: "sit", actT: 0, next: 0, phase: 0, hop: 0, hopV: 0, pet: 0, rub: 0, yip: 0, look: null,
      leaving: false, settledAs: null, chasing: false, path: [], pathFor: { goal: null, tiles: -1 }, via: null, stuck: 0, nearest: Infinity, tracking: null,
    };
  }

  /** Each straight where its state puts it: first those whose place is set (by their tile, along the
   *  bottom), then the others in the room left round them. */
  private placeInTurn(pups: Pup[]) {
    const turn = (p: Pup) => (p.state === "needs-you" ? 0 : p.state === "resting" ? 1 : 2);
    for (const p of [...pups].sort((a, b) => turn(a) - turn(b))) this.placeWhereItBelongs(p);
  }

  /** Straight where its state puts it, already doing it: for the first roster and still frames. */
  private placeWhereItBelongs(p: Pup) {
    const spot = this.homeOf(p);
    p.x = spot.x;
    p.y = spot.y;
    p.goal = null;
    p.speed = 0;
    p.act = this.restingAct(p);
    p.actT = 0;
    p.heading = this.restingHeading(p);
    p.next = 2 + this.rand() * 4;
    p.settledAs = p.state;
  }

  /** In from whichever edge is open where it comes in: the sides, or the bottom. */
  private enterFromEdge(p: Pup) {
    const u = this.unit;
    for (let i = 0; i < 12; i++) {
      const side = i < 11 ? Math.floor(this.rand() * 3) : 2;
      const y = this.h * (0.35 + 0.5 * this.rand()), x = this.w * (0.15 + 0.7 * this.rand());
      const start = side === 0 ? { x: -0.6 * u, y } : side === 1 ? { x: this.w + 0.6 * u, y } : { x, y: this.h + 0.3 * u };
      const inside = side === 0 ? { x: 0.7 * u, y } : side === 1 ? { x: this.w - 0.7 * u, y } : { x, y: this.h - 0.4 * u };
      if (this.feetBlocked(inside.x, inside.y, 0) && i < 11) continue;
      p.x = start.x;
      p.y = start.y;
      p.heading = side === 0 ? 0 : side === 1 ? Math.PI : -Math.PI / 2;
      break;
    }
    this.decide(p, true);
  }

  /** Off by the nearest edge it can reach without going under a tile: a side, or the bottom. */
  private leave(p: Pup) {
    const u = this.unit;
    p.leaving = true;
    p.chasing = false;
    p.act = "move";
    p.pace = PACE.trot;
    p.path = [];
    p.via = null;
    p.pathFor = { goal: null, tiles: -1 };
    const exits = [
      { x: -1.2 * u, y: p.y }, { x: this.w + 1.2 * u, y: p.y }, { x: p.x, y: this.h + 1.25 * u },
    ].map((e) => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y), open: !firstHit(p.x, p.y, e.x, e.y, this.boxes()) }));
    exits.sort((a, c) => Number(c.open) - Number(a.open) || a.d - c.d);
    p.goal = exits[0]!.e;
  }

  private outOfSight(p: Pup) {
    const m = this.unit;
    // Its body rises above its feet by most of a unit: with its feet a unit below the bottom
    // edge, none of it shows.
    return p.x < -m || p.x > this.w + m || p.y < -m || p.y > this.h + 1.1 * m;
  }

  /** Where its state puts it when it settles: by its tile, on the bottom, or somewhere open. */
  private homeOf(p: Pup): { x: number; y: number } {
    if (p.state === "needs-you") {
      const tile = this.tiles.find((t) => t.id === p.id);
      if (tile) return this.visitSpot(tile, p);
    }
    if (p.state === "resting") return this.restSpot(p);
    return this.spreadSpot(p);
  }

  /** A place of its own in the open, as far as it can be from the other pups. */
  private spreadSpot(p: Pup) {
    const pick = () => ({ x: this.w * (0.08 + 0.84 * this.rand()), y: this.h * (0.22 + 0.6 * this.rand()) });
    return this.roomiest(p, 32, pick, 0.25 * this.unit) ?? { x: this.w / 2, y: this.h * 0.6 };
  }

  /** Of `tries` places from `pick` where its body is clear of the tiles, the one furthest from the
   *  other pups: from where each stands, or from where it is bound. */
  private roomiest(p: Pup, tries: number, pick: () => { x: number; y: number }, pad: number) {
    let best: { x: number; y: number } | null = null, bestGap = -1;
    for (let i = 0; i < tries; i++) {
      const c = pick();
      if (this.bodyCovered(c.x, c.y, p.size, pad)) continue;
      let gap = Infinity;
      for (const o of this.pups.values()) {
        // One not yet placed (later in the first roster) is nowhere yet.
        if (o === p || o.leaving || !(o.settledAs || o.goal)) continue;
        const at = o.goal ?? o;
        gap = Math.min(gap, Math.hypot(at.x - c.x, (at.y - c.y) / SLANT));
      }
      if (gap > bestGap) { best = c; bestGap = gap; }
    }
    return best;
  }

  private restingAct(p: Pup): Act {
    if (p.state === "needs-you") return "bow";
    if (p.state === "resting") return "sleep";
    if (p.state === "working") return "sniff";
    return "sit";
  }

  /** Facing you, turned a little, or at its tile when it calls. */
  private restingHeading(p: Pup) {
    if (p.state === "needs-you") {
      const tile = this.tiles.find((t) => t.id === p.id);
      if (tile) return Math.atan2((tile.y0 + tile.y1) / 2 - p.y, (tile.x0 + tile.x1) / 2 - p.x);
    }
    return Math.PI / 2 + (p.seed < 0.5 ? -0.75 : 0.75);
  }

  /** What to do next, given its state; `now` when its state just changed. */
  private decide(p: Pup, now = false) {
    p.chasing = false;
    p.actT = 0;
    p.via = null;
    p.path = [];
    p.pathFor = { goal: null, tiles: -1 };
    p.stuck = 0;
    p.nearest = Infinity;
    switch (p.state) {
      case "needs-you": {
        const tile = this.tiles.find((t) => t.id === p.id);
        p.goal = tile ? this.visitSpot(tile, p) : this.openSpot(p, p, false);
        p.pace = PACE.run;
        p.act = "move";
        p.yip = now ? 0.3 : p.yip;
        break;
      }
      case "resting":
        p.goal = this.restSpot(p);
        p.pace = PACE.walk;
        p.act = "move";
        break;
      case "ready":
        p.goal = this.openSpot(p, p, true);
        p.pace = PACE.walk;
        p.act = "move";
        break;
      case "working":
        p.goal = this.openSpot(p, p, true);
        p.pace = PACE.trot;
        p.act = "move";
        break;
    }
  }

  private stepPup(p: Pup, dt: number) {
    p.actT += dt;
    p.yip = Math.max(0, p.yip - dt);
    // A hop rises and falls on its own gravity.
    if (p.hop > 0 || p.hopV > 0) {
      p.hopV -= 14 * dt;
      p.hop = Math.max(0, p.hop + p.hopV * dt);
      if (p.hop === 0) p.hopV = 0;
    }
    // Petting: rubbing builds it, it fades when the rubbing stops; a pup petted enough sits and
    // enjoys it, and bounces up happy when you stop.
    p.rub = Math.max(0, p.rub - 260 * dt);
    if (p.rub > 50 && !p.leaving && p.state !== "resting") {
      p.pet = Math.min(1, p.pet + dt * 2.5);
      if (p.act !== "pet" && p.pet > 0.3) { p.act = "pet"; p.actT = 0; p.goal = null; p.speed = 0; }
    } else if (p.act === "pet") {
      p.pet = Math.max(0, p.pet - dt * 1.2);
      if (p.pet < 0.05) { this.hopUp(p, 2.2); p.yip = 0.2; this.decide(p); }
    } else p.pet = Math.max(0, p.pet - dt);
    // A resting pup petted wags in its sleep.
    if (p.state === "resting" && p.rub > 50) p.pet = Math.min(1, p.pet + dt * 2);

    // Where it looks: at the pointer when it is near, else straight on.
    const near = this.pointer.on && Math.hypot(this.pointer.x - p.x, this.pointer.y - p.y) < 3 * this.unit;
    p.look = near && p.act !== "sleep" ? { x: this.pointer.x, y: this.pointer.y } : null;

    if (p.act === "pet" || (p.act === "sleep" && p.state === "resting")) { p.speed = 0; return; }

    // A tile put down over a pup at rest: it gets up and goes somewhere open.
    if (p.act !== "move" && !p.leaving && this.boxAround(p)) this.decide(p);

    if (p.act === "move" && p.goal) {
      const done = this.moveToward(p, p.goal, dt);
      if (done) this.arrive(p);
      return;
    }
    p.speed = Math.max(0, p.speed - dt * 6);

    // Still: hold its act, and now and then decide again.
    if (p.state === "needs-you") {
      // Call: a hop and a yip every so often, facing its tile.
      if (p.actT > 1.2 + p.seed) { p.actT = 0; this.hopUp(p, 1.8); p.yip = 0.22; }
      const tile = this.tiles.find((t) => t.id === p.id);
      if (tile) {
        const spot = this.visitSpot(tile, p);
        if (Math.hypot(spot.x - p.x, spot.y - p.y) > 0.6 * this.unit) this.decide(p);
      }
      return;
    }
    if (p.chasing) return;
    p.next -= dt;
    if (p.next <= 0) {
      if (p.state === "working") this.decide(p);
      else if (p.state === "ready" && this.rand() < 0.35) this.decide(p);
      else p.next = 6 + this.rand() * 10;
    }
  }

  private arrive(p: Pup) {
    p.goal = null;
    p.via = null;
    p.speed = 0;
    p.actT = 0;
    if (p.leaving) {
      if (!this.outOfSight(p)) { p.goal = { x: p.x < this.w / 2 ? -1.5 * this.unit : this.w + 1.5 * this.unit, y: p.y }; p.act = "move"; }
      return;
    }
    if (p.chasing && this.ball) {
      // Pounce on the ball, and it is caught.
      p.chasing = false;
      this.ball = null;
      this.hopUp(p, 2.6);
      p.yip = 0.2;
      p.act = "sit";
      p.next = 1.5;
      return;
    }
    p.act = this.restingAct(p);
    p.heading = p.state === "working" ? p.heading : this.restingHeading(p);
    p.next = p.state === "working" ? 1.5 + this.rand() * 3 : 8 + this.rand() * 12;
    p.settledAs = p.state;
  }

  /** Go toward `goal`; true once there. It turns smoothly, and goes round a tile in its way by the
   *  tile's best corner instead of walking under it. */
  private moveToward(p: Pup, goal: { x: number; y: number }, dt: number): boolean {
    const u = this.unit;
    const d = Math.hypot(goal.x - p.x, goal.y - p.y);
    if (d < (p.chasing ? 0.35 : 0.08) * u) return true;
    // Getting nowhere (another pup on its spot, a corner it cannot round): near enough is there;
    // otherwise it finds another place of the same kind. A pup on its way out keeps going.
    if (p.tracking !== goal) { p.tracking = goal; p.nearest = d; p.stuck = 0; }
    if (d < p.nearest - 0.02 * u) { p.nearest = d; p.stuck = 0; } else p.stuck += dt;
    if (p.stuck > 1.5 && !p.leaving) {
      if (d < 0.7 * u) return true;
      p.stuck = 0;
      p.nearest = d;
      p.pathFor = { goal: null, tiles: -1 };
      if (!p.chasing && p.state !== "needs-you") {
        p.goal = p.state === "resting" ? this.restSpot(p) : this.openSpot(p, p, false);
        return false;
      }
    }
    // Inside where its body would overlap a tile (a tile put down over it): out by the nearest
    // side, quickly. Otherwise its way: straight, or by a corner, looked at again now and then.
    const inside = this.boxAround(p);
    let to: { x: number; y: number } = goal;
    let pace = p.pace;
    if (inside) {
      to = this.exitOf(p, inside);
      pace = PACE.run;
    } else {
      if (p.pathFor.goal !== goal || p.pathFor.tiles !== this.tileVersion) {
        p.path = this.route(p, goal);
        p.pathFor = { goal, tiles: this.tileVersion };
      }
      while (p.path.length && Math.hypot(p.path[0]!.x - p.x, p.path[0]!.y - p.y) < 0.15 * u) p.path.shift();
      p.via = p.path[0] ?? null;
      to = p.via ?? goal;
    }
    const want = Math.atan2(to.y - p.y, to.x - p.x);
    const turn = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
    p.heading += Math.max(-7 * dt, Math.min(7 * dt, turn));
    const align = Math.max(0.2, Math.cos(turn));
    const left = to === goal ? d : Math.hypot(to.x - p.x, to.y - p.y) + Math.hypot(goal.x - to.x, goal.y - to.y);
    const target = pace * Math.min(1, left / (0.6 * u) + 0.25) * align;
    p.speed += (target - p.speed) * Math.min(1, dt * 6);
    // On screen, a step toward or away from you covers fewer pixels: the ground is seen at a slant.
    const px = p.speed * u * dt;
    p.x += Math.cos(p.heading) * px;
    p.y += Math.sin(p.heading) * SLANT * px;
    const stride = 0.34 + (0.8 - 0.34) * Math.min(1, Math.max(0, (p.speed - 1) / 0.8));
    p.phase += ((p.speed * dt) / stride) * Math.PI * 2;
    return false;
  }

  /** The box it stands in, if any: where its body overlaps a tile. */
  private boxAround(p: Pup): Box | null {
    return this.boxes().find((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) ?? null;
  }

  /** Just outside the box, by its nearest side that is on screen. */
  private exitOf(p: Pup, b: Box) {
    const m = 0.1 * this.unit;
    const ways = [
      { x: b.x0 - m, y: p.y, d: p.x - b.x0 }, { x: b.x1 + m, y: p.y, d: b.x1 - p.x },
      { x: p.x, y: b.y0 - m, d: p.y - b.y0 }, { x: p.x, y: b.y1 + m, d: b.y1 - p.y },
    ].filter((o) => o.x > 0 && o.x < this.w && o.y > 0.6 * this.unit && o.y < this.h);
    ways.sort((a, c) => a.d - c.d);
    return ways[0] ?? { x: this.w / 2, y: this.h - 0.2 * this.unit };
  }

  /** Where its feet may not go: each tile, grown by its body. */
  private boxes(pad = 0): Box[] {
    const u = this.unit;
    return this.tiles.map((b) => ({ x0: b.x0 - 0.5 * u - pad, x1: b.x1 + 0.5 * u + pad, y0: b.y0 - 0.15 * u - pad, y1: b.y1 + 0.85 * u + pad }));
  }

  private feetBlocked(x: number, y: number, pad: number) {
    return this.boxes(pad).some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);
  }

  /** The way from where it is to `goal`, round the tiles: the corners to go by, in order (none when
   *  straight there is clear). The shortest way over the tiles' corners; if there is none, none. */
  private route(p: Pup, goal: { x: number; y: number }): { x: number; y: number }[] {
    const u = this.unit;
    const boxes = this.boxes(0.05 * u);
    if (!firstHit(p.x, p.y, goal.x, goal.y, boxes)) return [];
    const m = 0.12 * u;
    const inBox = (c: { x: number; y: number }) => boxes.some((b) => c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1);
    const nodes: { x: number; y: number }[] = [{ x: p.x, y: p.y }, goal];
    for (const b of boxes) {
      for (const c of [{ x: b.x0 - m, y: b.y0 - m }, { x: b.x1 + m, y: b.y0 - m }, { x: b.x0 - m, y: b.y1 + m }, { x: b.x1 + m, y: b.y1 + m }]) {
        if (c.x > 0.3 * u && c.x < this.w - 0.3 * u && c.y > 0.8 * u && c.y < this.h - 0.05 * u && !inBox(c)) nodes.push(c);
      }
    }
    // Dijkstra over the corners, an edge wherever the way between two is clear.
    const n = nodes.length;
    const dist = new Array<number>(n).fill(Infinity), prev = new Array<number>(n).fill(-1), done = new Array<boolean>(n).fill(false);
    dist[0] = 0;
    for (;;) {
      let i = -1;
      for (let k = 0; k < n; k++) if (!done[k] && dist[k]! < Infinity && (i < 0 || dist[k]! < dist[i]!)) i = k;
      if (i < 0 || i === 1) break;
      done[i] = true;
      const a = nodes[i]!;
      for (let k = 0; k < n; k++) {
        if (done[k]) continue;
        const b = nodes[k]!;
        const nd = dist[i]! + Math.hypot(b.x - a.x, b.y - a.y);
        if (nd < dist[k]! && !firstHit(a.x, a.y, b.x, b.y, boxes)) { dist[k] = nd; prev[k] = i; }
      }
    }
    if (prev[1] === -1) return [];
    const way: { x: number; y: number }[] = [];
    for (let k = prev[1]!; k > 0; k = prev[k]!) way.unshift(nodes[k]!);
    return way;
  }

  private hopUp(p: Pup, v: number) {
    if (p.hop > 0.02) return;
    p.hopV = v;
    p.hop = 0.001;
  }

  /** Pups keep a little apart; one that calls holds its place and the others give way. */
  private separate(dt: number) {
    const ps = [...this.pups.values()].filter((p) => !p.leaving);
    const min = 0.75 * this.unit;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!, b = ps[j]!;
        const dx = b.x - a.x, dy = (b.y - a.y) / SLANT;
        const d = Math.hypot(dx, dy);
        if (d >= min || d === 0) continue;
        const push = ((min - d) / d) * Math.min(1, dt * 3);
        const wa = a.state === "needs-you" ? 0 : b.state === "needs-you" ? 1 : 0.5;
        a.x -= dx * push * wa; a.y -= dy * SLANT * push * wa;
        b.x += dx * push * (1 - wa); b.y += dy * SLANT * push * (1 - wa);
      }
    }
  }

  // ── places ───────────────────────────────────────────────────────────────

  /** Would a pup standing at (x, y) have any of its body under a tile (grown by `pad`)? */
  private bodyCovered(x: number, y: number, _size: number, pad: number) {
    return this.feetBlocked(x, y, pad);
  }

  /** Is the point under a tile (grown by `pad`)? */
  covered(x: number, y: number, pad: number) {
    return this.tiles.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad);
  }

  /** Somewhere open a pup can get to without passing under a tile; `ahead` prefers spots it
   *  would not have to turn round for. */
  private openSpot(p: Pup, from: { x: number; y: number }, ahead: boolean) {
    const u = this.unit;
    let best = { x: this.w / 2, y: this.h * 0.6 }, bestCost = Infinity;
    for (let i = 0; i < 24; i++) {
      const c = { x: this.w * (0.06 + 0.88 * this.rand()), y: this.h * (0.18 + 0.74 * this.rand()) };
      if (this.bodyCovered(c.x, c.y, p.size, 0.25 * u)) continue;
      let cost = firstHit(from.x, from.y, c.x, c.y, this.boxes()) ? 3 : 0;
      const dist = Math.hypot(c.x - from.x, c.y - from.y) / u;
      cost += Math.abs(dist - 3) * 0.15;
      if (ahead) {
        const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(c.y - from.y, c.x - from.x) - p.heading), Math.cos(Math.atan2(c.y - from.y, c.x - from.x) - p.heading)));
        cost += turn * 0.4;
      }
      if (cost < bestCost) { best = c; bestCost = cost; }
    }
    return best;
  }

  /** A sleeping place along the bottom fifth, in the open, away from the others. */
  private restSpot(p: Pup) {
    const pick = () => ({ x: this.w * (0.06 + 0.88 * this.rand()), y: this.h * (0.84 + 0.12 * this.rand()) });
    return this.roomiest(p, 24, pick, 0.15 * this.unit) ?? { x: this.w * (0.1 + 0.8 * p.seed), y: this.h * 0.92 };
  }

  /** By the open side of its agent's tile, clear of other tiles, where you will look. */
  visitSpot(tile: WallpaperTile, p: Pup) {
    const u = this.unit * p.size;
    const right = this.w - tile.x1 > tile.x0;
    const midY = Math.min(this.h - 0.3 * u, Math.max(0.9 * u, (tile.y0 + tile.y1) / 2 + 0.3 * u));
    const midX = (tile.x0 + tile.x1) / 2;
    const r = 0.62 * u;
    const spots = [
      { x: right ? tile.x1 + r : tile.x0 - r, y: midY },
      { x: right ? tile.x0 - r : tile.x1 + r, y: midY },
      { x: midX, y: tile.y1 + 0.95 * u },
      { x: midX, y: tile.y0 - 0.25 * u },
    ];
    const others = this.tiles.filter((b) => b !== tile);
    const fits = (s: { x: number; y: number }) =>
      s.x > 0.5 * u && s.x < this.w - 0.5 * u && s.y > 0.9 * u && s.y < this.h - 0.1 * u &&
      !others.some((b) => s.x + 0.5 * u > b.x0 && s.x - 0.5 * u < b.x1 && s.y + 0.15 * u > b.y0 && s.y - 0.85 * u < b.y1);
    return spots.find(fits) ?? spots[0]!;
  }
}

/** The first box the segment from (ax, ay) to (bx, by) passes through, or null. */
function firstHit(ax: number, ay: number, bx: number, by: number, boxes: readonly Box[]): Box | null {
  let best: Box | null = null, bt = Infinity;
  const dx = bx - ax, dy = by - ay;
  for (const b of boxes) {
    // Liang–Barsky: where the segment enters and leaves the box.
    let t0 = 0, t1 = 1, ok = true;
    for (const [pp, q] of [[-dx, ax - b.x0], [dx, b.x1 - ax], [-dy, ay - b.y0], [dy, b.y1 - ay]] as const) {
      if (pp === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / pp;
      if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (ok && t0 < bt) { bt = t0; best = b; }
  }
  return best;
}

/** How much shorter a step toward or away from you looks on screen than one across: the ground is
 *  seen from above at a slant (sin of the camera's 40° elevation). */
export const SLANT = Math.sin((40 * Math.PI) / 180);
