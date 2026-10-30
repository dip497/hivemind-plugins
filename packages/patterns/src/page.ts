/**
 * What a pattern's script makes of the page the app runs it in: a canvas over all of it, and the
 * face its characters are drawn in. The app's fonts are not in the frame, and the terminals' font
 * may not be on this computer at all, so each wallpaper brings a monospace face of its own (subsets
 * of JetBrains Mono, semibold, in its folder's fonts/, with its licence), loaded from its own files.
 */
import { connectWallpaper } from "@hivemind/view-sdk";
import { runScene, type Drawer, type Sim } from "./scene";

/** The family the patterns' own face goes by. */
export const FACE = "Patterns Mono";
/** How long a pattern waits for its face before it draws without it. */
const FACE_WAIT = 2000;

/** One file of the face, and the characters it holds. */
export interface FaceFile {
  file: string;
  range: string;
}
/** Latin: letters, digits, symbols and punctuation. Every pattern draws in it. */
export const LATIN: FaceFile = {
  file: "jetbrains-mono-latin-600-normal.woff2",
  range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
};
/** Greek letters, for Glyph Rain. */
export const GREEK: FaceFile = {
  file: "jetbrains-mono-greek-600-normal.woff2",
  range: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
};

/** The canvas a pattern draws in: over the whole page, drawn at the viewport's size times its pixel
 *  ratio and shown at the viewport's size. */
export function sceneCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", display: "block" });
  document.body.append(canvas);
  return canvas;
}

/** Load the face's `files` from the folder `fonts` (a URL of the wallpaper's own), as `FACE`.
 *  Settles once they are in, or failed, or after `FACE_WAIT`: the pattern then draws in the next
 *  font of its list. */
export function loadFace(fonts: URL, files: readonly FaceFile[]): Promise<void> {
  const loads = files.map(({ file, range }) => {
    const face = new FontFace(FACE, `url(${JSON.stringify(new URL(file, fonts).href)}) format("woff2")`, { weight: "600", unicodeRange: range });
    document.fonts.add(face);
    return face.load().then(() => {}, () => {});
  });
  return Promise.race([Promise.all(loads).then(() => {}), new Promise<void>((r) => setTimeout(r, FACE_WAIT))]);
}

/** Start a pattern in the page: its canvas, its face, and `sim` run for the app, drawn by what
 *  `drawerOf` makes of the canvas. */
export async function startScene<S extends Sim>(sim: S, drawerOf: (canvas: HTMLCanvasElement) => Drawer<S>, files: readonly FaceFile[] = [LATIN]) {
  const canvas = sceneCanvas();
  // Listening for the app's handshake from the first: it comes once, as the page loads. The face
  // loads meanwhile, so the first frame is drawn in it. The script is the wallpaper's dist/main.js.
  const [wp] = await Promise.all([connectWallpaper(), loadFace(new URL("../fonts/", import.meta.url), files)]);
  runScene(wp, sim, drawerOf(canvas));
}
