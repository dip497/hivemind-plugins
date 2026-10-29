// The harness page's host: Bees in a frame, connected to the SDK's fakeWallpaperHost as the app would
// connect it, with the tiles drawn over it as the app draws them (glass when see-through) and a glass
// panel whose text has to read over the meadow. `start(scenario)` runs one; `window.host` is the host,
// for a script to send the wallpaper what the app would; `window.frames` times each frame it draws.
import { fakeWallpaperHost, type FakeWallpaperHost } from "@hivemind/view-sdk/testing";
import type { WallpaperCreature, WallpaperLook, WallpaperMode, WallpaperTile } from "@hivemind/view-sdk";

export interface Scenario {
  look: WallpaperLook;
  mode: WallpaperMode;
  creatures: WallpaperCreature[];
  tiles: (WallpaperTile & { name?: string; lines?: string[] })[];
  seeThrough: boolean;
  /** The theme's panel colours, as CSS. */
  chrome: { bg2: string; fg: string; fg2: string; fg3: string; line: string };
  /** A glass panel over the wallpaper (not a tile: the wallpaper draws under it), and its lines. */
  panel?: { x0: number; y0: number; x1: number; y1: number; lines: string[] };
  /** The wallpaper alone: the tiles are told to it but not drawn over it (a preview). */
  bare?: boolean;
}

/** One frame the wallpaper drew: its script's time, and that time with the canvas made to paint. */
export interface FrameTime { js: number; painted: number }

declare global {
  interface Window {
    host: FakeWallpaperHost;
    frameTimes: FrameTime[];
    start(s: Scenario): Promise<void>;
  }
}

/** The see-through tiles' opacity and blur, and a glass panel's third of it (the app's SEE_THROUGH). */
const GLASS = { opacity: 0.5, blur: 14 };

const alpha = (hex: string, a: number) => `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;

window.frameTimes = [];
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
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    look: s.look, mode: s.mode, creatures: s.creatures, tiles: s.tiles.map(({ x0, y0, x1, y1, id }) => ({ x0, y0, x1, y1, ...(id ? { id } : {}) })), seeThrough: s.seeThrough,
  });
  window.host = host;
  while (!host.received.length) {
    host.handshake(win);
    await new Promise((r) => setTimeout(r, 20));
  }
  if (s.bare) return;
  const { bg2, fg, fg2, fg3, line } = s.chrome;
  document.body.style.setProperty("--line", line);
  for (const t of s.tiles) {
    const el = document.createElement("div");
    el.className = "tile";
    Object.assign(el.style, {
      left: `${t.x0}px`, top: `${t.y0}px`, width: `${t.x1 - t.x0}px`, height: `${t.y1 - t.y0}px`, color: fg,
      background: s.seeThrough ? alpha(bg2, GLASS.opacity) : bg2, backdropFilter: s.seeThrough ? `blur(${GLASS.blur}px)` : "", border: `1px solid ${line}`,
    });
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.textContent = t.name ?? "";
    const pre = document.createElement("pre");
    pre.style.color = fg2;
    pre.textContent = (t.lines ?? []).join("\n");
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
