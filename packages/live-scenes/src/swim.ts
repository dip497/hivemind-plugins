/**
 * Draws water and what swims in it, as a grid of ASCII cells: Shoal's sharks, Koi Pond's koi.
 *   1. the scene's own water (backdrop.ts), light coming down through it
 *   2. a wake field that diffuses where things swim, lighting the dots
 *   3. fish as minimal ASCII dashes, one per cell, glinting on hard turns
 *   4. the swimmers (spine.ts), cell by cell: blocks shaded by the light, meeting with no seam,
 *      a character on each that rides the skin, and an outline drawn in the cells' six parts
 * A scene's renderer adds its own layers under and over them (a sea bed, lily pads).
 *
 * Ported from stackedlol/ascii-sharks (MIT, see shoal/LICENSE). Every tone is a step of the
 * scene's own colours (its palette), mixed in RAMP steps worked out once per look, so a frame
 * builds no colour strings: fish in their species' colours, each kind of swimmer in its own.
 *
 * On dark water a swimmer is light on it, as in the original. On light water it is ink on paper:
 * blocks darker the more of it there is, darker characters in them; or, where the palette says so
 * (a koi's), bright on it, lit as on dark water.
 */
import type { WaterLook } from "./backdrop";
import { ramp as rampOf, rgbOf, type Oklch } from "./colour";
import { fillParts, textCells, WHOLE } from "./cells";
import { LookRenderer } from "./look";
import { clamp, TAU } from "./math";
import { FLAG_BODY, FLAG_EYE, FLAG_FIN, FLAG_MARK, FLAG_RIDGE, SPINE_NODES, SpineRaster, type SpineShape } from "./spine";
import type { World } from "./world";

/** A scene's water in its own colours, and what swims in it. */
export interface SwimPalette extends WaterLook {
  /** Where every swimmer's ramp starts: its shadow on dark water, the water itself on light. */
  shadow: Oklch;
  /** Each kind's skin where the light is full on it (dark) or at its darkest ink (light). */
  kinds: Record<string, Oklch>;
  /** A kind's markings that are colours of their own (a koi's patches), by marking (1, 2 …). */
  marks?: Record<string, Oklch[]>;
  /** By species (the World's). */
  fish: Oklch[];
  /** The wake's dots at their brightest, and a bite's flash. */
  wake: Oklch;
  flash: Oklch;
  /** On light water, whether the swimmers are bright on it, lit as on dark water, rather than
   *  ink on paper (Shoal's): a white koi is white. */
  bright?: boolean;
  /** How far a lit swimmer's skin is lifted from its shadow (`LIFT`): a koi's white is whiter. */
  lift?: { base: number; span: number };
}

/** What a scene's swimmers are: their shapes, by kind, and the palettes they are drawn in. */
export interface SwimBook {
  shapes: Readonly<Record<string, SpineShape>>;
  /** The kinds, in a fixed order. */
  kinds: readonly string[];
  palette: { dark: SwimPalette; light: SwimPalette };
}

const ALPHA_LEVELS = 6;
const FISH_LEVELS = [0.28, 0.42, 0.58, 0.74, 0.9];
/** How far toward its colour the wake's dots go at their brightest. */
const WAKE_REACH = 0.5;
/**
 * How light water draws, in steps from a swimmer's shadow (0, the water itself) toward its colour
 * (1), matched to the reference demo's tones. A shark's block goes from `base` at its faintest to
 * `base + span` where the original is brightest, its character `glyph` darker than its block. Eyes
 * and markings keep the original's levels, so an eye is a grey ring on the water as it is on black.
 * The wake is fainter than on dark water, where light on black needs more.
 */
const INK = { base: 0.02, span: 0.88, glyph: 0.15, wake: 0.32 };
/** Dark water is lighter than black, and a shark drawn at the original's levels sank into it: its
 *  skin is lifted to `base + span` of its levels (the palette's `lift` where it sets one), its eyes
 *  and markings kept dark on it. Its character is `glyph` darker than its block: enough to be the
 *  skin's grain, not so much that the body reads as a page of letters. */
const LIFT = { base: 0.28, span: 0.8 };
const GLYPH_DROP = 0.2;
/** A click's ring through the wake: how fast it spreads (px/s), and how long it lasts. */
const RING_SPEED = 150;
const RING_LIFE = 1.4;

/** The skin's grain, by how much of the cell each character covers: sparse where the light is on
 *  it, denser into shadow, so the grain deepens the shading. No letters: a letter reads as text. */
