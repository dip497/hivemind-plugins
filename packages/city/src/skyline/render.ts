/**
 * Skyline's drawing: a picture of the city, turned into characters (ascii.ts).
 *
 * The picture is painted a few samples to each character cell: the sky, deepening upward and warm
 * with the city's light over the roofs, the moon in its halo (the sun, by day); the back row of
 * buildings hazy against it; the front row in its materials, each lit from above and its side wall
 * in shade; the windows, warm and cool, glowing; the street's lamps pooling light, headlights
 * throwing beams. Beside it the scene paints its silhouettes alone (the buildings, their roofs, the
 * moon, the clouds, the street), in a grey each, so their outlines come out as lines: `|` down a
 * wall, `_` along a roof, `/` and `\` up a spire. The stars, the planes' lights and the fireworks'
 * sparks are characters set where they are.
 *
 * What holds still is painted once per size and look, and a window switched since is painted again
 * there alone; each frame copies it and paints over it what moves.
 */
import { AsciiPass, Picture, type AsciiStyle } from "../ascii";
import { SceneRenderer, type Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Oklch, type Rgb } from "../colour";
import { clamp, hashOf, seeded } from "../util";
import { CHANGE_RING, type City, type Cloud, type Material, type Placed } from "./city";
import { SKYLINE_PALETTE, type SkylinePalette } from "./palette";

/** Every character Skyline sets itself, apart from the ramp and the lines (ascii.ts). */
export const SKYLINE_GLYPHS = "*+.'|=<>-";

interface Styles {
  sky: Rgb[];
  side: Record<Material, string>;
  win: [string[], string[]];
  looker: string;
  pavement: string;
  road: string;
  mark: string;
  lamp: string;
  lampRgb: Rgb;
  paints: string[];
  taxi: string;
  head: string;
  headRgb: Rgb;
  tail: string;
  tailRgb: Rgb;
  beacon: Rgb;
  strobe: Rgb;
  plane: Rgb;
  star: Rgb;
  cloud: [string, string] | null;
  fireworks: Rgb[];
  style: AsciiStyle;
}

/** A star: where, as shares of the sky, and how it twinkles. */
interface Star { u: number; v: number; m: number; rate: number; phase: number }

/** Greys of the silhouettes, so each meets the next with an outline. */
const SHAPE = { sky: 0, cloud: 0.22, back: 0.36, front: [0.62, 0.84], moon: 0.5, pavement: 1, road: 0.72 };
const grey = (v: number) => { const c = Math.round(v * 255); return `rgb(${c},${c},${c})`; };

