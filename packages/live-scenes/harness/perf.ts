// The harness's timing page: a scene from the package's sources, its sim and its renderer on a
// canvas of the page's size, run on the SDK's clock through a fake host as the app runs it, in its
// own face, every draw timed. `measure(scene, look, frames)` runs one and returns each draw's time
// in ms; the scripts that call it say how the browser draws (headless Chromium draws in software).
import { fakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { loadFace, sceneCanvas } from "../src/page";
import { runScene, type Drawer, type Sim } from "../src/scene";
import { shoalWorld } from "../src/shoal/scene";
import { ShoalRenderer } from "../src/shoal/render";
import { koiWorld } from "../src/koi/scene";
import { KoiRenderer } from "../src/koi/render";
import { Swarm } from "../src/jellyfish/swarm";
import { JellyRenderer } from "../src/jellyfish/render";
import { Meadow } from "../src/fireflies/meadow";
import { FireflyRenderer } from "../src/fireflies/render";

const SCENES: Record<string, () => { sim: Sim; drawer: (c: HTMLCanvasElement) => Drawer<never> }> = {
  shoal: () => ({ sim: shoalWorld(), drawer: (c) => new ShoalRenderer(c) as Drawer<never> }),
  koi: () => ({ sim: koiWorld(), drawer: (c) => new KoiRenderer(c) as Drawer<never> }),
  jellyfish: () => ({ sim: new Swarm(), drawer: (c) => new JellyRenderer(c) as Drawer<never> }),
  fireflies: () => ({ sim: new Meadow(), drawer: (c) => new FireflyRenderer(c) as Drawer<never> }),
};

declare global {
  interface Window { measure(scene: string, look: WallpaperLook, frames: number): Promise<number[]> }
}

window.measure = async (scene, look, frames) => {
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
      if (times.length === frames) done();
    },
  };
  const host = fakeWallpaperHost({ viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look, mode: "run" });
  const stop = runScene(await host.connect(), sim, drawer);
  await finished;
  stop();
  return times;
};
