// The harness page's host: Bees in a frame, connected to the SDK's fakeWallpaperHost as the app
// would connect it (live wallpaper protocol 1: told the agents and where the tiles are, which Bees
// ignores), with tiles and a glass panel drawn over it as the app draws them and the pointer drawn
// where it is. `start(scenario)` runs one;
// `window.host` is the host, `point` and `click` play with it as the person would, and
// `window.frameTimes` times each frame it draws.
import { fakeWallpaperHost, type FakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperCreature, WallpaperLook, WallpaperMode } from "@hivemind/view-sdk";

export interface Scenario {
  look: WallpaperLook;
  mode: WallpaperMode;
  /** Tiles over the wallpaper, drawn as the app draws them, glass, and told to it as the app tells
   *  it, `id` naming an agent's. */
  tiles: { x0: number; y0: number; x1: number; y1: number; id?: string; name: string; lines: string[] }[];
  /** The agents, as the app tells a wallpaper them. */
  creatures?: WallpaperCreature[];
  /** The theme's panel colours, as CSS. */
  chrome: { bg2: string; fg: string; fg2: string; fg3: string; line: string };
  /** A glass panel over the wallpaper, and its lines. */
  panel?: { x0: number; y0: number; x1: number; y1: number; lines: string[] };
  /** The wallpaper alone (a preview). */
  bare?: boolean;
}

/** One frame the wallpaper drew: its script's time, and that time with the canvas made to paint. */
export interface FrameTime { js: number; painted: number }

declare global {
  interface Window {
    host: FakeWallpaperHost;
    frameTimes: FrameTime[];
    start(s: Scenario): Promise<void>;
    /** The pointer over empty canvas at (x, y), drawn there; or gone. */
    pointAt(x: number, y: number, over?: boolean): void;
    clickAt(x: number, y: number): void;
  }
}

/** The see-through tiles' opacity and blur, and a glass panel's third of it (the app's SEE_THROUGH). */
const GLASS = { opacity: 0.5, blur: 14 };

const alpha = (hex: string, a: number) => `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;

/** The pointer, drawn: an arrow, as the person sees it. */
const cursor = document.createElement("div");
cursor.style.cssText = "position:fixed;left:0;top:0;width:14px;height:20px;pointer-events:none;z-index:10;display:none;"
  + "background:#fff;clip-path:polygon(0 0,0 16px,4px 12px,7px 19px,9px 18px,6px 11px,12px 11px);filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)";

window.frameTimes = [];
window.pointAt = (x, y, over = true) => {
  window.host.point(x, y, over);
  cursor.style.display = over ? "block" : "none";
  cursor.style.transform = `translate(${x}px, ${y}px)`;
};
window.clickAt = (x, y) => {
  window.pointAt(x, y);
  window.host.click(x, y);
};
window.start = async (s: Scenario) => {
  const frame = document.createElement("iframe");
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.src = "/wp/__entry.html";
    document.body.append(frame);
  });
  // Time each frame it draws: the clock's own callback, and with the canvas painted (a pixel read
  // makes the browser draw what was asked, which it otherwise does after the callback).
  const win = frame.contentWindow as Window & typeof globalThis;
  const raf = win.requestAnimationFrame.bind(win);
  win.requestAnimationFrame = (cb: FrameRequestCallback) => raf((now) => {
    const t0 = win.performance.now();
    cb(now);
    const t1 = win.performance.now();
    if (t1 - t0 < 0.15) return;
    win.document.querySelector("canvas")?.getContext("2d")?.getImageData(0, 0, 1, 1);
    window.frameTimes.push({ js: t1 - t0, painted: win.performance.now() - t0 });
  });
  const host = fakeWallpaperHost({
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, look: s.look, mode: s.mode,
    creatures: s.creatures ?? [], tiles: s.tiles.map(({ x0, y0, x1, y1, id }) => ({ x0, y0, x1, y1, ...(id ? { id } : {}) })), seeThrough: true,
  });
  window.host = host;
  while (!host.received.length) {
    host.handshake(win);
    await new Promise((r) => setTimeout(r, 20));
  }
  document.body.append(cursor);
  if (s.bare) return;
  const { bg2, fg, fg2, fg3, line } = s.chrome;
  document.body.style.setProperty("--line", line);
  for (const t of s.tiles) {
    const el = document.createElement("div");
    el.className = "tile";
    Object.assign(el.style, {
      left: `${t.x0}px`, top: `${t.y0}px`, width: `${t.x1 - t.x0}px`, height: `${t.y1 - t.y0}px`, color: fg,
      background: alpha(bg2, GLASS.opacity), backdropFilter: `blur(${GLASS.blur}px)`, border: `1px solid ${line}`,
    });
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.textContent = t.name;
    const pre = document.createElement("pre");
    pre.style.color = fg2;
    pre.textContent = t.lines.join("\n");
    el.append(bar, pre);
    document.body.append(el);
  }
  if (s.panel) {
    const p = s.panel;
    const el = document.createElement("div");
    el.className = "panel";
    Object.assign(el.style, {
      left: `${p.x0}px`, top: `${p.y0}px`, width: `${p.x1 - p.x0}px`, height: `${p.y1 - p.y0}px`,
      background: alpha(bg2, GLASS.opacity / 3), backdropFilter: `blur(${GLASS.blur}px)`, border: `1px solid ${line}`,
    });
    p.lines.forEach((text, i) => {
      const row = document.createElement(i === 0 ? "b" : "div");
      row.textContent = text;
      row.style.color = i === 0 ? fg : i < 3 ? fg2 : fg3;
      el.append(row);
    });
    document.body.append(el);
  }
};
