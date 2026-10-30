/**
 * Life, a live wallpaper of the Patterns package: Conway's Game of Life on a board of character
 * cells behind the canvas, newborns bright and old cells settling, sown again wherever it goes
 * quiet. The app runs this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Life } from "./life";
import { LifeRenderer } from "./render";

await startScene(new Life(), (canvas) => new LifeRenderer(canvas));
