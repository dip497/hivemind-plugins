/**
 * Metro's drawing: a picture of the map, turned into characters (ascii.ts).
 *
 * The picture: the ground, a faint light in its middle; the river, a band winding across; the parks;
 * and the lines, each a stroke from cell middle to cell middle in its colour, glowing at night.
 * Beside it the scene paints its shapes alone (the river, the parks, the lines), so the lines come
 * out as line characters along their way (`-` across, `|` down, `/` and `\` at 45°) and the river's
 * banks and the parks' edges as outlines. Set where they are: a station `o` on its line, an
 * interchange `O`, a line's end `#`, each train a run of three `#` glowing on its track, ripples `~`
 * on the river, grass on the parks, and the districts' names in spaced capitals.
 *
 * What holds still is painted once per layout and look; each frame copies it, and paints over it a
 * line the pointer rests by, lit up over the rest, the trains, and a click's rings.
 */
import { AsciiPass, Picture, type AsciiStyle } from "../ascii";
import { SceneRenderer, type Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { clamp, hashOf } from "../util";
import { pointOn, type Layout, type Route } from "./map";
import { LEAVE, type Network } from "./network";
import { METRO_PALETTE, type MetroPalette } from "./palette";

/** Every character Metro sets itself, apart from the ramp and the lines (ascii.ts): the names' too. */
export const METRO_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ~'.,\"oO#";

const SHAPE = { ground: 0, park: 0.3, river: 0.5, line: 1 };
const grey = (v: number) => { const c = Math.round(v * 255); return `rgb(${c},${c},${c})`; };

export class MetroRenderer extends SceneRenderer<MetroPalette> {
  private pass: AsciiPass;
  private pic = new Picture();
  private still = new OffscreenCanvas(1, 1);
  private stillShape = new OffscreenCanvas(1, 1);
  private paintedLayout = -1;
  private fresh = false;
  private lineRgb: Rgb[] = [];
  private col = {
    ground: [] as Rgb[], river: [0, 0, 0] as unknown as Rgb, ripple: [0, 0, 0] as unknown as Rgb, park: [0, 0, 0] as unknown as Rgb,
    grass: [0, 0, 0] as unknown as Rgb, ring: [0, 0, 0] as unknown as Rgb, train: [0, 0, 0] as unknown as Rgb, label: [0, 0, 0] as unknown as Rgb,
    tick: null as Rgb | null,
  };
  private style!: AsciiStyle;
  private at = { x: 0, y: 0, dx: 0, dy: 0 };

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, METRO_PALETTE, false);
    this.pass = new AsciiPass(canvas);
  }

  protected styled() {
    const p = this.palette;
    this.lineRgb = p.lines.map(rgbOf);
    this.col = {
      ground: p.ground.map(rgbOf), river: rgbOf(p.river), ripple: rgbOf(p.ripple), park: rgbOf(p.park), grass: rgbOf(p.grass),
      ring: rgbOf(p.ring), train: rgbOf(p.train), label: rgbOf(p.label), tick: p.tick && rgbOf(p.tick),
    };
    this.style = { ...p.style, paper: rgbOf(p.style.paper), rim: rgbOf(p.style.rim) };
    this.fresh = false;
  }

  protected repaint() {
    this.fresh = false;
    this.pic.resize(this.cols, this.rows);
    this.pass.resize(this.cols, this.rows, this.cw, this.ch, this.dpr, this.fontFamily);
  }

  /** How wide a line is in the picture, in css px. */
  private get lineWidth() {
    return Math.max(3, this.cw * 0.5);
  }

  private polyline(g: Draw2D, pts: Float32Array, style: string, width: number) {
    if (pts.length < 4) return;
    g.beginPath();
    g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
    g.strokeStyle = style;
    g.lineWidth = width;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.stroke();
  }

  private paint(net: Network) {
    const { cw, ch, cols, rows } = this;
    const w = this.pic.canvas.width;
    const h = this.pic.canvas.height;
    for (const c of [this.still, this.stillShape]) {
      c.width = w;
      c.height = h;
    }
    const g = this.still.getContext("2d")!;
    const s = this.stillShape.getContext("2d")!;
    for (const k of [g, s]) k.setTransform(w / (cols * cw), 0, 0, h / (rows * ch), 0, 0);
    const W = cols * cw;
    const H = rows * ch;
    const L = net.layout;
    const p = this.palette;
    const grad = g.createLinearGradient(0, 0, 0, H);
    this.col.ground.forEach((c, i) => grad.addColorStop(i / (this.col.ground.length - 1), css(c)));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const lc = rgbOf(p.light.colour);
    const light = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.6);
    light.addColorStop(0, cssAlpha(lc, p.light.alpha));
    light.addColorStop(1, cssAlpha(lc, 0));
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);
    s.fillStyle = grey(SHAPE.ground);
    s.fillRect(0, 0, W, H);
    for (const pk of L.parks) {
      for (const [k, fill] of [[g, css(this.col.park)], [s, grey(SHAPE.park)]] as const) {
        k.fillStyle = fill;
        k.beginPath();
        k.roundRect(pk.x0, pk.y0, pk.x1 - pk.x0, pk.y1 - pk.y0, cw);
        k.fill();
      }
    }
    this.polyline(g, L.river, css(this.col.river), L.ux * 0.95);
    this.polyline(g, L.river, css(mix(this.col.river, this.col.ripple, 0.18)), L.ux * 0.35);
    this.polyline(s, L.river, grey(SHAPE.river), L.ux * 0.95);
    for (let line = 0; line < L.routes.length; line++) this.paintLine(g, L.routes[line]!, line, 1);
    for (const r of L.routes) this.polyline(s, r.bends, grey(SHAPE.line), this.lineWidth);
    this.paintedLayout = net.laidOut;
    this.fresh = true;
    this.pic.shapeDirty = true;
  }

  /** A line in the picture: its glow at night, then its stroke, `k` as strong. */
  private paintLine(g: Draw2D, route: Route, line: number, k: number) {
    const rgb = this.lineRgb[line % this.lineRgb.length]!;
    if (this.palette.halo) this.polyline(g, route.bends, cssAlpha(rgb, this.palette.halo * k), this.lineWidth * 4);
    this.polyline(g, route.bends, css(rgb), this.lineWidth * Math.min(1.4, k));
  }

  draw(net: Network) {
    if (!this.cols) return;
    if (!this.fresh || this.paintedLayout !== net.laidOut) this.paint(net);
    const pic = this.pic;
    pic.begin(this.cw, this.ch);
    pic.g.setTransform(1, 0, 0, 1, 0, 0);
    pic.g.drawImage(this.still, 0, 0);
    if (pic.shapeDirty) {
      pic.s.setTransform(1, 0, 0, 1, 0, 0);
      pic.s.drawImage(this.stillShape, 0, 0);
    }
    pic.begin(this.cw, this.ch);
    const L = net.layout;
    // A line the pointer rests by: the rest of the map dims, and it is drawn again over it,
    // brighter and glowing.
    let lit = 0;
    for (let line = 0; line < net.lines; line++) lit = Math.max(lit, net.glow[line]!);
    if (lit > 0) {
      pic.g.fillStyle = cssAlpha(this.col.ground[1]!, 0.55 * lit);
      pic.g.fillRect(0, 0, this.cols * this.cw, this.rows * this.ch);
      for (let line = 0; line < net.lines; line++) if (net.glow[line]! > 0) this.paintLine(pic.g, L.routes[line]!, line, 1 + net.glow[line]! * 0.8);
    }
    this.setMarks(net, lit);
    this.setNames(L);
    this.drawTrains(net, lit);
    this.drawArrivals(net);
    this.pass.draw(pic, this.style);
  }

  /** The stations, interchanges and ends, the ripples on the river and the grass in the parks. */
  private setMarks(net: Network, lit: number) {
    const L = net.layout;
    const { cw, ch } = this;
    const cell = (x: number, y: number) => [Math.floor(x / cw), Math.floor(y / ch)] as const;
    // Ripples drift along the river, a few to each stretch.
    for (let i = 0; i + 3 < L.river.length; i += 2) {
      const ax = L.river[i]!, ay = L.river[i + 1]!, bx = L.river[i + 2]!, by = L.river[i + 3]!;
      const n = Math.floor(Math.hypot(bx - ax, by - ay) / (cw * 4));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5 + ((net.time * 0.12 + hashOf(i, k, 3)) % 1)) / n;
        if (u > 1) continue;
        const off = (hashOf(i, k, 5) - 0.5) * L.uy * 0.5;
        const [c, r] = cell(ax + (bx - ax) * u, ay + (by - ay) * u + off);
        this.pic.set(c, r, "~", this.col.ripple);
      }
    }
    for (const [k, pk] of L.parks.entries()) {
      for (let c = Math.ceil(pk.x0 / cw) + 1; c < Math.floor(pk.x1 / cw) - 1; c++) {
        for (let r = Math.ceil(pk.y0 / ch) + 1; r < Math.floor(pk.y1 / ch) - 1; r++) {
          const u = hashOf(c, r, k + 31);
          if (u < 0.35) this.pic.set(c, r, u < 0.12 ? "\"" : u < 0.24 ? "'" : ",", this.col.grass);
        }
      }
    }
    for (let line = 0; line < L.routes.length; line++) {
      const route = L.routes[line]!;
      const rgb = this.lineRgb[line % this.lineRgb.length]!;
      const dim = lit > 0 && net.glow[line]! < lit ? 1 - 0.5 * lit : 1;
      const mark = mix(this.col.tick ?? rgb, this.col.ground[1]!, 1 - dim);
      for (const st of route.stops) {
        if (st.interchange) continue;
        const [c, r] = cell(st.x, st.y);
        this.pic.set(c, r, st.end ? "#" : "o", st.end ? mix(rgb, this.col.ground[1]!, 1 - dim) : mark);
      }
    }
    for (const x of L.interchanges) {
      const [c, r] = cell(x.x, x.y);
      this.pic.set(c, r, "O", this.col.ring);
    }
  }

  /** District names: capitals, one to a cell, kept on the window. */
  private setNames(L: Layout) {
    const { cw, ch, cols } = this;
    for (const d of L.districts) {
      const r = Math.floor(d.y / ch);
      const c0 = clamp(Math.round(d.x / cw - d.name.length / 2), 1, cols - d.name.length - 1);
      for (let i = 0; i < d.name.length; i++) if (d.name[i] !== " ") this.pic.set(c0 + i, r, d.name[i]!, this.col.label);
    }
  }

  /** Each train: three cars on its track, `#`, glowing at night, fading in as it comes on and out as
   *  it leaves; a light on the ground where it stands at a station. */
  private drawTrains(net: Network, lit: number) {
    const L = net.layout;
    const { cw, ch } = this;
    const g = this.pic.g;
    for (const t of net.trains) {
      if (t.line >= net.lines) continue;
      const route = L.routes[t.line]!;
      const rgb = this.lineRgb[t.line % this.lineRgb.length]!;
      const fade = t.leaving === null ? clamp((net.time - t.born) / 0.4, 0, 1) : clamp(1 - (net.time - t.leaving) / LEAVE, 0, 1);
      const dim = lit > 0 && net.glow[t.line]! < lit ? 1 - 0.5 * lit : 1;
      const a = fade * dim;
      if (a <= 0.05) continue;
      pointOn(route, t.s, this.at);
      const x = this.at.x;
      const y = this.at.y;
      if (this.palette.add) {
        const r = L.ux * (t.dwell > 0 ? 1.3 : 1);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, cssAlpha(mix(rgb, [255, 255, 255], 0.5), 0.75 * a));
        grad.addColorStop(1, cssAlpha(rgb, 0));
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const body = mix(this.col.ground[1]!, this.col.train, a);
      for (const k of [0, 1, 2]) {
        pointOn(route, t.s - t.dir * k * (L.ux / 3), this.at);
        this.pic.set(Math.floor(this.at.x / cw), Math.floor(this.at.y / ch), "#", k === 0 ? body : mix(body, rgb, 0.35));
      }
    }
  }

  /** A click's rings: one where it was, one where its train came on the line. */
  private drawArrivals(net: Network) {
    const g = this.pic.g;
    for (const a of net.arrivals) {
      const rgb = this.lineRgb[a.line % this.lineRgb.length]!;
      const k = a.age / 1.2;
      g.strokeStyle = cssAlpha(this.palette.add ? mix(rgb, [255, 255, 255], 0.4) : rgb, clamp(1 - k, 0, 1));
      g.lineWidth = this.cw * 0.6;
      g.beginPath();
      g.arc(a.x, a.y, 4 + k * net.layout.ux * 1.8, 0, Math.PI * 2);
      g.stroke();
      pointOn(net.layout.routes[a.line]!, a.s, this.at);
      g.beginPath();
      g.arc(this.at.x, this.at.y, this.lineWidth + k * net.layout.ux * 1.1, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
