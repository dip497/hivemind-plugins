/**
 * Bees, wired to the app: what the wallpaper is told goes to the meadow (meadow.ts) and to whatever
 * draws it, the meadow runs on the app's clock (`animate`: at most 30 frames a second, nothing while
 * held, one settled frame while still), and the pointer is answered from the meadow: the bee under
 * it, whose agent's name the app shows there. A click in the open scatters the small bees.
 */
import type { WallpaperClient, WallpaperLook, WallpaperTile, WallpaperViewport } from "@hivemind/view-sdk";
import { Meadow } from "./meadow";

/** What draws the meadow: the canvas painter (render.ts). */
export interface Drawer {
  resize(v: WallpaperViewport): void;
  setLook(look: WallpaperLook): void;
  setTiles(tiles: readonly WallpaperTile[], seeThrough: boolean): void;
  draw(meadow: Meadow, dt: number): void;
}

/** Run Bees for the app on `wp`, drawn by `drawer`. Returns the way to stop. */
export function startBees(wp: WallpaperClient, drawer: Drawer): () => void {
  const meadow = new Meadow();
  // The tiles first: where the hive stands is worked out from them with the window's size.
  const off = [
    wp.on("tiles", ({ tiles, seeThrough }) => {
      meadow.setTiles(tiles);
      drawer.setTiles(tiles, seeThrough);
    }),
    wp.on("viewport", (v) => {
      meadow.resize(v.w, v.h);
      drawer.resize(v);
    }),
    wp.on("look", (look) => drawer.setLook(look)),
  ];
  // The first bees are put where they belong; later ones fly in from the hive, unless the frame is
  // still and every change a settled picture.
  let first = true;
  off.push(wp.on("creatures", (cs) => {
    meadow.setCreatures(cs, first || wp.mode === "still");
    first = false;
  }));
  // A turn's loop and burst only while it runs: in a still frame it would be a frozen smudge.
  off.push(wp.on("done", ({ id }) => {
    if (wp.mode === "run") meadow.done(id);
  }));
  off.push(wp.on("pointer", (p) => {
    meadow.pointer.x = p.x;
    meadow.pointer.y = p.y;
    meadow.pointer.over = p.over;
  }));
  off.push(wp.on("click", ({ x, y, id }) => {
    if (id === null && wp.mode === "run") meadow.scatter(x, y);
  }));
  wp.hitTest((x, y) => meadow.beeAt(x, y));
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
