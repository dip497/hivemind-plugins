/**
 * Brick Town's drawing. Every still brick the window shows (the baseplate's studs, the streets and
 * pavements, the houses with their windows and doors and stepped roofs, the trees, lamps, fountains
 * and the railway) is a stage painted once per size and look, with the night's lights laid over it;
 * each frame copies it and draws what moves over it nearest last (cars, the train, people, dropped
 * bricks), each covered again by the still bricks in front of it.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import type { Drawer } from "../scene";
import { cssAlpha, rgbOf, type Oklch, type Rgb } from "../colour";
import { drawActors, Face, flat, mixRgb, screenX, screenY, sprite, Stage, type Actor, type Paint, type Raster, type Sprite } from "../iso";
import { faceOf, SPECK_DARK, SPECK_LIGHT, type Faces } from "../textures";
import { clamp, hash2 } from "../rng";
import { alongTrack, Ground, PARK_BOX, PERIOD, type House, type Lot } from "./plan";
import { BRICK_COLOURS, roofOver, TRAIN, type Car, type Town } from "./town";
import { TOWN_PALETTE, type TownPalette } from "./palette";
import type { Shades } from "../island/palette";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const facesOf = (s: Shades): Faces => ({ top: rgbOf(s.top), left: rgbOf(s.left), right: rgbOf(s.right) });
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** How tall a stud stands on a brick, in bricks, and how wide it is round. */
const STUD_H = 0.16;
const STUD_R = 0.29;
const PEOPLE = 8;

interface Kit {
  plate: Sprite;
  road: Sprite[];
  walk: Sprite;
  paving: Sprite;
  path: Sprite;
  water: Sprite;
  track: Sprite[];
  corners: Sprite[];
  bed: Sprite[];
  /** A wall's bricks, by colour: plain on even and odd courses, a window (lit and dark), a door. */
  walls: { plain: Sprite[]; window: Sprite; dark: Sprite; door: Sprite }[];
  roofs: Sprite[][];
  trees: Sprite[];
  lamp: Sprite;
  fountain: Sprite;
  cars: Sprite[];
  engine: Sprite[];
  wagons: Sprite[][];
  people: Sprite[];
  bricks: Sprite[];
  glow: OffscreenCanvas;
}

export class TownRenderer implements Drawer<Town> {
  private g: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dark = true;
  private look: TownPalette = TOWN_PALETTE.dark;
  private kit: Kit | null = null;
  private stage = new Stage();
  private cache = new OffscreenCanvas(1, 1);
  private builtFor = "";

  constructor(private canvas: HTMLCanvasElement) {
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("2D canvas unavailable");
    this.g = g;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.builtFor = "";
  }

  setLook(look: WallpaperLook) {
    if (look.dark === this.dark && this.kit) return;
    this.dark = look.dark;
    this.look = TOWN_PALETTE[look.dark ? "dark" : "light"];
    this.builtFor = "";
  }

  draw(town: Town) {
    if (!town.plan || !this.width) return;
    const key = `${town.iso.S}:${town.iso.ox}:${town.iso.oy}:${this.dark}:${this.canvas.width}x${this.canvas.height}`;
    if (key !== this.builtFor) {
      this.kit = this.makeKit(town.iso.S, town.iso.HZ);
      this.build(town);
      this.builtFor = key;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.cache, 0, 0);
    this.drawShadows(g, town);
    drawActors(g, this.stage, this.actors(town));
  }

  // ── sprites ──────────────────────────────────────────────────────────────

