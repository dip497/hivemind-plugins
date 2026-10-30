// The harness's timing page: a scene from the package's sources, its sim and its renderer on a
// canvas of the page's size, run on the SDK's clock through a fake host as the app runs it, every
// draw timed. `measure(scene, look, frames)` runs one and returns each draw's time in ms. The
// scripts that call it say how the browser draws (headless Chromium draws in software).
import { fakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { sceneCanvas } from "../src/page";
import { runScene, type Drawer, type Sim } from "../src/scene";
import { Island } from "../src/island/world";
import { IslandRenderer } from "../src/island/render";
import { Town } from "../src/bricktown/town";
import { TownRenderer } from "../src/bricktown/render";
import { Valley } from "../src/valley/valley";
import { ValleyRenderer } from "../src/valley/render";

const SCENES: Record<string, () => { sim: Sim; drawer: () => Drawer<never> }> = {
  island: () => ({ sim: new Island(), drawer: () => new IslandRenderer(sceneCanvas()) as Drawer<never> }),
  bricktown: () => ({ sim: new Town(), drawer: () => new TownRenderer(sceneCanvas()) as Drawer<never> }),
  valley: () => ({ sim: new Valley(), drawer: () => new ValleyRenderer(sceneCanvas) as Drawer<never> }),
};

declare global {
  interface Window { measure(scene: string, look: WallpaperLook, frames: number): Promise<number[]> }
}

window.measure = async (scene, look, frames) => {
  const { sim, drawer: make } = SCENES[scene]!();
  const real = make();
  const times: number[] = [];
  let done: () => void = () => {};
  const finished = new Promise<void>((r) => { done = r; });
  const drawer: Drawer<Sim> = {
    resize: (w, h, dpr) => real.resize(w, h, dpr),
    setLook: (l) => real.setLook(l),
    draw: (s) => {
      const t0 = performance.now();
      real.draw(s as never);
      times.push(performance.now() - t0);
      if (times.length === frames) done();
    },
  };
  const host = fakeWallpaperHost({ viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look, mode: "run" });
  const stop = runScene(await host.connect(), sim, drawer);
  await finished;
  stop();
  return times;
};
