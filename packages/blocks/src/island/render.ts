/**
 * Block Island's drawing. The sky (its gradient, the sun or the moon, stars, two far islands) is
 * painted once per size and look; the island's blocks, the cottage and the lantern posts are a stage
 * painted once into a layer of their own and painted again only where a block popped or grew back.
 * Each frame copies the two, then draws what moves over them nearest last (trees, rustling as a gust
 * passes; the animals; crumbs; the falling water; smoke), each covered again by the still blocks in
 * front of it; then the clouds low in front, a puff a click made, and by night the lights.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import type { Drawer } from "../scene";
import { css, cssAlpha, rgbOf, type Rgb } from "../colour";
import { drawActors, Face, flat, mixRgb, screenX, screenY, sprite, Stage, type Actor, type Box, type Paint, type Raster, type Sprite } from "../iso";
import { barked, doored, planked, speckled, SPECK_LIGHT, tiled, turfed, watery, windowed, type Faces } from "../textures";
import { clamp, hash2, seededRandom, TAU } from "../rng";
import { at, Mat, topAt, TREE_SHAPES } from "./land";
import { LEAF, PUFF_LIFE, SMOKE_LIFE, type Animal, type Island, type Kind } from "./world";
import { ISLAND_PALETTE, type IslandPalette, type Shades } from "./palette";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const facesOf = (s: Shades): Faces => ({ top: rgbOf(s.top), left: rgbOf(s.left), right: rgbOf(s.right) });
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** An animal's poses: standing, mid-step, head down (grazing or pecking), head up (looking). */
const POSES = 4;

/** Everything drawn at one block size in one look. */
interface Kit {
  S: number;
  grass: Sprite[];
  dirt: Sprite[];
  stone: Sprite[];
  sand: Sprite;
  water: Sprite;
  plank: Sprite;
  window: Sprite;
  sideWindow: Sprite;
  door: Sprite;
  roof: Sprite;
  chimney: Sprite;
  lantern: Sprite;
  trunks: Sprite[];
  canopies: Sprite[][];
  saplings: Sprite[];
  animals: Record<Kind, Sprite[]>;
  crumbs: Map<number, Sprite>;
  smoke: Sprite;
  far: Sprite[];
  near: Sprite[];
  puff: Sprite;
  glow: OffscreenCanvas;
  glint: Sprite;
}

