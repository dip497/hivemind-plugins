/**
 * Campfire, a live wallpaper of the Wilds package: a campfire in a clearing at night drawn in
 * characters behind the canvas, sparks rising, smoke curling, crickets in the grass. The app runs
 * this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Camp } from "./camp";
import { CampfireRenderer } from "./render";

await startScene(new Camp(), (canvas) => new CampfireRenderer(canvas));
