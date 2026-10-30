/**
 * Brick Town, a live wallpaper of the Blocks package: a little town of studded toy bricks, cars on
 * its streets, a train on its loop, people strolling. The app runs this script in a sandboxed frame
 * of its own and serves it `@hivemind/view-sdk`.
 */
import { sceneCanvas, startScene } from "../page";
import { Town } from "./town";
import { TownRenderer } from "./render";

await startScene(new Town(), () => new TownRenderer(sceneCanvas()));
