/**
 * Shoal's drawing: the water and what swims in it (swim.ts), its sharks by their shapes
 * (shapes.ts), and a reef's sea bed along the bottom (seabed.ts).
 */
import { leanGlyph, still, sway } from "../blades";
import { textCells, type Draw2D } from "../cells";
import { css, mix, rgbOf, type Oklch } from "../colour";
import { SwimRenderer } from "../swim";
import { SHOAL_PALETTE, type ShoalPalette } from "./palette";
import { Seabed, type BedColour, type Weed } from "./seabed";
import { SHAPES, SHARK_KINDS } from "./shapes";

export class ShoalRenderer extends SwimRenderer {
  private seabed = new Seabed();
  /** The bed's still cells, and the seagrass's and kelp's that never sway, drawn once into a
   *  layer the height of the bed, and drawn again only when the grid or the look change. */
  private bed = new OffscreenCanvas(1, 1);
  private bedTop = 0;
  private bedFresh = false;
  /** Each part of the bed's block and character. */
  private bedStyles = {} as Record<BedColour, { block: string; glyph: string }>;
  private weedStyles: { block: string; glyph: string }[] = [];
  private kelpStyle = { block: "", glyph: "" };
  private bladeStyle = "";

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, { shapes: SHAPES, kinds: SHARK_KINDS, palette: SHOAL_PALETTE });
  }

  protected looked() {
    this.bedFresh = false;
    const p = this.palette as ShoalPalette;
    const bed = p.seabed;
    // A part's block is its colour half faded into the deep water it stands in: its characters
    // stand out on it, as a shark's do.
    const deep = rgbOf(p.water[p.water.length - 1]!);
    const style = (c: Oklch, k = 0.5) => ({ block: css(mix(deep, rgbOf(c), k)), glyph: css(rgbOf(c)) });
    this.bedStyles = {
      // The sand less faded: half into blue water it went grey.
      sand: style(bed.sand, 0.75), rock: style(bed.rock), fan: style(bed.fan), brain: style(bed.brain),
      coral0: style(bed.corals[0]!), coral1: style(bed.corals[1]!), coral2: style(bed.corals[2]!),
    };
    this.weedStyles = bed.weeds.map((c) => style(c));
    this.kelpStyle = style(bed.kelp);
    this.bladeStyle = css(rgbOf(bed.blade));
  }

  protected allocate(n: number) {
    super.allocate(n);
    this.seabed.build(this.cols, this.rows);
    this.bedFresh = false;
  }

  resize(width: number, height: number, dpr: number) {
    super.resize(width, height, dpr);
    this.bedFresh = false;
  }

  /** The sea bed: its still cells from their layer, drawn again first if anything changed, and
   *  the seagrass and kelp above them where they have swayed to. */
  protected drawUnder(t: number) {
    const { ctx, dpr, ch } = this;
    if (!this.bedFresh) this.paintBed();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bed, 0, Math.round(this.bedTop * ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(ctx, ch, this.fontFamily);
    for (const w of this.seabed.weeds) {
      const from = still(w);
      let below = sway(w, from - 1, t);
      for (let k = from; k < w.height; k++) {
        const off = sway(w, k, t);
        this.weedCell(ctx, w, k, w.c + off, off - below);
        below = off;
      }
    }
  }

  /** The `k`th cell up a strand, in column `c`, leaning `lean` cells from the one below: seagrass a
   *  thin ribbon, its foot a block and the rest bare characters; kelp a stalk from a holdfast, and
   *  every other cell up it a float and a blade off it, two cells long, on one side and then the
   *  other, one cell near its top. */
  private weedCell(g: Draw2D, w: Weed, k: number, c: number, lean: number) {
    const { cols, cw, ch } = this;
    const r = w.foot - k;
    if (r < 0 || c < 0 || c >= cols || r >= this.rows) return;
    const style = w.kelp ? this.kelpStyle : this.weedStyles[w.colour]!;
    const x = c * cw;
    const y = r * ch;
    if (k < 2) {
      g.fillStyle = style.block;
      g.fillRect(x + 1, y + 1, cw - 1, ch - 1);
    }
    const blade = w.kelp && k >= 2 && k % 2 === 0 && k < w.height - 1;
    g.fillStyle = style.glyph;
    g.fillText(k === w.height - 1 ? "'" : blade ? "o" : leanGlyph(lean, w.kelp ? (k < 2 ? "&" : "|") : k % 2 ? "(" : ")"), x + cw / 2, y + ch / 2 + 1);
    if (!blade) return;
    const side = (k / 2) % 2 ? 1 : -1;
    g.fillStyle = this.bladeStyle;
    for (let n = 1; n <= (k < w.height * 0.75 ? 2 : 1); n++) {
      const bc = c + side * n;
      if (bc < 0 || bc >= cols) break;
      // Out from the stalk, trailing the way it leans.
      g.fillText(n === 1 ? (lean * side > 0 ? "-" : "~") : side > 0 ? ">" : "<", bc * cw + cw / 2, y + ch / 2 + 1 + (n === 2 ? ch * 0.15 : 0));
    }
  }

  /** The bed's still cells, and the cells of each strand that never sway, into their layer. */
  private paintBed() {
    const { dpr, cols, cw, ch, seabed } = this;
    this.bedFresh = true;
    let top = this.rows;
    for (const b of seabed.cells) top = Math.min(top, b.r);
    for (const w of seabed.weeds) top = Math.min(top, w.foot - still(w) + 1);
    this.bedTop = top = Math.max(0, top);
    const w = Math.max(1, Math.round(cols * cw * dpr));
    const h = Math.max(1, Math.round((this.rows - top) * ch * dpr));
    if (this.bed.width !== w || this.bed.height !== h) {
      this.bed.width = w;
      this.bed.height = h;
    }
    const g = this.bed.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, -top * ch * dpr);
    textCells(g, ch, this.fontFamily);
    for (const b of seabed.cells) {
      const style = this.bedStyles[b.colour];
      if (b.block) {
        g.fillStyle = style.block;
        g.fillRect(b.c * cw + 1, b.r * ch + 1, cw - 1, ch - 1);
      }
      if (b.glyph === " ") continue;
      g.fillStyle = style.glyph;
      g.fillText(b.glyph, b.c * cw + cw / 2, b.r * ch + ch / 2 + 1);
    }
    for (const weed of seabed.weeds) {
      let below = 0;
      for (let k = 0; k < still(weed); k++) {
        const off = sway(weed, k, 0);
        this.weedCell(g, weed, k, weed.c + off, off - below);
        below = off;
      }
    }
  }
}