export class SkylineRenderer extends SceneRenderer<SkylinePalette> {
  private st!: Styles;
  private pass: AsciiPass;
  private pic = new Picture();
  /** What holds still, painted once per size and look: the picture's and the silhouettes'. */
  private still = new OffscreenCanvas(1, 1);
  private stillShape = new OffscreenCanvas(1, 1);
  private paintedLayout = -1;
  private paintedChanges = 0;
  private fresh = false;
  /** The highest row anything stands in each column: stars and sparks are over open sky only. */
  private tops = new Int16Array(0);
  private beacons: { x: number; y: number; phase: number }[] = [];
  private stars: Star[];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, SKYLINE_PALETTE, false);
    this.pass = new AsciiPass(canvas);
    const r = seeded(0x5ca1e);
    this.stars = Array.from({ length: 500 }, () => ({ u: r(), v: r() ** 1.4, m: r(), rate: 0.5 + r() * 2.2, phase: r() * 6.3 }));
  }

  protected styled() {
    const p = this.palette;
    const c = (o: Oklch) => css(rgbOf(o));
    const back = rgbOf(p.back);
    const faces = Object.entries(p.face) as [Material, Oklch][];
    this.st = {
      sky: p.sky.map(rgbOf),
      side: Object.fromEntries(faces.map(([k, v]) => [k, css(rgbOf([v[0] * p.shade, v[1], v[2]]))])) as Record<Material, string>,
      win: [p.windows.map(c), p.windows.map((w) => css(mix(rgbOf(w), back, p.backMix)))],
      looker: c(p.looker),
      pavement: c(p.pavement),
      road: c(p.road),
      mark: c(p.mark),
      lamp: c(p.lamp),
      lampRgb: rgbOf(p.lamp),
      paints: p.paints.map(c),
      taxi: c(p.taxi),
      head: c(p.head),
      headRgb: rgbOf(p.head),
      tail: c(p.tail),
      tailRgb: rgbOf(p.tail),
      beacon: rgbOf(p.beacon),
      strobe: rgbOf(p.strobe),
      plane: rgbOf(p.plane),
      star: rgbOf(p.star),
      cloud: p.cloud && [c(p.cloud[0]), c(p.cloud[1])],
      fireworks: p.fireworks.map(rgbOf),
      style: { ...p.style, paper: rgbOf(p.style.paper) },
    };
    this.fresh = false;
  }

  protected repaint() {
    this.fresh = false;
    this.pic.resize(this.cols, this.rows);
    this.pass.resize(this.cols, this.rows, this.cw, this.ch, this.dpr, this.fontFamily);
  }

  // ── what holds still ────────────────────────────────────────────────────

  private paint(city: City) {
    const { cw, ch, cols } = this;
    const w = this.pic.canvas.width;
    const h = this.pic.canvas.height;
    for (const c of [this.still, this.stillShape]) {
      c.width = w;
      c.height = h;
    }
    const g = this.still.getContext("2d")!;
    const s = this.stillShape.getContext("2d")!;
    for (const k of [g, s]) k.setTransform(w / (cols * cw), 0, 0, h / (this.rows * ch), 0, 0);
    const p = this.palette;
    const st = this.st;
    const W = cols * cw;
    const ground = city.base * ch;
    // The sky, and the light of the city (or the haze) over the roofs.
    const sky = g.createLinearGradient(0, 0, 0, ground);
    st.sky.forEach((c, i) => sky.addColorStop(i / (st.sky.length - 1), css(c)));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, ground);
    const glow = g.createLinearGradient(0, ground, 0, ground * 0.35);
    glow.addColorStop(0, cssAlpha(rgbOf(p.glow.colour), p.glow.alpha));
    glow.addColorStop(1, cssAlpha(rgbOf(p.glow.colour), 0));
    g.fillStyle = glow;
    g.fillRect(0, ground * 0.35, W, ground * 0.65);
    s.fillStyle = grey(SHAPE.sky);
    s.fillRect(0, 0, W, this.rows * ch);
    this.paintLight(g, s, W);

    this.tops = new Int16Array(cols).fill(city.base);
    this.beacons = [];
    for (const pl of city.placed) for (const bl of pl.blocks) for (let c = Math.max(0, bl.c0); c <= Math.min(cols - 1, bl.c1); c++) this.tops[c] = Math.min(this.tops[c]!, bl.top);
    // The back row, then its haze, then the front row, left to right.
    for (const [i, pl] of city.placed.entries()) if (pl.b.layer === 0) this.paintBuilding(g, s, city, pl, i);
    const haze = g.createLinearGradient(0, ground, 0, ground * 0.4);
    haze.addColorStop(0, cssAlpha(rgbOf(p.haze.colour), p.haze.alpha));
    haze.addColorStop(1, cssAlpha(rgbOf(p.haze.colour), p.haze.alpha * 0.4));
    g.fillStyle = haze;
    g.fillRect(0, ground * 0.4, W, ground * 0.6);
    let k = 0;
    for (const [i, pl] of city.placed.entries()) if (pl.b.layer === 1) this.paintBuilding(g, s, city, pl, i, k++);
    this.paintStreet(g, s, city);
    this.paintedLayout = city.layout;
    this.paintedChanges = city.changes;
    this.fresh = true;
    this.pic.shapeDirty = true;
  }

  /** The moon in its halo, its seas (by night); the sun in its glow (by day). */
  private paintLight(g: Draw2D, s: Draw2D, W: number) {
    const { disc, halo, at, size } = this.palette.light;
    const H = this.rows * this.ch;
    const r = size * Math.min(W, H);
    const [x, y] = [at[0] * W, at[1] * H];
    const hc = rgbOf(halo);
    const glow = g.createRadialGradient(x, y, r * 0.8, x, y, r * 6);
    glow.addColorStop(0, cssAlpha(hc, 0.55));
    glow.addColorStop(0.3, cssAlpha(hc, 0.16));
    glow.addColorStop(1, cssAlpha(hc, 0));
    g.fillStyle = glow;
    g.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    const dc = rgbOf(disc);
    g.fillStyle = css(dc);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    if (this.palette.stars) {
      g.fillStyle = css(mix(dc, this.st.sky[1]!, 0.22));
      for (const [dx, dy, k] of [[-0.3, -0.2, 0.3], [0.28, 0.25, 0.22], [0.05, -0.5, 0.16], [-0.2, 0.42, 0.14]] as const) {
        g.beginPath();
        g.arc(x + dx * r, y + dy * r, k * r, 0, Math.PI * 2);
        g.fill();
      }
    }
    s.fillStyle = grey(SHAPE.moon);
    s.beginPath();
    s.arc(x, y, r, 0, Math.PI * 2);
    s.fill();
  }

  /** One building: its blocks' faces lit from above, a side wall in shade, its windows, its roof;
   *  and its silhouette, a grey of its own. */
  private paintBuilding(g: Draw2D, s: Draw2D, city: City, pl: Placed, place: number, nth = 0) {
    const { cw, ch } = this;
    const { b, blocks } = pl;
    const front = b.layer === 1;
    const p = this.palette;
    const x = (c: number) => (c + 0.5) * cw;
    const y = (r: number) => (r + 0.5) * ch;
    const ground = city.base * ch;
    const face = front ? rgbOf(p.face[b.material]) : rgbOf(p.back);
    const lightTop = mix(face, this.st.sky[p.style.dark ? 3 : 4]!, p.style.dark ? 0.18 : 0.25);
    const shapeGrey = grey(front ? SHAPE.front[nth % 2]! : SHAPE.back);
    for (const [i, bl] of blocks.entries()) {
      const top = y(bl.top);
      const bottom = i ? y(bl.bottom) : ground;
      // The side wall, in shade, seen a little from the right.
      if (front) {
        g.fillStyle = this.st.side[b.material];
        g.fillRect(x(bl.c1), top + ch * 0.3, cw * 0.7, bottom - top - ch * 0.3);
        s.fillStyle = shapeGrey;
        s.fillRect(x(bl.c1), top + ch * 0.3, cw * 0.7, bottom - top - ch * 0.3);
      }
      const fill = g.createLinearGradient(0, top, 0, bottom);
      fill.addColorStop(0, css(lightTop));
      fill.addColorStop(Math.min(1, (ch * 6) / Math.max(1, bottom - top)), css(face));
      fill.addColorStop(1, css(mix(face, [0, 0, 0], front ? 0.12 : 0)));
      g.fillStyle = fill;
      g.fillRect(x(bl.c0), top, x(bl.c1) - x(bl.c0), bottom - top);
      s.fillStyle = shapeGrey;
      s.fillRect(x(bl.c0), top, x(bl.c1) - x(bl.c0), bottom - top);
    }
    this.paintRoof(g, s, pl, blocks[blocks.length - 1]!, css(face), shapeGrey, front);
    for (let i = 0; i < pl.winC.length; i++) {
      if (!front && city.hidden(pl.winC[i]!, pl.winR[i]!)) continue;
      this.paintWindow(g, city, place, i);
    }
    // The ground floor: a door, and on some a lit shopfront.
    if (front) {
      const door = b.c0 + 1 + Math.floor(hashOf(b.seed, 1) * Math.max(1, b.w - 2));
      g.fillStyle = this.st.win[0][p.style.dark ? 0 : 1]!;
      g.fillRect(door * cw + cw * 0.15, (city.base - 1) * ch + ch * 0.2, cw * 0.7, ch * 0.8);
      if (hashOf(b.seed, 2) < 0.55 && b.w >= 7) {
        g.fillStyle = this.st.win[0][p.style.dark ? 1 : 0]!;
        const left = x(b.c0) + cw * 0.4;
        const right = x(b.c0 + b.w - 1) - cw * 0.4;
        const sy = (city.base - 1) * ch + ch * 0.3;
        if (door * cw > left) g.fillRect(left, sy, door * cw - left, ch * 0.55);
        if (right > (door + 1) * cw) g.fillRect((door + 1) * cw, sy, right - (door + 1) * cw, ch * 0.55);
      }
    }
  }

  /** The top block's roof: a tank on legs, a mast or spire and its light, a pyramid, a dome, a
   *  slant, a box of plant room. */
  private paintRoof(g: Draw2D, s: Draw2D, pl: Placed, top: Placed["blocks"][number], face: string, shape: string, front: boolean) {
    const { cw, ch } = this;
    const { b } = pl;
    const x = (c: number) => (c + 0.5) * cw;
    const ry = (top.top + 0.5) * ch;
    const span = top.c1 - top.c0;
    const mid = (x(top.c0) + x(top.c1)) / 2;
    const both = (f: (k: Draw2D) => void) => {
      g.fillStyle = face;
      f(g);
      s.fillStyle = shape;
      f(s);
    };
    const poly = (k: Draw2D, pts: number[]) => {
      k.beginPath();
      for (let i = 0; i < pts.length; i += 2) k[i ? "lineTo" : "moveTo"](pts[i]!, pts[i + 1]!);
      k.closePath();
      k.fill();
    };
    const mast = (mx: number, from: number, rowsUp: number) => {
      both((k) => k.fillRect(mx - cw * 0.12, from - rowsUp * ch, cw * 0.24, rowsUp * ch));
      if (front) this.beacons.push({ x: mx, y: from - rowsUp * ch, phase: hashOf(b.seed, 9) });
    };
    switch (b.roof) {
      case "box": {
        const w = Math.min(span - 2, 2 + Math.floor(hashOf(b.seed, 3) * 3));
        const c0 = top.c0 + 1 + Math.floor(hashOf(b.seed, 4) * Math.max(1, span - w - 1));
        both((k) => k.fillRect(x(c0), ry - ch, x(c0 + w) - x(c0), ch));
        break;
      }
      case "tank": {
        const c = top.c0 + 1 + Math.floor(hashOf(b.seed, 5) * Math.max(1, span - 3));
        const x0 = x(c) - cw * 0.1;
        const x1 = x(c + 1) + cw * 0.6;
        const legs = ry - ch * 0.7;
        const barrel = legs - ch * 1.3;
        both((k) => {
          k.fillRect(x0 + cw * 0.2, legs, cw * 0.2, ry - legs);
          k.fillRect(x1 - cw * 0.4, legs, cw * 0.2, ry - legs);
          k.fillRect(x0, barrel, x1 - x0, legs - barrel);
          poly(k, [x0 - cw * 0.2, barrel, (x0 + x1) / 2, barrel - ch * 0.7, x1 + cw * 0.2, barrel]);
        });
        break;
      }
      case "mast":
        mast(x(top.c0 + Math.max(1, Math.round(span * (0.3 + 0.4 * hashOf(b.seed, 6))))), ry, 4 + Math.floor(hashOf(b.seed, 7) * 3));
        break;
      case "spire": {
        const h = Math.max(1.5, span * 0.6) * ch;
        both((k) => poly(k, [mid - cw * 1.1, ry, mid, ry - h, mid + cw * 1.1, ry]));
        mast(mid, ry - h, 2 + Math.floor(hashOf(b.seed, 7) * 2));
        break;
      }
      case "pyramid": {
        const h = Math.min(span * 0.5 * cw, ch * 4);
        both((k) => poly(k, [x(top.c0), ry, mid, ry - h, x(top.c1), ry]));
        break;
      }
      case "dome": {
        const r = Math.min(span * 0.36 * cw, ch * 2.6);
        both((k) => {
          k.beginPath();
          k.ellipse(mid, ry, r, r * 0.85, 0, Math.PI, 0);
          k.closePath();
          k.fill();
          k.fillRect(mid - cw * 0.1, ry - r * 0.85 - ch * 0.8, cw * 0.2, ch * 0.8);
        });
        break;
      }
      case "slant": {
        const up = hashOf(b.seed, 8) < 0.5;
        const h = Math.min(span * 0.3, 3) * ch;
        both((k) => poly(k, up ? [x(top.c0), ry, x(top.c1), ry - h, x(top.c1), ry] : [x(top.c0), ry - h, x(top.c1), ry, x(top.c0), ry]));
        break;
      }
      case "flat":
        both((k) => k.fillRect(x(top.c0), ry - ch * 0.35, x(top.c1) - x(top.c0), ch * 0.35));
        break;
    }
  }

  /** The window `i` of the building placed `place`, in its state: a pane in its cell. */
  private paintWindow(g: Draw2D, city: City, place: number, i: number) {
    const pl = city.placed[place]!;
    const c = pl.winC[i]!;
    const r = pl.winR[i]!;
    const { cw, ch } = this;
    const state = pl.b.states[pl.winKey[i]!]!;
    const glint = !this.palette.style.dark && state === 0 && (c * 2 + r + (pl.b.seed % 11) + 40) % 13 < 2;
    g.fillStyle = this.st.win[pl.b.layer ? 0 : 1][glint ? 2 : state]!;
    const glass = pl.b.material === "glass";
    g.fillRect(c * cw + (glass ? cw * 0.06 : cw * 0.14), r * ch + ch * 0.14, cw * (glass ? 0.88 : 0.72), ch * 0.72);
  }

  /** The pavement and its lamps, the kerb, the road and its lane marks. */
  private paintStreet(g: Draw2D, s: Draw2D, city: City) {
    const { cw, ch, cols } = this;
    const W = cols * cw;
    const H = this.rows * ch;
    const top = city.base * ch;
    g.fillStyle = this.st.pavement;
    g.fillRect(0, top, W, ch);
    g.fillStyle = this.st.road;
    g.fillRect(0, top + ch, W, H - top - ch);
    g.fillStyle = this.st.mark;
    for (let c = 1; c < cols; c += 4) g.fillRect(c * cw, top + ch * 2 - ch * 0.06, cw * 2, ch * 0.12);
    s.fillStyle = grey(SHAPE.pavement);
    s.fillRect(0, top, W, ch);
    s.fillStyle = grey(SHAPE.road);
    s.fillRect(0, top + ch, W, H - top - ch);
    for (let c = 7; c < cols; c += 17) {
      const x = (c + 0.5) * cw;
      const head = top - ch * 0.8;
      if (this.palette.lit) {
        const pool = g.createRadialGradient(x, top + ch * 0.4, 0, x, top + ch * 0.4, ch * 3);
        pool.addColorStop(0, cssAlpha(this.st.lampRgb, 0.55));
        pool.addColorStop(1, cssAlpha(this.st.lampRgb, 0));
        g.fillStyle = pool;
        g.fillRect(x - ch * 3, top - ch * 2.6, ch * 6, ch * 6);
      }
      g.fillStyle = this.st.mark;
      g.fillRect(x - cw * 0.08, head, cw * 0.16, top + ch * 0.7 - head);
      g.fillStyle = this.st.lamp;
      g.fillRect(x - cw * 0.3, head - ch * 0.12, cw * 0.6, ch * 0.24);
    }
  }

  /** Paint again, in what holds still, each window switched since it last showed it. */
  private catchUp(city: City) {
    const g = this.still.getContext("2d")!;
    g.setTransform(this.still.width / (this.cols * this.cw), 0, 0, this.still.height / (this.rows * this.ch), 0, 0);
    for (let n = this.paintedChanges; n < city.changes; n++) {
      const v = city.changed[n % CHANGE_RING]!;
      const place = v >>> 16;
      const pl = city.placed[place];
      if (!pl) continue;
      const i = pl.winKey.indexOf(v & 0xffff);
      // A window of the back row behind a building in front stays as the front building has it.
      if (i >= 0 && (pl.b.layer === 1 || !city.hidden(pl.winC[i]!, pl.winR[i]!))) this.paintWindow(g, city, place, i);
    }
    this.paintedChanges = city.changes;
  }

  // ── each frame ─────────────────────────────────────────────────────────

  draw(city: City) {
    if (!this.cols) return;
    if (!this.fresh || this.paintedLayout !== city.layout || city.changes - this.paintedChanges > CHANGE_RING) this.paint(city);
    else if (city.changes !== this.paintedChanges) this.catchUp(city);
    const pic = this.pic;
    pic.begin(this.cw, this.ch);
    pic.g.setTransform(1, 0, 0, 1, 0, 0);
    pic.g.drawImage(this.still, 0, 0);
    const t = city.time;
    if (this.st.cloud || pic.shapeDirty) {
      pic.s.setTransform(1, 0, 0, 1, 0, 0);
      pic.s.drawImage(this.stillShape, 0, 0);
      pic.shapeDirty = true;
    }
    pic.begin(this.cw, this.ch);
    if (this.st.cloud) for (const c of city.clouds) this.drawCloud(c);
    this.drawStars(t);
    this.drawPlanes(city, t);
    this.drawBeacons(t);
    this.drawLookers(city, t);
    this.drawTraffic(city);
    this.drawFireworks(city);
    this.pass.draw(pic, this.st.style);
  }

  private drawStars(t: number) {
    if (!this.palette.stars) return;
    const { cols, cw, ch } = this;
    const n = Math.round((cols * this.rows) / 26);
    const sky = this.st.star;
    const dim = mix(sky, this.st.sky[1]!, 0.45);
    const [mx, my] = this.palette.light.at;
    const moonR = this.palette.light.size * Math.min(cols * cw, this.rows * ch) * 2.2;
    for (let i = 0; i < Math.min(n, this.stars.length); i++) {
      const s = this.stars[i]!;
      const c = Math.floor(s.u * cols);
      const r = Math.floor(s.v * (this.tops[c] ?? 0) * 0.85);
      if (r >= (this.tops[c] ?? 0) - 2) continue;
      if (Math.hypot((c + 0.5) * cw - mx * cols * cw, (r + 0.5) * ch - my * this.rows * ch) < moonR) continue;
      const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
      const big = s.m > 0.85;
      this.pic.set(c, r, big && b > 0.6 ? "*" : s.m > 0.55 || b > 0.8 ? "+" : ".", b > 0.35 ? sky : dim);
    }
  }

  /** A cloud: round puffs along a flat base, white, shaded underneath; its outline from its shape. */
  private drawCloud(c: Cloud) {
    const { cw, ch } = this;
    const g = this.pic.g;
    const s = this.pic.s;
    const r = seeded(c.seed);
    const base = c.y + (c.h - 0.5) * ch;
    const n = 3 + Math.floor(r() * 2);
    const puffs: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const midness = 1 - Math.abs((i + 0.5) / n - 0.5) * 2;
      const rad = Math.min((c.h - 0.8) * ch * 0.62, ch * (0.9 + 1.2 * midness + 0.4 * r()));
      puffs.push([c.x + ((i + 0.5) / n) * c.w * cw, base - rad * (0.25 + 0.35 * midness), rad]);
    }
    const shade = g.createLinearGradient(0, base - ch * 2.5, 0, base);
    shade.addColorStop(0, this.st.cloud![0]);
    shade.addColorStop(1, this.st.cloud![1]);
    for (const [k, fill] of [[g, shade], [s, grey(SHAPE.cloud)]] as const) {
      k.save();
      k.beginPath();
      k.rect(c.x - cw * 4, c.y - ch * 4, c.w * cw + cw * 8, base - c.y + ch * 4);
      k.clip();
      k.fillStyle = fill;
      k.beginPath();
      for (const [x, y, rad] of puffs) {
        k.moveTo(x + rad, y);
        k.arc(x, y, rad, 0, Math.PI * 2);
      }
      k.fill();
      k.restore();
    }
  }

  /** A soft light in the picture: bloom round it at night, a tint by day. */
  private glow(x: number, y: number, r: number, colour: Rgb, alpha: number) {
    const g = this.pic.g;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, cssAlpha(colour, alpha));
    grad.addColorStop(1, cssAlpha(colour, 0));
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  private cellOf(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cw), Math.floor(y / this.ch)];
  }

  /** A plane: by night its lights, a red beacon and a white strobe flashing twice; by day its body
   *  and a trail. */
  private drawPlanes(city: City, t: number) {
    for (const p of city.planes) {
      const dir = Math.sign(p.v) || 1;
      const [c, r] = this.cellOf(p.x, p.y);
      if (this.palette.lit) {
        const beat = (t + p.phase) % 1.6;
        const beacon = (t + p.phase) % 1.1 < 0.2;
        const strobe = beat < 0.08 || (beat > 0.22 && beat < 0.3);
        if (beacon) this.glow(p.x, p.y, this.cw * 2, this.st.beacon, 0.9);
        if (strobe) this.glow(p.x + dir * this.cw, p.y, this.cw * 2.5, this.st.strobe, 1);
        this.pic.set(c, r, beacon ? "*" : ".", this.st.beacon);
        this.pic.set(c + dir, r, strobe ? "*" : ".", strobe ? this.st.strobe : this.st.plane);
        continue;
      }
      this.pic.set(c - dir, r, "=", this.st.plane);
      this.pic.set(c, r, "=", this.st.plane);
      this.pic.set(c + dir, r, dir > 0 ? ">" : "<", this.st.plane);
      for (let k = 2; k < 18; k += 2) this.pic.set(c - dir * k, r, k < 9 ? "-" : ".", mix(this.st.plane, [255, 255, 255], 0.3 + k * 0.035));
    }
  }

  private drawBeacons(t: number) {
    for (const b of this.beacons) {
      const on = (t * 0.7 + b.phase) % 1;
      const [c, r] = this.cellOf(b.x, b.y);
      if (on < 0.45) {
        const k = Math.sin((on / 0.45) * Math.PI);
        this.glow(b.x, b.y, this.cw * 2.2, this.st.beacon, 0.9 * k);
        this.pic.set(c, r, k > 0.5 ? "*" : "+", this.st.beacon);
      } else this.pic.set(c, r, ".", mix(this.st.beacon, [0, 0, 0], 0.4));
    }
  }

  /** People at windows: the pane lit warm, brighter than any, glowing; fading in and out. */
  private drawLookers(city: City, t: number) {
    const { cw, ch } = this;
    const g = this.pic.g;
    for (const l of city.lookers) {
      const pl = city.placed[l.place];
      if (!pl) continue;
      const i = pl.winKey.indexOf(l.key);
      if (i < 0) continue;
      const a = Math.min(clamp((t - l.since) / 0.35, 0, 1), l.until === Infinity ? 1 : clamp((l.until - t) / 0.6, 0, 1));
      if (a <= 0) continue;
      const x = pl.winC[i]! * cw;
      const y = pl.winR[i]! * ch;
      g.globalAlpha = a;
      g.fillStyle = this.st.looker;
      g.fillRect(x + cw * 0.05, y + ch * 0.08, cw * 0.9, ch * 0.84);
      g.globalAlpha = 1;
      if (this.palette.lit) this.glow(x + cw / 2, y + ch / 2, cw * 2.2, rgbOf(this.palette.looker), 0.5 * a);
    }
  }

  /** The traffic: each car's body in its lane, its glass, its lights; at night its headlights
   *  throwing a beam ahead along the road and its tail lights red. */
  private drawTraffic(city: City) {
    const { cw, ch } = this;
    const g = this.pic.g;
    const st = this.st;
    const lit = this.palette.lit;
    for (const car of city.cars) {
      const dir = car.lane ? -1 : 1;
      const len = car.len * cw;
      const x0 = dir > 0 ? car.x : car.x - len;
      if (x0 > this.width + cw * 8 || x0 + len < -cw * 8) continue;
      const y = (city.base + 1 + car.lane) * ch;
      const front = dir > 0 ? x0 + len : x0;
      const back = dir > 0 ? x0 : x0 + len;
      if (lit) {
        const beam = g.createLinearGradient(front, 0, front + dir * cw * 7, 0);
        beam.addColorStop(0, cssAlpha(st.headRgb, 0.6));
        beam.addColorStop(1, cssAlpha(st.headRgb, 0));
        g.fillStyle = beam;
        g.fillRect(Math.min(front, front + dir * cw * 7), y + ch * 0.35, cw * 7, ch * 0.55);
        this.glow(back, y + ch * 0.55, cw * 1.6, st.tailRgb, 0.7);
      }
      g.fillStyle = car.kind === "taxi" ? st.taxi : st.paints[car.paint % st.paints.length]!;
      const tall = car.kind === "bus" || car.kind === "van";
      g.fillRect(x0, y + ch * 0.45, len, ch * 0.4);
      g.fillRect(x0 + (tall ? 0 : len * 0.2), y + ch * (tall ? 0.08 : 0.2), tall ? len : len * 0.6, ch * (tall ? 0.4 : 0.28));
      g.fillStyle = car.kind === "bus" && lit ? st.win[0][1]! : st.win[0][lit ? 0 : 1]!;
      g.fillRect(x0 + (tall ? cw * 0.3 : len * 0.26), y + ch * (tall ? 0.14 : 0.24), tall ? len - cw * 0.6 : len * 0.48, ch * 0.18);
      g.fillStyle = st.head;
      g.fillRect(front - (dir > 0 ? cw * 0.3 : 0), y + ch * 0.5, cw * 0.3, ch * 0.18);
      g.fillStyle = st.tail;
      g.fillRect(back - (dir > 0 ? 0 : cw * 0.3), y + ch * 0.5, cw * 0.3, ch * 0.18);
    }
  }

  /** Fireworks: the rocket climbing, its trail; then the burst, its light on the sky and its sparks,
   *  each a character in its cell, white-hot, then its colour, dimmer as it falls and fades, behind
   *  the roofs it falls behind. */
  private drawFireworks(city: City) {
    const { cols } = this;
    for (const f of city.fireworks) {
      const colour = this.st.fireworks[f.colour % this.st.fireworks.length]!;
      const colour2 = this.st.fireworks[f.colour2 % this.st.fireworks.length]!;
      if (f.age < f.rise) {
        const y = city.rocketY(f);
        const [c, r] = this.cellOf(f.x, y);
        this.glow(f.x, y, this.cw * 1.5, colour, 0.8);
        this.pic.set(c, r, "|", mix(colour, [255, 255, 255], 0.6));
        this.pic.set(c, r + 1, "'", colour);
        this.pic.set(c, r + 2, ".", mix(colour, [0, 0, 0], 0.4));
        continue;
      }
      const since = f.age - f.rise;
      const left = clamp(1 - since / f.life, 0, 1);
      if (since < 0.35) this.glow(f.x, f.y, 40 + since * 260, mix(colour, [255, 255, 255], 0.5), (1 - since / 0.35) * (this.palette.lit ? 0.9 : 0.5));
      if (left > 0.25) this.glow(f.x, f.y + since * 20, 70 + since * 120, colour, (this.palette.lit ? 0.3 : 0.18) * (left - 0.25));
      const glyph = left > 0.6 ? "*" : left > 0.28 ? "+" : ".";
      const hot = left > 0.8;
      const s = f.sparks;
      const tick = Math.floor(city.time * 12);
      for (let i = 0; i < s.length; i += 4) {
        const [c, r] = this.cellOf(s[i]!, s[i + 1]!);
        if (c < 0 || c >= cols || r < 0 || r >= this.tops[c]!) continue;
        if (left < 0.35 && hashOf(i, tick, f.colour) < 0.35) continue;
        const own = (i >> 2) & 1 ? colour2 : colour;
        const k = this.palette.lit ? 0.35 + 0.65 * left : 1;
        this.pic.set(c, r, glyph, hot ? mix(own, [255, 255, 255], 0.5) : mix(this.st.sky[1]!, own, k));
        // Its trail, a cell back along its way.
        if (left > 0.3) {
          const v = Math.hypot(s[i + 2]!, s[i + 3]!) || 1;
          const [tc, tr] = this.cellOf(s[i]! - (s[i + 2]! / v) * this.cw * 1.2, s[i + 1]! - (s[i + 3]! / v) * this.ch * 0.9);
          if ((tc !== c || tr !== r) && tc >= 0 && tc < cols && tr >= 0 && tr < this.tops[tc]!) this.pic.set(tc, tr, f.kind === "willow" ? "'" : ".", mix(this.st.sky[1]!, own, 0.6 * k));
        }
      }
    }
  }
}
