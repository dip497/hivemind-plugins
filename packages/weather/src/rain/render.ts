/**
 * Rain on Glass's picture, which the character pass turns into characters (chars.ts).
 *
 * Behind the glass, the city's lights (city.ts) out of focus and the buildings along the street,
 * painted twice per size and look: once as seen through clear glass (crisp discs, the dark between
 * them) and once through condensation (wider, softer, under a pale haze). Each frame the two are
 * mixed by how fogged each cell of the glass is, through a mask of the cells scaled up smoothly, so a
 * wiped patch and a drop's line have soft edges; the condensation's grain is what the pass's ramp
 * makes of the haze. Over that: the cars' lights passing down the street, the beads of water, each a
 * point of the light behind it (by night) or of ink (by day), the running drops with their wet
 * streaks (the scene's own characters, `marks`, in those colours), and a tap's ring.
 */
import type { Draw2D } from "../cells";
import { css, cssAlpha, rgbOf, type Rgb } from "../colour";
import { PictureRenderer } from "../picture";
import { clamp } from "../util";
import { cityOf, farEnd, lightIndex, type City } from "./city";
import { STREAK, TAP, type Glass } from "./glass";
import { LIGHTS, RAIN_PALETTE, type RainPalette } from "./palette";

/** The drops' own characters, and their numbers in a mark (1 the first). */
const MARKS = ["o", "°", "·", ".", "|", ":", "'"];
const [O, RING, DOT, SPECK, BAR, COLON, TICK] = [1, 2, 3, 4, 5, 6, 7];

export class RainRenderer extends PictureRenderer<RainPalette, Glass> {
  private clear = new OffscreenCanvas(1, 1);
  private fogged = new OffscreenCanvas(1, 1);
  private through = new OffscreenCanvas(1, 1);
  private mask = new OffscreenCanvas(1, 1);
  private maskImage: ImageData | null = null;
  private viewsFor = -1;
  private city: City = { lights: [], buildings: [] };
  /** The clear view's colours, read back once per size and look: what a drop shows. */
  private behind: Uint8ClampedArray = new Uint8ClampedArray(0);
  /** What a drop in each cell shows: rgb for a small one, rgb for a big one. */
  private lensOf = new Uint8Array(0);
  private discs: OffscreenCanvas[] = [];
  private blobs: OffscreenCanvas[] = [];
  private glint: Rgb = [255, 255, 255];
  private drop: Rgb = [128, 128, 128];

