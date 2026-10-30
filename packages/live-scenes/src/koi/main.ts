/**
 * Koi Pond, a live wallpaper of the Live scenes package: koi under lily pads seen from above, drawn
 * in characters behind the canvas, fry darting between them and reeds along the bank. The app runs
 * this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { KoiRenderer } from "./render";
import { koiWorld } from "./scene";

await startScene(koiWorld(), (canvas) => new KoiRenderer(canvas));
