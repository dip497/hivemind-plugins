/**
 * Snowfall's picture, which the character pass turns into characters (chars.ts).
 *
 * The ground, crisp, painted again only when the snow has lain noticeably deeper (or on a new size or
 * look): over a still part painted once per size and look (the sky with the moon or the sun; the
 * peaks, each split along a ridge into a face toward the light and a face away, snow above jagged
 * rock; mist at their feet; two lines of forest; the snowy slope with the path and the lanterns'
 * light on it), the village back to front, each house and pine casting its shadow on the snow, with
 * the snow lying on its roof or branches as deep as its ledges hold; then the snow on the ground in
 * front (its height map) and the lanterns.
 *
 * The light, soft, each frame: the smoke, and the glow of each lit window and lantern. The flakes, a
 * click's powder and the lit windows are the scene's own characters (`marks`).
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, rgbOf, type Oklch, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { PictureRenderer } from "../picture";
import { hash3, noise2 } from "../util";
import { SNOW_PALETTE, type SnowPalette } from "./palette";
import type { Valley } from "./valley";
import { Kind, type House, type Layout, type Peak, type Pine } from "./village";

/** The flakes' and the windows' own characters, and their numbers in a mark (1 the first). */
const MARKS = ["*", "+", "·", ".", "#"];
const [STAR, CROSS, DOT, SPECK, PANE] = [1, 2, 3, 4, 5];