export class IslandRenderer implements Drawer<Island> {
  private g: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private look: IslandPalette = ISLAND_PALETTE.dark;
  private dark = true;
  private kit: Kit | null = null;
  private sky = new OffscreenCanvas(1, 1);
  private skyFresh = false;
  /** The island's still blocks, painted; and the part of the window they cover. */
  private ground = new OffscreenCanvas(1, 1);
  private groundBox = { L: 0, T: 0, R: 1, B: 1 };
  private stage = new Stage();
  private builtVersion = -1;
  private builtFor = "";
  private fall: { frames: OffscreenCanvas[]; X: number; Y: number; box: Box; key: number } | null = null;
  private windows: { x: number; y: number; z: number }[] = [];
  private stars: { x: number; y: number; size: number; a: number; twinkle: number }[] = [];
  private pond: { i: number; j: number }[] = [];

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
    this.skyFresh = false;
    this.builtFor = "";
  }

  setLook(look: WallpaperLook) {
    if (look.dark === this.dark && this.kit) return;
    this.dark = look.dark;
    this.look = ISLAND_PALETTE[look.dark ? "dark" : "light"];
    this.skyFresh = false;
    this.builtFor = "";
  }

  draw(sim: Island) {
    if (!sim.land || !this.width) return;
    const g = this.g;
    const key = `${sim.iso.S}:${sim.iso.ox}:${sim.iso.oy}:${this.dark}:${this.canvas.width}x${this.canvas.height}`;
    if (key !== this.builtFor) {
      this.kit = this.makeKit(sim.iso.S);
      this.paintSky(sim);
      this.build(sim, true);
      this.builtFor = key;
    } else if (sim.version !== this.builtVersion) this.build(sim, false);
    const kit = this.kit!;
    const t = sim.time;
    const bob = sim.bob;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.sky, 0, 0);
    this.drawTwinkles(g, t);
    // Clouds far behind the island.
    for (const c of sim.clouds) if (c.far) this.cloud(g, kit.far[c.shape % kit.far.length]!, c.x, c.y, this.dark ? 0.55 : 0.9);
    const b = this.groundBox;
    if (b.R > b.L && b.B > b.T) g.drawImage(this.ground, b.L, b.T, b.R - b.L, b.B - b.T, b.L, b.T + bob, b.R - b.L, b.B - b.T);
    this.drawGlints(g, sim, t);
    drawActors(g, this.stage, this.actors(sim, kit, t), 0, bob);
    if (!this.dark) {
      // Nothing more by day but the clouds in front.
    } else this.drawLights(g, sim, kit, t);
    for (const c of sim.clouds) if (!c.far) this.cloud(g, kit.near[c.shape % kit.near.length]!, c.x, c.y, this.dark ? 0.7 : 0.95);
    for (const p of sim.puffs) {
      const grow = clamp(p.age / 0.45, 0, 1);
      const fade = clamp((PUFF_LIFE - p.age) / 2.5, 0, 1);
      const img = kit.puff;
      const s = 0.4 + 0.6 * grow;
      g.globalAlpha = fade * (this.dark ? 0.85 : 0.95);
      const w = img.w * s;
      const h = img.h * s;
      g.drawImage(img.canvas, Math.round(p.x * this.dpr - w / 2), Math.round(p.y * this.dpr - h / 2), Math.round(w), Math.round(h));
    }
    g.globalAlpha = 1;
  }

  private cloud(g: Ctx, img: Sprite, x: number, y: number, alpha: number) {
    g.globalAlpha = alpha;
    g.drawImage(img.canvas, Math.round(x * this.dpr - img.w / 2), Math.round(y * this.dpr - img.h / 2));
    g.globalAlpha = 1;
  }

  // ── sprites ──────────────────────────────────────────────────────────────

  private makeKit(S: number): Kit {
    const P = this.look;
    const HZ = S;
    const cube = (paint: Paint, h = 1) => sprite(S, HZ, [0, 0, 0, 1, 1, h], (r) => r.box(0, 0, 0, 1, 1, h, paint));
    const grass = facesOf(P.grass);
    const dirt = facesOf(P.dirt);
    const stone = facesOf(P.stone);
    const sand = facesOf(P.sand);
    const water = facesOf(P.water);
    const wood = facesOf(P.wood);
    const leaves = facesOf(P.leaves);
    const plank = planked(facesOf(P.plank), 3);
    const pane = rgbOf(P.glass);
    const frame = rgbOf(P.plank.right);
    const flowers = P.flowers.map(rgbOf);
    const centre = rgbOf(P.beak);
    const kit: Kit = {
      S,
      grass: [0, 1, ...flowers.map((_, k) => k + 2)].map((v) => cube(turfed(grass, dirt, v + 1, v >= 2 ? flowers[v - 2]! : null, centre))),
      dirt: [0, 1].map((v) => cube(speckled(dirt, 20 + v))),
      stone: [0, 1].map((v) => cube(speckled(stone, 30 + v, 0.28))),
      sand: cube(speckled(sand, 40, 0.15)),
      water: cube(watery(water, 5), 0.85),
      plank: cube(plank),
      window: cube(windowed(plank, pane, frame, [Face.Left])),
      sideWindow: cube(windowed(plank, pane, frame, [Face.Right])),
      door: cube(doored(plank, rgbOf(P.door), rgbOf(P.beak), Face.Left)),
      roof: cube(tiled(facesOf(P.roof))),
      chimney: cube(speckled(stone, 33, 0.3)),
      lantern: sprite(S, HZ, [0, 0, 0, 1, 1, 1.6], (r) => {
        const post = flat(wood.top, wood.left, wood.right);
        r.box(0.45, 0.45, 0, 0.55, 0.55, 1.1, post);
        const light = P.light ? rgbOf(P.light) : pane;
        const glass = (f: Face, u: number, v: number) => (f === Face.Top ? mixRgb(wood.top, BLACK, 0.2) : u < 0.18 || u > 0.82 || v > 0.85 ? mixRgb(wood.left, BLACK, 0.2) : light);
        r.box(0.36, 0.36, 1.1, 0.64, 0.64, 1.42, glass);
        r.box(0.33, 0.33, 1.42, 0.67, 0.67, 1.5, flat(mixRgb(wood.top, BLACK, 0.25), mixRgb(wood.left, BLACK, 0.25), mixRgb(wood.right, BLACK, 0.25)));
      }),
      trunks: TREE_SHAPES.map((shape) => sprite(S, HZ, [0, 0, 0, 1, 1, shape.trunk], (r) => r.box(0.27, 0.27, 0, 0.73, 0.73, shape.trunk - 0.5, barked(wood, 7)))),
      canopies: TREE_SHAPES.map((shape, k) => [false, true].map((ruffled) => sprite(S, HZ, [-2, -2, shape.trunk - 1, 3, 3, shape.trunk + 3], (r) => {
        const paint = leafPaint(leaves, rgbOf(P.leavesSpeck), k * 10 + (ruffled ? 5 : 0), ruffled);
        for (const [dx, dy, dz] of shape.leaves) r.box(dx, dy, dz, dx + 1, dy + 1, dz + 1, paint);
      }))),
      saplings: this.saplings(S, wood, leaves, rgbOf(P.leavesSpeck)),
      animals: { sheep: this.herd(S, "sheep"), hen: this.herd(S, "hen") },
      crumbs: new Map(),
      smoke: sprite(S, HZ, [0, 0, 0, 0.36, 0.36, 0.36], (r) => r.box(0, 0, 0, 0.36, 0.36, 0.36, flat(...smokeShades(this.dark)))),
      far: [0, 1, 2, 3].map((k) => cloudSprite(even(S * 0.55), facesOf(P.cloud), k)),
      near: [0, 1, 2, 3].map((k) => cloudSprite(even(S * 1.05), facesOf(P.cloud), k + 4)),
      puff: cloudSprite(even(S * 0.7), facesOf(P.cloud), 9),
      glow: glowSprite(rgbOf(P.light ?? P.orb.glow), 64),
      glint: sprite(S, HZ, [0, 0, 0, 0.25, 0.12, 0.01], (r) => r.box(0, 0, 0, 0.25, 0.12, 0.01, flat(rgbOf(P.waterGlint), rgbOf(P.waterGlint), rgbOf(P.waterGlint)))),
    };
    const crumbOf = (f: Faces, size = 0.2) => sprite(S, HZ, [0, 0, 0, size, size, size], (r) => r.box(0, 0, 0, size, size, size, flat(f.top, f.left, f.right)));
    kit.crumbs.set(Mat.Grass, crumbOf(grass));
    kit.crumbs.set(Mat.Dirt, crumbOf(dirt));
    kit.crumbs.set(Mat.Stone, crumbOf(stone));
    kit.crumbs.set(Mat.Sand, crumbOf(sand));
    kit.crumbs.set(Mat.Water, crumbOf({ top: rgbOf(P.waterGlint), left: water.top, right: water.left }, 0.12));
    kit.crumbs.set(LEAF, sprite(S, HZ, [0, 0, 0, 0.2, 0.2, 0.05], (r) => r.box(0, 0, 0, 0.2, 0.2, 0.05, flat(leaves.top, leaves.left, leaves.right))));
    return kit;
  }

  private saplings(S: number, wood: Faces, leaves: Faces, speck: Rgb): Sprite[] {
    const stem = flat(wood.top, wood.left, wood.right);
    const leaf = leafPaint(leaves, speck, 77, false);
    return [
      sprite(S, S, [0, 0, 0, 1, 1, 0.5], (r) => {
        r.box(0.47, 0.47, 0, 0.53, 0.53, 0.28, flat(leaves.top, leaves.left, leaves.right));
        r.box(0.3, 0.44, 0.22, 0.48, 0.56, 0.3, flat(leaves.top, leaves.left, leaves.right));
        r.box(0.52, 0.44, 0.26, 0.7, 0.56, 0.34, flat(leaves.top, leaves.left, leaves.right));
      }),
      sprite(S, S, [0, 0, 0, 1, 1, 1.1], (r) => {
        r.box(0.45, 0.45, 0, 0.55, 0.55, 0.6, stem);
        r.box(0.25, 0.25, 0.5, 0.75, 0.75, 1, leaf);
      }),
      sprite(S, S, [-1, -1, 0, 2, 2, 2.6], (r) => {
        r.box(0.35, 0.35, 0, 0.65, 0.65, 1.3, barked(wood, 7));
        r.box(-0.25, -0.25, 1.2, 1.25, 1.25, 2, leaf);
        r.box(0.15, 0.15, 2, 0.85, 0.85, 2.5, leaf);
      }),
      sprite(S, S, [-2, -2, 0, 3, 3, 4], (r) => {
        r.box(0.3, 0.3, 0, 0.7, 0.7, 2.2, barked(wood, 7));
        r.box(-0.75, -0.75, 2, 1.75, 1.75, 3, leaf);
        r.box(-0.25, -0.25, 3, 1.25, 1.25, 3.8, leaf);
      }),
    ];
  }

  /** An animal's sprites, by the way it faces (4) and its pose (POSES). */
  private herd(S: number, kind: Kind): Sprite[] {
    const P = this.look;
    const out: Sprite[] = [];
    for (let dir = 0; dir < 4; dir++) {
      for (let pose = 0; pose < POSES; pose++) {
        out.push(sprite(S, S, [-0.6, -0.6, 0, 0.6, 0.6, 1], (r) => {
          if (kind === "sheep") sheep(r, dir, pose, facesOf(P.wool), rgbOf(P.face), this.dark);
          else hen(r, dir, pose, facesOf(P.hen), rgbOf(P.comb), rgbOf(P.beak), this.dark);
        }));
        shadowUnder(out[out.length - 1]!, S, kind === "sheep" ? 0.34 : 0.2);
      }
    }
    return out;
  }

  // ── the sky ──────────────────────────────────────────────────────────────

  private paintSky(sim: Island) {
    const P = this.look;
    const W = Math.round(this.width * this.dpr);
    const H = Math.round(this.height * this.dpr);
    this.sky.width = W;
    this.sky.height = H;
    const g = this.sky.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, H);
    P.sky.forEach((c, i) => grad.addColorStop(i / (P.sky.length - 1), css(rgbOf(c))));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const unit = Math.min(W, H);
    // The sun, or the moon: a square disc in a soft glow, up to the right.
    const ox = W * 0.8;
    const oy = H * 0.14;
    const glow = g.createRadialGradient(ox, oy, 0, ox, oy, unit * 0.32);
    glow.addColorStop(0, cssAlpha(rgbOf(P.orb.glow), P.orb.alpha));
    glow.addColorStop(1, cssAlpha(rgbOf(P.orb.glow), 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const disc = rgbOf(P.orb.disc);
    const side = Math.round(unit * 0.065);
    g.fillStyle = css(mixRgb(disc, rgbOf(P.sky[0]!), 0.35));
    g.fillRect(Math.round(ox - side * 0.62), Math.round(oy - side * 0.62), Math.round(side * 1.24), Math.round(side * 1.24));
    g.fillStyle = css(disc);
    g.fillRect(Math.round(ox - side / 2), Math.round(oy - side / 2), side, side);
    if (this.dark) {
      // The moon's craters.
      g.fillStyle = css(mixRgb(disc, rgbOf(P.sky[1]!), 0.25));
      const q = side / 8;
      for (const [cx, cy, s] of [[1, 1, 2], [5, 2, 1], [3, 5, 2], [6, 5, 1]] as const) g.fillRect(Math.round(ox - side / 2 + cx * q), Math.round(oy - side / 2 + cy * q), Math.round(s * q), Math.round(s * q));
    } else {
      g.fillStyle = css(mixRgb(disc, WHITE, 0.6));
      g.fillRect(Math.round(ox - side / 2 + side * 0.2), Math.round(oy - side / 2 + side * 0.2), Math.round(side * 0.3), Math.round(side * 0.3));
    }
    // Stars, by night, thinning toward the horizon.
    this.stars = [];
    if (P.stars) {
      const rnd = seededRandom(1234);
      const n = Math.round((this.width * this.height) / 3800);
      const star = rgbOf(P.stars);
      for (let k = 0; k < n; k++) {
        const x = rnd() * W;
        const y = Math.pow(rnd(), 1.4) * H * 0.8;
        if (Math.hypot(x - ox, y - oy) < side * 1.6) continue;
        const size = Math.max(1, Math.round((rnd() < 0.15 ? 2 : 1) * this.dpr));
        const a = 0.25 + 0.65 * rnd() * (1 - y / H);
        const twinkle = rnd() < 0.12 ? rnd() * TAU : -1;
        this.stars.push({ x: Math.round(x), y: Math.round(y), size, a, twinkle });
        if (twinkle >= 0) continue;
        g.fillStyle = cssAlpha(star, a);
        g.fillRect(Math.round(x), Math.round(y), size, size);
      }
    }
    // Two far islands, small and hazy, high at the sides.
    const S = sim.iso.S;
    const haze = rgbOf(P.haze);
    const fog = (s: Shades): Faces => {
      const f = facesOf(s);
      return { top: mixRgb(f.top, haze, 0.5), left: mixRgb(f.left, haze, 0.5), right: mixRgb(f.right, haze, 0.5) };
    };
    const small = even(Math.max(4, S * 0.42));
    for (const [fx, fy, seed, r] of [[0.09, 0.24, 3, 3.2], [0.93, 0.3, 8, 2.6]] as const) {
      const islet = isletSprite(small, fog(P.grass), fog(P.dirt), fog(P.stone), fog(P.leaves), seed, r);
      g.drawImage(islet.canvas, Math.round(fx * W - islet.w / 2), Math.round(fy * H - islet.h / 2));
    }
    this.skyFresh = true;
  }

  private drawTwinkles(g: Ctx, t: number) {
    if (!this.dark || !this.look.stars) return;
    const star = rgbOf(this.look.stars);
    g.fillStyle = css(star);
    for (const s of this.stars) {
      if (s.twinkle < 0) continue;
      g.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(t * 1.7 + s.twinkle * 5));
      g.fillRect(s.x, s.y, s.size, s.size);
    }
    g.globalAlpha = 1;
  }

  // ── the stage ────────────────────────────────────────────────────────────

  /** The island's still pieces, from its land as it is; painted all again (`all`), or only round the
   *  columns that changed. */
  private build(sim: Island, all: boolean) {
    const { land, iso } = sim;
    const kit = this.kit!;
    const stage = this.stage;
    stage.clear();
    const { n, base } = land;
    const c = land.cottage;
    const inCottage = (i: number, j: number, k: number) => i >= c.i && i < c.i + 3 && j >= c.j && j < c.j + 3 && k >= base && k < base + 2;
    const solid = (i: number, j: number, k: number) => {
      if (inCottage(i, j, k)) return true;
      const q = at(land, i, j);
      if (q < 0) return false;
      const top = land.top[q]!;
      if (top < 0 || k < land.bottom[q]! || k >= top) return false;
      return !(k === top - 1 && land.surface[q] === Mat.Water);
    };
    const key = (i: number, j: number, k: number) => (i + j) * 4096 + k + 512;
    const add = (img: Sprite, i: number, j: number, k: number, h = 1) =>
      stage.add(img, screenX(iso, i, j), screenY(iso, i, j, k), { x0: i, y0: j, z0: k, x1: i + 1, y1: j + 1, z1: k + h }, key(i, j, k));
    this.pond = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const q = j * n + i;
        const top = land.top[q]!;
        if (top < 0) continue;
        const surface = land.surface[q]!;
        if (surface === Mat.Water) this.pond.push({ i, j });
        for (let k = land.bottom[q]!; k < top; k++) {
          const isTop = k === top - 1;
          if (!isTop && solid(i + 1, j, k) && solid(i, j + 1, k) && solid(i, j, k + 1)) continue;
          if (isTop && surface === Mat.Water) {
            add(kit.water, i, j, k, 0.85);
            continue;
          }
          const v = hash2(i, j, k) < 0.5 ? 0 : 1;
          let img: Sprite;
          if (isTop) {
            img = surface === Mat.Grass ? kit.grass[land.flower[q] ? 1 + land.flower[q]! : v]!
              : surface === Mat.Sand ? kit.sand : surface === Mat.Stone ? kit.stone[v]! : kit.dirt[v]!;
          } else if (surface === Mat.Water && k === top - 2) img = kit.sand;
          else img = k >= top - 3 ? kit.dirt[v]! : kit.stone[v]!;
          add(img, i, j, k);
        }
      }
    }
    // The cottage: plank walls with windows and a door facing the viewer, a tiled roof, a chimney.
    this.windows = [];
    for (let k = base; k < base + 2; k++) {
      for (let b = 0; b < 3; b++) {
        for (let a = 0; a < 3; a++) {
          const i = c.i + a;
          const j = c.j + b;
          if (solid(i + 1, j, k) && solid(i, j + 1, k) && solid(i, j, k + 1) && k < base + 1) continue;
          let img = kit.plank;
          if (k === base && b === 2 && a === 1) img = kit.door;
          else if (k === base && b === 2 && a === 0) { img = kit.window; this.windows.push({ x: i + 0.5, y: j + 1, z: k + 0.55 }); }
          else if (k === base && a === 2 && b === 1) { img = kit.sideWindow; this.windows.push({ x: i + 1, y: j + 0.5, z: k + 0.55 }); }
          add(img, i, j, k);
        }
      }
    }
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) add(kit.roof, c.i + a, c.j + b, base + 2);
    for (let b = 0; b < 3; b++) add(kit.roof, c.i + 1, c.j + b, base + 3);
    add(kit.chimney, c.i + 2, c.j, base + 3);
    add(kit.chimney, c.i + 2, c.j, base + 4);
    for (const l of land.lanterns) {
      const top = topAt(land, l.i, l.j);
      stage.add(kit.lantern, screenX(iso, l.i, l.j), screenY(iso, l.i, l.j, top), { x0: l.i + 0.33, y0: l.j + 0.33, z0: top, x1: l.i + 0.67, y1: l.j + 0.67, z1: top + 1.5 }, key(l.i, l.j, top) + 0.5);
    }
    stage.finish();
    this.makeFall(sim);

    const W = this.canvas.width;
    const H = this.canvas.height;
    if (all) {
      this.ground.width = W;
      this.ground.height = H;
      const gg = this.ground.getContext("2d")!;
      gg.clearRect(0, 0, W, H);
      stage.paint(gg);
      let L = W;
      let T = H;
      let R = 0;
      let B = 0;
      for (const p of stage.pieces) {
        L = Math.min(L, p.X);
        T = Math.min(T, p.Y);
        R = Math.max(R, p.X + p.w);
        B = Math.max(B, p.Y + p.h);
      }
      // Room for the bob.
      const m = Math.ceil(3 * this.dpr);
      this.groundBox = { L: clamp(L - m, 0, W), T: clamp(T - m, 0, H), R: clamp(R + m, 0, W), B: clamp(B + m, 0, H) };
      sim.dirty.length = 0;
    } else {
      const gg = this.ground.getContext("2d")!;
      for (const d of sim.dirty.splice(0)) {
        const q = at(land, d.i, d.j);
        const top = Math.max(land.top[q]!, base) + 6;
        const L = Math.floor(screenX(iso, d.i, d.j + 2)) - 2;
        const R = Math.ceil(screenX(iso, d.i + 2, d.j)) + 2;
        const T = Math.floor(screenY(iso, d.i - 1, d.j - 1, top)) - 2;
        const Bt = Math.ceil(screenY(iso, d.i + 2, d.j + 2, land.bottom[q]! - 1)) + 2;
        stage.repaint(gg, L, T, R, Bt, (l, t, r, b) => gg.clearRect(l, t, r - l, b - t));
      }
    }
    this.builtVersion = sim.version;
  }

  /** The pond's water falling from the lip: eight frames of its streaks, run in turn. */
  private makeFall(sim: Island) {
    const { land, iso } = sim;
    const { S } = iso;
    const lip = land.lip;
    const zTop = land.base - 0.15;
    const X1 = screenX(iso, lip.i + 1, lip.j + 0.12);
    const X2 = screenX(iso, lip.i + 1, lip.j + 0.88);
    const Y1 = screenY(iso, lip.i + 1, lip.j + 0.12, zTop);
    const Y2 = screenY(iso, lip.i + 1, lip.j + 0.88, zTop);
    const H = this.canvas.height;
    const length = Math.max(S * 4, H - Y1 + S);
    const w = Math.ceil(X1 - X2) + 2;
    const h = Math.ceil(Y2 - Y1 + length) + 2;
    const fall = rgbOf(this.look.fall);
    const foam = rgbOf(this.look.foam);
    const period = Math.max(8, Math.round(S * 2.2));
    const frames: OffscreenCanvas[] = [];
    for (let f = 0; f < 8; f++) {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d")!;
      // Fades out as it falls, into the clouds below.
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, cssAlpha(fall, 0.92));
      grad.addColorStop(0.45, cssAlpha(fall, 0.75));
      grad.addColorStop(1, cssAlpha(fall, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(X1 - X2 + 1, 1);
      g.lineTo(1, 1 + Y2 - Y1);
      g.lineTo(1, h);
      g.lineTo(X1 - X2 + 1, h);
      g.closePath();
      g.fill();
      for (let x = 0; x < w - 2; x++) {
        const top = 1 + (Y2 - Y1) - x / 2;
        const off = hash2(x, 0, 71) * period;
        const len = Math.max(2, Math.round(period * (0.25 + 0.4 * hash2(x, 1, 71))));
        for (let y = ((f * period) / 8 + off) % period - period; y < h - top; y += period) {
          const a = clamp(1 - (y + top) / h, 0, 1);
          g.fillStyle = cssAlpha(foam, 0.75 * a);
          g.fillRect(x + 1, Math.round(top + y), 1, len);
        }
        // Foam along the lip.
        g.fillStyle = cssAlpha(foam, 0.9);
        g.fillRect(x + 1, Math.round(top), 1, Math.max(1, Math.round(S / 9)));
      }
      frames.push(c);
    }
    this.fall = {
      frames, X: Math.floor(X2) - 1, Y: Math.floor(Y1) - 1,
      box: { x0: lip.i + 1, x1: lip.i + 1.02, y0: lip.j + 0.12, y1: lip.j + 0.88, z0: -1000, z1: zTop },
      key: lip.i + lip.j + 1.9,
    };
  }

  // ── what moves ───────────────────────────────────────────────────────────

  private actors(sim: Island, kit: Kit, t: number): Actor[] {
    const { land, iso } = sim;
    const out: Actor[] = [];
    const place = (img: Sprite, x: number, y: number, z: number, box: Box, key: number, alpha?: number) => {
      const a: Actor = { ...box, key, img: img.canvas, X: screenX(iso, x, y) + img.dx, Y: screenY(iso, x, y, z) + img.dy + sim.bob };
      if (alpha !== undefined) a.alpha = alpha;
      out.push(a);
    };
    for (const tree of land.trees) {
      const shape = TREE_SHAPES[tree.shape]!;
      const z = topAt(land, tree.i, tree.j);
      const r = sim.rustle(tree.i, tree.j);
      const phase = hash2(tree.i, tree.j, 5) * TAU;
      const ruffled = r > 0.3 && Math.floor(t * 9 + phase) % 2 === 0;
      const sway = Math.round(Math.sin(t * 13 + phase) * r * 1.2 * this.dpr);
      place(kit.trunks[tree.shape]!, tree.i, tree.j, z, { x0: tree.i + 0.27, y0: tree.j + 0.27, z0: z, x1: tree.i + 0.73, y1: tree.j + 0.73, z1: z + shape.trunk - 1 }, tree.i + tree.j + 1);
      const canopy = kit.canopies[tree.shape]![ruffled ? 1 : 0]!;
      out.push({
        x0: tree.i - 2, y0: tree.j - 2, z0: z + shape.trunk - 1, x1: tree.i + 3, y1: tree.j + 3, z1: z + shape.trunk + 3,
        key: tree.i + tree.j + 1.2, img: canopy.canvas,
        X: screenX(iso, tree.i, tree.j) + canopy.dx + sway, Y: screenY(iso, tree.i, tree.j, z) + canopy.dy + sim.bob,
      });
    }
    for (const s of sim.saplings) {
      const z = topAt(land, s.i, s.j);
      place(kit.saplings[Math.min(3, s.stage)]!, s.i, s.j, z, { x0: s.i + 0.25, y0: s.j + 0.25, z0: z, x1: s.i + 0.75, y1: s.j + 0.75, z1: z + 1 + s.stage }, s.i + s.j + 1);
    }
    for (const a of sim.animals) place(this.animalSprite(kit, a, t), a.x, a.y, a.z, { x0: a.x - 0.3, y0: a.y - 0.3, z0: a.z, x1: a.x + 0.3, y1: a.y + 0.3, z1: a.z + 0.75 }, a.x + a.y + 0.01);
    for (const c of sim.crumbs) {
      const img = kit.crumbs.get(c.mat) ?? kit.crumbs.get(Mat.Dirt)!;
      const fade = c.rest < 0 ? 1 : clamp(1 - (c.rest - 0.9) / 0.7, 0, 1);
      place(img, c.x - 0.1, c.y - 0.1, c.z, { x0: c.x - 0.1, y0: c.y - 0.1, z0: c.z, x1: c.x + 0.1, y1: c.y + 0.1, z1: c.z + 0.2 }, c.x + c.y + 0.02, fade);
    }
    for (const p of sim.pops) {
      const img = p.mat === Mat.Grass ? kit.grass[0]! : p.mat === Mat.Stone ? kit.stone[0]! : p.mat === Mat.Sand ? kit.sand : kit.dirt[0]!;
      const z = p.z + p.age * 1.6;
      place(img, p.i, p.j, z, { x0: p.i, y0: p.j, z0: z, x1: p.i + 1, y1: p.j + 1, z1: z + 1 }, p.i + p.j + 1.05, 1 - p.age / 0.7);
    }
    for (const r of sim.regrows) {
      if (r.rising <= 0) continue;
      const img = r.mat === Mat.Grass ? kit.grass[0]! : r.mat === Mat.Stone ? kit.stone[0]! : r.mat === Mat.Sand ? kit.sand : kit.dirt[0]!;
      const z = topAt(land, r.i, r.j) - (1 - r.rising) * 0.6;
      place(img, r.i, r.j, z, { x0: r.i, y0: r.j, z0: z, x1: r.i + 1, y1: r.j + 1, z1: z + 1 }, r.i + r.j + 1, clamp(r.rising * 1.5, 0, 1));
    }
    for (const s of sim.smoke) {
      const fade = clamp(s.age / 0.4, 0, 1) * clamp((SMOKE_LIFE - s.age) / 2, 0, 1) * 0.8;
      place(kit.smoke, s.x - 0.18, s.y - 0.18, s.z, { x0: s.x - 0.2, y0: s.y - 0.2, z0: s.z, x1: s.x + 0.2, y1: s.y + 0.2, z1: s.z + 0.36 }, s.x + s.y + 50, fade);
    }
    if (this.fall) {
      const f = this.fall;
      const frame = f.frames[Math.floor(t * 12) % f.frames.length]!;
      out.push({ ...f.box, key: f.key, img: frame, X: f.X, Y: f.Y + sim.bob });
    }
    return out;
  }

  private animalSprite(kit: Kit, a: Animal, t: number): Sprite {
    let pose = 0;
    if (a.habit === "look") pose = 3;
    else if (a.ni !== a.ci || a.nj !== a.cj) pose = Math.floor(a.t * 4) % 2;
    else if (a.habit === "graze") pose = a.kind === "hen" ? (Math.floor(t * 4 + a.id) % 3 === 0 ? 0 : 2) : 2;
    return kit.animals[a.kind][a.dir * POSES + pose]!;
  }

  private drawGlints(g: Ctx, sim: Island, t: number) {
    const kit = this.kit!;
    const { iso } = sim;
    for (const p of this.pond) {
      const phase = hash2(p.i, p.j, 9) * TAU;
      if (Math.sin(t * 1.3 + phase) < 0.82) continue;
      const u = 0.2 + 0.5 * hash2(p.i, p.j, Math.floor(t * 0.5 + phase));
      const v = 0.2 + 0.5 * hash2(p.j, p.i, Math.floor(t * 0.5 + phase));
      const z = sim.land.base - 0.15;
      g.drawImage(kit.glint.canvas, Math.round(screenX(iso, p.i + u, p.j + v) + kit.glint.dx), Math.round(screenY(iso, p.i + u, p.j + v, z) + kit.glint.dy + sim.bob));
    }
  }

  /** By night: the lanterns' and the windows' light, flickering a little. */
  private drawLights(g: Ctx, sim: Island, kit: Kit, t: number) {
    const { iso, land } = sim;
    g.globalCompositeOperation = "lighter";
    const size = iso.S * 3.2;
    const at3 = (x: number, y: number, z: number, scale: number, alpha: number) => {
      g.globalAlpha = alpha;
      const s = size * scale;
      g.drawImage(kit.glow, Math.round(screenX(iso, x, y) - s / 2), Math.round(screenY(iso, x, y, z) - s / 2 + sim.bob), Math.round(s), Math.round(s));
    };
    for (const l of land.lanterns) {
      const flicker = 0.55 + 0.1 * Math.sin(t * 7 + l.i) + 0.06 * Math.sin(t * 17 + l.j);
      at3(l.i + 0.5, l.j + 0.5, topAt(land, l.i, l.j) + 1.26, 1, flicker);
    }
    for (const w of this.windows) at3(w.x, w.y, w.z, 0.8, 0.45);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

// ── models ───────────────────────────────────────────────────────────────

const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));