const SKIN_RAMP = " .:;+*%#";
const MARK_GLYPHS = "#%";

/** How many of a cell's six parts each mask holds. */
const PARTS_IN = Uint8Array.from({ length: 64 }, (_, m) => [0, 1, 2, 3, 4, 5].filter((k) => (m >> k) & 1).length);

/** The part an eye takes in a cell covering `parts`: the middle row first, then the top and the
 *  bottom; -1 when it covers fewer than three, where the eye would sit on the outline. */
const EYE_PART = Int8Array.from({ length: 64 }, (_, m) => (PARTS_IN[m]! < 3 ? -1 : [2, 3, 0, 1, 4, 5].find((k) => (m >> k) & 1) ?? -1));

/** A line along the spine's direction `dir` (0 … 255 for 0 … π), turned `turn` of a half turn. */
function lineAlong(dir: number, turn = 0) {
  const a = (dir / 256 + turn) % 1;
  return a < 0.125 || a >= 0.875 ? "-" : a < 0.375 ? "\\" : a < 0.625 ? "|" : "/";
}

export abstract class SwimRenderer extends LookRenderer<SwimPalette> {
  private energy = new Float32Array(0);
  private energyTmp = new Float32Array(0);
  private heat = new Float32Array(0);
  private bucketOf = new Uint8Array(0);
  private bucketOrder = new Int32Array(0);
  private bucketCounts = new Int32Array(ALPHA_LEVELS + 1);
  /** Each kind's shadow to its colour. */
  private kindRamps: string[][] = [];
  /** Swimmers are ink on paper: darker the more of them, on light water. */
  private ink = false;
  private wakeStyles: string[] = [];
  /** The middle of the water to the wake's colour: a click's ring is drawn in it. */
  private wakeRamp: string[] = [];
  /** A bite's flash, from the middle of the water to its colour. */
  private flash: string[] = [];
  /** Each kind's markings in colours of their own (a koi's patches), by marking. */
  private markRamps: string[][][] = [];
  protected raster: SpineRaster;

  /** Cells holding a fish this frame (frame stamp); dots skip them. */
  private fishStamp = new Uint32Array(0);
  private frameId = 0;
  /** Each fish cell's way this frame, as a unit step across and down: a fish is drawn as a sliver
   *  along it. */
  private fishDx = new Float32Array(0);
  private fishDy = new Float32Array(0);
  /** Fish cells bucketed by species and brightness, so each bucket is one fillStyle. */
  private fishBuckets: number[][] = [];
  private fishStyles: string[] = [];
  /** The water's time at the last frame. What fades fades by the time gone by since, so a frame
   *  drawn again with none gone by (held, or still) is the same frame. */
  private drawnAt = 0;
  /** Clicks' rings spreading through the wake. */
  private rings: { x: number; y: number; age: number }[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, private book: SwimBook) {
    super(canvas, book.palette);
    this.raster = new SpineRaster(book.shapes, Object.fromEntries(book.kinds.map((k, i) => [k, i])));
  }

  /** Every swimmer, fish, dot and flash a step of the palette. */
  protected styled() {
    const p = this.palette;
    this.ink = this.light && !p.bright;
    // The middle of the water: what a fish, the wake and a flash fade into.
    const mid = rgbOf(p.water[1]!);
    const shadow = rgbOf(p.shadow);
    this.kindRamps = this.book.kinds.map((k) => rampOf(shadow, rgbOf(p.kinds[k]!)));
    this.markRamps = this.book.kinds.map((k) => (p.marks?.[k] ?? []).map((c) => rampOf(shadow, rgbOf(c))));
    this.flash = rampOf(mid, rgbOf(p.flash));
    const wake = (this.wakeRamp = rampOf(mid, rgbOf(p.wake)));
    const reach = this.light ? INK.wake : WAKE_REACH;
    this.wakeStyles = Array.from({ length: ALPHA_LEVELS }, (_, l) => this.tone((reach * (l + 1)) / ALPHA_LEVELS, wake));
    this.fishStyles = p.fish.flatMap((c) => {
      const r = rampOf(mid, rgbOf(c));
      return FISH_LEVELS.map((a) => this.tone(0.3 + 0.7 * a, r));
    });
    this.fishBuckets = this.fishStyles.map(() => []);
    this.looked();
  }

  /** The look changed: a scene's own layers take their colours from the palette here. */
  protected looked() {}

  /** Drawn after the water, before the fish and swimmers (a sea bed): the transform is the
   *  device's own, 1:1. */
  protected drawUnder(_t: number) {}

