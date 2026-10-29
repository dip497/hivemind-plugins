/**
 * Shoal, a live wallpaper of the Live scenes package: a reef's water seen from above, drawn in
 * characters behind the canvas, schools of small fish and the sharks that hunt them. The app runs
 * this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { ShoalRenderer } from "./render";
import { shoalWorld } from "./scene";

await startScene(shoalWorld(), (canvas) => new ShoalRenderer(canvas));
