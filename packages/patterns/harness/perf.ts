// The harness's timing page: a pattern from the package's sources, its sim and its renderer (WebGL,
// as the wallpaper draws where it can) on a canvas of the page's size, run on the SDK's clock through
// a fake host as the app runs it, in its own face, every draw timed. `measure(scene, look, frames)`
// runs one and returns each draw's time in ms: the script's (`js`), and with the canvas made to paint
// what it was told (`painted`: one pixel read back, which waits for the drawing the browser defers).
// The scripts that call it say how the browser draws (headless Chromium draws in software).
import { fakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperLook } from "@hivemind/view-sdk";
import { GREEK, LATIN, loadFace, sceneCanvas, type FaceFile } from "../src/page";
import { runScene, type Drawer, type Sim } from "../src/scene";
import { webgl, type GL } from "../src/gl";
import { Life } from "../src/life/life";
import { LifeGl } from "../src/life/glrender";
import { LifeRenderer } from "../src/life/render";
import { Rain } from "../src/glyphs/rain";
import { RainGl } from "../src/glyphs/glrender";
import { RainRenderer } from "../src/glyphs/render";

/** Each pattern's sim, its drawer as its main.ts makes it (WebGL, else 2D), and its face. */
const SCENES: Record<string, () => { sim: Sim; drawer: (c: HTMLCanvasElement, gl: GL | null) => Drawer<never>; faces: FaceFile[] }> = {
  life: () => ({ sim: new Life(), drawer: (c, gl) => (gl ? new LifeGl(c, gl) : new LifeRenderer(c)) as Drawer<never>, faces: [LATIN] }),
  glyphs: () => ({ sim: new Rain(), drawer: (c, gl) => (gl ? new RainGl(c, gl) : new RainRenderer(c)) as Drawer<never>, faces: [LATIN, GREEK] }),
};

declare global {
  interface Window {
    measure(scene: string, look: WallpaperLook, frames: number): Promise<{ js: number[]; painted: number[] }>;
  }
}

window.measure = async (scene, look, frames) => {
  const { sim, drawer: make, faces } = SCENES[scene]!();
  await loadFace(new URL(`/wp/${scene}/fonts/`, location.href), faces);
  const canvas = sceneCanvas();
  const gl = webgl(canvas);
  const real = make(canvas, gl);
  const ctx = gl ? null : canvas.getContext("2d")!;
  const pixel = new Uint8Array(4);
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
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      else ctx!.getImageData(0, 0, 1, 1);
      painted.push(performance.now() - t0);
      if (times.length === frames) done();
    },
  };
  const host = fakeWallpaperHost({ viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look, mode: "run" });
  const stop = runScene(await host.connect(), sim, drawer);
  await finished;
  stop();
  return { js: times, painted };
};
