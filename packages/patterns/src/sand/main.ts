/**
 * Sand, a live wallpaper of the Patterns package: coloured sand pouring from spouts above a painted
 * desert into banded dunes, all drawn in characters behind the canvas, draining slowly through the
 * floor. Drawn in WebGL; in 2D where the frame has no WebGL2. The app runs this script in a
 * sandboxed frame of its own and serves it `@hivemind/view-sdk`.
 */
import { webgl } from "../gl";
import { startScene } from "../page";
import { SandGl } from "./glrender";
import { SandRenderer } from "./render";
import { Sand } from "./sand";

await startScene(new Sand(), (canvas) => {
  const gl = webgl(canvas);
  return gl ? new SandGl(canvas, gl) : new SandRenderer(canvas);
});
