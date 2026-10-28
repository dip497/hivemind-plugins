// Tools as a person sees them: each tool's own module drawn by Chromium in a tile as the app draws
// one (tool-tile.tsx: its body --color-bg2 under a --color-bg3 bar), on <html> the CSS variables the
// app's theme store paints for a preset (theme-store.ts paintTheme: the palette, and --color-info the
// accent, or the brand on a light page), its programs answered by ./helpers/tool-fixtures.js. In each
// state a tool reaches, every word it writes reads at 4.5:1 (3:1 when large) on the pixels under it,
// every mark it draws (a dot, a bar, a ring) at 3:1 on what is painted under it, and nothing is drawn
// in the attention colour, which says a person is waited on and nothing in these states waits. The
// theme is switched live, as a person switches it. Needs Playwright's Chromium (`npx playwright
// install chromium-headless-shell`) and React, which the app hands a tool.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { APP, ROOT, core } from "./app";

const { PRESETS, ACCENTS } = await core("settings-schema.ts");
type Preset = { mode: "dark" | "light"; accent: string; palette: Record<string, string> };
type Look = { name: string; mode: "dark" | "light"; palette: Record<string, string>; brand: string; accent: string };
const lookOf = (id: string, accent?: string): Look => {
  const p = PRESETS[id] as Preset, a = ACCENTS[accent ?? p.accent] as { brand: string; accent: string };
  return { name: accent ? `${id} with ${accent}` : id, mode: p.mode, palette: p.palette, brand: a.brand, accent: a.accent };
};
const PRESET_IDS = Object.keys(PRESETS);
/** The dark presets, each once: Clean paints a tool the same colours as Signal. */
const DARK = PRESET_IDS.filter((id, i) => {
  const look = ({ mode, accent, palette }: Preset) => JSON.stringify([mode, accent, palette]);
  return (PRESETS[id] as Preset).mode === "dark" && PRESET_IDS.findIndex((other) => look(PRESETS[other]) === look(PRESETS[id])) === i;
});
// An app from before Clean Light (the latest release, which CI tests against too) has no light
// preset: there the rows on Clean Light are skipped, under a name that says so.
const LIGHT = (PRESETS["clean-light"] as Preset | undefined)?.mode === "light";
const NO_LIGHT = "skipped: the app at HIVEMIND_APP has no Clean Light preset";
const ON_LIGHT = LIGHT ? "on Clean Light" : `on Clean Light (${NO_LIGHT})`;
// Harbour, Archipelago's theme, applied as the app applies a theme: its palette, and its accent's
// colours as the accent's. A checkout without it runs the presets alone, and says so.
const HARBOUR_FILE = path.join(ROOT, "packages/archipelago/themes/harbour/theme.json");
const HARBOUR: Look | null = existsSync(HARBOUR_FILE) ? (() => {
  const t = JSON.parse(readFileSync(HARBOUR_FILE, "utf8"));
  return { name: "Harbour", mode: t.mode, palette: t.palette, brand: t.accent.brand, accent: t.accent.accent };
})() : null;
const IN_DARK = `in every dark preset${HARBOUR ? " and Harbour" : " (Harbour skipped: this checkout has no packages/archipelago/themes/harbour)"}`;
const DARK_LOOKS = [...DARK.map((id) => lookOf(id)), ...(HARBOUR ? [HARBOUR] : [])];
/** Clean Light, after a live switch from a dark preset, then back and over again. */
const LIGHT_LOOKS = LIGHT ? [lookOf("clean-light"), lookOf(DARK[0]!), lookOf("clean-light")] : [];

/** What the app's theme store paints on <html> for a look, as a tool reads it. In a tile --color-bg2
 *  and --color-bg3 are the panels' own colours, under glass or not (styles.css, .hm-tile-surface). */
const varsOf = (l: Look): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(l.palette).map(([k, v]) => [`--color-${k}`, v])),
  "--color-brand": l.brand, "--color-info": l.mode === "light" ? l.brand : l.accent,
  "--font-mono": '"JetBrains Mono", ui-monospace, monospace',
});

