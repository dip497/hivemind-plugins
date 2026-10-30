// The harness page's host: one of the City scenes in a sandboxed frame, as the app frames a live
// wallpaper, connected to the SDK's fakeWallpaperHost as the app would connect it. `start(scenario)`
// runs one; `window.host` is the host, for a script to send the wallpaper what the app would.
import { fakeWallpaperHost, type FakeWallpaperHost } from "@hivemind/view-sdk/testing";
import { PORT_HANDSHAKE, type WallpaperCreature, type WallpaperLook, type WallpaperMode, type WallpaperTile } from "@hivemind/view-sdk";

export interface Scenario {
  /** The wallpaper's folder name: skyline or sunset. */
  scene: string;
  look: WallpaperLook;
  mode: WallpaperMode;
  /** What the app tells every wallpaper of the agents and tiles, which a scene does not listen to. */
  creatures?: WallpaperCreature[];
  tiles?: WallpaperTile[];
}

declare global {
  interface Window {
    host: FakeWallpaperHost;
    /** The scene's frame, for a script to read its canvas. */
    scene: HTMLIFrameElement;
    start(s: Scenario): Promise<void>;
  }
}

window.start = async (s: Scenario) => {
  const frame = document.createElement("iframe");
  // As the app frames it: scripts and nothing else, an opaque origin of its own.
  frame.setAttribute("sandbox", "allow-scripts");
  window.scene = frame;
  const host = fakeWallpaperHost({
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    look: s.look, mode: s.mode, creatures: s.creatures ?? [], tiles: s.tiles ?? [], seeThrough: true,
  });
  window.host = host;
  // The host's end of its port is kept here; the other end is handed to the frame as the app hands
  // it over: posted once, when the frame has loaded (its origin is opaque, so to "*").
  const grab = new EventTarget();
  let port: MessagePort | undefined;
  grab.addEventListener("message", (e) => { port = (e as MessageEvent).ports[0]; });
  host.handshake(grab);
  frame.addEventListener("load", () => frame.contentWindow!.postMessage({ type: PORT_HANDSHAKE }, "*", [port!]), { once: true });
  frame.src = `/wp/${s.scene}/__entry.html?js=dist/main.js`;
  document.body.append(frame);
  while (!host.received.length) await new Promise((r) => setTimeout(r, 20));
};
