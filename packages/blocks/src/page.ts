/**
 * What a scene's script makes of the page the app runs it in: a canvas over all of it, and the
 * scene run for the app once its handshake comes. The scenes draw no characters, so they bring no
 * font.
 */
import { connectWallpaper } from "@hivemind/view-sdk";
import { runScene, type Drawer, type Sim } from "./scene";

/** A canvas over the whole page, drawn at the viewport's size times its pixel ratio (the drawer
 *  sets its size) and shown at the viewport's size. */
export function sceneCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", display: "block" });
  document.body.append(canvas);
  return canvas;
}

/** Start a scene in the page: `sim` run for the app, drawn by what `drawerOf` makes. */
export async function startScene<S extends Sim>(sim: S, drawerOf: () => Drawer<S>) {
  // Listening for the app's handshake from the first: it comes once, as the page loads.
  const connecting = connectWallpaper();
  const drawer = drawerOf();
  runScene(await connecting, sim, drawer);
}
