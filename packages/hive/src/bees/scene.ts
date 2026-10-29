/**
 * Bees, wired to the app: the window's size and the theme go to the meadow (meadow.ts) and to what
 * draws it, the meadow runs on the app's clock (`animate`: at most 30 frames a second, nothing while
 * held, one settled frame while still), and the pointer and clicks over empty canvas play with it.
 *
 * Live wallpaper protocol 1 also tells a wallpaper the agents (`creatures`), where the tiles are and
 * when a turn ends well. Bees listens to none of it: its colony lives a day of its own. Nor does it
 * give the client a hit test, so it never says a bee is under the pointer: the app names no agent
 * over the meadow, and a click there opens nothing.
 */
import type { WallpaperClient, WallpaperLook, WallpaperViewport } from "@hivemind/view-sdk";
import { Meadow } from "./meadow";

/** What draws the meadow: the canvas painter (render.ts). */
export interface Drawer {
  resize(v: WallpaperViewport): void;
  setLook(look: WallpaperLook): void;
  draw(meadow: Meadow, dt: number): void;
}

/** Run Bees for the app on `wp`, drawn by `drawer`. Returns the way to stop. */
export function startBees(wp: WallpaperClient, drawer: Drawer): () => void {
  const meadow = new Meadow();
  const off = [
    wp.on("viewport", (v) => {
      meadow.resize(v.w, v.h);
      drawer.resize(v);
    }),
    wp.on("look", (look) => drawer.setLook(look)),
    wp.on("pointer", (p) => meadow.point(p.x, p.y, p.over)),
    // A click's puff and scatter only while it runs: in a still frame they would be a frozen smudge.
    wp.on("click", ({ x, y }) => {
      if (wp.mode === "run") meadow.scatter(x, y);
    }),
  ];
  const stop = wp.animate({
    step: (dt) => meadow.step(dt),
    draw: (dt) => drawer.draw(meadow, dt),
    settle: () => meadow.settle(),
  });
  return () => {
    stop();
    for (const f of off) f();
  };
}
