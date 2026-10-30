/**
 * Skyline, a live wallpaper of the City package: a city's skyline drawn in characters behind the
 * canvas, its windows lighting and going dark, its traffic and its planes. The app runs this script
 * in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { startScene } from "../page";
import { City } from "./city";
import { SkylineRenderer } from "./render";

await startScene(new City(), (canvas) => new SkylineRenderer(canvas));
