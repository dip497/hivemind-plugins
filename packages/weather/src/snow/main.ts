/**
 * Snowfall, a live wallpaper of the Weather package: snow falling on a mountain village, drawn in
 * characters behind the canvas. The app runs this script in a sandboxed frame of its own and serves
 * it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { SnowRenderer } from "./render";
import { Valley } from "./valley";

await startScene(new Valley(), (canvas) => new SnowRenderer(canvas));