  /** Drawn over the swimmers (lily pads, ripples, food), in CSS pixels. */
  protected drawOver(_t: number, _world: World) {}

  /** The water's time went on `dt` seconds since the last frame: what a scene shows that moves by
   *  itself (a pond's pads) moves with it. */
  protected advance(_dt: number) {}

  protected allocate(n: number) {
    this.energy = new Float32Array(n);
    this.energyTmp = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.bucketOf = new Uint8Array(n);
    this.bucketOrder = new Int32Array(n);
    this.raster.allocate(n);
    this.fishStamp = new Uint32Array(n);
    this.fishDx = new Float32Array(n);
    this.fishDy = new Float32Array(n);
  }

  draw(world: World) {
    const { ctx, dpr, cols, ch } = this;
    if (cols === 0) return;
    const t = world.time;
    const dt = t - this.drawnAt;
    this.drawnAt = t;
    if (dt > 0) {
      this.consumeEvents(world);
      this.advance(dt);
      this.spreadRings(dt);
      this.depositWake(world);
      this.diffuse(dt);
    }
    this.raster.rasterize(world.swimmers, { cw: this.cw, ch, cols, rows: this.rows });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop(t), 0, 0);
    this.drawUnder(t);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.markFish(world);
    this.drawDots();

    textCells(ctx, ch, this.fontFamily);
    this.drawFish();
    this.drawRings();
    this.drawCreatures();
    this.drawOver(t, world);
    // Flashes go over the swimmers: a shark swims on over the spot it bit.
    this.drawHeat();
  }

  // ── simulation → field ──────────────────────────────────────────────

  private stamp(field: Float32Array, x: number, y: number, radius: number, amount: number) {
    const c0 = Math.floor(x / this.cw);
    const r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const d = Math.hypot(c - c0, (r - r0) * 1.4);
        if (d > radius + 0.5) continue;
        const i = r * this.cols + c;
        field[i] = Math.min(1.6, field[i]! + amount * (1 - d / (radius + 1)));
      }
    }
  }

  /** What happened in the water since the last frame: a meal flashes and stirs the wake, a click
   *  stirs it and sends a ring out through it. A scene answers more of them (a pond's rings). */
  protected consumeEvents(world: World) {
    for (const e of world.events) {
      if (e.kind === "eat") {
        this.stamp(this.heat, e.x, e.y, 2, 1);
        this.stamp(this.energy, e.x, e.y, 3, 0.9);
      } else if (e.kind === "splash") {
        this.stamp(this.energy, e.x, e.y, 2, 1);
        this.rings.push({ x: e.x, y: e.y, age: 0 });
      }
    }
    world.events.length = 0;
  }

  /** Each click's ring: a fine circle on the water, widening and fading; the swimmers
   *  pass over it. */
  private drawRings() {
    const { ctx, cw } = this;
    for (const ring of this.rings) {
      const fade = 1 - ring.age / RING_LIFE;
      if (fade <= 0) continue;
      const r = cw * 2 + RING_SPEED * ring.age;
      ctx.strokeStyle = this.tone(0.3 + 0.6 * fade, this.wakeRamp);
      ctx.lineWidth = Math.max(1, cw * 0.16) * (0.6 + 0.4 * fade);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, r, 0, TAU);
      ctx.stroke();
    }
  }

  /** Each click's ring spreads, stirring the wake round it as it goes, fainter as it widens. */
  private spreadRings(dt: number) {
    if (!this.rings.length) return;
    const { energy, cw } = this;
    for (const ring of this.rings) {
      ring.age += dt;
      const fade = 1 - ring.age / RING_LIFE;
      if (fade <= 0) continue;
      const r = cw * 2 + RING_SPEED * ring.age;
      const steps = Math.ceil((TAU * r) / (cw * 0.8));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * TAU;
        const i = this.cellIndex(ring.x + Math.cos(a) * r, ring.y + Math.sin(a) * r);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.3 * fade);
      }
    }
    if (this.rings.some((ring) => ring.age >= RING_LIFE)) this.rings = this.rings.filter((ring) => ring.age < RING_LIFE);
  }

  private depositWake(world: World) {
    const { energy } = this;
    for (const f of world.fish) {
      if (!f.alive) continue;
      const i = this.cellIndex(f.x, f.y);
      if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.012 + f.alarm * 0.03);
    }
    for (const sh of world.swimmers) {
      // The tail sweeps the most water.
      for (let k = SPINE_NODES - 6; k < SPINE_NODES; k++) {
        const i = this.cellIndex(sh.nodes[k * 2]!, sh.nodes[k * 2 + 1]!);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.05 + sh.speed * 0.0012);
      }
    }
    if (world.pointer.active) {
      this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
    }
  }

  /** Blur + decay so wakes spread out like ripples and fade. */
  private diffuse(dt: number) {
    const { cols, rows, energy, energyTmp: tmp, heat } = this;
    const decay = Math.exp(-dt * 1.5);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? energy[i - 1]! : energy[i]!;
        const rt = c < cols - 1 ? energy[i + 1]! : energy[i]!;
        const u = r > 0 ? energy[i - cols]! : energy[i]!;
        const d = r < rows - 1 ? energy[i + cols]! : energy[i]!;
        tmp[i] = (energy[i]! * 4 + l + rt + u + d) * 0.125 * decay;
      }
    }
    this.energy = tmp;
    this.energyTmp = energy;
    const heatDecay = Math.exp(-dt * 2.2);
    for (let i = 0; i < heat.length; i++) heat[i] = heat[i]! * heatDecay;
  }

  // ── swimmers ────────────────────────────────────────────────────────

  private drawCreatures() {
    const { ctx, cols, rows, cw, ch, dpr } = this;
    const paper = this.ink;
    const lift = this.palette.lift ?? LIFT;
    const { flag: sharkFlag, parts: sharkParts, dir: sharkDir, shade: sharkShade, key: sharkKey, depth: sharkDepth, kind: sharkKind, mark: sharkMark } = this.raster;
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      if (!sharkFlag[i]) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      const key = sharkKey[i]!;
      const shade = sharkShade[i]!;
      const parts = sharkParts[i]!;
      const dim = 0.7 + 0.3 * sharkDepth[i]!;
      const kind = sharkKind[i]!;
      // A marking in a colour of its own (a koi's patch) is skin in that colour; a shark's dark
      // markings are drawn as markings.
      const own = sharkMark[i] ? this.markRamps[kind]![sharkMark[i]! - 1] : undefined;
      const ramp = own ?? this.kindRamps[kind]!;
      const flag = own && sharkFlag[i] === FLAG_MARK ? FLAG_BODY : sharkFlag[i]!;

      let level: number;
      let glyph: string;
      const held = PARTS_IN[parts]!;
      if (flag === FLAG_RIDGE) {
        // The dorsal fin standing up off the back, catching the light: a line along the spine.
        level = 176;
        glyph = lineAlong(sharkDir[i]!);
      } else if (flag === FLAG_EYE) {
        // The skin round the eye; the eye itself is one dark part of the cell (below).
        level = 70;
        glyph = " ";
      } else if (flag === FLAG_MARK) {
        level = 24 + shade * 22;
        glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length]!;
      } else if (flag === FLAG_FIN) {
        level = 40 + shade * 120;
        // A fin's rays run out from the body, across the spine.
        glyph = (key >>> 8) % 3 ? lineAlong(sharkDir[i]!, 0.5) : ":";
      } else {
        level = 46 + shade * 160;
        const jitter = ((key >>> 4) % 3) - 1;
        glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * SKIN_RAMP.length) + jitter, 0, SKIN_RAMP.length - 1)]!;
      }
      // Levels are on the original's 0–255 scale: how much light the skin gives back. A cell the
      // body covers one part of is fainter: the outline's last step into the water.
      const lit = ((level * dim) / 255) * (held === 1 ? 0.6 : 1);
      let block: number;
      let ink: number;
      if (paper) {
        // Ink on paper: the more of the shark, the darker its block, and its character darker still.
        if (flag === FLAG_MARK) { block = lit; ink = 0.27; }
        else {
          block = INK.base + INK.span * lit;
          ink = block + INK.glyph;
        }
      } else {
        block = flag !== FLAG_MARK ? lift.base + lift.span * lit : lit;
        if (flag === FLAG_MARK) ink = 0.27;
        else ink = Math.max(0, block - GLYPH_DROP);
      }
      ctx.fillStyle = this.tone(block, ramp);
      fillParts(ctx, col, row, cw, ch, dpr, parts);
      if (flag === FLAG_EYE) {
        // A dark dot, in the part of the cell nearest its middle that the body covers: an eye
        // sits in the head, never off its edge.
        const k = EYE_PART[parts]!;
        if (k < 0) continue;
        ctx.fillStyle = this.tone(paper ? 0.75 : 0.04, ramp);
        fillParts(ctx, col, row, cw, ch, dpr, 1 << k);
        continue;
      }
      // The outline is drawn in the cell's parts alone: a character there would stand off the body.
      if (parts !== WHOLE) continue;
      if (glyph === " ") continue;
      ctx.fillStyle = this.tone(ink, ramp);
      ctx.fillText(glyph, col * cw + cw / 2, row * ch + ch / 2 + 1);
    }
  }

  // ── fish, dots, heat ────────────────────────────────────────────────

  /**
   * Snap each fish to a cell and bucket it by species and brightness: far fish are dim,
   * near fish brighter, and turning or panicking fish glint. Nearer fish
   * claim a cell first when two land in the same one.
   */
  private markFish(world: World) {
    const { fishStamp, fishBuckets } = this;
    const sharkFlag = this.raster.flag;
    const frame = ++this.frameId;
    for (const bucket of fishBuckets) bucket.length = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const f of world.fish) {
        if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
        const i = this.cellIndex(f.x, f.y);
        if (i < 0 || fishStamp[i]! === frame || sharkFlag[i]!) continue;
        fishStamp[i] = frame;
        const v = Math.hypot(f.vx, f.vy) || 1;
        this.fishDx[i] = f.vx / v;
        this.fishDy[i] = f.vy / v;
        const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
        const light = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, f.alarm);
        const level = clamp(Math.floor(light * FISH_LEVELS.length), 0, FISH_LEVELS.length - 1);
        fishBuckets[f.species * FISH_LEVELS.length + level]!.push(i);
      }
    }
  }

  /** Each fish a sliver in the middle of its cell, pointing the way it swims: seen from above, a
   *  small fish is a short stroke, the same length whichever way it goes. One path per bucket. */
  private drawFish() {
    const { ctx, cw, ch, cols, fishBuckets, fishDx, fishDy } = this;
    const half = cw * 0.36;
    ctx.lineWidth = Math.max(1.25, cw * 0.17);
    ctx.lineCap = "round";
    for (let b = 0; b < fishBuckets.length; b++) {
      const bucket = fishBuckets[b]!;
      if (!bucket.length) continue;
      ctx.strokeStyle = this.fishStyles[b]!;
      ctx.beginPath();
      for (const i of bucket) {
        const x = (i % cols) * cw + cw / 2;
        const y = ((i / cols) | 0) * ch + ch / 2;
        ctx.moveTo(x - fishDx[i]! * half, y - fishDy[i]! * half);
        ctx.lineTo(x + fishDx[i]! * half, y + fishDy[i]! * half);
      }
      ctx.stroke();
    }
  }

  private drawHeat() {
    const { ctx, heat, cols, cw, ch } = this;
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i]!;
      if (h < 0.08) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      // A bite flashes in the flash colour and fades back into the water.
      ctx.fillStyle = this.tone(h > 0.5 ? Math.min(1, h) : h * 1.1, this.flash);
      ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
    }
  }

  /** Dots light up where the wake is strong, bucketed by brightness so each bucket is one fillStyle. */
  private drawDots() {
    const { ctx, cols, rows, cw, ch, energy, fishStamp, frameId } = this;
    const sharkFlag = this.raster.flag;
    const { bucketOf, bucketOrder, bucketCounts } = this;
    const n = cols * rows;
    const SKIP = bucketCounts.length - 1;
    bucketCounts.fill(0);

    for (let i = 0; i < n; i++) {
      const e = energy[i]!;
      if (sharkFlag[i]! || fishStamp[i]! === frameId || e < 0.45) {
        bucketOf[i] = SKIP;
        continue;
      }
      const bucket = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
      bucketOf[i] = bucket;
      bucketCounts[bucket] = bucketCounts[bucket]! + 1;
    }

    // Counting sort cells by bucket.
    const starts = new Int32Array(bucketCounts.length);
    for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1]! + bucketCounts[b - 1]!;
    const cursor = starts.slice();
    for (let i = 0; i < n; i++) {
      const b = bucketOf[i]!;
      if (b === SKIP) continue;
      const at = cursor[b]!;
      cursor[b] = at + 1;
      bucketOrder[at] = i;
    }

    const size = Math.max(2, Math.round(cw * 0.19)) + 1;
    for (let b = 0; b < SKIP; b++) {
      const count = bucketCounts[b]!;
      if (!count) continue;
      ctx.fillStyle = this.wakeStyles[b]!;
      const start = starts[b]!;
      for (let k = start; k < start + count; k++) {
        const i = bucketOrder[k]!;
        const col = i % cols;
        const row = (i / cols) | 0;
        // Sit the dot low-right in its cell, as in the reference.
        ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
      }
    }
  }
}