// React as the app hands it to a tool: the app's own where it is installed, else this repository's.
const react = [path.join(APP, "apps/desktop/package.json"), path.join(ROOT, "package.json")].map((p) => createRequire(p)).find((r) => {
  try { r.resolve("react"); r.resolve("react-dom/client"); return true; } catch { return false; }
});
const NO_REACT = "skipped: no React here to draw a tool with (the app's apps/desktop, or this repository's node_modules)";
if (!react) console.log(`tools-theme: ${NO_REACT}.`);
const drawn = (name: string) => (react ? name : `${name} (${NO_REACT})`);

// The app's parts a tool imports from hm-plugin://host/. Each is marked data-app: what it paints is
// the app's, measured by the app's own tests, so it is left out here.
const SDK = `import React, { useState } from "react";
const h = React.createElement;
export function Button({ children, onClick, disabled, size, variant, ...rest }) {
  return h("button", { "data-app": "button", onClick, disabled, "aria-pressed": rest["aria-pressed"], style: { display: "inline-flex", alignItems: "center", gap: 4, height: size === "2xs" ? 20 : 24, padding: "0 8px", fontSize: 11, borderRadius: 4, background: variant === "secondary" ? "var(--color-bg3)" : variant === "default" ? "var(--color-brand)" : "transparent", border: variant === "outline" ? "1px solid var(--color-line)" : 0 } }, children);
}
export const Loading = ({ label }) => h("div", { "data-app": "loading", style: { padding: 16 } }, label ?? "Loading");
export const Markdown = ({ text }) => h("div", { "data-app": "markdown", style: { whiteSpace: "pre-wrap" } }, text);
export const PatchView = ({ patch }) => h("pre", { "data-app": "patch", style: { margin: 0 } }, patch);
export function useTileState(hm, key, initial) {
  const saved = hm.hello?.layout ?? {};
  return useState(Object.hasOwn(saved, key) ? saved[key] : initial);
}`;
const UI = `import React from "react";
export { Button } from "hm-plugin://host/sdk.js";
const box = (children) => React.createElement("div", { "data-app": "dialog" }, children);
export const Dialog = ({ children }) => box(children), DialogContent = Dialog, DialogDescription = Dialog, DialogFooter = Dialog, DialogTitle = Dialog;
export const toast = Object.assign(() => {}, { success() {}, error() {}, info() {}, warning() {} });`;

/** `tool`'s module in a page of its own, on the fixtures, its programs failing when `fails`. */
async function bundle(tool: string, fails: boolean) {
  const entry = `import React from "react";
import { createRoot } from "react-dom/client";
import mod from ${JSON.stringify(path.join(ROOT, "tools", tool, "index.js"))};
import { FIXTURES } from ${JSON.stringify(path.join(import.meta.dir, "helpers/tool-fixtures.js"))};
const f = FIXTURES[${JSON.stringify(tool)}];
const hm = { settings: f.settings, capabilities: ["workspace:spawn", "workspace:prompt"], hello: { layout: f.layout ?? {} }, on: () => () => {}, onCommand: () => () => {}, commands: { spawnAgent() {} }, setLayout() {} };
const run = ${fails} ? f.fail : f.run;
const host = { repoPath: f.repoPath ?? "/r/app", cwd: "/r/app", run: (bin, args, opts) => run(bin, args, opts ?? {}), openFile() {}, openUrl() {} };
createRoot(document.getElementById("body")).render(React.createElement(mod.tiles[f.kind], { tile: { id: "t", kind: f.kind, name: "t", frameId: "f" }, hm, host, selected: false }));`;
  const out = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: "js" }, bundle: true, format: "esm", write: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "host",
      setup(b) {
        b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => ({ path: react!.resolve(a.path) }));
        b.onResolve({ filter: /^hm-plugin:\/\/host\// }, (a) => {
          const part = /^hm-plugin:\/\/host\/(.*)\.js$/.exec(a.path)![1]!;
          if (part === "react") return { path: react!.resolve("react") };
          if (part === "react-jsx-runtime") return { path: react!.resolve("react/jsx-runtime") };
          return { path: part, namespace: "app" };
        });
        b.onLoad({ filter: /.*/, namespace: "app" }, (a) => ({ contents: a.path === "sdk" ? SDK : UI, resolveDir: ROOT, loader: "js" }));
      },
    }],
  });
  return out.outputFiles[0]!.text;
}