  private makeKit(S: number, HZ: number): Kit {
    const P = this.look;
    const studded = (paint: Paint, f: Faces, h = 1) => sprite(S, HZ, [0, 0, 0, 1, 1, h + STUD_H + 0.05], (r) => {
      r.box(0, 0, 0, 1, 1, h, paint);
      stud(r, 0.5, 0.5, h, f);
    });
    const tile = (paint: Paint, top = 0) => sprite(S, HZ, [0, 0, -0.2, 1, 1, top], (r) => r.box(0, 0, -0.2, 1, 1, top, paint));
    const plate = facesOf(P.plate);
    const dash = rgbOf(P.dash);
    const road = facesOf(P.road);
    const roadPaint = (mark: (u: number, v: number) => boolean): Paint => (f, u, v) => (f === Face.Top && mark(u, v) ? dash : faceOf(road, f));
    const dashes = (t: number) => Math.floor(t * 4) % 2 === 0;
    const walk = facesOf(P.walk);
    const paving = facesOf(P.paving);
    const gravel = facesOf(P.gravel);
    const sleeper = rgbOf(P.sleeper);
    const rail = rgbOf(P.rail);
    const trackPaint = (railAt: (u: number, v: number) => number, sleeperAt: (u: number, v: number) => boolean): Paint => (f, u, v) => {
      if (f !== Face.Top) return faceOf(gravel, f);
      if (railAt(u, v) < 0.045) return rail;
      if (sleeperAt(u, v)) return sleeper;
      return speck(gravel.top, u, v, 3);
    };
    const straight = (along: "x" | "y") => trackPaint(
      (u, v) => { const a = along === "x" ? v : u; return Math.min(Math.abs(a - 0.3), Math.abs(a - 0.7)); },
      (u, v) => { const [s, a] = along === "x" ? [u, v] : [v, u]; return (s * 2) % 1 > 0.15 && (s * 2) % 1 < 0.4 && a > 0.16 && a < 0.84; },
    );
    // A corner turns about the cell's corner (cu, cv): its rails quarter circles round it.
    const corner = (cu: number, cv: number) => trackPaint(
      (u, v) => { const d = Math.hypot(u - cu, v - cv); return Math.min(Math.abs(d - 0.3), Math.abs(d - 0.7)); },
      (u, v) => { const d = Math.hypot(u - cu, v - cv); const a = Math.atan2(v - cv, u - cu); return d > 0.16 && d < 0.84 && ((a * 6) / Math.PI + 12) % 1 > 0.55; },
    );
    const flowers = P.flowers.map(rgbOf);
    const kit: Kit = {
      plate: sprite(S, HZ, [0, 0, -0.2, 1, 1, STUD_H + 0.05], (r) => { r.box(0, 0, -0.2, 1, 1, 0, flat(plate.top, plate.left, plate.right)); stud(r, 0.5, 0.5, 0, plate); }),
      road: [
        tile(roadPaint(() => false)),
        tile(roadPaint((u, v) => u > 0.94 && dashes(v))),
        tile(roadPaint((u, v) => u < 0.06 && dashes(v))),
        tile(roadPaint((u, v) => v > 0.94 && dashes(u))),
        tile(roadPaint((u, v) => v < 0.06 && dashes(u))),
      ],
      walk: tile((f, u, v) => (f === Face.Top && (u < 0.04 || v < 0.04) ? mixRgb(walk.top, BLACK, SPECK_DARK) : faceOf(walk, f))),
      paving: tile((f, u, v) => (f === Face.Top && ((u * 2) % 1 < 0.05 || (v * 2) % 1 < 0.05) ? mixRgb(paving.top, BLACK, SPECK_DARK) : faceOf(paving, f))),
      path: tile((f, u, v) => (f === Face.Top ? speck(rgbOf(P.path.top), u, v, 5) : faceOf(facesOf(P.path), f))),
      water: tile((f, u, v) => (f === Face.Top && Math.floor(u * 8 + v * 16) % 7 === 0 ? mixRgb(rgbOf(P.water.top), WHITE, SPECK_LIGHT) : faceOf(facesOf(P.water), f)), -0.12),
      track: [tile(straight("x")), tile(straight("y"))],
      corners: [tile(corner(1, 1)), tile(corner(0, 1)), tile(corner(0, 0)), tile(corner(1, 0))],
      bed: flowers.map((colour, k) => sprite(S, HZ, [0, 0, -0.2, 1, 1, 0.5], (r) => {
        r.box(0, 0, -0.2, 1, 1, 0, flat(plate.top, plate.left, plate.right));
        const leaf = facesOf(P.leaves);
        for (const [x, y] of [[0.3, 0.3], [0.7, 0.4], [0.4, 0.72]] as const) {
          r.cylinder(x, y, 0, 0.18, 0.06, leaf.top, leaf.left, leaf.right);
          r.cylinder(x, y, 0.18, 0.28, 0.13 + 0.02 * k, colour, mixRgb(colour, BLACK, 0.1), mixRgb(colour, BLACK, 0.25));
        }
      })),
      walls: P.walls.map((w) => this.wallKit(S, HZ, facesOf(w))),
      roofs: P.roofs.map((roof) => [false, true].map((odd) => studded(brickPaint(facesOf(roof), odd), facesOf(roof)))),
      trees: [true, false].map((big) => this.tree(S, HZ, big)),
      lamp: this.lamp(S, HZ),
      fountain: sprite(S, HZ, [-1.2, -1.2, 0, 1.2, 1.2, 1.4], (r) => {
        const stone = facesOf(P.walk);
        const water = facesOf(P.water);
        r.cylinder(0, 0, 0, 0.32, 1.1, stone.top, stone.left, stone.right, mixRgb(stone.top, WHITE, 0.3));
        r.cylinder(0, 0, 0.32, 0.33, 0.95, water.top, water.left, water.right);
        r.cylinder(0, 0, 0.3, 0.82, 0.14, stone.top, stone.left, stone.right);
        r.cylinder(0, 0, 0.78, 0.9, 0.42, stone.top, stone.left, stone.right, mixRgb(stone.top, WHITE, 0.3));
        r.cylinder(0, 0, 0.9, 0.91, 0.34, water.top, water.left, water.right);
        r.cylinder(0, 0, 0.9, 1.25, 0.05, WHITE, mixRgb(water.top, WHITE, 0.6), mixRgb(water.top, WHITE, 0.4));
      }),
      cars: [],
      engine: [0, 1, 2, 3].map((dir) => {
        const img = sprite(S, HZ, [-2, -2, 0, 2, 2, 1.6], (r) => engine(r, dir, facesOf(P.engine), this.look, this.dark));
        if (P.headlight) halo(img, S, HZ, ahead(dir, 1.35), 0.5, rgbOf(P.headlight), S * 1.1);
        return img;
      }),
      wagons: P.wagons.map((w) => [0, 1, 2, 3].map((dir) => sprite(S, HZ, [-1.3, -1.3, 0, 1.3, 1.3, 1.4], (r) => wagon(r, dir, facesOf(w), this.look)))),
      people: [],
      bricks: P.bricks.map((b) => studded(brickPaint(facesOf(b), false), facesOf(b))),
      glow: glowSprite(rgbOf(P.lit ?? P.lamp), 64),
    };
    // By night a car's lights throw a glow on the road before it, in the car's own picture, so a
    // house in front of the car covers it too.
    const beam = P.headlight ? rgbOf(P.headlight) : null;
    for (let c = 0; c < BRICK_COLOURS; c++) {
      for (let dir = 0; dir < 4; dir++) {
        const img = sprite(S, HZ, [-1.9, -1.9, 0, 1.9, 1.9, 1.3], (r) => car(r, dir, facesOf(P.bricks[c]!), this.look, this.dark));
        if (beam) halo(img, S, HZ, ahead(dir, 1.25), 0.25, beam, S * 1.1);
        kit.cars.push(img);
      }
    }
    for (let k = 0; k < PEOPLE; k++) {
      for (let dir = 0; dir < 4; dir++) {
        for (let pose = 0; pose < 4; pose++) kit.people.push(sprite(S, HZ, [-0.4, -0.4, 0, 0.4, 0.4, 1.35], (r) => person(r, dir, pose, k, this.look)));
      }
    }
    return kit;
  }