export class SnowRenderer extends PictureRenderer<SnowPalette, Valley> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = { version: -1, layout: null as Layout | null };
  private layouts = new WeakMap<Layout, number>();
  private laidOutCount = 0;
  private st = {} as Record<string, string>;
  private glow: OffscreenCanvas | null = null;
  private cellMarks = new Uint8Array(0);
  private flakeRgb: Rgb[] = [];
  private litRgb: Rgb = [255, 200, 120];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, SNOW_PALETTE);
  }

  protected extras() {
    return MARKS;
  }

  protected styled() {
    const p = this.palette;
    const c = (o: Oklch) => css(rgbOf(o));
    this.st = {
      trim: c(p.trim), chimney: c(p.chimney), dark: c(p.dark), pineLit: c(p.pine.lit), pineShade: c(p.pine.shade), pineSnow: c(p.pineSnow),
      roofLit: c(p.roof.lit), roofShade: c(p.roof.shade), path: c(p.path), lantern: c(p.lantern), crest: c(p.crest), snowDeep: c(p.snow[1]),
      shade: cssAlpha(rgbOf(p.shade.colour), p.shade.alpha),
    };
    this.glow = glowSprite(rgbOf(p.glow.colour));
    this.flakeRgb = p.flake.map(rgbOf);
    this.litRgb = rgbOf(p.lit);
  }

  private valid(v: Valley): Layout | null {
    const l = v.layout;
    return l && l.cols === this.cols && l.rows === this.rows ? l : null;
  }

  /** The ground is painted again when the snow on the ground or on the ledges has lain an eighth of
   *  a row deeper on average: a few times while it piles up, then never. */
  protected groundOf(v: Valley) {
    const l = this.valid(v);
    if (!l) return "none";
    if (!this.layouts.has(l)) this.layouts.set(l, ++this.laidOutCount);
    let ground = 0;
    for (const d of v.ground) ground += d;
    let lying = 0;
    let room = 0;
    l.ledges.forEach((e, k) => {
      lying += v.ledgeDepth[k]!;
      room += e.cap;
    });
    return `${this.layouts.get(l)}|${Math.floor((ground / Math.max(1, v.ground.length)) * 8)}|${Math.floor((lying / Math.max(1e-6, room)) * 16)}`;
  }

  protected paintGround(v: Valley, g: Draw2D) {
    const l = this.valid(v);
    if (!l) return;
    if (this.stillFor.version !== this.version || this.stillFor.layout !== l) {
      this.still.width = this.ground.width;
      this.still.height = this.ground.height;
      this.paintStill(this.context(this.still, true), l, v.village!.far);
      this.stillFor = { version: this.version, layout: l };
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.still, 0, 0);
    g.restore();
    const depth = this.capDepths(v, l);
    l.things.forEach((t, k) => {
      if ("w" in t) {
        this.paintShadow(g, (t.mid + 0.5 + t.side / 2) * this.cw, (t.base + 1) * this.ch, (t.w + Math.abs(t.side) + 2) * this.cw, (t.base - t.peak + 2) * this.ch);
        this.paintHouse(g, t, depth[k]!);
      } else {
        this.paintShadow(g, (t.c + 0.5) * this.cw, (t.base + 1) * this.ch, (t.h / 3 + 1.5) * this.cw, t.h * this.ch);
        this.paintPine(g, t, depth[k]!);
      }
    });
    this.paintDrift(v, g, l);
    this.paintLanterns(g, l);
  }

  /** The snow on each house's roof and each pine's branches: as deep as its ledges hold on average,
   *  in px. */
  private capDepths(v: Valley, l: Layout) {
    const depth = new Float32Array(l.things.length);
    const count = new Float32Array(l.things.length);
    l.ledges.forEach((e, k) => {
      const owner = e.key >> 7;
      depth[owner] = depth[owner]! + v.ledgeDepth[k]!;
      count[owner] = count[owner]! + 1;
    });
    return depth.map((d, k) => (count[k] ? (d / count[k]!) * this.ch * 0.6 : 0));
  }

  /** The sky, the moon or the sun, the peaks, the mist, the forest, the snowy slope with its path and
   *  the lanterns' light on it. */
  private paintStill(g: Draw2D, l: Layout, peaks: Peak[]) {
    const { width: W, height: H, cw, ch } = this;
    const p = this.palette;
    const feet = (l.field + 1) * ch;
    const sky = g.createLinearGradient(0, 0, 0, feet);
    p.sky.forEach((c, i) => sky.addColorStop(i / (p.sky.length - 1), css(rgbOf(c))));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // The moon or the sun, its glow over the sky; the moon's darker seas.
    const lx = W * p.light.x;
    const ly = H * p.light.y;
    const R = Math.max(cw * 2.2, H * 0.034);
    const halo = g.createRadialGradient(lx, ly, R, lx, ly, H * 0.55);
    halo.addColorStop(0, cssAlpha(rgbOf(p.light.glow), p.light.alpha));
    halo.addColorStop(0.25, cssAlpha(rgbOf(p.light.glow), p.light.alpha * 0.3));
    halo.addColorStop(1, cssAlpha(rgbOf(p.light.glow), 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    g.fillStyle = css(rgbOf(p.light.disc));
    g.beginPath();
    g.arc(lx, ly, R, 0, Math.PI * 2);
    g.fill();
    if (!this.light) {
      g.fillStyle = cssAlpha(rgbOf([0.78, 0.03, 90]), 0.45);
      for (const [dx, dy, r] of [[-0.3, -0.25, 0.32], [0.25, 0.1, 0.24], [-0.05, 0.38, 0.2]] as const) {
        g.beginPath();
        g.arc(lx + dx * R, ly + dy * R, r * R, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.paintPeaks(g, l, peaks);
    // Mist along the peaks' feet.
    const top = Math.min(...Array.from(l.hills)) * ch;
    const mist = g.createLinearGradient(0, top - H * 0.12, 0, top + ch * 2);
    mist.addColorStop(0, cssAlpha(rgbOf(p.mist.colour), 0));
    mist.addColorStop(1, cssAlpha(rgbOf(p.mist.colour), p.mist.alpha));
    g.fillStyle = mist;
    g.fillRect(0, top - H * 0.12, W, feet - top + H * 0.12);
    // Two lines of forest, the far one higher and paler, their tops a crisp line of tree tips.
    this.paintForest(g, l, -2.2, p.forest[0], 7);
    this.paintForest(g, l, 0, p.forest[1], 11);
    // The snowy slope, its top edge a little uneven; long hollows across it in shade.
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + cw; x += cw * 2) g.lineTo(x, (l.field + 0.3 + 0.9 * (noise2(x / W * 7, 4.5, 81) - 0.5)) * ch);
    g.lineTo(W, H);
    g.closePath();
    const field = g.createLinearGradient(0, feet, 0, H);
    field.addColorStop(0, css(rgbOf(p.snow[0])));
    field.addColorStop(1, css(rgbOf(p.snow[1])));
    g.fillStyle = field;
    g.fill();
    const shade = rgbOf(p.shade.colour);
    for (let k = 0; k < 4; k++) {
      const y = feet + (H - feet) * (0.12 + 0.24 * k);
      const band = g.createLinearGradient(0, y - ch, 0, y + ch * 1.6);
      band.addColorStop(0, cssAlpha(shade, 0));
      band.addColorStop(0.6, cssAlpha(shade, p.shade.alpha * 0.45));
      band.addColorStop(1, cssAlpha(shade, 0));
      g.fillStyle = band;
      g.beginPath();
      g.moveTo(0, y - ch);
      for (let x = 0; x <= W + cw; x += cw * 3) g.lineTo(x, y + (noise2(x / W * 4, k + 0.5, 83) - 0.5) * ch * 3);
      g.lineTo(W, y + ch * 2);
      g.lineTo(0, y + ch * 2);
      g.closePath();
      g.fill();
    }
    this.paintPath(g, l);
    // The lanterns' light on the snow round them.
    if (p.pool.alpha > 0) {
      const pool = rgbOf(p.pool.colour);
      for (const n of this.lights(l)) {
        const x = n.x * cw;
        const y = (n.y + 1.6) * ch;
        g.save();
        g.translate(x, y);
        g.scale(1, 0.38);
        const r = cw * 7 * n.size;
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, cssAlpha(pool, p.pool.alpha));
        grad.addColorStop(1, cssAlpha(pool, 0));
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
        g.restore();
      }
    }
  }

  /** Every lantern: those along the path, and one by each front house's door. */
  private lights(l: Layout) {
    const out = l.lanterns.map((n) => ({ x: n.x, y: n.y, size: 1 }));
    for (const h of l.houses) if (h.front || h.kind === Kind.Church) out.push({ x: h.mid + 1.7, y: h.base - 1, size: 0.6 });
    return out;
  }

  /** The path trodden up through the snow. */
  private paintPath(g: Draw2D, l: Layout) {
    const { cw, ch } = this;
    g.fillStyle = this.st.path!;
    g.beginPath();
    l.path.forEach((p, k) => (k ? g.lineTo((p.x - p.w / 2) * cw, p.y * ch) : g.moveTo((p.x - p.w / 2) * cw, p.y * ch)));
    for (let k = l.path.length - 1; k >= 0; k--) g.lineTo((l.path[k]!.x + l.path[k]!.w / 2) * cw, l.path[k]!.y * ch);
    g.closePath();
    g.fill();
  }

  /** A band of forest along the hills' top row, `lift` rows higher, down to the snowy slope: its
   *  body dark, and over it rows of small spruce, the nearer rows lower and a little bigger, each
   *  tree's half toward the light lighter, so the forest is trees and not a flat fill. */
  private paintForest(g: Draw2D, l: Layout, lift: number, colour: Oklch, seed: number) {
    const { width: W, height: H, cw, ch } = this;
    const rowAt = (x: number) => {
      const f = x / cw - 0.5;
      const c = Math.max(0, Math.min(l.cols - 1, Math.floor(f)));
      const d = Math.max(0, Math.min(l.cols - 1, c + 1));
      const t = Math.max(0, Math.min(1, f - c));
      return (l.hills[c]! * (1 - t) + l.hills[d]! * t + lift) * ch;
    };
    const body = rgbOf(colour);
    const lit = rgbOf([colour[0] + (this.light ? 0.08 : 0.05), colour[1], colour[2] - 10]);
    const dark = rgbOf([colour[0] - (this.light ? 0.06 : 0.04), colour[1], colour[2] + 10]);
    g.fillStyle = css(body);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + cw; x += cw) g.lineTo(x, rowAt(x) + ch * 0.8);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    const bottom = (l.field + 1.5) * ch;
    for (let row = 0; row < 16; row++) {
      const step = cw * (0.75 + 0.05 * row);
      for (let x = -step * hash3(row, seed, 1), k = 0; x <= W + step; x += step * (0.7 + 0.6 * hash3(k, row, seed)), k++) {
        const y = rowAt(x) + ch * (0.9 + 0.95 * row) + (hash3(k, row + 9, seed) - 0.5) * ch * 0.5;
        if (y > bottom) continue;
        const h = ch * (0.9 + 0.9 * hash3(k, row + 5, seed) + 0.08 * row);
        const w = h * 0.3;
        g.fillStyle = css(row % 2 ? dark : body);
        g.beginPath();
        g.moveTo(x, y - h);
        g.lineTo(x + w, y);
        g.lineTo(x - w, y);
        g.closePath();
        g.fill();
        g.fillStyle = css(lit);
        g.beginPath();
        g.moveTo(x, y - h);
        g.lineTo(x + w, y);
        g.lineTo(x + w * 0.15, y - h * 0.08);
        g.closePath();
        g.fill();
      }
    }
  }

  /** The far peaks, the tallest (the farthest) first, the nearer ones paler with less haze. Each is
   *  split along a ridge from its top down across to its foot: the face toward the light (the
   *  right) lit, the other in shade, with a few spurs' shade across the lit face; snow above a
   *  jagged line, deeper down the gullies, rock below. */
  private paintPeaks(g: Draw2D, l: Layout, peaks: Peak[]) {
    const { height: H, cw, ch } = this;
    const p = this.palette;
    const feet = (l.field + 1) * ch;
    const sorted = [...peaks].sort((a, b) => a.top - b.top);
    sorted.forEach((k, i) => {
      const far = sorted.length > 1 ? 1 - i / (sorted.length - 1) : 0;
      const ax = k.fx * this.width;
      const ay = Math.max(H * 0.1, k.top * H);
      const tall = feet - ay;
      const run = (tall / (k.slope * ch)) * cw;
      const seed = Math.round(k.fx * 997);
      const jag = (f: number, side: number) => (noise2(f * 5 + side * 7, seed, 95) - 0.5) * ch * 2.2 * Math.sin(Math.PI * Math.min(1, f * 1.3)) + (hash3(Math.round(f * 40), side + 3, seed) - 0.5) * ch * 0.5 * f;
      // The silhouette: up the left flank to the top, down the right.
      const outline: [number, number][] = [];
      for (let s = 24; s >= 0; s--) outline.push([ax - run * (s / 24), ay + tall * (s / 24) + jag(s / 24, -1)]);
      for (let s = 1; s <= 24; s++) outline.push([ax + run * (s / 24), ay + tall * (s / 24) + jag(s / 24, 1)]);
      // The ridge: from the top down to the left, a little crooked; the face left of it in shade.
      const ridge: [number, number][] = [];
      for (let s = 0; s <= 16; s++) {
        const f = s / 16;
        ridge.push([ax - run * k.ridge * f + (noise2(f * 4, seed, 96) - 0.5) * cw * 3 * Math.sin(Math.PI * f), ay + tall * f ** 0.92]);
      }
      const shaded: [number, number][][] = [[...outline.slice(0, 25), ...ridge.slice().reverse()]];
      // Spurs high on the lit face, in its snow: from points down the ridge, a short thin shade
      // falling to the right.
      const spurs: [number, number][][] = [];
      for (let m = 1; m <= 3; m++) {
        const [rx, ry] = ridge[1 + m * 2]!;
        const len = run * (0.1 + 0.12 * hash3(m, seed, 7));
        const fall = len * k.slope * (ch / cw);
        spurs.push([[rx, ry], [rx + len, ry + fall * 0.9], [rx + len - cw * 0.7, ry + fall + ch * 0.5]]);
      }
      const poly = (pts: [number, number][]) => {
        g.beginPath();
        pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
      };
      const faces = (lit: Oklch, shade: Oklch, more: [number, number][][]) => {
        g.fillStyle = css(rgbOf(lit));
        g.fillRect(ax - run - cw, ay - ch, run * 2 + cw * 2, tall + ch * 2);
        g.fillStyle = css(rgbOf(shade));
        for (const s of [...shaded, ...more]) {
          poly(s);
          g.fill();
        }
      };
      g.save();
      poly(outline);
      g.clip();
      faces(p.rock.lit, p.rock.shade, []);
      // The snow: down to a jagged line, in tongues down the gullies.
      const line = 0.34 + 0.14 * noise2(k.fx * 3, 1.5, 97);
      g.beginPath();
      g.moveTo(ax - run - cw, ay - ch * 2);
      for (let s = 0; s <= 32; s++) {
        const x = ax - run + (run * 2 * s) / 32;
        const gully = noise2(s * 0.55, seed + 0.5, 99);
        const d = Math.abs(x - ax) / run;
        g.lineTo(x, ay + tall * (line * (0.55 + 0.9 * gully ** 2) + d * 0.5 * line) + (hash3(s, seed, 11) - 0.5) * ch * 0.8);
      }
      g.lineTo(ax + run + cw, ay - ch * 2);
      g.closePath();
      g.clip();
      faces(p.snowcap.lit, p.snowcap.shade, spurs);
      g.restore();
      if (far > 0) {
        g.save();
        poly(outline);
        g.fillStyle = cssAlpha(rgbOf(p.haze), 0.5 * far);
        g.fill();
        g.restore();
      }
    });
  }

  /** The shadow something standing at (x, bottom), `w` wide and `h` tall, casts on the snow: the
   *  light is high behind it on the right, so it falls toward us and to the left. */
  private paintShadow(g: Draw2D, x: number, bottom: number, w: number, h: number) {
    const fall = Math.min(h * 0.35, this.ch * 3);
    g.fillStyle = this.st.shade!;
    g.beginPath();
    g.moveTo(x - w / 2, bottom - this.ch * 0.2);
    g.lineTo(x + w / 2, bottom - this.ch * 0.2);
    g.lineTo(x + w / 2 - fall * 1.1, bottom + fall);
    g.lineTo(x - w / 2 - fall * 1.6, bottom + fall);
    g.closePath();
    g.fill();
  }

  /** A house seen a little from the side: its gable toward us (wood, or the church's stone), its long
   *  wall beside it lit or in shade by the side it is on, the roof's slope over that wall white with
   *  snow, dark trim along the gable's edges with snow lying on them `cap` px deep, its chimney, its
   *  windows dark (the lit ones are marks over them), a door; the church's tower and spire. */
  private paintHouse(g: Draw2D, h: House, cap: number) {
    const { cw, ch, st } = this;
    const p = this.palette;
    const [front, faces] = h.kind === Kind.Church ? p.stone : p.wood;
    const dir = Math.sign(h.side) || 1;
    const depth = Math.abs(h.side) * cw;
    const x0 = h.c0 * cw;
    const x1 = (h.c0 + h.w) * cw;
    const top = h.wallTop * ch;
    const bottom = (h.base + 1) * ch;
    const px = (h.mid + 0.5) * cw;
    const py = h.peak * ch + ch * 0.4;
    const over = cw * 0.6;
    const near = dir > 0 ? x1 : x0;
    // The long wall, and the gable wall with its triangle.
    g.fillStyle = css(rgbOf(dir > 0 ? faces.lit : faces.shade));
    g.fillRect(dir > 0 ? x1 : x0 - depth, top, depth, bottom - top);
    g.fillStyle = css(rgbOf(front));
    g.beginPath();
    g.moveTo(x0, bottom);
    g.lineTo(x0, top);
    g.lineTo(px, py);
    g.lineTo(x1, top);
    g.lineTo(x1, bottom);
    g.closePath();
    g.fill();
    // Planks across the wood, faintly.
    if (h.kind !== Kind.Church) {
      g.fillStyle = cssAlpha(rgbOf(p.trim), 0.35);
      for (let y = top + ch * 0.5; y < bottom; y += ch * 0.5) {
        g.fillRect(x0, y, x1 - x0, Math.max(1, ch * 0.07));
        g.fillRect(dir > 0 ? x1 : x0 - depth, y, depth, Math.max(1, ch * 0.07));
      }
    }
    // The roof's slope over the long wall: white, a little darker toward the eaves, its thickness a
    // dark band along them.
    const eave = near + dir * over;
    const slope = g.createLinearGradient(0, py, 0, top);
    slope.addColorStop(0, dir > 0 ? st.roofLit! : st.roofShade!);
    slope.addColorStop(1, st.roofShade!);
    g.fillStyle = slope;
    g.beginPath();
    g.moveTo(px, py - cap * 0.5);
    g.lineTo(px + dir * depth, py - cap * 0.5);
    g.lineTo(eave + dir * depth, top);
    g.lineTo(eave, top);
    g.closePath();
    g.fill();
    g.fillStyle = st.trim!;
    g.beginPath();
    g.moveTo(eave, top);
    g.lineTo(eave + dir * depth, top);
    g.lineTo(eave + dir * depth, top + ch * 0.22);
    g.lineTo(eave, top + ch * 0.22);
    g.closePath();
    g.fill();
    if (h.smoke) {
      const cx = Math.floor(h.smoke.x) * cw;
      g.fillStyle = st.chimney!;
      g.fillRect(cx + cw * 0.15, h.smoke.y * ch, cw * 0.7, (h.peak + 1.2 - h.smoke.y) * ch);
      g.fillStyle = st.roofLit!;
      g.fillRect(cx + cw * 0.05, h.smoke.y * ch - cap * 0.4, cw * 0.9, Math.max(2, cap * 0.4));
    }
    // The gable's edges: dark trim, the snow lying along it.
    const other = (dir > 0 ? x0 : x1) - dir * over;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = st.trim!;
    g.lineWidth = Math.max(1.5, cw * 0.28);
    g.beginPath();
    g.moveTo(other, top + ch * 0.1);
    g.lineTo(px, py);
    g.lineTo(eave, top + ch * 0.1);
    g.stroke();
    if (cap > 0.5) {
      g.strokeStyle = st.roofLit!;
      g.lineWidth = Math.max(1.5, cap * 0.55);
      g.beginPath();
      g.moveTo(other + dir * cw * 0.2, top - cap * 0.2);
      g.lineTo(px, py - cap * 0.3);
      g.lineTo(eave - dir * cw * 0.2, top - cap * 0.2);
      g.stroke();
    }
    // Windows, dark; a door.
    g.fillStyle = st.dark!;
    for (const w of h.windows) {
      const tall = h.kind === Kind.Church && w.r > h.wallTop ? 1.6 : 1;
      g.fillRect(w.c * cw + cw * 0.18, w.r * ch + ch * (1.15 - tall * 0.9), cw * 0.64, ch * 0.62 * tall);
    }
    if (h.front || h.kind === Kind.Church) {
      g.fillStyle = st.trim!;
      g.fillRect(h.mid * cw + cw * 0.12, h.base * ch + ch * 0.05, cw * 0.76, ch * 0.95);
    }
    if (h.tower) this.paintTower(g, h, cap);
  }

  /** The church's tower, in front of its gable, stone with its side toward the light; the spire on
   *  it, dark slate, snow along its lit edge. */
  private paintTower(g: Draw2D, h: House, cap: number) {
    const { cw, ch, st } = this;
    const [front, faces] = this.palette.stone;
    const t = h.tower!;
    const x0 = t.c0 * cw + cw * 0.1;
    const x1 = (t.c1 + 1) * cw - cw * 0.1;
    const top = t.top * ch;
    const bottom = (h.base + 1) * ch;
    g.fillStyle = css(rgbOf(faces.lit));
    g.fillRect(x1, top + ch * 0.2, cw * 0.7, bottom - top - ch * 0.2);
    g.fillStyle = css(rgbOf(front));
    g.fillRect(x0, top, x1 - x0, bottom - top);
    // A cornice under the spire, the bell's window, the door's arch.
    g.fillStyle = st.trim!;
    g.fillRect(x0 - cw * 0.2, top, x1 - x0 + cw * 0.9, ch * 0.25);
    const mx = (x0 + x1) / 2;
    g.fillStyle = st.dark!;
    g.beginPath();
    g.arc(mx, (t.top + 1.55) * ch, cw * 0.42, Math.PI, 0);
    g.lineTo(mx + cw * 0.42, (t.top + 2.2) * ch);
    g.lineTo(mx - cw * 0.42, (t.top + 2.2) * ch);
    g.closePath();
    g.fill();
    g.fillStyle = st.trim!;
    g.beginPath();
    g.arc(mx, bottom - ch * 0.9, cw * 0.45, Math.PI, 0);
    g.lineTo(mx + cw * 0.45, bottom);
    g.lineTo(mx - cw * 0.45, bottom);
    g.closePath();
    g.fill();
    // The spire.
    const tip = t.tip * ch;
    g.fillStyle = st.trim!;
    g.beginPath();
    g.moveTo(x0 - cw * 0.1, top);
    g.lineTo(mx, tip);
    g.lineTo(x1 + cw * 0.6, top);
    g.closePath();
    g.fill();
    g.strokeStyle = st.roofLit!;
    g.lineWidth = Math.max(1.2, cw * 0.18 + cap * 0.2);
    g.beginPath();
    g.moveTo(mx + cw * 0.05, tip + ch * 0.4);
    g.lineTo(x1 + cw * 0.5, top - ch * 0.05);
    g.stroke();
    g.fillStyle = css(rgbOf(this.palette.lantern));
    g.beginPath();
    g.arc(mx, tip - ch * 0.15, Math.max(1.2, cw * 0.16), 0, Math.PI * 2);
    g.fill();
  }

  /** A pine: tiers, each wider than the one above, the half toward the light lighter; snow lying
   *  along each tier's upper edges, `cap` px deep. */
  private paintPine(g: Draw2D, t: Pine, cap: number) {
    const { cw, ch, st } = this;
    const x = (t.c + 0.5) * cw;
    const top = (t.base - t.h + 1) * ch;
    const h = (t.h - 1) * ch;
    g.fillStyle = st.pineShade!;
    g.fillRect(x - cw * 0.18, top + h - ch * 0.2, cw * 0.36, ch * 1.2);
    this.tiers(t, (y0, y1, w0, w1) => {
      const droop = (y1 - y0) * 0.18;
      g.fillStyle = st.pineShade!;
      g.beginPath();
      g.moveTo(x - w0, y0);
      g.lineTo(x + w0, y0);
      g.lineTo(x + w1, y1);
      g.quadraticCurveTo(x, y1 - droop * 2, x - w1, y1);
      g.closePath();
      g.fill();
      g.fillStyle = st.pineLit!;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + w0, y0);
      g.lineTo(x + w1, y1);
      g.quadraticCurveTo(x + w1 * 0.4, y1 - droop * 1.6, x + w1 * 0.1, y1 - droop * 1.2);
      g.closePath();
      g.fill();
      if (cap > 0.5) {
        // Snow on the tier: along its upper edges, heaviest at its middle.
        const d = Math.min(cap * 0.8, (y1 - y0) * 0.45);
        g.fillStyle = st.pineSnow!;
        g.beginPath();
        g.moveTo(x - w1 * 0.92, y1 - droop * 0.4);
        g.lineTo(x - w0 * 0.6 - cw * 0.1, y0 + (y1 - y0) * 0.35);
        g.lineTo(x, y0 + (y1 - y0) * 0.3 - d * 0.3);
        g.lineTo(x + w0 * 0.6 + cw * 0.1, y0 + (y1 - y0) * 0.35);
        g.lineTo(x + w1 * 0.92, y1 - droop * 0.4);
        g.lineTo(x + w1 * 0.5, y1 - droop * 0.9 - d * 0.35);
        g.lineTo(x, y0 + (y1 - y0) * 0.3 + d * 0.9);
        g.lineTo(x - w1 * 0.5, y1 - droop * 0.9 - d * 0.35);
        g.closePath();
        g.fill();
      }
    });
  }

  /** A pine's tiers, top to bottom: each its top and bottom (px) and half-widths there. */
  private tiers(t: Pine, each: (y0: number, y1: number, w0: number, w1: number) => void) {
    const { cw, ch } = this;
    const top = (t.base - t.h + 1) * ch;
    const h = (t.h - 1) * ch;
    const n = Math.max(2, Math.round(t.h / 2.6));
    const wide = cw * Math.min(1, t.h / 9 + 0.35);
    for (let k = 0; k < n; k++) {
      const y0 = top + (h * k) / n;
      const y1 = top + (h * (k + 1.35)) / n;
      each(y0, Math.min(top + h, y1), k ? wide * (0.3 + 0.55 * k) : 0, wide * (1 + 0.8 * (k + 1)));
    }
  }

  /** The snow on the ground in front: its surface across the window, a bright crest, blue shade in
   *  the hollows behind each drift; the path again where it crosses it. */
  private paintDrift(v: Valley, g: Draw2D, l: Layout) {
    const { width: W, height: H, cw, ch, cols } = this;
    const p = this.palette;
    g.save();
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, v.surface(0));
    for (let c = 0; c < cols; c++) g.lineTo((c + 0.5) * cw, v.surface(c));
    g.lineTo(W, v.surface(cols - 1));
    g.lineTo(W, H);
    g.closePath();
    let top = H;
    for (let c = 0; c < cols; c++) top = Math.min(top, v.surface(c));
    const grad = g.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, this.st.crest!);
    grad.addColorStop(0.35, css(rgbOf(p.snow[0])));
    grad.addColorStop(1, this.st.snowDeep!);
    g.fillStyle = grad;
    g.fill();
    g.clip();
    this.paintPath(g, l);
    const shade = rgbOf(p.shade.colour);
    for (let k = 0; k < 2; k++) {
      const y = top + (H - top) * (0.45 + 0.3 * k);
      const band = g.createLinearGradient(0, y - ch, 0, y + ch * 1.2);
      band.addColorStop(0, cssAlpha(shade, 0));
      band.addColorStop(0.7, cssAlpha(shade, p.shade.alpha * 0.6));
      band.addColorStop(1, cssAlpha(shade, 0));
      g.fillStyle = band;
      g.fillRect(0, y - ch, W, ch * 2.2);
    }
    g.restore();
  }

  /** The lanterns: a dark post, the lamp on it. */
  private paintLanterns(g: Draw2D, l: Layout) {
    const { cw, ch, st } = this;
    for (const n of this.lights(l)) {
      const x = n.x * cw;
      const y = (n.y + 0.5) * ch;
      g.fillStyle = st.trim!;
      g.fillRect(x - cw * 0.1, y, cw * 0.2, ch * (n.size > 0.8 ? 1.6 : 0.6));
      g.fillRect(x - cw * 0.3, y - ch * 0.42, cw * 0.6, ch * 0.12);
      g.fillStyle = st.lantern!;
      g.beginPath();
      g.arc(x, y - ch * 0.1, cw * 0.26, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** The smoke, and the glow round each lit window and lantern. */
  protected paintLight(v: Valley, g: Draw2D) {
    const l = this.valid(v);
    if (!l) return;
    const { cw, ch } = this;
    const p = this.palette;
    const c = rgbOf(p.smoke.colour);
    for (const puffs of v.smoke) {
      for (const s of puffs) {
        const a = s.age / s.life;
        g.fillStyle = cssAlpha(c, p.smoke.alpha * (1 - a) * Math.min(1, a * 6));
        g.beginPath();
        g.arc(s.x, s.y, cw * (0.5 + 1.8 * a), 0, Math.PI * 2);
        g.fill();
      }
    }
    if (!this.glow) return;
    g.globalAlpha = p.glow.alpha;
    l.houses.forEach((h, k) => h.windows.forEach((w, j) => {
      if (!v.lit[k]?.[j] || (w.r + 0.5) * ch > v.surface(w.c)) return;
      const x = (w.c + 0.5) * cw;
      const y = (w.r + 0.5) * ch;
      g.drawImage(this.glow!, x - cw * 2.5, y - cw * 2.5, cw * 5, cw * 5);
      if (h.front) g.drawImage(this.glow!, x - cw * 3, v.surface(w.c) - ch * 0.5, cw * 6, ch * 1.6);
    }));
    if (p.pool.alpha > 0) {
      for (const n of this.lights(l)) g.drawImage(this.glow, n.x * cw - cw * 3 * n.size, (n.y + 0.4) * ch - cw * 3 * n.size, cw * 6 * n.size, cw * 6 * n.size);
    }
    g.globalAlpha = 1;
  }

  /** The flakes' characters: a far one a speck (not over the village, which stands in front of it),
   *  one among the houses a star or a cross by its size, a near one a star; a click's powder, a star
   *  going to a speck as it drifts; and each lit window, its panes. */
  protected marks(v: Valley) {
    const { cols, rows, cw, ch } = this;
    const l = this.valid(v);
    if (!l) return null;
    if (this.cellMarks.length !== cols * rows * 4) this.cellMarks = new Uint8Array(cols * rows * 4);
    const m = this.cellMarks;
    m.fill(0);
    l.houses.forEach((h, k) => h.windows.forEach((w, j) => {
      if (!v.lit[k]?.[j] || (w.r + 0.5) * ch > v.surface(w.c) || w.c < 0 || w.c >= cols || w.r < 0 || w.r >= rows) return;
      if (l.owner[w.r * cols + w.c] !== l.things.indexOf(h)) return;
      const i = (w.r * cols + w.c) * 4;
      m.set(this.litRgb, i);
      m[i + 3] = PANE;
    }));
    const put = (x: number, y: number, code: number, colour: Rgb) => {
      const c = Math.floor(x / cw);
      const r = Math.floor(y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const i = r * cols + c;
      if (m[i * 4 + 3] === PANE || (code === SPECK && (l.owner[i]! >= 0 || m[i * 4 + 3]))) return;
      m.set(colour, i * 4);
      m[i * 4 + 3] = code;
    };
    for (const f of v.flakes) put(f.x, f.y, f.layer === 0 ? SPECK : f.layer === 2 || f.size > 0.55 ? STAR : CROSS, this.flakeRgb[f.layer]!);
    for (const p of v.powder) {
      const a = p.age / p.life;
      put(p.x, p.y, a < 0.25 ? STAR : a < 0.5 ? CROSS : a < 0.75 ? DOT : SPECK, this.flakeRgb[2]!);
    }
    return m;
  }
}
