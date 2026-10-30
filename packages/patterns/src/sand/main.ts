/**
 * Sand, a live wallpaper of the Patterns package: coloured sand pouring from spouts above the
 * window into banded dunes, drawn in half blocks behind the canvas, draining slowly through the
 * floor. The app runs this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { SandRenderer } from "./render";
import { Sand } from "./sand";

await startScene(new Sand(), (canvas) => new SandRenderer(canvas));
