/**
 * Rain on Glass, a live wallpaper of the Weather package: rain on a window, drawn in characters
 * behind the canvas, the city's lights blurred behind it. The app runs this script in a sandboxed
 * frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Glass } from "./glass";
import { RainRenderer } from "./render";

await startScene(new Glass(), (canvas) => new RainRenderer(canvas));
