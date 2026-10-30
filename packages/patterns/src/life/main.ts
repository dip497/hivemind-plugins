/**
 * Life, a live wallpaper of the Patterns package: Conway's Game of Life as a glowing colony drawn in
 * characters behind the canvas, newborns bright and old cells settling, sown again wherever it goes
 * quiet. Drawn in WebGL; in 2D where the frame has no WebGL2. The app runs this script in a
 * sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { webgl } from "../gl";
import { startScene } from "../page";
import { LifeGl } from "./glrender";
import { Life } from "./life";
import { LifeRenderer } from "./render";

await startScene(new Life(), (canvas) => {
  const gl = webgl(canvas);
  return gl ? new LifeGl(canvas, gl) : new LifeRenderer(canvas);
});
