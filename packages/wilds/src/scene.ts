/**
 * A Wilds scene, wired to the app: a world of its own (a clearing round a campfire, a desert of
 * dunes) whose life goes on by itself and plays with the pointer, drawn in
 * characters in its own colours, a daytime picture on a light theme and a night one on a dark theme.
 *
 * It hears the window's size, the theme, whether to run, and the pointer and clicks over empty
 * canvas, and runs on the app's clock (`animate`: at most 30 frames a second, nothing while held,
 * one settled picture while still). The app tells a wallpaper of the agents and the tiles too; a
 * scene listens for none of it, and never says what is under the pointer, so nothing it draws is
 * named and no click on it opens a tile.
 */
import { SCENE_STEP, SETTLE_STEPS, type WallpaperClient, type WallpaperLook } from "@hivemind/view-sdk";

/** What lives in a scene, apart from any canvas: a test runs it alone. */
export interface Sim {
  /** The window is `width` by `height` CSS pixels: the first time it is stocked, spread over all of
   *  it; after, what lives there is moved into the new window as it was in the old. */
  resize(width: number, height: number): void;
  /** The pointer over empty canvas (`active`), or gone from it: what lives there notices it. */
  point(x: number, y: number, active: boolean): void;
  /** A click on empty canvas: the scene answers it. */
  splash(x: number, y: number): void;
  /** `dt` seconds on. */
  step(dt: number): void;
  /** Daytime (a light theme) or night: a scene whose life differs by it (a fire burning lower at
   *  dusk) hears it here. */
  daylight?(light: boolean): void;
}

/** What draws a scene's sim: its renderer, or a test's stand-in. */
export interface Drawer<S> {
  resize(width: number, height: number, dpr: number): void;
  setLook(look: WallpaperLook): void;
  draw(sim: S): void;
}

/** Run `sim` for the app on `wp`, drawn by `drawer`. Returns the way to stop. */
export function runScene<S extends Sim>(wp: WallpaperClient, sim: S, drawer: Drawer<S>): () => void {
  const off = [
    wp.on("viewport", (v) => {
      sim.resize(v.w, v.h);
      drawer.resize(v.w, v.h, v.dpr);
    }),
    wp.on("look", (look) => {
      sim.daylight?.(!look.dark);
      drawer.setLook(look);
    }),
    // It notices the pointer only while it runs: a held or a still picture does not stir.
    wp.on("mode", (mode) => {
      if (mode !== "run") sim.point(0, 0, false);
    }),
    wp.on("pointer", ({ x, y, over }) => sim.point(x, y, over && wp.mode === "run")),
    wp.on("click", ({ x, y }) => {
      if (wp.mode === "run") sim.splash(x, y);
    }),
  ];
  let stepped = false;
  const step = (dt: number) => {
    stepped = true;
    sim.step(dt);
  };
  const stop = wp.animate({
    step,
    draw: () => drawer.draw(sim),
    // A still picture is the scene a few seconds after it was stocked, its fire caught and its
    // sand blowing; one that has run already is a picture as it is. What changes after (the
    // theme, the window's size) is drawn again with everything where it was: a picture that ran on
    // at each change would jump.
    settle: () => {
      if (stepped) return;
      for (let i = 0; i < SETTLE_STEPS; i++) step(SCENE_STEP);
    },
  });
  return () => {
    stop();
    for (const f of off) f();
  };
}
