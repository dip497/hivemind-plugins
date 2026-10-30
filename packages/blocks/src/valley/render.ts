/**
 * Block Valley's drawing: in WebGL2 (gl.ts) while there is WebGL2, else, or once the context is
 * lost, the valley as one still picture on a 2D canvas (still.ts) in a canvas of its own.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import type { Drawer } from "../scene";
import { ValleyGL } from "./gl";
import { ValleyStill } from "./still";
import { VALLEY_PALETTE, type ValleyPalette } from "./palette";
import type { Valley } from "./valley";

export class ValleyRenderer implements Drawer<Valley> {
  private canvas: HTMLCanvasElement;
  private gl: ValleyGL | null = null;
  private still: ValleyStill | null = null;
  private built = false;
  private size = { w: 0, h: 0, dpr: 1 };
  private palette: ValleyPalette = VALLEY_PALETTE.dark;
  /** The valley last drawn: drawn still at once if the context goes. */
  private last: Valley | null = null;

  constructor(private makeCanvas: () => HTMLCanvasElement) {
    this.canvas = makeCanvas();
    try {
      this.gl = new ValleyGL(this.canvas, () => this.fallBack());
      this.gl.setPalette(this.palette);
    } catch {
      this.fallBack();
    }
  }

  /** Draw a still picture from now on, in a canvas of its own (one that held a WebGL context
   *  cannot take a 2D one), and draw it at once. */
  private fallBack() {
    if (this.still) return;
    this.gl = null;
    this.canvas.remove();
    this.canvas = this.makeCanvas();
    this.still = new ValleyStill(this.canvas);
    this.still.setPalette(this.palette);
    if (this.size.w) this.still.resize(this.size.w, this.size.h, this.size.dpr);
    if (this.last) this.still.draw(this.last);
  }

  /** Which way it draws now. */
  get mode(): "gl" | "still" {
    return this.gl && !this.gl.lost ? "gl" : "still";
  }

  resize(w: number, h: number, dpr: number) {
    this.size = { w, h, dpr };
    if (this.gl) this.gl.resize(Math.round(w * dpr), Math.round(h * dpr), w, h);
    else this.still?.resize(w, h, dpr);
  }

  setLook(look: WallpaperLook) {
    this.palette = VALLEY_PALETTE[look.dark ? "dark" : "light"];
    this.gl?.setPalette(this.palette);
    this.still?.setPalette(this.palette);
  }

  draw(v: Valley) {
    this.last = v;
    if (this.gl) {
      if (!this.built) {
        this.gl.build(v.land);
        this.built = true;
      }
      this.gl.draw(v);
    } else this.still?.draw(v);
  }
}
