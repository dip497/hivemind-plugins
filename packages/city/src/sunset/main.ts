/**
 * Sunset Drive, a live wallpaper of the City package: a drive into a striped sunset drawn in half
 * blocks behind the canvas, a grid floor scrolling under it and palms passing by. The app runs this
 * script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Drive } from "./drive";
import { SunsetRenderer } from "./render";

await startScene(new Drive(), (canvas) => new SunsetRenderer(canvas));
