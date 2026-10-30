// The harness's timing page: a City scene from the package's sources, its sim and its renderer on a
// canvas of the page's size, run on the SDK's clock through a fake host as the app runs it, in its
// own face, every draw timed. `measure(scene, look, frames)` runs one and returns each draw's time
// in ms, twice: the script's own (the canvas only records what to draw), and with the canvas made to
// paint it (a pixel read back after the draw). The scripts that call it say how the browser draws
// (headless Chromium draws in software).
import { fakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { loadFace, sceneCanvas } from "../src/page";
import { runScene, type Drawer, type Sim } from "../src/scene";
import { City } from "../src/skyline/city";
import { SkylineRenderer } from "../src/skyline/render";
import { Drive } from "../src/sunset/drive";
import { SunsetRenderer } from "../src/sunset/render";

const SCENES: Record<string, () => { sim: Sim; drawer: (c: HTMLCanvasElement) => Drawer<never> }> = {
  skyline: () => ({ sim: new City(), drawer: (c) => new SkylineRenderer(c) as Drawer<never> }),
  sunset: () => ({ sim: new Drive(), drawer: (c) => new SunsetRenderer(c) as Drawer<never> }),
};

declare global {
  interface Window { measure(scene: string, look: WallpaperLook, frames: number, clicks?: boolean): Promise<{ js: number[]; painted: number[] }> }
}

window.measure = async (scene, look, frames, clicks = true) => {
  await loadFace(new URL(`/wp/${scene}/fonts/jetbrains-mono-latin-600-normal.woff2`, location.href));
  const { sim, drawer: make } = SCENES[scene]!();
  const canvas = sceneCanvas();
  const real = make(canvas);
  const paint = canvas.getContext("2d")!;
  const times: number[] = [];
  const painted: number[] = [];
  let done: () => void = () => {};
  const finished = new Promise<void>((r) => { done = r; });
  const drawer: Drawer<Sim> = {
    resize: (w, h, dpr) => real.resize(w, h, dpr),
    setLook: (l) => real.setLook(l),
    draw: (s) => {
      const t0 = performance.now();
      real.draw(s as never);
      times.push(performance.now() - t0);
      paint.getImageData(0, 0, 1, 1);
      painted.push(performance.now() - t0);
      // A click every second and a half and the pointer resting: what the scene draws at its
      // busiest, as well as at its calmest.
      if (clicks && times.length % 45 === 0) {
        sim.point(innerWidth * (0.3 + 0.4 * Math.random()), innerHeight * (0.3 + 0.4 * Math.random()), true);
        sim.splash(innerWidth * (0.2 + 0.6 * Math.random()), innerHeight * (0.2 + 0.6 * Math.random()));
      }
      if (times.length === frames) done();
    },
  };
  const host = fakeWallpaperHost({ viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look, mode: "run" });
  const stop = runScene(await host.connect(), sim, drawer);
  await finished;
  stop();
  return { js: times, painted };
};
