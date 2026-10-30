/**
 * Glyph Rain, a live wallpaper of the Patterns package: a curtain of letters, digits and symbols
 * falling at three depths behind the canvas, each stream a bright head and a fading tail. Drawn in
 * WebGL; in 2D where the frame has no WebGL2. The app runs this script in a sandboxed frame of its
 * own and serves it `@hivemind/view-sdk`.
 */
import { webgl } from "../gl";
import { GREEK, LATIN, startScene } from "../page";
import { RainGl } from "./glrender";
import { Rain } from "./rain";
import { RainRenderer } from "./render";

await startScene(new Rain(), (canvas) => {
  const gl = webgl(canvas);
  return gl ? new RainGl(canvas, gl) : new RainRenderer(canvas);
}, [LATIN, GREEK]);
