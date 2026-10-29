/**
 * Fireflies, a live wallpaper of the Live scenes package: a meadow at night drawn in characters
 * behind the canvas, fireflies over the grass flashing their kinds' codes. The app runs this script
 * in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Meadow } from "./meadow";
import { FireflyRenderer } from "./render";

await startScene(new Meadow(), (canvas) => new FireflyRenderer(canvas));
