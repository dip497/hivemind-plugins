/**
 * What a City scene's script makes of the page the app runs it in: a canvas over all of it, and the
 * face its characters are drawn in. The app's fonts are not in the frame, and the terminals' font may
 * not be on this computer at all, so each wallpaper brings a monospace face of its own (a Latin subset
 * of JetBrains Mono, semibold, in its folder's fonts/, with its licence), loaded from its own files.
 */
import { connectWallpaper } from "@hivemind/view-sdk";
import { runScene, type Drawer, type Sim } from "./scene";

/** The family the scenes' own face goes by. */
export const SCENE_FACE = "City Mono";
/** How long a scene waits for its face before it draws without it. */
const FACE_WAIT = 2000;
/** The face, in the wallpaper's folder: the script is its dist/main.js. */
const FACE_FILE = "../fonts/jetbrains-mono-latin-600-normal.woff2";

/** The canvas a scene draws in: over the whole page, drawn at the viewport's size times its pixel
 *  ratio and shown at the viewport's size. */
export function sceneCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", display: "block" });
  document.body.append(canvas);
  return canvas;
}

/** Load the face from `url` (a file of the wallpaper's own), as `SCENE_FACE`. Settles once it is in,
 *  or failed, or after `FACE_WAIT`: the scene then draws in the next font of its list. */
export function loadFace(url: URL): Promise<void> {
  const face = new FontFace(SCENE_FACE, `url(${JSON.stringify(url.href)}) format("woff2")`, { weight: "600" });
  document.fonts.add(face);
  return Promise.race([face.load().then(() => {}, () => {}), new Promise<void>((r) => setTimeout(r, FACE_WAIT))]);
}

/** Start a scene in the page: its canvas, its face, and `sim` run for the app, drawn by what
 *  `drawerOf` makes of the canvas. */
export async function startScene<S extends Sim>(sim: S, drawerOf: (canvas: HTMLCanvasElement) => Drawer<S>) {
  const canvas = sceneCanvas();
  // Listening for the app's handshake from the first: it comes once, as the page loads. The face
  // loads meanwhile, so the first frame is drawn in it.
  const [wp] = await Promise.all([connectWallpaper(), loadFace(new URL(FACE_FILE, import.meta.url))]);
  runScene(wp, sim, drawerOf(canvas));
}
