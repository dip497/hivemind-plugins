/**
 * Bees, the live wallpaper of the Hive package: a meadow, a hive and its colony drawn in characters
 * behind the canvas, playing with the pointer. The app runs this script in a sandboxed frame
 * of its own and serves it `@hivemind/view-sdk`.
 */
import { connectWallpaper } from "@hivemind/view-sdk";
import { Painter } from "./render";
import { startBees } from "./scene";

const canvas = document.createElement("canvas");
// Drawn at the viewport's size times its pixel ratio, shown at the viewport's size.
Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", display: "block" });
document.body.append(canvas);

startBees(await connectWallpaper(), new Painter(canvas));
