/**
 * The Den wired to the app: what the app says goes to the yard (the window, the agents, the
 * tiles, the pointer, clicks, a turn done well), the yard runs on the app's clock, and a drawer
 * draws it. The yard and the drawer are apart, so a test runs the Den with a drawer that only
 * counts.
 */
import { SETTLE_STEPS, SCENE_STEP, type WallpaperClient, type WallpaperLook } from "@hivemind/view-sdk";
import type { Yard } from "./yard";

/** What draws the yard: the 3D view, or a test's stand-in. */
export interface Drawer {
  resize(w: number, h: number, dpr: number, unit: number): void;
  setLook(look: WallpaperLook): void;
  /** On each step of the clock: bodies follow the yard. */
  step(yard: Yard, dt: number): void;
  /** For a still picture: bodies straight into their poses. */
  settle(yard: Yard): void;
  draw(yard: Yard): void;
}

/** Run `yard` for the app on `wp`, drawn by `drawer`. Returns the way to stop. */
export function runDen(wp: WallpaperClient, yard: Yard, drawer: Drawer): () => void {
  const off = [
    wp.on("viewport", (v) => {
      yard.resize(v.w, v.h);
      drawer.resize(v.w, v.h, v.dpr, yard.unit);
    }),
    wp.on("look", (look) => drawer.setLook(look)),
    wp.on("tiles", ({ tiles }) => yard.setTiles(tiles)),
    wp.on("creatures", (cs) => yard.meet(cs)),
    // It notices the pointer only while it runs: a held or still picture does not stir.
    wp.on("mode", (mode) => { if (mode !== "run") yard.point(0, 0, false); }),
    wp.on("pointer", ({ x, y, over }) => yard.point(x, y, over && wp.mode === "run")),
    wp.on("click", ({ x, y, id }) => { if (wp.mode === "run") yard.click(x, y, id); }),
    wp.on("done", ({ id }) => { if (wp.mode === "run") yard.done(id); }),
  ];
  wp.hitTest((x, y) => yard.hit(x, y));
  let stepped = false;
  const stop = wp.animate({
    step: (dt) => {
      stepped = true;
      yard.step(dt);
      drawer.step(yard, dt);
    },
    draw: () => drawer.draw(yard),
    // A still picture: pups that are new or changed state go where their state puts them, the
    // others stay where they are, and every body is settled into its pose. Before it has ever run,
    // the yard is given a few seconds so the first picture is not of pups mid-step.
    settle: () => {
      if (!stepped) {
        for (let i = 0; i < SETTLE_STEPS / 2; i++) yard.step(SCENE_STEP);
        stepped = true;
      }
      yard.settle();
      drawer.settle(yard);
    },
  });
  return () => {
    stop();
    for (const f of off) f();
  };
}
