/**
 * Metro, a live wallpaper of the City package: a transit map drawn in box-drawing lines behind the
 * canvas, its trains running from station to station. The app runs this script in a sandboxed frame
 * of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { Network } from "./network";
import { MetroRenderer } from "./render";

await startScene(new Network(), (canvas) => new MetroRenderer(canvas));