/** A box given facing +x, turned to face `dir` (+x, +y, -x, -y) about the model's foot. */
function turned(dir: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  switch (dir) {
    case 1: return [-y1, x0, -y0, x1];
    case 2: return [-x1, -y1, -x0, -y0];
    case 3: return [y0, -x1, y1, -x0];
    default: return [x0, y0, x1, y1];
  }
}

/** Where a point given facing +x lands, turned to face `dir`. */
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

/** Two eyes on a head's front (x = front), if it faces the viewer. */
function eyes(r: Raster, dir: number, front: number, half: number, z: number, colour: Rgb) {
  if (dir !== 0 && dir !== 1) return;
  const px = Math.max(1, Math.round(r.p.S / 20));
  for (const side of [-half, half]) {
    const [x, y] = turnedPoint(dir, front + 0.001, side);
    const X = Math.round(screenX(r.p, x, y));
    const Y = Math.round(screenY(r.p, x, y, z));
    for (let a = 0; a < px; a++) for (let b = 0; b < px; b++) r.dot(X + a - (dir === 0 ? 1 : 0), Y + b, colour);
  }
}

/** A woolly body on four short legs, a dark face in front with a cap of wool. */
function sheep(r: Raster, dir: number, pose: number, wool: Faces, face: Rgb, dark: boolean) {
  const woolly = speckled(wool, 61, 0.35, false);
  const faceShades = flat(face, mixRgb(face, BLACK, 0.15), mixRgb(face, BLACK, 0.3));
  const step = pose === 1 ? 0.05 : 0;
  for (const [lx, ly, s] of [[0.2, 0.12, 1], [0.2, -0.12, -1], [-0.22, 0.12, -1], [-0.22, -0.12, 1]] as const) {
    part(r, dir, lx - 0.05 + step * s, ly - 0.05, 0, lx + 0.05 + step * s, ly + 0.05, 0.26, faceShades);
  }
  part(r, dir, -0.36, -0.23, 0.22, 0.3, 0.23, 0.64, woolly);
  part(r, dir, -0.3, -0.18, 0.64, 0.2, 0.18, 0.7, woolly);
  const head = pose === 2 ? { x: 0.32, z0: 0.14, z1: 0.38 } : pose === 3 ? { x: 0.26, z0: 0.5, z1: 0.74 } : { x: 0.27, z0: 0.4, z1: 0.64 };
  part(r, dir, head.x, -0.12, head.z0, head.x + 0.2, 0.12, head.z1, faceShades);
  part(r, dir, head.x + 0.02, -0.12, head.z1 - 0.02, head.x + 0.14, 0.12, head.z1 + 0.05, woolly);
  part(r, dir, head.x + 0.04, -0.18, head.z1 - 0.1, head.x + 0.1, 0.18, head.z1 - 0.05, faceShades);
  eyes(r, dir, head.x + 0.2, 0.06, head.z1 - 0.08, dark ? [235, 235, 220] : [250, 250, 245]);
}