// The page: Tailwind's preflight as the app has it (what changes how a tool's elements paint), the
// tile, and the helpers that read what reaches the screen.
const PAGE = (tool: string, fails: boolean) => `<!doctype html><html><head><meta charset="utf-8"><style>
*, ::before, ::after { box-sizing: border-box; border: 0 solid; margin: 0; padding: 0; }
button, input, select, textarea { font: inherit; letter-spacing: inherit; color: inherit; border-radius: 0; background-color: transparent; opacity: 1; }
ol, ul, menu { list-style: none; }
table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
b, strong { font-weight: bolder; }
/* What is read is where each colour settles, not a frame of its fade to it. */
*, ::before, ::after { transition: none !important; }
html, body { height: 100%; }
body { font-family: system-ui, sans-serif; font-size: 13px; line-height: 1.5; color: var(--color-fg); background: var(--color-bg); -webkit-font-smoothing: antialiased; }
#tile { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--color-bg2); }
#bar { height: 32px; flex: none; background: var(--color-bg3); border-bottom: 1px solid var(--color-line); }
#body { position: relative; flex: 1; min-height: 0; overflow: hidden; }
</style><script>
const one = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
/** A CSS colour as [r, g, b, alpha]. */
const rgba = (css) => { one.clearRect(0, 0, 1, 1); one.fillStyle = "rgba(0, 0, 0, 0)"; one.fillStyle = css; one.fillRect(0, 0, 1, 1); const d = one.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (under, [r, g, b, a]) => [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
window.paint = (vars) => { for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); };
/** An element, named for a failure: its tag and data attributes, up to three parents. */
const named = (el) => {
  const parts = [];
  for (let at = el; at && at.id !== "body" && parts.length < 4; at = at.parentElement) {
    parts.unshift(at.tagName.toLowerCase() + [...at.attributes].filter((a) => a.name.startsWith("data-") || a.name === "role").map((a) => "[" + a.name + (a.value && a.value.length < 30 ? '="' + a.value + '"' : "") + "]").join(""));
  }
  return parts.join(" > ");
};
const mine = (el) => !el.closest("[data-app], style, script");
const alphaOf = (el) => { let a = 1; for (let at = el; at; at = at.parentElement) a *= Number(getComputedStyle(at).opacity); return a; };
const shown = (el, r) => { const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el.contains(top) || top.contains(el)); };
/** Every run of words the tool writes on screen: its box, ink, the alpha it is drawn at, and what it needs. */
window.words = () => {
  const out = [], walk = document.createTreeWalker(document.getElementById("body"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent.trim(), el = n.parentElement;
    if (!text || !mine(el)) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight);
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || !shown(el, r)) continue;
      // Large text (24px, or 18.66px bold) needs 3:1, the rest 4.5:1.
      out.push({ what: named(el), text: text.slice(0, 32), ink: cs.color, alpha: alphaOf(el), need: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5, x: r.x, y: r.y, w: r.width, h: r.height });
    }
  }
  return out;
};
let hushed = null;
window.hush = (on) => {
  if (on) { hushed = document.createElement("style"); hushed.textContent = "*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }"; document.head.append(hushed); }
  else hushed?.remove();
};
const pixels = async (png) => {
  const img = new Image();
  img.src = "data:image/png;base64," + png;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
};
/** For each box of words: the lowest contrast its ink, at its alpha, has with the pixels under the
 *  words, which are those that differ between \`shown\` and \`bare\` (the words taken out). */
window.under = async (shownPng, barePng, boxes) => {
  const [a, b] = await Promise.all([pixels(shownPng), pixels(barePng)]);
  return boxes.map(({ ink, alpha, x, y, w, h }) => {
    const [r, g, bl, k] = rgba(ink), t = k * alpha;
    let least = Infinity;
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(a.h, Math.ceil(y + h)); j++) {
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(a.w, Math.ceil(x + w)); i++) {
        const p = (j * a.w + i) * 4;
        if (Math.abs(a.d[p] - b.d[p]) + Math.abs(a.d[p + 1] - b.d[p + 1]) + Math.abs(a.d[p + 2] - b.d[p + 2]) < 6) continue;
        const ground = [b.d[p], b.d[p + 1], b.d[p + 2]];
        least = Math.min(least, contrast([r, g, bl].map((v, c) => v * t + ground[c] * (1 - t)), ground));
      }
    }
    return least;
  });
};
/** What the element's parents paint under it, from the tile in. */
const groundOf = (el) => {
  const chain = [];
  for (let at = el.parentElement; at && at.id !== "tile"; at = at.parentElement) chain.unshift(at);
  let g = rgba(getComputedStyle(document.getElementById("tile")).backgroundColor);
  for (const at of chain) { const c = rgba(getComputedStyle(at).backgroundColor); if (c[3] > 0) g = over(g, [c[0], c[1], c[2], c[3] * alphaOf(at)]); }
  return g;
};
/** Every mark the tool draws (an element without words that paints a fill, or a ring: an edge all
 *  round): its contrast, at its alpha, with what its parents paint under it. Fields are left to the
 *  app. Chromium draws a 1.5px edge 1px wide, so any width counts. */
window.marks = () => {
  const out = [];
  for (const el of document.getElementById("body").querySelectorAll("*")) {
    if (!mine(el) || el.matches("input, textarea, select, option") || el.children.length || el.textContent.trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !shown(el, r)) continue;
    const cs = getComputedStyle(el), fill = rgba(cs.backgroundColor);
    const ring = ["Top", "Right", "Bottom", "Left"].every((side) => parseFloat(cs["border" + side + "Width"]) >= 1);
    const colour = fill[3] > 0 ? fill : ring ? rgba(cs.borderTopColor) : null;
    if (!colour || colour[3] === 0) continue;
    const ground = groundOf(el);
    out.push({ what: named(el), ratio: contrast(over(ground, [colour[0], colour[1], colour[2], colour[3] * alphaOf(el)]), ground) });
  }
  return out;
};
/** Every colour each element of the tool is drawn with, so a change of one variable can be seen. */
window.colours = () => [...document.getElementById("body").querySelectorAll("*")].filter(mine).map((el) => {
  const cs = getComputedStyle(el);
  return [named(el), [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor, cs.outlineColor, cs.boxShadow, cs.textDecorationColor, cs.fill, cs.stroke].join(" ")];
});
</script></head><body><div id="tile"><div id="bar"></div><div id="body"></div></div><script type="module" src="/tool/${tool}.js?fails=${fails}"></script></body></html>`;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const page = /^\/page\/([\w-]+)$/.exec(u.pathname), tool = /^\/tool\/([\w-]+)\.js$/.exec(u.pathname);
    const fails = u.searchParams.get("fails") === "true";
    if (page) return new Response(PAGE(page[1]!, fails), { headers: { "content-type": "text/html" } });
    if (tool) return new Response(await bundle(tool[1]!, fails), { headers: { "content-type": "text/javascript" } });
    return new Response(null, { status: 404 });
  },
});

