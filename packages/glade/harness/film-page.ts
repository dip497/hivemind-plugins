// The page film.ts drives: the Glade's own renderer and life, drawn one frame at a time at times the
// film names, with the pointer and clicks the film gives it. It draws what main.ts draws, without the
// clock, so a slow machine still makes a smooth film, and a film can start anywhere in the weather.
import type { WallpaperLook } from "@hivemind/view-sdk";
import { artSize, layGlade } from "../src/glade/glade";
import { Life } from "../src/glade/life";
import { lighting, sceneOf } from "../src/glade/looks";
import { Renderer } from "../src/glade/render";
import { makeAtlas } from "../src/glade/sprites";

let ctx: { renderer: Renderer; life: Life; px: number; canvas: HTMLCanvasElement; light: ReturnType<typeof lighting> };
const w = window as unknown as Record<string, unknown>;
const pointer = { x: 0, y: 0, over: false };

w.init = (width: number, height: number, look: WallpaperLook, start = 0, dpr = 1) => {
  const canvas = document.body.appendChild(document.createElement("canvas"));
  Object.assign(canvas.style, { width: `${width}px`, height: `${height}px`, display: "block" });
  const renderer = new Renderer(canvas, true);
  const s = artSize(width, height), g = layGlade(s.w, s.h), atlas = makeAtlas();
  renderer.resize(Math.round(width * dpr), Math.round(height * dpr));
  renderer.setArt(g.still, atlas.p);
  const life = new Life(g, atlas);
  const light = lighting(look);
  life.night = light.night;
  // Run the life on to where the film starts, a sixtieth at a time.
  for (let t = 0; t < start; t += 1 / 60) life.step(1 / 60, pointer, true);
  ctx = { renderer, life, px: s.px, canvas, light };
};

/** Step on by `secs`, with the pointer (CSS px, or null when away), then draw; a JPEG data URL. */
w.frame = (secs: number, at: [number, number] | null, click: [number, number] | null) => {
  const { life, renderer, light, px } = ctx;
  pointer.over = !!at;
  if (at) { pointer.x = at[0] / px; pointer.y = at[1] / px; }
  if (click) life.click(click[0] / px, click[1] / px);
  for (let k = 0; k < Math.round(secs * 60); k++) life.step(1 / 60, pointer, true);
  renderer.draw(sceneOf(light, life));
  return ctx.canvas.toDataURL("image/jpeg", 0.92);
};

/** Time one frame of drawing, to its last pixel: milliseconds. */
w.time = () => {
  const { life, renderer, light } = ctx;
  life.step(1 / 60, pointer, true);
  const t0 = performance.now();
  renderer.draw(sceneOf(light, life));
  renderer.finish();
  return performance.now() - t0;
};
