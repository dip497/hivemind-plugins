/**
 * Canvas helpers the Wilds renderers share: a 2D context type, setting a context up to draw cells'
 * characters, and a layer kept offscreen.
 */
import { cellFont } from "./grid";

/** A 2D context to draw in: the page's canvas, or a layer kept offscreen. */
export type Draw2D = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/** Ready `g` to draw cells' characters, each centred in its cell. */
export function textCells(g: Draw2D, ch: number, family: string) {
  g.font = cellFont(ch, family);
  g.textAlign = "center";
  g.textBaseline = "middle";
}

/** A layer kept offscreen, sized (and cleared). */
export function sizeLayer(layer: OffscreenCanvas, w: number, h: number) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (layer.width !== w || layer.height !== h) {
    layer.width = w;
    layer.height = h;
  }
  const g = layer.getContext("2d");
  if (g) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
  }
  return g;
}