/** A plump body, a tail up behind, a small head with a comb, a beak and a wattle, on two legs. */
function hen(r: Raster, dir: number, pose: number, body: Faces, comb: Rgb, beak: Rgb, dark: boolean) {
  const feathers = speckled(body, 62, 0.25, false);
  const leg = flat(beak, mixRgb(beak, BLACK, 0.15), mixRgb(beak, BLACK, 0.3));
  const red = flat(comb, mixRgb(comb, BLACK, 0.12), mixRgb(comb, BLACK, 0.25));
  const step = pose === 1 ? 0.04 : 0;
  part(r, dir, -0.03 + step, 0.04, 0, 0.03 + step, 0.1, 0.16, leg);
  part(r, dir, -0.03 - step, -0.1, 0, 0.03 - step, -0.04, 0.16, leg);
  part(r, dir, -0.18, -0.13, 0.14, 0.14, 0.13, 0.4, feathers);
  part(r, dir, -0.25, -0.07, 0.3, -0.15, 0.07, 0.52, feathers);
  const head = pose === 2 ? { x: 0.14, z0: 0.12, z1: 0.3 } : pose === 3 ? { x: 0.06, z0: 0.42, z1: 0.62 } : { x: 0.07, z0: 0.36, z1: 0.56 };
  part(r, dir, head.x, -0.08, head.z0, head.x + 0.15, 0.08, head.z1, feathers);
  part(r, dir, head.x + 0.02, -0.03, head.z1, head.x + 0.12, 0.03, head.z1 + 0.06, red);
  part(r, dir, head.x + 0.15, -0.03, head.z0 + 0.06, head.x + 0.22, 0.03, head.z0 + 0.11, leg);
  part(r, dir, head.x + 0.13, -0.025, head.z0 + 0.0, head.x + 0.17, 0.025, head.z0 + 0.06, red);
  eyes(r, dir, head.x + 0.15, 0.045, head.z1 - 0.06, dark ? [30, 30, 40] : [40, 35, 30]);
}

