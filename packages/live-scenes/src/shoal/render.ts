/**
 * Shoal's drawing: the water and what swims in it (swim.ts), its sharks by their shapes
 * (shapes.ts), and a reef's sea bed along the bottom (seabed.ts).
 *
 * The bed's still part (sand, rock, coral, sponges, fans) is drawn once into a layer the height
 * of the bed, and again only when the grid or the look change. Its solid cells are blocks lit from
 * above, meeting with no seam, their tops in the cells' parts, a little grain on them; a coral's
 * branches and a fan's rays are lines from cell to cell, a polyp at each branch's tip. The
 * seagrass and the kelp sway, so they are drawn each frame: each a ribbon from its root, thinning
 * to its tip, bending in the current; a kelp's blades off its stalk, a float at the foot of each.
 */
import { bend, ribbon } from "../blades";
import { fillParts, textCells, WHOLE } from "../cells";
import { ramp as rampOf, rgbOf, type Oklch } from "../colour";
import { clamp, hash3 } from "../math";
import { SwimRenderer } from "../swim";
import { SHOAL_PALETTE, type ShoalPalette } from "./palette";
import { Seabed, type BedColour } from "./seabed";
import { SHAPES, SHARK_KINDS } from "./shapes";

/** Two tones of each colour of seagrass: a meadow is not one flat green. */
const GRASS_TONES = [0.62, 0.8];

