/**
 * Autumn Wood's drawing. The picture, one pixel a cell: the sky and the low sun's glow (by day the
 * sun high on the right); the far treeline, hazed; the mist low between the trees; the forest floor
 * and the pile of leaves on it; each tree, its trunk lit on the side toward the sun, its limbs, and
 * its crown of clumps, each lit on its sunward side and shaded on the other, those behind darker, in
 * the tree's autumn colours (a shaken crown sways a cell or two); the fox or deer crossing; and at
 * dusk the lantern and the fireflies, which glow. That is drawn through characters (ascii.ts): the
 * crowns' and trunks' outlines come out as lines, their light and shade as a ramp in their colours.
 * Over it, as characters of their own: the stars, the falling leaves tumbling, the fireflies.
 */
import type { Draw2D } from "../cells";
import { css, mix, ramp as rampOf, rgbOf, RAMP, type Rgb } from "../colour";
import { PictureRenderer } from "../look";
import { clamp, hash } from "../num";
import { paintSky } from "../sky";
import { SPRITES } from "./beasts";
import { PILE_ROWS, type Wood } from "./forest";
import { AUTUMN_PALETTE, LEAF_COLOURS, type AutumnPalette } from "./palette";
import type { TreeShape, WoodLayout } from "./wood";

/** The shapes a falling leaf tumbles through: face on, turning, edge on, turning. */
const TUMBLE = [["&", "%", "|", "%"], ["@", "o", "-", "o"], ["§", "s", "/", "s"], ["*", "+", "'", "+"]];
const STAR_LEVELS = 3;

interface TreeLayers { shape: TreeShape; trunk: OffscreenCanvas; crown: OffscreenCanvas }

