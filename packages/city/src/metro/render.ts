/**
 * Metro's drawing. The map is painted once per layout and look into a layer of its own: the ground
 * and its cell grid, the parks and their grass, the river and its ripples (characters on the grid),
 * the lines as strokes from cell middle to cell middle (glowing at night), each station a tick, each
 * interchange a ring, each end of a line a bar, and the districts' names in small spaced capitals.
 * Each frame copies the layer and draws over it what moves: a line the pointer rests by, lit up
 * over the rest; the trains, each a block of three cars on its track, glowing at night; a click's
 * rings where a new train comes on.
 */
import { layerOf, paintGrid, SceneRenderer, textCells, type Draw2D } from "../cells";
import { css, cssAlpha, mix, rgbOf, type Rgb } from "../colour";
import { glowSprite } from "../glow";
import { clamp, hashOf } from "../util";
import { pointOn, type Layout, type Route } from "./map";
import { LEAVE, type Network } from "./network";
import { METRO_PALETTE, type MetroPalette } from "./palette";

/** Every character Metro draws: the face it brings has each (tests/city.test.ts). */
export const METRO_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ~'.,";

interface LineStyle { stroke: string; halo: string; core: string; tick: string; train: string; rgb: Rgb; glow: OffscreenCanvas }

export class MetroRenderer extends SceneRenderer<MetroPalette> {
  private layer = new OffscreenCanvas(1, 1);
  private paintedLayout = -1;
  private fresh = false;
  private lineStyles: LineStyle[] = [];
  private ground: Rgb[] = [];
  private styles = { river: "", ripple: "", park: "", grass: "", ring: "", ringFill: "", label: "", trainEdge: "", veil: [0, 0, 0] as unknown as Rgb };
  private at = { x: 0, y: 0, dx: 0, dy: 0 };

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, METRO_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    const white = rgbOf(p.train);
    this.ground = p.ground.map(rgbOf);
    this.lineStyles = p.lines.map((l) => {
      const rgb = rgbOf(l);
      return {
        stroke: css(rgb),
        halo: cssAlpha(rgb, p.halo),
        core: css(mix(rgb, [255, 255, 255], p.core)),
        tick: p.tick ? css(rgbOf(p.tick)) : css(rgb),
        train: css(mix(white, rgb, p.trainMix)),
        rgb,
        glow: glowSprite(rgb),
      };
    });
    this.styles = {
      river: css(rgbOf(p.river)),
      ripple: css(rgbOf(p.ripple)),
      park: css(rgbOf(p.park)),
      grass: css(rgbOf(p.grass)),
      ring: css(rgbOf(p.ring)),
      ringFill: css(rgbOf(p.ringFill)),
      label: css(rgbOf(p.label)),
      trainEdge: css(rgbOf(p.trainEdge)),
      veil: this.ground[1]!,
    };
    this.fresh = false;
  }

  protected repaint() {
    this.fresh = false;
  }

  /** How wide a line is drawn, in css px. */
  private get lineWidth() {
    return Math.max(3, Math.round(this.cw * 0.5));
  }

  private paint(net: Network) {
    const { width: W, height: H, dpr, cw, ch } = this;
    const g = layerOf(this.layer, Math.round(W * dpr), Math.round(H * dpr));
    if (!g) return;
    const L = net.layout;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    const grad = g.createLinearGradient(0, 0, 0, H * dpr);
    this.ground.forEach((c, i) => grad.addColorStop(i / (this.ground.length - 1), css(c)));
    g.fillStyle = grad;
    g.fillRect(0, 0, W * dpr, H * dpr);
    paintGrid(g, W, H, cw, ch, dpr, cssAlpha(rgbOf(this.palette.grid.colour), this.palette.grid.alpha));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCells(g, ch, this.fontFamily);
    // Parks, with grass on them here and there.
    for (const [k, p] of L.parks.entries()) {
      g.fillStyle = this.styles.park;
      g.beginPath();
      g.roundRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0, cw);
      g.fill();
      g.fillStyle = this.styles.grass;
      for (let c = Math.ceil(p.x0 / cw); c < Math.floor(p.x1 / cw); c++) {
        for (let r = Math.ceil(p.y0 / ch); r < Math.floor(p.y1 / ch); r++) {
          const u = hashOf(c, r, k + 31);
          if (u < 0.22) g.fillText(u < 0.08 ? "," : u < 0.15 ? "'" : ".", c * cw + cw / 2, r * ch + ch / 2 + 1);
        }
      }
    }
    // The river, wide, its bends rounded; ripples along it.
    this.polyline(g, L.river, this.styles.river, L.ux * 0.95);
    g.fillStyle = this.styles.ripple;
    for (let i = 0; i + 3 < L.river.length; i += 2) {
      const ax = L.river[i]!, ay = L.river[i + 1]!, bx = L.river[i + 2]!, by = L.river[i + 3]!;
      const n = Math.floor(Math.hypot(bx - ax, by - ay) / (cw * 5));
      for (let k = 1; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const y = ay + ((by - ay) * k) / n + (hashOf(i, k, 5) - 0.5) * L.uy * 0.5;
        g.fillText("~", Math.floor(x / cw) * cw + cw / 2, Math.floor(y / ch) * ch + ch / 2 + 1);
      }
    }
    // The lines: their glow under all of them, then each line, then the stations over them.
    for (let line = 0; line < L.routes.length; line++) this.paintLine(g, L.routes[line]!, line, 1, true);
    for (let line = 0; line < L.routes.length; line++) this.paintLine(g, L.routes[line]!, line, 1, false);
    for (let line = 0; line < L.routes.length; line++) this.paintStops(g, L, line, 1);
    this.paintRings(g, L, 1);
    this.paintNames(g, L);
    this.paintedLayout = net.laidOut;
    this.fresh = true;
  }

  /** A stroked polyline, round at its bends. */
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

  /** A line's glow (`halo`), or its stroke and core, `k` as strong (wider when lit up). */
  private paintLine(g: Draw2D, route: Route, line: number, k: number, halo: boolean) {
    const s = this.lineStyles[line % this.lineStyles.length]!;
    const w = this.lineWidth * k;
    if (halo) {
      if (!this.palette.halo) return;
      g.globalCompositeOperation = "lighter";
      this.polyline(g, route.bends, s.halo, w * 3.4);
      g.globalCompositeOperation = "source-over";
      return;
    }
    this.polyline(g, route.bends, s.stroke, w);
    if (this.palette.core) this.polyline(g, route.bends, s.core, Math.max(1, w * 0.3));
  }

  /** A line's stations: a tick to one side at each, a bar across each end. */
  private paintStops(g: Draw2D, L: Layout, line: number, k: number) {
    const route = L.routes[line]!;
    const s = this.lineStyles[line % this.lineStyles.length]!;
    const w = this.lineWidth;
    g.fillStyle = s.tick;
    g.strokeStyle = s.tick;
    g.lineCap = "butt";
    for (const st of route.stops) {
      if (st.interchange) continue;
      pointOn(route, st.s + (st.end ? (st.s > 0 ? -0.5 : 0.5) : 0), this.at);
      const nx = -this.at.dy;
      const ny = this.at.dx;
      const reach = st.end ? w * 1.7 : w * 1.5;
      g.lineWidth = st.end ? w * 0.9 * k : Math.max(1.5, w * 0.6) * k;
      g.beginPath();
      if (st.end) {
        g.moveTo(st.x - nx * reach, st.y - ny * reach);
        g.lineTo(st.x + nx * reach, st.y + ny * reach);
      } else {
        const dir = hashOf(line, st.i, 2) < 0.5 ? 1 : -1;
        g.moveTo(st.x, st.y);
        g.lineTo(st.x + nx * reach * dir, st.y + ny * reach * dir);
      }
      g.stroke();
    }
  }

  /** The interchanges: a ring where lines meet. */
  private paintRings(g: Draw2D, L: Layout, alpha: number, only?: number) {
    const r = this.lineWidth * 1.15;
    g.globalAlpha = alpha;
    g.lineWidth = Math.max(1.5, this.lineWidth * 0.45);
    g.strokeStyle = this.styles.ring;
    g.fillStyle = this.styles.ringFill;
    for (const c of L.interchanges) {
      if (only !== undefined && !c.lines.includes(only)) continue;
      g.beginPath();
      g.arc(c.x, c.y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** District names: small capitals, spaced out, centred where the map left room. */
  private paintNames(g: Draw2D, L: Layout) {
    const size = Math.max(8, Math.round(this.ch * 0.72));
    g.font = `600 ${size}px ${this.fontFamily}`;
    g.textAlign = "center";
    g.fillStyle = this.styles.label;
    const step = size * 0.6 + Math.max(1, size * 0.18);
    for (const d of L.districts) {
      const x0 = d.x - ((d.name.length - 1) * step) / 2;
      for (let i = 0; i < d.name.length; i++) if (d.name[i] !== " ") g.fillText(d.name[i]!, x0 + i * step, d.y + 1);
    }
  }

  draw(net: Network) {
    const { ctx, dpr } = this;
    if (!this.cols) return;
    if (!this.fresh || this.paintedLayout !== net.laidOut) this.paint(net);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = net.layout;
    // A line the pointer rests by: the rest of the map dims under a veil, and it is drawn again over
    // it, wider and brighter, its stations with it.
    let lit = 0;
    for (let line = 0; line < net.lines; line++) lit = Math.max(lit, net.glow[line]!);
    if (lit > 0) {
      ctx.fillStyle = cssAlpha(this.styles.veil, 0.5 * lit);
      ctx.fillRect(0, 0, this.width, this.height);
      for (let line = 0; line < net.lines; line++) {
        const k = net.glow[line]!;
        if (k <= 0) continue;
        ctx.globalAlpha = k;
        this.paintLine(ctx, L.routes[line]!, line, 1.35, true);
        if (this.palette.halo) this.paintLine(ctx, L.routes[line]!, line, 1.9, true);
        this.paintLine(ctx, L.routes[line]!, line, 1.35, false);
        this.paintStops(ctx, L, line, 1.2);
        ctx.globalAlpha = 1;
        this.paintRings(ctx, L, k, line);
      }
    }
    this.drawTrains(net, lit);
    this.drawArrivals(net);
  }

  /** Each train: three cars on its track (the side its direction runs on), glowing at night, a
   *  light at its station while it stands; fading in as it comes on and out as it leaves. */
  private drawTrains(net: Network, lit: number) {
    const { ctx } = this;
    const L = net.layout;
    const w = this.lineWidth;
    const len = L.ux * 0.95;
    const thick = Math.max(4, w * 1.55);
    for (const t of net.trains) {
      if (t.line >= net.lines) continue;
      const route = L.routes[t.line]!;
      const s = this.lineStyles[t.line % this.lineStyles.length]!;
      pointOn(route, t.s, this.at);
      const { dx, dy } = this.at;
      const off = t.dir * w * 0.45;
      const x = this.at.x - dy * off;
      const y = this.at.y + dx * off;
      const fade = t.leaving === null ? clamp((net.time - t.born) / 0.4, 0, 1) : clamp(1 - (net.time - t.leaving) / LEAVE, 0, 1);
      const dim = lit > 0 && net.glow[t.line]! < lit ? 1 - 0.45 * lit : 1;
      const a = fade * dim;
      if (a <= 0) continue;
      if (this.palette.add) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * (t.dwell > 0 ? 0.75 : 0.5);
        const r = L.ux * (t.dwell > 0 ? 1.1 : 0.9);
        ctx.drawImage(s.glow, x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = this.styles.trainEdge;
      ctx.fillRect(-len / 2 - 1, -thick / 2 - 1, len + 2, thick + 2);
      ctx.fillStyle = s.train;
      const car = (len - 2) / 3;
      for (let k = 0; k < 3; k++) ctx.fillRect(-len / 2 + k * (car + 1), -thick / 2, car, thick);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /** A click's rings: one where it was, one where its train came on the line. */
  private drawArrivals(net: Network) {
    const { ctx } = this;
    for (const a of net.arrivals) {
      const s = this.lineStyles[a.line % this.lineStyles.length]!;
      const k = a.age / 1.2;
      ctx.globalAlpha = clamp(1 - k, 0, 1);
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = Math.max(1.5, this.lineWidth * 0.5);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4 + k * net.layout.ux * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      pointOn(net.layout.routes[a.line]!, a.s, this.at);
      ctx.beginPath();
      ctx.arc(this.at.x, this.at.y, this.lineWidth + k * net.layout.ux, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
