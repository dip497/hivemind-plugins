/**
 * Northern Lights, a live wallpaper of the Weather package: the aurora over a snowy tundra, drawn in
 * characters and braille dots behind the canvas. The app runs this script in a sandboxed frame of
 * its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { NorthernLightsRenderer } from "./render";
import { Tundra } from "./tundra";

await startScene(new Tundra(), (canvas) => new NorthernLightsRenderer(canvas));
