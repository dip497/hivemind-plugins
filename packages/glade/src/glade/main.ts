/**
 * Glade, a live wallpaper: a clearing in a deep forest, in pixel art lit as a real scene. A campfire
 * burns in its ring of stones by a tent, an old stump has become a cottage with its windows lit,
 * lanterns stand along the path, a pond mirrors them, glowing mushrooms grow at the trees' feet. The
 * fire flickers and throws sparks, smoke curls from the chimney, fireflies wander and blink, a fox
 * sleeps by the fire, a deer comes now and then to graze, eyes shine in the dark of the trees, and
 * the weather turns: clear, mist rising, rain, clearing again. Night on a dark theme, a misty morning
 * on a light one.
 *
 * The pointer draws the fireflies; a click stirs the fire, ripples the pond or scatters the
 * fireflies. A world of its own: it draws none of the person's agents.
 */
import { connectWallpaper } from "@hivemind/view-sdk";
import { artSize, layGlade, type Glade } from "./glade";
import { Life } from "./life";
import { lighting, sceneOf, type Lighting } from "./looks";
import { Renderer } from "./render";
import { makeAtlas } from "./sprites";

const wp = await connectWallpaper();
const canvas = document.body.appendChild(document.createElement("canvas"));
Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", display: "block", imageRendering: "pixelated" });
const renderer = new Renderer(canvas);
const atlas = makeAtlas();

let art = { px: 4, w: 1, h: 1 };
let glade: Glade | undefined;
let life: Life | undefined;
let light: Lighting = lighting(wp.look);
const pointer = { x: 0, y: 0, over: false };

wp.on("viewport", ({ w, h, dpr }) => {
  const size = artSize(w, h);
  renderer.resize(Math.round(w * dpr), Math.round(h * dpr));
  if (size.w === art.w && size.h === art.h && glade) { art = size; return; }
  art = size;
  glade = layGlade(size.w, size.h);
  renderer.setArt(glade.still, atlas.p);
  if (life) life.setGlade(glade);
  else life = new Life(glade, atlas);
});
wp.on("look", (look) => {
  light = lighting(look);
  if (life) life.night = light.night;
});
wp.on("pointer", ({ x, y, over }) => {
  pointer.x = x / art.px; pointer.y = y / art.px; pointer.over = over;
});
wp.on("click", ({ x, y }) => {
  if (wp.mode === "run") life?.click(x / art.px, y / art.px);
});

function draw() {
  if (life) renderer.draw(sceneOf(light, life));
}

wp.animate({
  step: (dt) => life?.step(dt, pointer, wp.mode === "run"),
  draw,
  // A still picture: a clear night (or morning), the fire steady, the fox asleep, no visitor.
  settle: () => life?.settle(),
});
