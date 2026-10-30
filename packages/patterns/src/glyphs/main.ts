/**
 * Glyph Rain, a live wallpaper of the Patterns package: columns of letters, digits and symbols
 * falling at three depths behind the canvas, each stream a bright head and a fading tail. The app
 * runs this script in a sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { GREEK, LATIN, startScene } from "../page";
import { Rain } from "./rain";
import { RainRenderer } from "./render";

await startScene(new Rain(), (canvas) => new RainRenderer(canvas), [LATIN, GREEK]);
