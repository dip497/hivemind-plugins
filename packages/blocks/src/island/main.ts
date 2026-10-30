/**
 * Block Island, a live wallpaper of the Blocks package: an island of blocks floating in the sky,
 * its sheep and hens wandering, its pond spilling over the edge. The app runs this script in a
 * sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { sceneCanvas, startScene } from "../page";
import { Island } from "./world";
import { IslandRenderer } from "./render";

await startScene(new Island(), () => new IslandRenderer(sceneCanvas()));