/** A soft shadow on the ground under a sprite's model. */
function shadowUnder(s: Sprite, S: number, r: number) {
  const g = s.canvas.getContext("2d")!;
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = "rgba(0,0,0,0.16)";
  g.beginPath();
  const cx = -s.dx;
  const cy = -s.dy;
  g.moveTo(cx, cy - r * S);
  g.lineTo(cx + r * S * 2, cy);
  g.lineTo(cx, cy + r * S);
  g.lineTo(cx - r * S * 2, cy);
  g.closePath();
  g.fill();
}

/** Leaves: speckled darker and lighter; ruffled by a gust, the pale undersides of some turned up. */
function leafPaint(leaves: Faces, speck: Rgb, salt: number, ruffled: boolean): Paint {
  const base = speckled(leaves, salt, 0.3);
  return (face, u, v) => {
    const tu = Math.min(7, Math.floor(u * 8));
    const tv = Math.min(7, Math.floor(v * 8));
    const h = hash2(tu + face * 9, tv, salt + 1);
    if (h < 0.18) return mixRgb(face === Face.Top ? leaves.top : face === Face.Left ? leaves.left : leaves.right, speck, 0.8);
    if (ruffled && h > 0.8) return mixRgb(face === Face.Top ? leaves.top : leaves.left, WHITE, SPECK_LIGHT);
    return base(face, u, v);
  };
}