export class AutumnRenderer extends PictureRenderer<AutumnPalette, Wood> {
  private still = new OffscreenCanvas(1, 1);
  private stillFor = -1;
  private stillLayout: WoodLayout | null = null;
  private trees: TreeLayers[] = [];
  private leafRamps: string[][] = [];
  private leafRgb: Rgb[] = [];
  private starStyles: string[] = [];
  private beastStyles: Record<"fox" | "deer", string[]> = { fox: [], deer: [] };
  private stars: { x: number; y: number; rate: number; phase: number }[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, AUTUMN_PALETTE, { dim: 0.34, bloom: 0.8, wash: 0.18, night: [0.16, 0.85], day: [0.12, 0.62] });
  }

  protected styled() {
    const p = this.palette;
    this.leafRgb = LEAF_COLOURS.map((k) => rgbOf(p.leaves[k]));
    this.leafRamps = this.leafRgb.map((c) => rampOf(rgbOf(p.shadow), c));
    const top = rgbOf(p.sky[0]!);
    this.starStyles = p.stars ? Array.from({ length: STAR_LEVELS }, (_, l) => css(mix(top, rgbOf(p.star), (p.stars * (l + 1)) / STAR_LEVELS))) : [];
    const tones = (cs: [number, number, number][]) => cs.map((c) => css(rgbOf(c)));
    this.beastStyles = this.light
      ? { fox: tones([[0.66, 0.17, 45], [0.95, 0.02, 80], [0.3, 0.05, 40]]), deer: tones([[0.6, 0.08, 60], [0.95, 0.02, 80], [0.32, 0.04, 50]]) }
      : { fox: tones([[0.66, 0.16, 45], [0.9, 0.03, 80], [0.18, 0.03, 300]]), deer: tones([[0.58, 0.07, 58], [0.88, 0.03, 80], [0.18, 0.03, 300]]) };
  }

  private skyAt(r: number): Rgb {
    const s = this.palette.sky.map(rgbOf);
    const t = clamp((r + 0.5) / this.rows, 0, 1) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(t));
    return mix(s[i]!, s[i + 1]!, t - i);
  }

  /** What holds still: the sky, the far treeline, the mist, the floor; and each tree's layers. */
  private paintStill(layout: WoodLayout) {
    const { cols, rows, cw, ch } = this;
    const p = this.palette;
    this.still.width = cols;
    this.still.height = rows;
    const g = this.still.getContext("2d")!;
    paintSky(g, cols, rows, p, ch / cw);
    const shadow = rgbOf(p.shadow);
    const farBase = rgbOf(p.far);
    for (let c = 0; c < cols; c++) {
      for (let r = layout.far[c]!; r < layout.floor; r++) {
        const down = (r - layout.far[c]!) / Math.max(1, layout.floor - layout.far[c]!);
        const leaf = this.leafRgb[[1, 2, 3, 4, 6][Math.floor(hash(Math.floor(c / 4), 0, 5) * 4.99)]!]!;
        const tint = mix(mix(farBase, leaf, 0.3), this.skyAt(r), p.haze);
        g.fillStyle = css(mix(tint, shadow, this.light ? down * 0.25 : 0.2 + down * 0.4));
        g.fillRect(c, r, 1, 1);
      }
    }
    // The mist's body, low between the trees.
    const mist = rgbOf(p.mist);
    const top = layout.floor - Math.round(rows * 0.14);
    const band = g.createLinearGradient(0, top, 0, layout.floor + 1);
    band.addColorStop(0, `rgba(${mist.join(",")},0)`);
    band.addColorStop(0.75, `rgba(${mist.join(",")},${p.mistAlpha * 0.7})`);
    band.addColorStop(1, `rgba(${mist.join(",")},${p.mistAlpha * 0.3})`);
    g.fillStyle = band;
    g.fillRect(0, top, cols, layout.floor + 1 - top);
    // The floor: earth, a litter of leaves on it.
    const [earth, litter] = p.floor.map(rgbOf) as [Rgb, Rgb];
    for (let r = layout.floor; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = hash(c, r, 0x0a17);
        g.fillStyle = css(h < 0.4 ? mix(mix(litter, this.leafRgb[Math.floor(h * 17) % 7]!, 0.5), earth, 0.3) : mix(earth, shadow, (r - layout.floor) * 0.1));
        g.fillRect(c, r, 1, 1);
      }
    }
    const glow = p.glow!;
    const sun = { c: glow.x * cols, r: glow.y * rows };
    this.trees = layout.trees.map((shape, i) => this.paintTree(shape, sun, this.trees[i]));
  }

  /** A tree's trunk and limbs, and its crown, each a layer of its own (the crown sways). */
  private paintTree(s: TreeShape, sun: { c: number; r: number }, prev?: TreeLayers): TreeLayers {
    const p = this.palette;
    const light = this.light;
    const { c0, r0, c1, r1 } = s.box;
    const t: TreeLayers = { shape: s, trunk: prev?.trunk ?? new OffscreenCanvas(1, 1), crown: prev?.crown ?? new OffscreenCanvas(1, 1) };
    for (const layer of [t.trunk, t.crown]) {
      layer.width = c1 - c0 + 1;
      layer.height = r1 - r0 + 1;
    }
    const haze = s.near ? 0 : 0.22;
    const sky = this.skyAt(Math.round(s.cy));
    const hazed = (rgb: Rgb) => css(haze ? mix(rgb, sky, haze) : rgb);
    const [dark, face, bright] = p.bark.map(rgbOf) as [Rgb, Rgb, Rgb];
    const barkAt = (v: number) => (v < 0.5 ? mix(dark, face, v * 2) : mix(face, bright, (v - 0.5) * 2));
    const toSun = Math.sign(sun.c - s.c) || 1;
    const g = t.trunk.getContext("2d")!;
    g.translate(-c0, -r0);
    for (let r = s.top; r <= s.foot; r++) {
      const up = (s.foot - r) / Math.max(1, s.foot - s.top);
      const mid = s.c + (s.foot - r) * s.lean;
      const flare = r >= s.foot - 1 ? (r === s.foot ? 2 : 1) : 0;
      const width = Math.round(s.base + (s.width - s.base) * up) + flare * 2;
      const left = Math.round(mid - width / 2);
      for (let k = 0; k < width; k++) {
        const u = ((k + 0.5) / width) * 2 - 1;
        // Lit on the side toward the sun, grooved up and down.
        const v = clamp(0.45 + 0.4 * u * toSun - 0.2 * u * u + (hash(left + k - Math.round(mid), Math.floor(r / 3), 7) - 0.5) * 0.25, 0, 1);
        g.fillStyle = hazed(barkAt(v));
        g.fillRect(left + k, r, 1, 1);
      }
    }
    for (const l of s.limbs) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(l.c1 - l.c0), Math.abs(l.r1 - l.r0) * 1.45)));
      for (let i = 1; i <= n; i++) {
        g.fillStyle = hazed(barkAt(0.3 + 0.3 * (1 - i / n)));
        g.fillRect(Math.round(l.c0 + ((l.c1 - l.c0) * i) / n), Math.round(l.r0 + ((l.r1 - l.r0) * i) / n), i / n < 0.4 && l.thick > 1 ? 2 : 1, 1);
      }
    }
    // The crown: each clump lit on its sunward side, those behind darker, warm at the sunward edge.
    const cg = t.crown.getContext("2d")!;
    cg.translate(-c0, -r0);
    const cr = s.crown;
    let lx = sun.c - s.cx;
    let ly = (sun.r - s.cy) * 1.45;
    const lz = Math.hypot(lx, ly) * (light ? 0.9 : 0.35);
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll;
    ly /= ll;
    const lzn = lz / ll;
    const rim = rgbOf(p.rim);
    for (let i = 0; i < cr.n; i++) {
      const k = cr.colour[i]!;
      const facing = cr.nx[i]! * lx + cr.ny[i]! * ly + cr.nz[i]! * lzn;
      const lit = clamp(0.4 + 0.62 * facing + (hash(cr.c[i]!, cr.r[i]!, s.id) - 0.5) * 0.16 - 0.36 * cr.back[i]!, 0.05, 1);
      let rgb = mix(rgbOf(p.shadow), this.leafRgb[k]!, light ? 0.55 + 0.45 * lit : 0.2 + 0.8 * lit);
      if (cr.nx[i]! * lx + cr.ny[i]! * ly > 0.55 && cr.back[i]! < 0.6) rgb = mix(rgb, rim, p.rimAlpha * 0.6);
      cg.globalAlpha = cr.edge[i] ? 0.55 : 1;
      cg.fillStyle = hazed(rgb);
      cg.fillRect(cr.c[i]!, cr.r[i]!, 1, 1);
    }
    return t;
  }

  private placeStars(layout: WoodLayout) {
    const { width: W, height: H, cw, ch } = this;
    let s = 0x5a7;
    const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    this.stars = [];
    for (let i = Math.round((W * H) / 12000); i > 0; i--) {
      const x = r() * W;
      const y = r() * H * 0.55;
      const rate = 0.5 + r() * 1.6;
      const phase = r() * 6.28;
      if (layout.trees.some((t) => x / cw >= t.box.c0 - 1 && x / cw <= t.box.c1 + 1 && y / ch >= t.box.r0 - 1)) continue;
      this.stars.push({ x, y, rate, phase });
    }
  }

  protected paint(g: Draw2D, wood: Wood) {
    const layout = wood.layout;
    if (!layout || layout.grid.cols !== this.cols || layout.grid.rows !== this.rows) return;
    if (this.stillFor !== this.version || this.stillLayout !== layout) {
      this.stillFor = this.version;
      this.stillLayout = layout;
      this.paintStill(layout);
      this.placeStars(layout);
    }
    const t = wood.time;
    const p = this.palette;
    g.drawImage(this.still, 0, 0);
    // The trees, back to front; a crown sways a cell or two when shaken, and in a gust a few of its
    // leaves turn to show their paler side.
    const gust = clamp((wood.wind - 16) / 50, 0, 1);
    for (const near of [false, true]) {
      for (const tree of this.trees) {
        if (tree.shape.near !== near) continue;
        const { c0, r0 } = tree.shape.box;
        const { dx, hard } = wood.shake(tree.shape.id);
        g.drawImage(tree.trunk, c0, r0);
        g.drawImage(tree.crown, c0 + dx, r0);
        const cr = tree.shape.crown;
        const chance = 0.012 + 0.06 * gust + 0.4 * hard;
        g.fillStyle = css(mix(this.leafRgb[4]!, [255, 255, 255], 0.35));
        for (let i = 0; i < cr.n; i += 1) {
          if (cr.edge[i] || hash(i, Math.floor(t * 2.2 + hash(i, 3, 1) * 9), tree.shape.id) >= chance) continue;
          g.globalAlpha = 0.45;
          g.fillRect(cr.c[i]! + dx, cr.r[i]!, 1, 1);
        }
        g.globalAlpha = 1;
      }
    }
    // The pile on the floor, each column as deep as it is, its top leaves catching the light.
    const floor = layout.floor;
    for (let c = 0; c < this.cols; c++) {
      const depth = Math.min(PILE_ROWS, wood.pile[c]!);
      for (let k = 0; k < Math.ceil(depth); k++) {
        const colour = wood.pileColour[c * PILE_ROWS + k]!;
        const top = k + 1 >= depth;
        g.fillStyle = this.leafRamps[colour]![Math.round((this.light ? 0.6 + 0.3 * (k / PILE_ROWS) : 0.35 + 0.4 * (k / PILE_ROWS) + (top ? 0.2 : 0)) * RAMP)]!;
        g.globalAlpha = top ? clamp(depth - k, 0.3, 1) : 1;
        g.fillRect(c, floor - 1 - k, 1, 1);
      }
    }
    g.globalAlpha = 1;
    this.paintBeast(g, wood);
    // At dusk the lantern and the fireflies are lights: they glow.
    const lights = this.ascii.lit;
    if (p.lantern) {
      const { c, r } = layout.lantern;
      const flicker = 0.85 + 0.15 * Math.sin(t * 9.1) * Math.sin(t * 3.7);
      g.fillStyle = css(rgbOf(p.bark[0]));
      g.fillRect(c, r, 1, 1);
      lights.fillStyle = g.fillStyle = css(mix(rgbOf(p.lantern), [255, 255, 255], 0.3 * flicker));
      g.fillRect(c, r + 1, 1, 2);
      lights.globalAlpha = flicker;
      lights.fillRect(c - 1, r, 3, 3);
      lights.globalAlpha = 1;
    }
    if (p.firefly) {
      lights.fillStyle = css(rgbOf(p.firefly));
      for (const f of wood.fireflies) {
        const l = wood.fireflyLight(f);
        if (l < 0.2) continue;
        lights.globalAlpha = l;
        lights.fillRect(Math.floor(f.x / this.cw), Math.floor(f.y / this.ch), 1, 1);
      }
      lights.globalAlpha = 1;
    }
  }

  /** The fox or deer crossing on the floor, its legs stepping, as its shape. */
  private paintBeast(g: Draw2D, wood: Wood) {
    const w = wood.walker;
    if (!w) return;
    const sprite = SPRITES[w.kind];
    const [coat, pale, dark] = this.beastStyles[w.kind];
    const width = Math.max(...sprite.rows.map((r) => r.length));
    const left = Math.round(w.x / this.cw - width / 2);
    const top = Math.min(this.rows - 1, wood.layout.floor + 2) - sprite.rows.length + 1;
    const stride = Math.floor(w.gait) % 2 === 1;
    sprite.rows.forEach((row, k) => {
      let leg = 0;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        if (ch === " ") continue;
        let c = left + (w.dir > 0 ? i : width - 1 - i);
        if (ch === "L") {
          // The lowest row of each leg swings as it strides, fore and hind legs opposite.
          if (stride && k === sprite.rows.length - 1) c += leg % 2 ? 1 : -1;
          leg++;
        }
        const cell = sprite.cells[ch];
        g.fillStyle = cell ? [coat, pale, dark][cell[0]]! : ch === "L" || ch === "." || ch === "=" ? dark! : ch === "'" ? pale! : coat!;
        g.fillRect(c, top + k, 1, 1);
      }
    });
  }

  protected overlay(g: Draw2D | null, wood: Wood) {
    const t = wood.time;
    const hold = (x: number, y: number) => this.ascii.hold(x, y);
    if (this.starStyles.length) {
      for (let l = 0; l < STAR_LEVELS; l++) {
        if (g) g.fillStyle = this.starStyles[l]!;
        for (const s of this.stars) {
          const b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
          if (Math.min(STAR_LEVELS - 1, Math.floor(b * STAR_LEVELS)) !== l) continue;
          if (g) this.glyphAt(g, l === 2 ? "+" : l === 1 ? "." : "`", s.x, s.y);
          else hold(s.x, s.y);
        }
      }
    }
    // The leaves in the air, tumbling, grouped by colour.
    for (let k = 0; k < LEAF_COLOURS.length; k++) {
      if (g) g.fillStyle = this.leafRamps[k]![Math.round((this.light ? 0.62 : 0.95) * RAMP)]!;
      for (const l of wood.leaves) {
        if (l.colour !== k) continue;
        if (!g) {
          hold(l.x, l.y);
          continue;
        }
        const f = Math.floor((((l.spin % 6.2832) + 6.2832) % 6.2832) / 1.5708) % 4;
        this.glyphAt(g, TUMBLE[l.shape]![f]!, l.x, l.y);
      }
    }
    if (this.palette.firefly) {
      if (g) g.fillStyle = css(rgbOf(this.palette.firefly));
      for (const f of wood.fireflies) {
        if (wood.fireflyLight(f) < 0.3) continue;
        if (g) this.glyphAt(g, "*", f.x, f.y);
        else hold(f.x, f.y);
      }
    }
  }
}