export class ShoalRenderer extends SwimRenderer {
  private seabed = new Seabed();
  /** The bed's still cells, drawn once into a layer the height of the bed, and drawn again only
   *  when the grid or the look change. */
  private bed = new OffscreenCanvas(1, 1);
  private bedTop = 0;
  private bedFresh = false;
  /** Each part of the bed's colour, from the deep water to it in full light. */
  private bedRamps = {} as Record<BedColour, string[]>;
  private weedRamps: string[][] = [];
  private kelpRamp: string[] = [];
  private bladeRamp: string[] = [];
  /** On light water the bed's grain is darker than its block: toward its colour, not the water. */
  private grainStep = -0.22;
  /** Each frame's seagrass, a path per colour and tone; the kelp's stalks, blades and floats. */
  private grass: Path2D[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, { shapes: SHAPES, kinds: SHARK_KINDS, palette: SHOAL_PALETTE });
  }

  protected looked() {
    this.bedFresh = false;
    const p = this.palette as ShoalPalette;
    const bed = p.seabed;
    const deep = rgbOf(p.water[p.water.length - 1]!);
    const ramp = (c: Oklch) => rampOf(deep, rgbOf(c));
    this.bedRamps = {
      sand: ramp(bed.sand), rock: ramp(bed.rock), fan: ramp(bed.fan), brain: ramp(bed.brain),
      coral0: ramp(bed.corals[0]!), coral1: ramp(bed.corals[1]!), coral2: ramp(bed.corals[2]!),
    };
    this.weedRamps = bed.weeds.map(ramp);
    this.kelpRamp = ramp(bed.kelp);
    this.bladeRamp = ramp(bed.blade);
    this.grainStep = this.light ? 0.22 : -0.22;
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
   *  the seagrass and kelp over them where they have swayed to. */
  protected drawUnder(t: number) {
    const { ctx, dpr, ch } = this;
    if (!this.bedFresh) this.paintBed();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bed, 0, Math.round(this.bedTop * ch * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawWeeds(t);
  }

  /** Every strand where the current has it now. Seagrass: a ribbon from its root, thinning to its
   *  tip. Kelp: a stalk, and every other cell up it a blade off one side and then the other, a
   *  float at its foot. One fill a colour. */
  private drawWeeds(t: number) {
    const { ctx, cw, ch, cols } = this;
    const grass = GRASS_TONES.length;
    const paths = this.weedRamps.length * grass;
    while (this.grass.length < paths + 2) this.grass.push(new Path2D());
    for (let k = 0; k < paths + 2; k++) this.grass[k] = new Path2D();
    const stalks = this.grass[paths]!;
    const blades = this.grass[paths + 1]!;
    const floats: number[] = [];
    for (const w of this.seabed.weeds) {
      if (w.c < 0 || w.c >= cols) continue;
      const tone = w.kelp ? 0 : (hash3(w.c, w.foot, w.height) * grass) | 0;
      const path = w.kelp ? stalks : this.grass[w.colour * grass + tone]!;
      const root = w.kelp ? cw * 0.2 : cw * 0.24;
      const tip = w.kelp ? cw * 0.12 : cw * 0.04;
      ribbon(path, w, t, cw, ch, root, tip);
      if (!w.kelp) continue;
      for (let k = 2; k < w.height - 1; k += 2) {
        const side = (k / 2) % 2 ? 1 : -1;
        const x = (w.c + 0.5 + bend(w, k, t)) * cw;
        const y = (w.foot + 1 - k) * ch;
        // A blade trails the way the stalk leans above it.
        const lean = bend(w, k + 1, t) - bend(w, k, t);
        const long = (k < w.height * 0.75 ? 2.2 : 1.2) * cw;
        leaf(blades, x, y, side, long, lean * cw, ch);
        floats.push(x + side * cw * 0.25, y);
      }
    }
    for (let c = 0; c < this.weedRamps.length; c++) {
      for (let g = 0; g < grass; g++) {
        ctx.fillStyle = this.tone(GRASS_TONES[g]!, this.weedRamps[c]!);
        ctx.fill(this.grass[c * grass + g]!);
      }
    }
    ctx.fillStyle = this.tone(0.72, this.bladeRamp);
    ctx.fill(blades);
    ctx.fillStyle = this.tone(0.7, this.kelpRamp);
    ctx.fill(stalks);
    if (!floats.length) return;
    textCells(ctx, ch, this.fontFamily);
    ctx.fillStyle = this.tone(0.95, this.bladeRamp);
    for (let k = 0; k < floats.length; k += 2) ctx.fillText("o", floats[k]!, floats[k + 1]! + 1);
  }

  /** The bed's still cells into their layer. */
  private paintBed() {
    const { dpr, cols, cw, ch, seabed } = this;
    this.bedFresh = true;
    let top = this.rows;
    for (const b of seabed.cells) top = Math.min(top, b.r);
    this.bedTop = top = Math.max(0, top - 1);
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
    g.lineCap = "round";
    // Lines first, so a polyp and a block stand over the branch running into them.
    for (const b of seabed.cells) {
      if (!b.from) continue;
      g.strokeStyle = this.tone(b.colour === "fan" ? 0.66 : 0.84, this.bedRamps[b.colour]);
      g.lineWidth = cw * (b.colour === "fan" ? 0.14 + 0.4 * (b.thick ?? 0) : 0.24 + 0.5 * (b.thick ?? 0));
      g.beginPath();
      g.moveTo((b.from.c + 0.5) * cw, (b.from.r + 0.5) * ch);
      g.lineTo((b.c + 0.5) * cw, (b.r + 0.5) * ch);
      g.stroke();
    }
    for (const b of seabed.cells) {
      const ramp = this.bedRamps[b.colour];
      const x = b.c * cw + cw / 2;
      const y = b.r * ch + ch / 2 + 1;
      if (b.block) {
        const block = 0.3 + 0.55 * b.shade;
        g.fillStyle = this.tone(block, ramp);
        fillParts(g, b.c, b.r, cw, ch, dpr, b.parts);
        if (b.mouth) {
          // A sponge's open top: dark inside its rim.
          g.fillStyle = this.tone(this.light ? 0.95 : 0.08, ramp);
          fillParts(g, b.c, b.r, cw, ch, dpr, 12);
        }
        if (b.glyph === " " || b.parts !== WHOLE) continue;
        g.fillStyle = this.tone(clamp(block + this.grainStep, 0, 1), ramp);
        g.fillText(b.glyph, x, y);
        continue;
      }
      if (b.glyph === " ") continue;
      g.fillStyle = this.tone(b.tip ? 0.98 : b.colour === "fan" ? 0.6 : 0.8, ramp);
      g.fillText(b.glyph, x, y);
    }
  }
}

/** A kelp blade into `path`: a leaf out from the stalk at (`x`, `y`) on `side`, `long` across,
 *  rising a little, its far end trailing `lean` the way the stalk leans. */
function leaf(path: Path2D, x: number, y: number, side: number, long: number, lean: number, ch: number) {
  const ex = x + side * long + lean;
  const ey = y - ch * 0.55;
  const mx = (x + ex) / 2;
  const my = (y + ey) / 2;
  const wide = ch * 0.26;
  path.moveTo(x, y);
  path.quadraticCurveTo(mx, my - wide, ex, ey);
  path.quadraticCurveTo(mx, my + wide, x, y);
  path.closePath();
}