  private wallKit(S: number, HZ: number, f: Faces) {
    const P = this.look;
    const brick = (paint: Paint) => sprite(S, HZ, [0, 0, 0, 1, 1, 1 + STUD_H + 0.05], (r) => {
      r.box(0, 0, 0, 1, 1, 1, paint);
      stud(r, 0.5, 0.5, 1, f);
    });
    const frame = rgbOf(P.frame);
    const pane = rgbOf(P.pane);
    const lit = P.lit ? rgbOf(P.lit) : pane;
    const glazed = (glass: Rgb, shine: boolean): Paint => {
      const wall = brickPaint(f, false);
      return (face, u, v) => {
        if (face === Face.Top || u < 0.2 || u > 0.8 || v < 0.18 || v > 0.78) return wall(face, u, v);
        if (u < 0.27 || u > 0.73 || v < 0.25 || v > 0.71 || Math.abs(u - 0.5) < 0.035) return frame;
        // A glint of the sky across the glass by day; by night the light inside, warmer low down.
        if (shine && Math.abs(u - v + 0.05) < 0.07) return mixRgb(glass, WHITE, 0.45);
        return P.lit && glass === lit ? mixRgb(glass, rgbOf([0.75, 0.15, 60] as Oklch), (v - 0.25) * 0.5) : glass;
      };
    };
    const door = rgbOf(P.door);
    const doorPaint: Paint = (face, u, v) => {
      if (face !== Face.Left || u < 0.26 || u > 0.74 || v < 0.16) return brickPaint(f, false)(face, u, v);
      if (u < 0.31 || u > 0.69 || v < 0.21) return frame;
      return Math.abs(u - 0.62) < 0.04 && Math.abs(v - 0.6) < 0.05 ? frame : door;
    };
    return {
      plain: [false, true].map((odd) => brick(brickPaint(f, odd))),
      window: brick(glazed(lit, !P.lit)),
      dark: brick(glazed(pane, !P.lit)),
      door: brick(doorPaint),
    };
  }

