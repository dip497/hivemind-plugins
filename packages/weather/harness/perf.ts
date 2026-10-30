// The harness's timing page: a scene from the package's sources, its sim and its renderer on a
// canvas of the page's size, run on the SDK's clock through a fake host as the app runs it, in its
// own face, every draw timed. `measure(scene, look, frames)` runs one and returns each draw's time
// in ms (with `flush`, made to paint before the time is taken), with the pointer moving over it and a click now and then, as a person's would; the scripts
// that call it say how the browser draws (headless Chromium draws in software).
import { fakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { loadFace, sceneCanvas } from "../src/page";
import { runScene, type Drawer, type Sim } from "../src/scene";
import { Valley } from "../src/snow/valley";
import { SnowRenderer } from "../src/snow/render";
import { Tundra } from "../src/northern-lights/tundra";
import { NorthernLightsRenderer } from "../src/northern-lights/render";

const SCENES: Record<string, () => { sim: Sim; drawer: (c: HTMLCanvasElement) => Drawer<never> }> = {
  snow: () => ({ sim: new Valley(), drawer: (c) => new SnowRenderer(c) as Drawer<never> }),
  "northern-lights": () => ({ sim: new Tundra(), drawer: (c) => new NorthernLightsRenderer(c) as Drawer<never> }),
};

declare global {
  interface Window { measure(scene: string, look: WallpaperLook, frames: number, flush?: boolean): Promise<number[]> }
}

window.measure = async (scene, look, frames, flush = false) => {
  await loadFace(new URL(`/wp/${scene}/fonts/jetbrains-mono-latin-600-normal.woff2`, location.href));
  const { sim, drawer: make } = SCENES[scene]!();
  const canvas = sceneCanvas();
  const real = make(canvas);
  const times: number[] = [];
  let done: () => void = () => {};
  const finished = new Promise<void>((r) => { done = r; });
  const host = fakeWallpaperHost({ viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look, mode: "run" });
  const drawer: Drawer<Sim> = {
    resize: (w, h, dpr) => real.resize(w, h, dpr),
    setLook: (l) => real.setLook(l),
    draw: (s) => {
      const t0 = performance.now();
      real.draw(s as never);
      // With `flush`, the canvas is made to paint what it was told (reading a pixel waits for it),
      // so the time is the drawing's, not only the script's.
      if (flush) canvas.getContext("2d")!.getImageData(0, 0, 1, 1);
      times.push(performance.now() - t0);
      // The pointer wanders over the window, and clicks every five seconds.
      const k = times.length;
      host.point(innerWidth * (0.5 + 0.35 * Math.sin(k / 47)), innerHeight * (0.5 + 0.3 * Math.sin(k / 31)));
      if (k % 150 === 75) host.click(innerWidth * (0.3 + 0.4 * Math.sin(k)), innerHeight * 0.5);
      if (k === frames) done();
    },
  };
  const stop = runScene(await host.connect(), sim, drawer);
  await finished;
  stop();
  return times;
};
