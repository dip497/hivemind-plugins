/**
 * Block Valley, a live wallpaper of the Blocks package: a valley of blocks seen from a camera
 * sweeping slowly to and fro: its river, village, fields, trees and snowy peaks fading into the
 * haze. The app runs this script in a sandboxed frame of its own and serves it
 * `@hivemind/view-sdk`.
 */
import { sceneCanvas, startScene } from "../page";
import { Valley } from "./valley";
import { ValleyRenderer } from "./render";

await startScene(new Valley(), () => new ValleyRenderer(sceneCanvas));