  /** A street lamp: a post with a lantern on it; by night a soft halo round the lantern, in the
   *  lamp's own picture so whatever stands in front of the lamp covers its light too. */
  private lamp(S: number, HZ: number): Sprite {
    const P = this.look;
    const post = facesOf(P.post);
    const light = rgbOf(P.lamp);
    const s = sprite(S, HZ, [-0.8, -0.8, 0, 1.8, 1.8, 2.6], (r) => {
      r.cylinder(0.5, 0.5, 0, 1.55, 0.06, post.top, post.left, post.right);
      r.cylinder(0.5, 0.5, 0, 0.12, 0.13, post.top, post.left, post.right);
      r.box(0.36, 0.36, 1.48, 0.64, 0.64, 1.72, (f) => (f === Face.Top ? post.top : light));
      r.box(0.33, 0.33, 1.72, 0.67, 0.67, 1.78, flat(post.top, post.left, post.right));
    });
    if (P.pool) {
      const g = s.canvas.getContext("2d")!;
      const at = { S, HZ, ox: -s.dx, oy: -s.dy };
      const X = screenX(at, 0.5, 0.5);
      const Y = screenY(at, 0.5, 0.5, 1.6);
      const R = S * 1.3;
      const grad = g.createRadialGradient(X, Y, 0, X, Y, R);
      grad.addColorStop(0, cssAlpha(light, 0.55));
      grad.addColorStop(0.35, cssAlpha(light, 0.18));
      grad.addColorStop(1, cssAlpha(light, 0));
      g.globalCompositeOperation = "destination-over";
      g.fillStyle = grad;
      g.fillRect(X - R, Y - R, 2 * R, 2 * R);
    }
    return s;
  }

  /** A round toy tree: a stem, then rounds of green narrowing up to a stud. */
  private tree(S: number, HZ: number, big: boolean): Sprite {
    const leaf = facesOf(this.look.leaves);
    const trunk = facesOf(this.look.trunk);
    return sprite(S, HZ, [0, 0, 0, 1, 1, 2.2], (r) => {
      r.cylinder(0.5, 0.5, 0, 0.55, 0.11, trunk.top, trunk.left, trunk.right);
      const tiers = big ? [[0.47, 0.45, 0.85], [0.38, 0.85, 1.22], [0.27, 1.22, 1.55]] : [[0.38, 0.42, 0.76], [0.27, 0.76, 1.06]];
      for (const [rad, z0, z1] of tiers) r.cylinder(0.5, 0.5, z0!, z1!, rad!, mixRgb(leaf.top, WHITE, SPECK_LIGHT * 0.5), leaf.left, leaf.right, mixRgb(leaf.top, WHITE, SPECK_LIGHT));
      const top = tiers[tiers.length - 1]![2]!;
      r.cylinder(0.5, 0.5, top, top + STUD_H, 0.12, leaf.top, leaf.left, leaf.right);
    });
  }

  // ── the stage ────────────────────────────────────────────────────────────

