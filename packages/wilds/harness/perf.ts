// The harness's timing page: a scene from the package's sources, its sim and its renderer on a
// canvas of the page's size, run on the SDK's clock through a fake host as the app runs it, in its
// own face, every draw timed. `measure(scene, look, frames)` runs one and returns each draw's time
// in ms; the scripts that call it say how the browser draws (headless Chromium draws in software).
import { fakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { loadFace, sceneCanvas } from "../src/page";
import { runScene, type Drawer, type Sim } from "../src/scene";
import { Camp } from "../src/campfire/camp";
import { CampfireRenderer } from "../src/campfire/render";

const SCENES: Record<string, () => { sim: Sim; drawer: (c: HTMLCanvasElement) => Drawer<never> }> = {
  campfire: () => ({ sim: new Camp(), drawer: (c) => new CampfireRenderer(c) as Drawer<never> }),
};

declare global {
  interface Window { measure(scene: string, look: WallpaperLook, frames: number, play?: boolean): Promise<number[]> }
}

/** Time `frames` draws of `scene`; with `play`, the pointer rests in the scene and a click lands
 *  every two seconds, so what they stir up is timed too. */
window.measure = async (scene, look, frames, play = false) => {
  await loadFace(new URL(`/wp/${scene}/fonts/jetbrains-mono-latin-600-normal.woff2`, location.href));
  const { sim, drawer: make } = SCENES[scene]!();
  const real = make(sceneCanvas());
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
      if (play && times.length % 60 === 0) host.click(innerWidth * (0.3 + 0.4 * Math.random()), innerHeight * (0.3 + 0.5 * Math.random()));
      if (times.length === frames) done();
    },
  };
  const host = fakeWallpaperHost({ viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look, mode: "run" });
  const stop = runScene(await host.connect(), sim, drawer);
  if (play) host.point(innerWidth * 0.5, innerHeight * 0.7);
  await finished;
  stop();
  return times;
};
