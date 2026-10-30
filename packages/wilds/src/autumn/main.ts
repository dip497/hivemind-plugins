/**
 * Autumn Wood, a live wallpaper of the Wilds package: a forest edge in autumn drawn in characters
 * behind the canvas, leaves tumbling down and piling up, a fox or a deer crossing now and then. The
 * app runs this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Wood } from "./forest";
import { AutumnRenderer } from "./render";

await startScene(new Wood(), (canvas) => new AutumnRenderer(canvas));