  /** Each cell's own character this frame (MARKS), row by row. */
  private cellMarks = new Uint8Array(0);

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, RAIN_PALETTE);
  }

  protected extras() {
    return MARKS;
  }

  /** The drops' characters: a bead by its size, a running drop and its streak up the cells it ran
   *  down, a drop shivering after a tap a cell side to side. */
  protected marks(sim: Glass) {
    const { cols, rows } = this;
    if (sim.cols !== cols || sim.rows !== rows || this.lensOf.length !== cols * rows * 6) return null;
    if (this.cellMarks.length !== cols * rows * 4) this.cellMarks = new Uint8Array(cols * rows * 4);
    const m = this.cellMarks;
    const lens = this.lensOf;
    const put = (i: number, code: number, big: boolean) => {
      const from = i * 6 + (big ? 3 : 0);
      m[i * 4] = lens[from]!;
      m[i * 4 + 1] = lens[from + 1]!;
      m[i * 4 + 2] = lens[from + 2]!;
      m[i * 4 + 3] = code;
    };
    const s = sim.scale;
    for (let i = 0; i < cols * rows; i++) {
      const r = sim.bead[i]!;
      if (!r) m[i * 4 + 3] = 0;
      else put(i, r > 2 * s ? O : r > 1.1 * s ? (i % 3 ? DOT : RING) : SPECK, r > 2 * s);
    }
    for (const d of sim.runners) {
      for (let k = d.pathN - 1; k >= 1; k--) {
        const j = d.path[k]!;
        if (!sim.bead[j]) put(j, k <= 2 ? BAR : k <= 4 ? COLON : TICK, false);
      }
      const shake = d.shiver > 0 ? (Math.floor(sim.time * 26 + d.id) % 2 ? 1 : -1) : 0;
      const c = clamp(Math.floor(d.x / this.cw) + shake, 0, cols - 1);
      const r = Math.floor(d.y / this.ch);
      if (r >= 0 && r < rows) put(r * cols + c, O, true);
    }
    return m;
  }

  protected styled() {
    const p = this.palette;
    this.discs = LIGHTS.map((k) => disc(rgbOf(p.lights[k]), false));
    this.blobs = LIGHTS.map((k) => disc(rgbOf(p.lights[k]), true));
    this.glint = rgbOf(p.glint);
    this.drop = rgbOf(p.drop);
  }

  /** The city through clear glass and through condensation. */
  private paintViews() {
    const { width: W, height: H } = this;
    const p = this.palette;
    this.city = cityOf(W, H);
    for (const [view, soft] of [[this.clear, false], [this.fogged, true]] as const) {
      const g = this.layer(view);
      const sky = g.createLinearGradient(0, 0, 0, H);
      p.sky.forEach((c, i) => sky.addColorStop(i / (p.sky.length - 1), css(rgbOf(c))));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      if (p.glow) {
        const { colour, alpha, x, y, r } = p.glow;
        const R = Math.max(W, H) * r;
        const glow = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, R);
        glow.addColorStop(0, cssAlpha(rgbOf(colour), alpha));
        glow.addColorStop(1, cssAlpha(rgbOf(colour), 0));
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
      }
      g.save();
      g.filter = `blur(${soft ? 4 : 1.5}px)`;
      g.fillStyle = css(rgbOf(p.building));
      for (const b of this.city.buildings) g.fillRect(b.x0, b.top, b.x1 - b.x0, H * 1.1 - b.top);
      g.restore();
      for (const b of this.city.lights) {
        const r = soft ? b.r * 1.9 : b.r;
        g.globalAlpha = b.a * (soft ? p.fogAlpha : p.clearAlpha);
        g.drawImage((soft ? this.blobs : this.discs)[lightIndex(b.kind)]!, b.x - r, b.y - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
      if (soft) {
        g.globalAlpha = p.veil.alpha;
        g.fillStyle = css(rgbOf(p.veil.colour));
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }
    const read = this.clear.getContext("2d", { willReadFrequently: true });
    this.behind = read ? read.getImageData(0, 0, this.clear.width, this.clear.height).data : new Uint8ClampedArray(0);
    // What a drop in each cell shows of the light behind it: a small one and a big one.
    const { cols, rows } = this;
    this.lensOf = new Uint8Array(cols * rows * 6);
    const px = new Uint8ClampedArray(4 * 2);
    for (let i = 0; i < cols * rows; i++) {
      this.dot(px, 0, (i % cols) * 2, Math.floor(i / cols) * 4 + 1, 0.4);
      this.dot(px, 4, (i % cols) * 2, Math.floor(i / cols) * 4 + 1, 1);
      this.lensOf.set([px[0]!, px[1]!, px[2]!, px[4]!, px[5]!, px[6]!], i * 6);
    }
  }

  protected paint(sim: Glass, g: Draw2D) {
    if (sim.cols !== this.cols || sim.rows !== this.rows) return;
    if (this.viewsFor !== this.version) {
      this.paintViews();
      this.viewsFor = this.version;
    }
    this.paintGlass(sim, g);
    g.setTransform(this.pic.width / this.width, 0, 0, this.pic.height / this.height, 0, 0);
    this.paintTraffic(sim, g);
    this.paintTaps(sim, g);
  }

  /** The two views mixed by each cell's condensation: the fogged view, and the clear one through a
   *  mask of how clear each cell is, scaled up smoothly. */
  private paintGlass(sim: Glass, g: Draw2D) {
    const { cols, rows } = this;
    if (this.mask.width !== cols || this.mask.height !== rows) {
      this.mask.width = cols;
      this.mask.height = rows;
      this.maskImage = new ImageData(cols, rows);
    }
    const px = this.maskImage!.data;
    for (let i = 0; i < cols * rows; i++) {
      px[i * 4 + 3] = clamp(Math.round((1 - sim.fog[i]! / 0.85) * 255), 0, 255);
    }
    this.mask.getContext("2d")!.putImageData(this.maskImage!, 0, 0);
    const t = this.through.getContext("2d")!;
    if (this.through.width !== this.pic.width || this.through.height !== this.pic.height) {
      this.through.width = this.pic.width;
      this.through.height = this.pic.height;
    }
    t.globalCompositeOperation = "copy";
    t.drawImage(this.clear, 0, 0);
    t.globalCompositeOperation = "destination-in";
    t.imageSmoothingEnabled = true;
    t.drawImage(this.mask, 0, 0, this.pic.width, this.pic.height);
    t.globalCompositeOperation = "source-over";
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.fogged, 0, 0);
    g.drawImage(this.through, 0, 0);
  }

  /** What a drop at texel (x, y) of the picture shows, into `out` at `at` (rgb): what a lens makes
   *  of the clear view behind it, brighter by night, by day dark ink with that colour in it; `k` how
   *  much of a drop (0 to 1). */
  private dot(out: Uint8ClampedArray, at: number, x: number, y: number, k: number) {
    const { width: pw, height: ph } = this.pic;
    const i = (Math.min(ph - 1, y) * pw + Math.min(pw - 1, x)) * 4;
    const b = this.behind;
    if (this.light) {
      const m = 0.3 * k;
      for (let c = 0; c < 3; c++) out[at + c] = this.drop[c]! + (b[i + c]! - this.drop[c]!) * m;
    } else {
      const lift = (0.5 + 0.45 * k) * 0.4;
      for (let c = 0; c < 3; c++) out[at + c] = b[i + c]! * 1.7 + this.glint[c]! * lift;
    }
  }

  /** The cars down the street: a pair of soft lights each, headlights coming nearer and growing,
   *  tail lights going away and shrinking, at the street's level, behind the glass. */
  private paintTraffic(sim: Glass, g: Draw2D) {
    const { width: W, height: H } = this;
    const end = farEnd(W, H);
    const s = Math.min(W, H) / 900;
    const p = this.palette;
    for (const c of sim.cars) {
      const k = Math.pow(c.z, 0.7);
      const x = W * (0.5 + c.lane * (1 - k)) * (1 - k) + end.x * k;
      const y = H * 0.84 * (1 - k) + (end.y + 6 * s) * k;
      const r = (30 * (1 - k) + 6 * k) * s * 1.4;
      g.globalAlpha = p.clearAlpha * 0.75 * (0.5 + 0.5 * (1 - k)) * Math.min(1, (1 - c.z) * 8, c.z * 12 + 0.3);
      const sprite = this.blobs[lightIndex(c.coming ? "warm" : "red")]!;
      for (const side of [-1, 1]) g.drawImage(sprite, x + side * r * 0.8 - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }

  /** A tap's ring: the glass trembling outward from it, fading. */
  private paintTaps(sim: Glass, g: Draw2D) {
    for (const t of sim.taps) {
      const k = t.age / (TAP.life * 0.6);
      if (k >= 1) continue;
      const rho = TAP.reach * sim.scale * (1 - (1 - k) ** 2);
      g.strokeStyle = cssAlpha(this.glint, (1 - k) * (this.light ? 0.5 : 0.7));
      g.lineWidth = this.ch * 0.35;
      g.beginPath();
      g.ellipse(t.x, t.y, rho, rho * 0.85, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** A light out of focus, in one colour: through clear glass a disc, even across with a soft edge and
 *  a faintly brighter rim, as a lens blurs a point of light; through condensation a soft blob. */
function disc(colour: Rgb, soft: boolean, size = 64): OffscreenCanvas {
  const sprite = new OffscreenCanvas(size, size);
  const g = sprite.getContext("2d");
  if (!g) return sprite;
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  if (soft) {
    grad.addColorStop(0, cssAlpha(colour, 0.9));
    grad.addColorStop(0.35, cssAlpha(colour, 0.62));
    grad.addColorStop(0.7, cssAlpha(colour, 0.2));
    grad.addColorStop(1, cssAlpha(colour, 0));
  } else {
    grad.addColorStop(0, cssAlpha(colour, 0.8));
    grad.addColorStop(0.75, cssAlpha(colour, 0.88));
    grad.addColorStop(0.9, cssAlpha(colour, 1));
    grad.addColorStop(1, cssAlpha(colour, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return sprite;
}
