/**
 * Block Valley as one still picture, for a computer with no WebGL2 or one whose WebGL went away:
 * the whole valley as a block model seen from above at an angle, drawn on a 2D canvas once per size
 * and look, in the same colours, under the same sky.
 */
import { css, rgbOf } from "../colour";
import { flat, screenX, screenY, sprite, type Iso, type Sprite } from "../iso";
import { speckled, turfed, watery, barked, type Faces } from "../textures";
import type { Shades } from "../island/palette";
import { crown } from "./gl";
import { idx, inLand, Mat, SIZE, WATER } from "./terrain";
import type { ValleyPalette } from "./palette";
import type { Valley } from "./valley";

const facesOf = (s: Shades): Faces => ({ top: rgbOf(s.top), left: rgbOf(s.left), right: rgbOf(s.right) });

export class ValleyStill {
  private g: CanvasRenderingContext2D;
  private size = { w: 0, h: 0, dpr: 1 };
  private palette: ValleyPalette | null = null;
  private drawnFor = "";

  constructor(private canvas: HTMLCanvasElement) {
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("2D canvas unavailable");
    this.g = g;
  }

  resize(w: number, h: number, dpr: number) {
    this.size = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.drawnFor = "";
  }

  setPalette(p: ValleyPalette) {
    if (p !== this.palette) this.drawnFor = "";
    this.palette = p;
  }

  /** The picture, painted once; a frame after it changes nothing, so it draws nothing. */
  draw(v: Valley) {
    const p = this.palette;
    const { w, h, dpr } = this.size;
    if (!p || !w) return;
    const key = `${w}x${h}@${dpr}`;
    if (key === this.drawnFor) return;
    this.drawnFor = key;
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, css(rgbOf(p.zenith)));
    sky.addColorStop(0.7, css(rgbOf(p.horizon)));
    sky.addColorStop(1, css(rgbOf(p.fog)));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const S = Math.max(2, 2 * Math.round((Math.min((w * 0.94) / (2 * SIZE), (h * 0.6) / SIZE) * dpr) / 2));
    const iso: Iso = { S, HZ: S, ox: Math.round(W / 2), oy: Math.round(H * 0.58 - (SIZE * S) / 2) };
    const m = p.mats.map(facesOf);
    const cube = (paint: ReturnType<typeof flat>, top = 1) => sprite(S, S, [0, 0, 0, 1, 1, top], (r) => r.box(0, 0, 0, 1, 1, top, paint));
    const tops: Sprite[] = [];
    tops[Mat.Grass] = cube(turfed(m[Mat.Grass]!, m[Mat.Dirt]!, 1));
    tops[Mat.Sand] = cube(speckled(m[Mat.Sand]!, 2));
    tops[Mat.Stone] = cube(speckled(m[Mat.Stone]!, 3, 0.28));
    tops[Mat.Snow] = cube(turfed(m[Mat.Snow]!, m[Mat.Stone]!, 4));
    const dirt = cube(speckled(m[Mat.Dirt]!, 5));
    const stone = cube(speckled(m[Mat.Stone]!, 6, 0.28));
    const water = cube(watery(m[Mat.Water]!, 7), 0.85);
    const wood = sprite(S, S, [0, 0, 0, 1, 1, 1], (r) => r.box(0.25, 0.25, 0, 0.75, 0.75, 1, barked(m[Mat.Wood]!, 8)));
    const leaves = cube(speckled(m[Mat.Leaves]!, 9, 0.3));
    const pine = cube(speckled(m[Mat.Pine]!, 10, 0.3));
    const height = (i: number, j: number) => (inLand(i, j) ? v.land.height[idx(i, j)]! : -1);
    const trees = new Map(v.land.trees.map((t) => [idx(t.i, t.j), t]));
    // Back to front: by diagonal, and up each column.
    for (let d = 0; d < SIZE * 2 - 1; d++) {
      for (let i = Math.max(0, d - SIZE + 1); i <= Math.min(d, SIZE - 1); i++) {
        const j = d - i;
        const top = height(i, j);
        const mat = v.land.top[idx(i, j)]!;
        const low = Math.min(top - 1, Math.max(0, Math.min(height(i + 1, j), height(i, j + 1)) - 1));
        for (let k = Math.max(0, low); k < top; k++) {
          const img = k === top - 1 ? (mat === Mat.Water ? tops[Mat.Sand]! : tops[mat] ?? tops[Mat.Grass]!) : top - k > 3 ? stone : mat === Mat.Stone || mat === Mat.Snow ? stone : dirt;
          g.drawImage(img.canvas, Math.round(screenX(iso, i, j) + img.dx), Math.round(screenY(iso, i, j, k) + img.dy));
        }
        if (mat === Mat.Water) g.drawImage(water.canvas, Math.round(screenX(iso, i, j) + water.dx), Math.round(screenY(iso, i, j, WATER - 1) + water.dy));
        const t = trees.get(idx(i, j));
        if (!t) continue;
        for (let y = 0; y < t.trunk; y++) g.drawImage(wood.canvas, Math.round(screenX(iso, i, j) + wood.dx), Math.round(screenY(iso, i, j, top + y) + wood.dy));
        const cells = crown(t.pine, t.trunk).sort((a, b) => a[0] + a[2] - (b[0] + b[2]) || a[1] - b[1]);
        for (const [a, y, b] of cells) {
          const img = t.pine ? pine : leaves;
          g.drawImage(img.canvas, Math.round(screenX(iso, i + a, j + b) + img.dx), Math.round(screenY(iso, i + a, j + b, top + y) + img.dy));
        }
      }
    }
  }
}
