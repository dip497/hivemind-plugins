/**
 * Dunes, a live wallpaper of the Wilds package: a desert of rolling dunes shaded in characters behind
 * the canvas, sand streaming off the crests, a caravan crossing a ridge. The app runs this script in
 * a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { DunesRenderer } from "./render";
import { Desert } from "./sands";

await startScene(new Desert(), (canvas) => new DunesRenderer(canvas));