  private build(town: Town) {
    const { iso, plan } = town;
    const kit = this.kit!;
    const stage = this.stage;
    stage.clear();
    const v = town.view(2);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const key = (x: number, y: number, k: number) => (x + y) * 4096 + k + 64;
    const shows = (img: Sprite, X: number, Y: number) => X + img.dx < W && X + img.dx + img.w > 0 && Y + img.dy < H && Y + img.dy + img.h > 0;
    const put = (img: Sprite, x: number, y: number, z: number, box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, order: number) => {
      const X = screenX(iso, x, y);
      const Y = screenY(iso, x, y, z);
      if (shows(img, X, Y)) stage.add(img, X, Y, box, order);
    };
    const lights: { x: number; y: number }[] = [];
    // The ground.
    for (let y = v.y0; y <= v.y1; y++) {
      for (let x = v.x0; x <= v.x1; x++) {
        const g = plan.ground(x, y);
        let img = kit.plate;
        if (g === Ground.Road) img = this.roadTile(x, y);
        else if (g === Ground.Walk) img = kit.walk;
        else if (g === Ground.Paving) img = kit.paving;
        else if (g === Ground.Path) img = kit.path;
        else if (g === Ground.Water) img = kit.water;
        else if (g === Ground.Track) img = this.trackTile(x, y);
        put(img, x, y, 0, { x0: x, y0: y, z0: -0.2, x1: x + 1, y1: y + 1, z1: 0 }, key(x, y, -1));
      }
    }
    // What stands on it, lot by lot.
    const seen = new Set<Lot>();
    for (const lot of plan.lotsIn(v.x0, v.y0, v.x1, v.y1)) {
      if (seen.has(lot)) continue;
      seen.add(lot);
      for (const h of lot.houses) this.house(h, put, key);
      for (const t of lot.trees) put(t.big ? kit.trees[0]! : kit.trees[1]!, t.x, t.y, 0, { x0: t.x + 0.05, y0: t.y + 0.05, z0: 0, x1: t.x + 0.95, y1: t.y + 0.95, z1: 1.8 }, key(t.x, t.y, 0));
      for (const b of lot.beds) put(kit.bed[b.colour % kit.bed.length]!, b.x, b.y, 0, { x0: b.x, y0: b.y, z0: -0.2, x1: b.x + 1, y1: b.y + 1, z1: 0.3 }, key(b.x, b.y, 0));
      for (const l of lot.lamps) {
        put(kit.lamp, l.x, l.y, 0, { x0: l.x + 0.35, y0: l.y + 0.35, z0: 0, x1: l.x + 0.65, y1: l.y + 0.65, z1: 1.8 }, key(l.x, l.y, 0));
        lights.push({ x: l.x + 0.5, y: l.y + 0.5 });
      }
      if (lot.fountain) {
        const f = lot.fountain;
        put(kit.fountain, f.x, f.y, 0, { x0: f.x - 1.1, y0: f.y - 1.1, z0: 0, x1: f.x + 1.1, y1: f.y + 1.1, z1: 1.25 }, key(Math.floor(f.x), Math.floor(f.y), 0) + 2);
      }
    }
    stage.finish();
    this.cache.width = W;
    this.cache.height = H;
    const g = this.cache.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    // The ground first, then by night the pools of light the lamps throw on it, then what stands.
    const flatOnes = stage.pieces.filter((p) => p.z1 <= 0.01);
    for (const p of flatOnes) g.drawImage(p.img, p.X, p.Y);
    const P = this.look;
    if (P.pool) {
      g.globalCompositeOperation = "lighter";
      const pool = glowSprite(rgbOf(P.pool.colour), 64);
      g.globalAlpha = P.pool.alpha;
      for (const l of lights) {
        const X = screenX(iso, l.x, l.y);
        const Y = screenY(iso, l.x, l.y, 0);
        g.drawImage(pool, Math.round(X - iso.S * 2.4), Math.round(Y - iso.S * 1.2), Math.round(iso.S * 4.8), Math.round(iso.S * 2.4));
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    for (const p of stage.pieces) if (p.z1 > 0.01) g.drawImage(p.img, p.X, p.Y);
  }

  private roadTile(x: number, y: number): Sprite {
    const kit = this.kit!;
    const mx = ((x % PERIOD) + PERIOD) % PERIOD;
    const my = ((y % PERIOD) + PERIOD) % PERIOD;
    const alongY = mx < 2;
    const alongX = my < 2;
    if (alongX && alongY) return kit.road[0]!;
    if (alongY) return kit.road[mx === 0 ? 1 : 2]!;
    return kit.road[my === 0 ? 3 : 4]!;
  }

  private trackTile(x: number, y: number): Sprite {
    const kit = this.kit!;
    const a = PARK_BOX.x0 + 1;
    const b = PARK_BOX.x1 - 2;
    if (x === a && y === a) return kit.corners[0]!;
    if (x === b && y === a) return kit.corners[1]!;
    if (x === b && y === b) return kit.corners[2]!;
    if (x === a && y === b) return kit.corners[3]!;
    return kit.track[y === a || y === b ? 0 : 1]!;
  }

  /** A house's bricks that show: walls with windows and a door, then its roof in steps. */
  private house(h: House, put: (img: Sprite, x: number, y: number, z: number, box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, order: number) => void, key: (x: number, y: number, k: number) => number) {
    const kit = this.kit!;
    const wall = kit.walls[h.wall % kit.walls.length]!;
    const roof = kit.roofs[h.roof % kit.roofs.length]!;
    const top = (x: number, y: number) => (x < h.x0 || y < h.y0 || x >= h.x0 + h.w || y >= h.y0 + h.d ? 0 : h.floors + roofOver(h, x, y));
    const doorAt = h.x0 + Math.floor(h.w / 2);
    for (let y = h.y0; y < h.y0 + h.d; y++) {
      for (let x = h.x0; x < h.x0 + h.w; x++) {
        const t = top(x, y);
        for (let k = 0; k < t; k++) {
          // Hidden behind a brick in front and one on top.
          if (k + 1 < t && top(x + 1, y) > k && top(x, y + 1) > k) continue;
          const front = y === h.y0 + h.d - 1;
          const side = x === h.x0 + h.w - 1;
          let img: Sprite;
          if (k >= h.floors || (h.flat && k === h.floors - 1)) img = roof[k % 2]!;
          else if (k === 0 && front && x === doorAt && !side) img = wall.door;
          else if ((front !== side) && (x + y + k) % 2 === 1 && k < h.floors) {
            img = hash2(x * 7 + k, y * 13, 19) < 0.62 ? wall.window : wall.dark;
          } else img = wall.plain[k % 2]!;
          put(img, x, y, k, { x0: x, y0: y, z0: k, x1: x + 1, y1: y + 1, z1: k + 1 }, key(x, y, k));
        }
      }
    }
  }

  // ── what moves ───────────────────────────────────────────────────────────

  private actors(town: Town): Actor[] {
    const { iso } = town;
    const kit = this.kit!;
    const out: Actor[] = [];
    const place = (img: Sprite, x: number, y: number, z: number, box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, key: number, alpha?: number) => {
      const a: Actor = { ...box, key, img: img.canvas, X: screenX(iso, x, y) + img.dx, Y: screenY(iso, x, y, z) + img.dy };
      if (alpha !== undefined) a.alpha = alpha;
      out.push(a);
    };
    for (const c of town.cars) {
      const [x, y] = carAt(c);
      const dir = c.axis === "x" ? (c.dir > 0 ? 0 : 2) : c.dir > 0 ? 1 : 3;
      const [hx, hy] = c.axis === "x" ? [0.85, 0.42] : [0.42, 0.85];
      place(kit.cars[c.colour * 4 + dir]!, x, y, 0, { x0: x - hx, y0: y - hy, z0: 0, x1: x + hx, y1: y + hy, z1: 1 }, x + y);
    }
    TRAIN.forEach((back, k) => {
      const at = alongTrack(town.train.d - back);
      const img = k === 0 ? kit.engine[at.dir]! : kit.wagons[(k - 1) % kit.wagons.length]![at.dir]!;
      const [hx, hy] = at.dir % 2 === 0 ? [1, 0.42] : [0.42, 1];
      place(img, at.x, at.y, 0, { x0: at.x - hx, y0: at.y - hy, z0: 0, x1: at.x + hx, y1: at.y + hy, z1: 1.3 }, at.x + at.y);
    });
    for (const p of town.people) {
      const pose = p.look > 0.5 ? 3 : town.time < p.pause ? 0 : 1 + (Math.floor(p.stepPhase * 2) % 2);
      place(kit.people[((p.id % PEOPLE) * 4 + p.face) * 4 + pose]!, p.x, p.y, 0, { x0: p.x - 0.2, y0: p.y - 0.2, z0: 0, x1: p.x + 0.2, y1: p.y + 0.2, z1: 1.1 }, p.x + p.y);
    }
    for (const b of town.bricks) {
      const alpha = b.state === "leaving" ? clamp(1 - b.age / 0.8, 0, 1) : undefined;
      place(kit.bricks[b.colour % kit.bricks.length]!, b.x, b.y, b.z, { x0: b.x, y0: b.y, z0: b.z, x1: b.x + 1, y1: b.y + 1, z1: b.z + 1 }, b.x + b.y + 1 + b.z * 0.001, alpha);
    }
    return out;
  }

  /** A falling brick's shadow on where it will land, darker as it nears. */
  private drawShadows(g: Ctx, town: Town) {
    const { iso } = town;
    for (const b of town.bricks) {
      if (b.state !== "falling" || b.z - b.rest < 0.05) continue;
      const near = clamp(1 - (b.z - b.rest) / 12, 0.15, 1);
      g.fillStyle = `rgba(0,0,0,${(0.22 * near).toFixed(3)})`;
      const cx = screenX(iso, b.x + 0.5, b.y + 0.5);
      const cy = screenY(iso, b.x + 0.5, b.y + 0.5, b.rest);
      const r = 0.45 + 0.4 * (1 - near);
      g.beginPath();
      g.moveTo(cx, cy - (r * iso.S) / 2);
      g.lineTo(cx + r * iso.S, cy);
      g.lineTo(cx, cy + (r * iso.S) / 2);
      g.lineTo(cx - r * iso.S, cy);
      g.closePath();
      g.fill();
    }
  }
}

const carAt = (c: Car): [number, number] => (c.axis === "x" ? [c.s, c.line + 0.5] : [c.line + 0.5, c.s]);

// ── the bricks ───────────────────────────────────────────────────────────

/** A toy brick's faces: smooth plastic lighter toward the top, a highlight along each top edge,
 *  the seam where it sits on the brick below, and on alternate courses the joint between two
 *  bricks half way along, so a wall shows its bond. */
function brickPaint(f: Faces, odd: boolean): Paint {
  return (face, u, v) => {
    const c = faceOf(f, face);
    if (face === Face.Top) return u < 0.08 || v < 0.08 ? mixRgb(c, WHITE, SPECK_LIGHT) : c;
    if (v < 0.07) return mixRgb(c, WHITE, SPECK_LIGHT);
    if (v > 0.93) return mixRgb(c, BLACK, SPECK_DARK);
    if (odd && Math.abs(u - 0.5) < 0.025) return mixRgb(c, BLACK, SPECK_DARK);
    return mixRgb(c, WHITE, (1 - v) * SPECK_LIGHT * 0.5);
  };
}

/** A stud on a brick's top at (x, y), level `z`: a short round post with a lit rim. */
function stud(r: Raster, x: number, y: number, z: number, f: Faces, radius = STUD_R) {
  r.cylinder(x, y, z, z + STUD_H, radius, mixRgb(f.top, WHITE, SPECK_LIGHT * 0.6), mixRgb(f.left, WHITE, SPECK_LIGHT * 0.4), f.right, mixRgb(f.top, WHITE, SPECK_LIGHT));
}

/** A texel speckle on a flat colour, for gravel and paths. */
function speck(c: Rgb, u: number, v: number, salt: number): Rgb {
  const h = hash2(Math.floor(u * 8), Math.floor(v * 8), salt);
  return h < 0.25 ? mixRgb(c, BLACK, SPECK_DARK) : h > 0.85 ? mixRgb(c, WHITE, SPECK_LIGHT) : c;
}

function turned(dir: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  switch (dir) {
    case 1: return [-y1, x0, -y0, x1];
    case 2: return [-x1, -y1, -x0, -y0];
    case 3: return [y0, -x1, y1, -x0];
    default: return [x0, y0, x1, y1];
  }
}
function turnedPoint(dir: number, x: number, y: number): [number, number] {
  switch (dir) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}
function part(r: Raster, dir: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, paint: Paint) {
  const [a, b, c, d] = turned(dir, x0, y0, x1, y1);
  r.box(a, b, z0, c, d, z1, paint);
}
function studAt(r: Raster, dir: number, x: number, y: number, z: number, f: Faces, radius = 0.12) {
  const [a, b] = turnedPoint(dir, x, y);
  stud(r, a, b, z, f, radius);
}
const shade = (c: Rgb): Faces => ({ top: c, left: mixRgb(c, BLACK, 0.1), right: mixRgb(c, BLACK, 0.22) });
const flatOf = (f: Faces) => flat(f.top, f.left, f.right);

/** A toy car facing +x (turned to `dir`): wheels, a chassis, its body in its colour, a cabin of
 *  glass, headlights, studs on the bonnet and the roof. */
function car(r: Raster, dir: number, body: Faces, P: TownPalette, dark: boolean) {
  const tyre = shade(rgbOf(P.tyre));
  const glass = rgbOf(P.glass);
  for (const [x, y] of [[0.5, 0.33], [0.5, -0.43], [-0.5, 0.33], [-0.5, -0.43]] as const) part(r, dir, x - 0.14, y, 0, x + 0.14, y + 0.1, 0.26, flatOf(tyre));
  part(r, dir, -0.82, -0.34, 0.1, 0.82, 0.34, 0.24, flatOf(shade(mixRgb(rgbOf(P.tyre), WHITE, 0.25))));
  part(r, dir, -0.82, -0.38, 0.24, 0.82, 0.38, 0.56, brickPaint(body, false));
  const cabin: Paint = (f, u, v) => (f === Face.Top ? body.top : v > 0.15 && v < 0.9 && u > 0.08 && u < 0.92 ? (f === Face.Left ? glass : mixRgb(glass, BLACK, 0.12)) : faceOf(body, f));
  part(r, dir, -0.46, -0.34, 0.56, 0.26, 0.34, 0.9, cabin);
  const lamp = dark && P.headlight ? rgbOf(P.headlight) : mixRgb(body.top, WHITE, 0.7);
  for (const y of [-0.28, 0.16]) part(r, dir, 0.82, y, 0.36, 0.86, y + 0.12, 0.46, flat(lamp, lamp, lamp));
  studAt(r, dir, 0.55, -0.15, 0.56, body);
  studAt(r, dir, 0.55, 0.15, 0.56, body);
  studAt(r, dir, -0.1, 0, 0.9, body);
}

/** A toy steam engine facing +x: wheels, a boiler with a chimney, a cab with windows. */
function engine(r: Raster, dir: number, body: Faces, P: TownPalette, dark: boolean) {
  const tyre = shade(rgbOf(P.tyre));
  const glass = rgbOf(P.lit && dark ? P.lit : P.glass);
  for (const x of [-0.6, 0, 0.55]) for (const y of [0.32, -0.42]) part(r, dir, x - 0.17, y, 0, x + 0.17, y + 0.1, 0.3, flatOf(tyre));
  part(r, dir, -1, -0.36, 0.12, 1, 0.36, 0.3, flatOf(tyre));
  part(r, dir, -0.15, -0.3, 0.3, 0.92, 0.3, 0.84, brickPaint(body, false));
  part(r, dir, 0.92, -0.2, 0.42, 0.98, 0.2, 0.72, flatOf(tyre));
  const cab: Paint = (f, u, v) => (f !== Face.Top && v > 0.15 && v < 0.5 && u > 0.2 && u < 0.8 ? glass : brickPaint(body, false)(f, u, v));
  part(r, dir, -0.95, -0.38, 0.3, -0.15, 0.38, 1.22, cab);
  part(r, dir, -1.02, -0.42, 1.22, -0.08, 0.42, 1.32, flatOf(tyre));
  const [cx, cy] = turnedPoint(dir, 0.62, 0);
  r.cylinder(cx, cy, 0.84, 1.18, 0.12, tyre.top, tyre.left, tyre.right, mixRgb(tyre.top, WHITE, 0.3));
  studAt(r, dir, 0.25, 0, 0.84, body);
}

/** A wagon facing +x, loaded with studs. */
function wagon(r: Raster, dir: number, body: Faces, P: TownPalette) {
  const tyre = shade(rgbOf(P.tyre));
  for (const x of [-0.55, 0.55]) for (const y of [0.32, -0.42]) part(r, dir, x - 0.16, y, 0, x + 0.16, y + 0.1, 0.28, flatOf(tyre));
  part(r, dir, -0.98, -0.36, 0.12, 0.98, 0.36, 0.3, flatOf(tyre));
  part(r, dir, -0.95, -0.4, 0.3, 0.95, 0.4, 0.82, brickPaint(body, false));
  for (const x of [-0.55, 0, 0.55]) for (const y of [-0.18, 0.18]) studAt(r, dir, x, y, 0.82, body, 0.13);
}

/** A little brick person facing +x: legs, a body with arms, a square head with hair and eyes.
 *  Pose 0 stands, 1 and 2 step, 3 looks up with an arm raised to point. */
function person(r: Raster, dir: number, pose: number, k: number, P: TownPalette) {
  const skin = shade(rgbOf(P.skin[k % P.skin.length]!));
  const shirt = shade(rgbOf(P.shirts[k % P.shirts.length]!));
  const legs = shade(rgbOf(P.trousers[k % P.trousers.length]!));
  const hair = shade(rgbOf(P.hair[(k * 2) % P.hair.length]!));
  const step = pose === 1 ? 0.07 : pose === 2 ? -0.07 : 0;
  part(r, dir, -0.06 + step, 0.015, 0, 0.06 + step, 0.12, 0.42, flatOf(legs));
  part(r, dir, -0.06 - step, -0.12, 0, 0.06 - step, -0.015, 0.42, flatOf(legs));
  part(r, dir, -0.09, -0.15, 0.42, 0.09, 0.15, 0.8, flatOf(shirt));
  part(r, dir, -0.05 - step, 0.15, 0.48, 0.05 - step, 0.22, 0.8, flatOf(shirt));
  if (pose === 3) part(r, dir, 0.0, -0.22, 0.72, 0.1, -0.15, 1.18, flatOf(shirt));
  else part(r, dir, -0.05 + step, -0.22, 0.48, 0.05 + step, -0.15, 0.8, flatOf(shirt));
  const lift = pose === 3 ? 0.03 : 0;
  part(r, dir, -0.1 - lift, -0.1, 0.8, 0.1 - lift, 0.1, 1.04, flatOf(skin));
  part(r, dir, -0.11 - lift, -0.11, 1.0, 0.1 - lift, 0.11, 1.08, flatOf(hair));
  part(r, dir, -0.12 - lift, -0.11, 0.86, -0.08 - lift, 0.11, 1.04, flatOf(hair));
  if (dir === 0 || dir === 1) {
    const eye = rgbOf(P.tyre);
    const px = Math.max(1, Math.round(r.p.S / 22));
    for (const side of [-0.05, 0.05]) {
      const [x, y] = turnedPoint(dir, 0.1 - lift + 0.001, side);
      const X = Math.round(screenX(r.p, x, y));
      const Y = Math.round(screenY(r.p, x, y, pose === 3 ? 0.99 : 0.95));
      for (let a = 0; a < px; a++) for (let b = 0; b < px; b++) r.dot(X + a - (dir === 0 ? 1 : 0), Y + b, eye);
    }
  }
}

/** Where a point `d` ahead of a model's middle is, for a model facing `dir`. */
const ahead = (dir: number, d: number): [number, number] => turnedPoint(dir, d, 0);

/** A soft glow round a point (x, y, z) of a sprite's model, laid under what is drawn there. */
function halo(s: Sprite, S: number, HZ: number, [x, y]: [number, number], z: number, colour: Rgb, R: number) {
  const g = s.canvas.getContext("2d")!;
  const at = { S, HZ, ox: -s.dx, oy: -s.dy };
  const X = screenX(at, x, y);
  const Y = screenY(at, x, y, z);
  const grad = g.createRadialGradient(X, Y, 0, X, Y, R);
  grad.addColorStop(0, cssAlpha(colour, 0.45));
  grad.addColorStop(0.4, cssAlpha(colour, 0.14));
  grad.addColorStop(1, cssAlpha(colour, 0));
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = grad;
  g.fillRect(X - R, Y - R, 2 * R, 2 * R);
}

/** A soft round glow in one colour, bright in its middle. */
function glowSprite(colour: Rgb, size: number): OffscreenCanvas {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, cssAlpha(colour, 0.9));
  grad.addColorStop(0.3, cssAlpha(colour, 0.35));
  grad.addColorStop(1, cssAlpha(colour, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