/** A cloud of blocks, flat underneath and heaped up toward its middle, of a shape from `seed`. */
function cloudSprite(S: number, f: Faces, seed: number): Sprite {
  const rnd = seededRandom(400 + seed);
  const w = 6 + Math.floor(rnd() * 5);
  const d = 3 + Math.floor(rnd() * 3);
  const cells: [number, number, number][] = [];
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < w; i++) {
      const dx = (i + 0.5 - w / 2) / (w / 2);
      const dy = (j + 0.5 - d / 2) / (d / 2);
      const r = dx * dx + dy * dy;
      if (r > 1.05 + rnd() * 0.3) continue;
      cells.push([i, j, 0]);
      if (r < 0.6 + rnd() * 0.2) cells.push([i, j, 1]);
      if (r < 0.15 + rnd() * 0.15) cells.push([i, j, 2]);
    }
  }
  const paint = flat(f.top, f.left, f.right);
  return sprite(S, Math.round(S * 0.8), [0, 0, 0, w, d, 3], (r) => { for (const [i, j, k] of cells) r.box(i, j, k, i + 1, j + 1, k + 1, paint); });
}

/** A small far island of `r` columns' reach: grass over a cone of rock, a tree on it. */
function isletSprite(S: number, grass: Faces, dirt: Faces, stone: Faces, leaves: Faces, seed: number, R: number): Sprite {
  const n = Math.ceil(R * 2) + 2;
  return sprite(S, S, [0, 0, -n, n, n, 6], (r) => {
    const c = n / 2;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(i + 0.5 - c, j + 0.5 - c) / R - 0.2 * hash2(i, j, seed);
        if (d > 1) continue;
        const depth = Math.round((1 - d) * R * 1.6 + 1);
        r.box(i, j, -1, i + 1, j + 1, 0, flat(grass.top, dirt.left, dirt.right));
        r.box(i, j, -1 - depth, i + 1, j + 1, -1, flat(stone.top, stone.left, stone.right));
      }
    }
    r.box(c - 0.25, c - 0.25, 0, c + 0.25, c + 0.25, 2, flat(leaves.top, mixRgb(leaves.left, BLACK, 0.15), mixRgb(leaves.right, BLACK, 0.15)));
    r.box(c - 1.5, c - 1.5, 2, c + 1.5, c + 1.5, 3.2, flat(leaves.top, leaves.left, leaves.right));
    r.box(c - 0.8, c - 0.8, 3.2, c + 0.8, c + 0.8, 4, flat(leaves.top, leaves.left, leaves.right));
  });
}

function smokeShades(dark: boolean): [Rgb, Rgb, Rgb] {
  const top = rgbOf(dark ? [0.55, 0.01, 270] : [0.96, 0.004, 250]);
  return [top, mixRgb(top, BLACK, 0.06), mixRgb(top, BLACK, 0.12)];
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
