/**
 * Den, a live wallpaper: a yard behind your canvas where each agent is a fluffy wolf pup. One at
 * work potters and sniffs about, one ready sits and wags, one that needs you runs to its tile and
 * play-bows there, and one at rest curls up asleep along the bottom. Rub a pup with the pointer to
 * pet it; click open ground to throw it a ball.
 */
import { connectWallpaper } from "@hivemind/view-sdk";
import { Yard } from "./yard";
import { DenView } from "./view";
import { runDen } from "./scene";

const wp = await connectWallpaper();
const canvas = document.body.appendChild(document.createElement("canvas"));
Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", display: "block" });
const view = new DenView(canvas);
view.prepare();
runDen(wp, new Yard(), view);