let browser: Browser;
// Chromium can take longer than bun's 5 s hook limit to start on a busy machine.
beforeAll(async () => { if (react) browser = await chromium.launch(); }, 60_000);
afterAll(async () => { await browser?.close(); server.stop(true); });

const frames = (tab: Page, n = 2) => tab.evaluate((n) => new Promise<void>((resolve) => {
  let i = 0;
  const step = () => (++i >= n ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);
type Helpers = {
  paint(vars: Record<string, string>): void; hush(on: boolean): void;
  words(): { what: string; text: string; ink: string; alpha: number; need: number; x: number; y: number; w: number; h: number }[];
  under(shown: string, bare: string, boxes: unknown[]): Promise<number[]>;
  marks(): { what: string; ratio: number }[]; colours(): [string, string][];
};
const paint = (tab: Page, vars: Record<string, string>) => tab.evaluate((v) => (window as unknown as Helpers).paint(v), vars);

/** In the look on screen: each word that reads below what it needs, and each mark below 3:1. */
async function low(tab: Page) {
  const words = await tab.evaluate(() => (window as unknown as Helpers).words());
  // A screenshot waits for a frame drawn after what came before it.
  const shown = (await tab.screenshot()).toString("base64");
  await tab.evaluate(() => (window as unknown as Helpers).hush(true));
  const bare = (await tab.screenshot()).toString("base64");
  await tab.evaluate(() => (window as unknown as Helpers).hush(false));
  const seen = await tab.evaluate((a) => (window as unknown as Helpers).under(a.shown, a.bare, a.words), { shown, bare, words });
  const marks = await tab.evaluate(() => (window as unknown as Helpers).marks());
  return [
    ...words.flatMap((w, i) => (seen[i]! < w.need ? [`"${w.text}" ${seen[i]!.toFixed(2)}:1 (${w.what})`] : [])),
    ...marks.flatMap((m) => (m.ratio < 3 ? [`a mark ${m.ratio.toFixed(2)}:1 (${m.what})`] : [])),
  ];
}

/** What the tool draws in the attention colour: each element whose colours change with it. */
async function amber(tab: Page, look: Look) {
  const before = await tab.evaluate(() => (window as unknown as Helpers).colours());
  await paint(tab, { "--color-warn": "rgb(255, 0, 255)" });
  const after = await tab.evaluate(() => (window as unknown as Helpers).colours());
  await paint(tab, { "--color-warn": look.palette.warn! });
  return before.flatMap(([what, c], i) => (after[i]?.[1] !== c ? [what] : []));
}

/** `tool` in a tile of its own, opened in a dark preset, its programs failing or not; what it
 *  throws is kept in `thrown`. */
async function open(tool: string, fails: boolean, thrown: string[]) {
  const tab = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
  tab.on("pageerror", (e) => thrown.push(e.message));
  await tab.goto(`${server.url}page/${tool}?fails=${fails}`);
  await paint(tab, varsOf(lookOf(DARK[0]!)));
  return tab;
}

type Drive = (tab: Page) => Promise<void>;
type State = [name: string, drive: Drive];
/** Each state of `tool` reached in turn, each read in every look, switched live; the state named
 *  "error" opens the tool afresh with its programs failing. */
async function check(tool: string, looks: Look[], states: State[]) {
  const failures: string[] = [], ambers = new Set<string>(), thrown: string[] = [];
  let tab: Page | null = null;
  for (const [state, drive] of states) {
    if (!tab || state === "error") {
      await tab?.close();
      tab = await open(tool, state === "error", thrown);
    }
    await drive(tab);
    await frames(tab, 4);
    for (const look of looks) {
      await paint(tab, varsOf(look));
      await frames(tab);
      for (const f of await low(tab)) failures.push(`${look.name}, ${state}: ${f}`);
      for (const what of await amber(tab, look)) ambers.add(`${state}: ${what}`);
    }
  }
  await tab?.close();
  expect({ thrown, low: failures, amber: [...ambers] }).toEqual({ thrown: [], low: [], amber: [] });
}

const shows = (sel: string): Drive => (tab) => tab.locator(sel).first().waitFor({ timeout: 15_000 });
const click = (sel: string, then?: string): Drive => async (tab) => {
  await tab.locator(sel).first().click();
  if (then) await shows(then)(tab);
};
const button = (tab: Page, name: RegExp) => tab.locator('[data-app="button"]', { hasText: name }).first();
/** Choose `method` in Try it and send it to `to`, which the fixture answers with `status` (or
 *  with nothing, when there is none). */
const tryIt = (method: string, to: string, status: number | null): Drive => async (tab) => {
  await tab.locator(`div:has(> span:text-is("Try it")) > [data-method="${method}"]`).click();
  await tab.locator('[aria-label="Path"]').fill(to);
  await button(tab, /^Send$/).click();
  await shows(status === null ? '[role="alert"]' : `[data-response="${status}"]`)(tab);
};

/** Each tool, the states that show what it draws, and what of it the rows guard. */
const TOOLS: { tool: string; Name: string; says: string; states: State[]; light: boolean }[] = [
  {
    tool: "api-explorer", Name: "API explorer", light: true,
    says: "its method chips at rest and chosen, the status of a 500, a 404, a 301 and a 200, a request nobody answered and a failed scan",
    states: [
      ["the endpoints", shows("[data-path] [data-method]")],
      ["DELETE chosen in the list", click('[data-path] [data-method="DELETE"]')],
      ["DELETE sent, a 500", tryIt("DELETE", "/500", 500)],
      ["PUT sent, a 404", tryIt("PUT", "/404", 404)],
      ["POST sent, a 301", tryIt("POST", "/301", 301)],
      ["GET sent, a 200, its headers shown", async (tab) => { await tryIt("GET", "/items", 200)(tab); await button(tab, /headers/).click(); }],
      ["nothing answered", tryIt("PATCH", "/refused", null)],
      ["error", shows('[role="alert"]')],
    ],
  },
  {
    tool: "bundle-size", Name: "Bundle size", light: true,
    says: "each kind's bar and swatch (a source map's too), against a baseline: what grew, what is new and the files removed",
    states: [["against a baseline", shows("[data-file]")], ["error", shows('[role="alert"]')]],
  },
  {
    tool: "changelog-writer", Name: "Changelog writer", light: true,
    says: "each section's dot and name, and its error",
    states: [["the sections", shows("[data-section]")], ["error", shows('[role="alert"]')]],
  },
  {
    tool: "ci-runs", Name: "CI runs", light: true,
    says: "running, queued, failed and passed runs and jobs, a failed run chosen with its failed job's log, and its error",
    states: [
      ["the runs", shows("[data-run]")],
      ["a failed run chosen, its log", click('[data-run="101"]', "[data-error]")],
      ["a running job chosen", click('[data-job="e2e"]', "ol li")],
      ["a running run chosen", click('[data-run="103"]', "[data-job]")],
      ["error", shows('[role="alert"]')],
    ],
  },
  {
    tool: "dependency-audit", Name: "Dependency audit", light: true,
    says: "each severity's pill and dot, the advisories' links, a level switched off, a lockfile that does not parse, and its error",
    states: [
      ["the findings", shows("[data-package]")],
      ["Low and Unknown switched off", async (tab) => { await click('[data-severity="low"]')(tab); await click('[data-severity="unknown"]')(tab); }],
      ["error", shows('[role="alert"]')],
    ],
  },
  {
    tool: "flaky-tests", Name: "Flaky tests", light: true,
    says: "its meter while the tests run, each test's history (a run it was not in too), the flaky chip and bars",
    states: [
      ["running, run 3 of 4", async (tab) => { await button(tab, /^Run/).click(); await tab.waitForFunction(() => !!document.querySelector("[data-progress]")?.textContent?.includes("2 of 4")); }],
      ["the results", async (tab) => { await tab.evaluate(() => (window as unknown as { release(n: string): void }).release("run3")); await shows("[data-test]")(tab); }],
    ],
  },
  {
    tool: "git-history", Name: "Git history", light: false,
    says: "a chosen commit's second line, and its error",
    states: [["a commit chosen", click("[data-commit]", "[data-app=patch]")], ["error", shows('[role="alert"]')]],
  },
  {
    tool: "github-prs", Name: "GitHub pull requests", light: false,
    says: "a chosen pull request's second line, and its error",
    states: [["a pull request chosen", click('[data-pr="12"]', "[data-pr-tab], [data-app=markdown]")], ["error", shows('[role="alert"]')]],
  },
  {
    tool: "log-tail", Name: "Log tail", light: true,
    says: "each level's lines, rule and dot, a level switched off, and its error",
    states: [
      ["the lines", shows('[data-log] [data-level="error"]')],
      ["Debug switched off", click('button[data-level="debug"]')],
      ["error", shows('[role="alert"]')],
    ],
  },
  {
    tool: "release-checklist", Name: "Release checklist", light: true,
    says: "each check's mark and the meter not checked yet, while the tests run, and once checks failed, with what they found",
    states: [
      ["not checked yet", shows("[data-check]")],
      ["the tests running", async (tab) => { await button(tab, /Run all/).click(); await shows('[data-state="running"]')(tab); await tab.waitForFunction(() => document.querySelectorAll('[data-state="fail"]').length >= 1); }],
      ["checked, some failed", async (tab) => { await tab.evaluate(() => (window as unknown as { release(n: string): void }).release("tests")); await tab.waitForFunction(() => !document.querySelector('[data-state="running"]')); }],
    ],
  },
  {
    tool: "sqlite-browser", Name: "SQLite browser", light: false,
    says: "a table's numbers, its header and the chosen table's count, and its error",
    states: [["a table", shows("[data-grid] tbody td")], ["error", shows('[role="alert"]')]],
  },
  {
    tool: "todo-finder", Name: "TODO finder", light: false,
    says: "its notes and its error",
    states: [["the notes", shows("[data-note]")], ["error", shows('[role="alert"]')]],
  },
  {
    tool: "worktrees", Name: "Worktrees", light: true,
    says: "each worktree's pills (this frame, uncommitted, behind, folder missing) and second line, on the chosen row too, and its error",
    states: [
      ["the worktrees", shows("[data-worktree]")],
      ["this frame's worktree chosen", click('[data-worktree="app"]', "[data-app=patch]")],
      ["a worktree with changes chosen", click('[data-worktree="wt-work"]')],
      ["a missing one chosen", click('[data-worktree="gone"]')],
      ["error", shows('[role="alert"]')],
    ],
  },
];

for (const { tool, Name, says, states, light } of TOOLS) {
  test.skipIf(!react)(drawn(`${Name}: ${says}: words at 4.5:1, marks at 3:1 and nothing in the attention colour, ${IN_DARK}, switched live`), () => check(tool, DARK_LOOKS, states), 240_000);
  // Only where a tool drew something wrong on Clean Light; the others' rows on it would guard nothing.
  if (light) test.skipIf(!react || !LIGHT)(drawn(`${Name}: ${says}: the same ${ON_LIGHT}, switched live from a dark preset and back`), () => check(tool, LIGHT_LOOKS, states), 240_000);
}

// Work under way and a failure differ by their mark's shape, as the app's do (a circle, a cross), not by
// colour alone: a theme's accent can sit close to its error colour (Harbour's copper does). With the two
// made one colour, the running run's dot and the failed run's still cover different pixels.
test.skipIf(!react)(drawn("CI runs: a running and a failed run differ by their mark's shape, with the accent and the error colour made one"), async () => {
  const thrown: string[] = [];
  const tab = await open("ci-runs", false, thrown);
  await shows("[data-run]")(tab);
  await paint(tab, { "--color-info": "rgb(200, 120, 100)", "--color-err": "rgb(200, 120, 100)" });
  await frames(tab);
  const shots = await Promise.all(['[data-run="103"]', '[data-run="101"]'].map(async (row) => (await tab.locator(`${row} > span[title]`).first().screenshot()).toString("base64")));
  // The share of the pixels either mark covers that only one of them covers.
  const apart = await tab.evaluate(async (pngs) => {
    const masks = await Promise.all(pngs.map(async (png) => {
      const img = new Image();
      img.src = "data:image/png;base64," + png;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, bg = [d[0]!, d[1]!, d[2]!];
      const mask: boolean[] = [];
      for (let p = 0; p < d.length; p += 4) mask.push(Math.abs(d[p]! - bg[0]!) + Math.abs(d[p + 1]! - bg[1]!) + Math.abs(d[p + 2]! - bg[2]!) > 60);
      return mask;
    }));
    let either = 0, one = 0;
    masks[0]!.forEach((a, i) => { const b = masks[1]![i]; if (a || b) either++; if (a !== b) one++; });
    return either ? one / either : 0;
  }, shots);
  await tab.close();
  expect({ thrown, apart: apart >= 0.3 ? "apart" : `${(apart * 100).toFixed(0)}% apart` }).toEqual({ thrown: [], apart: "apart" });
}, 120_000);

// The worktree of this tile's frame says so on its row in --color-fg, never the accent, which a
// person may make any colour: on the chosen row it reads whichever they pick.
test.skipIf(!react)(drawn(`Worktrees: this frame's worktree, chosen, reads at 4.5:1 in every accent a person can pick, in every dark preset${LIGHT ? " and on Clean Light" : ""}`), () => {
  const looks = [...DARK, ...(LIGHT ? ["clean-light"] : [])].flatMap((id) => Object.keys(ACCENTS).map((accent) => lookOf(id, accent)));
  return check("worktrees", looks, [["this frame's worktree chosen", async (tab) => { await shows("[data-worktree]")(tab); await click('[data-worktree="app"]', "[data-app=patch]")(tab); }]]);
}, 240_000);
