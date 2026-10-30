/**
 * Jellyfish, a live wallpaper of the Live scenes package: jellies beating their way through the deep
 * sea, drawn in characters behind the canvas, marine snow falling past them. The app runs this
 * script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { JellyRenderer } from "./render";
import { Swarm } from "./swarm";

await startScene(new Swarm(), (canvas) => new JellyRenderer(canvas));
