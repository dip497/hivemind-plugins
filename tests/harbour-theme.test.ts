// Harbour, Archipelago's theme: read by the app's own theme reader and package reader, its colours
// measured, and its files opened. Whether theme.json is valid is the app's to say
// (packages/hive-core/src/theme-format.ts, through theme-folder.ts); an app from before themes (CI's
// main and v2026.10.5 legs) has neither, and those rows are reported as skipped, under a name that
// says so. The colour maths for Harbour's own assertions is in ./colour.ts.
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP, core } from "./app";
import { contrast, deltaE, oklchOf, rgbOf, simulate, type RGB } from "./colour";

const PKG = path.resolve(import.meta.dir, "../packages/archipelago");
const DIR = path.join(PKG, "themes/harbour");
const theme = JSON.parse(readFileSync(path.join(DIR, "theme.json"), "utf8"));
const PALETTE_KEYS = ["bg", "bg2", "bg3", "bg4", "line", "line2", "fg", "fg2", "fg3", "select", "ok", "warn", "err"] as const;
const P = theme.palette as Record<(typeof PALETTE_KEYS)[number], string>;
const MOST_BYTES = 400 * 1024;
const SCRIPT = path.join(PKG, "scripts/make-harbour-sounds.mjs");

// The app's theme reader, when the app at HIVEMIND_APP has themes.
const THEMES = existsSync(path.join(APP, "packages/hive-core/src/theme-folder.ts"));
const NO_THEMES = "skipped: the app at HIVEMIND_APP has no theme member (packages/hive-core/src/theme-folder.ts)";
const withThemes = (name: string) => (THEMES ? name : `${name} (${NO_THEMES})`);
if (!THEMES) console.log(`harbour-theme: ${NO_THEMES}, so the rows read by the app do not run.`);
const WHITE: RGB = [1, 1, 1];
const ratio = (a: string | RGB, b: string | RGB) => contrast(typeof a === "string" ? rgbOf(a) : a, typeof b === "string" ? rgbOf(b) : b);

describe("Harbour", () => {
  test.skipIf(!THEMES)(withThemes("the app's theme reader takes it as @dip497/archipelago/harbour: format 1, a dark theme named Harbour, every field the plan's table has"), async () => {
    const { readThemeFolder } = await core("theme-folder.ts");
    const { id, theme: read } = await readThemeFolder(DIR, "@dip497/archipelago");
    expect(id).toBe("@dip497/archipelago/harbour");
    expect({ format: theme.format, name: read.name, mode: read.mode }).toEqual({ format: 1, name: "Harbour", mode: "dark" });
    expect(Object.keys(theme).sort()).toEqual(["accent", "fonts", "format", "mode", "name", "palette", "radius", "sounds", "terminal", "wallpaper"]);
    // The sea's blues, written as the presets are, in oklch().
    expect(Object.keys(P).sort()).toEqual([...PALETTE_KEYS].sort());
    for (const k of PALETTE_KEYS) expect(P[k]).toMatch(/^oklch\(/);
  });

  test.skipIf(!THEMES)(withThemes("the app's package reader lists it as a member of Archipelago, with the view and the four widgets"), async () => {
    const { readPackage } = await core("packages.ts");
    const pkg = await readPackage(PKG, { folder: "archipelago" });
    expect(pkg.members.filter((m: { kind: string }) => m.kind === "theme").map((m: { id: string; name: string }) => [m.id, m.name])).toEqual([["@dip497/archipelago/harbour", "Harbour"]]);
    expect(pkg.members.length).toBe(6);
  });

  test.skipIf(!THEMES || !existsSync(path.join(APP, "packages/hive-hub/src/since.ts")))(withThemes("HiveHub lists the package as needing 2026.10.6 or newer, worked out from its themes, and says what the theme does"), async () => {
    const { checkPluginFolder } = await import(path.join(APP, "packages/hive-hub/src/plugin-checks.ts"));
    const files: { path: string; bytes: Uint8Array }[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
        const at = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(at); else files.push({ path: at, bytes: new Uint8Array(readFileSync(path.join(PKG, at))) });
      }
    };
    walk("");
    const c = await checkPluginFolder(files);
    expect("problem" in c ? c.problem : null).toBe(null);
    expect(c.plugin.minAppVersion).toBe("2026.10.6");
    expect(c.plugin.members.find((m: { id: string }) => m.id === "@dip497/archipelago/harbour")?.does.join(" ")).toMatch(/looks and sounds/);
  });

  test("its words read: fg on bg and bg2 at 4.5:1, fg2 on bg at 3:1 (the pairs the app refuses below), and fg3, select and every status at 3:1 on bg as marks", () => {
    for (const [a, b, least] of [["fg", "bg", 4.5], ["fg", "bg2", 4.5], ["fg2", "bg", 3]] as const) expect({ pair: `${a} on ${b}`, ok: ratio(P[a], P[b]) >= least }).toEqual({ pair: `${a} on ${b}`, ok: true });
    for (const k of ["fg3", "select", "ok", "warn", "err"] as const) for (const on of ["bg", "bg2"] as const)
      expect({ mark: `${k} on ${on}`, ok: ratio(P[k], P[on]) >= 3 }).toEqual({ mark: `${k} on ${on}`, ok: true });
    // The panels step up from the sea, darkest first.
    const L = (k: keyof typeof P) => oklchOf(rgbOf(P[k])).L;
    expect(L("bg") < L("bg2") && L("bg2") < L("bg3") && L("bg3") < L("bg4") && L("line") < L("line2")).toBe(true);
  });

  test("warn is the one warm yellow: amber, and no other colour of the theme comes near it", () => {
    const warn = oklchOf(rgbOf(P.warn));
    expect(warn.H).toBeGreaterThan(65);
    expect(warn.H).toBeLessThan(95);
    const others = [...PALETTE_KEYS.filter((k) => k !== "warn").map((k) => P[k]), theme.accent.brand, theme.accent.accent, theme.accent.working];
    for (const c of others) {
      const o = oklchOf(rgbOf(c));
      const warmYellow = o.C > 0.06 && o.H > 60 && o.H < 105;
      expect({ c, warmYellow }).toEqual({ c, warmYellow: false });
    }
  });

  test("its wood accent reads apart from warn, by eye and under deuteranopia and protanopia, and reads as words on bg and bg2; its brand takes white words", () => {
    const { brand, accent, working } = theme.accent as Record<string, string>;
    for (const c of [brand, accent]) {
      const near = Math.min(deltaE(rgbOf(c), rgbOf(P.warn)), ...(["deuteranopia", "protanopia"] as const).map((k) => deltaE(simulate(rgbOf(c), k), simulate(rgbOf(P.warn), k))));
      expect({ c, apart: near >= 20 }).toEqual({ c, apart: true });
      // Wood: a brown, low in chroma, well below warn's lightness.
      const o = oklchOf(rgbOf(c));
      expect(o.H > 30 && o.H < 60 && o.C < 0.1 && o.L < oklchOf(rgbOf(P.warn)).L - 0.15).toBe(true);
    }
    expect(ratio(accent, P.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(accent, P.bg2)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(brand, P.bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(WHITE, brand)).toBeGreaterThanOrEqual(4.5);
    // A working agent is not the brand: a pale sea colour, a mark on the panels.
    expect(ratio(working, P.bg2)).toBeGreaterThanOrEqual(3);
  });

  test("its terminal: every ANSI colour but black reads at 4.5:1 on its background, and its yellows are not warn's amber", () => {
    const t = theme.terminal;
    expect(ratio(t.foreground, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.cursor, t.background)).toBeGreaterThanOrEqual(3);
    t.ansi.forEach((c: string, i: number) => { if (i) expect({ i, c, reads: ratio(c, t.background) >= 4.5 }).toEqual({ i, c, reads: true }); });
    // The terminal sits on the theme's own sea.
    expect(deltaE(rgbOf(t.background), rgbOf(P.bg))).toBeLessThan(3);
    const warn = oklchOf(rgbOf(P.warn));
    for (const i of [3, 11]) {
      const y = oklchOf(rgbOf(t.ansi[i]));
      expect({ i, offHue: Math.abs(y.H - warn.H) >= 15, calmer: y.C <= warn.C * 0.7 }).toEqual({ i, offHue: true, calmer: true });
    }
  });

  test("its font is one woff2 of Nunito, under 400 KB, with its licence beside it", () => {
    const ui = theme.fonts.ui;
    expect(ui.family).toBe("Nunito");
    for (const f of ui.files) {
      const bytes = readFileSync(path.join(DIR, f.path));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(bytes.length).toBeLessThanOrEqual(MOST_BYTES);
    }
    expect(readFileSync(path.join(DIR, "fonts/OFL.txt"), "utf8")).toContain("SIL Open Font License, Version 1.1");
    expect(readFileSync(path.join(DIR, "ASSETS.md"), "utf8")).toContain("https://github.com/googlefonts/nunito");
  });

  test("its wallpaper is a WebP still sized for a desktop and kept small, dimmed into the range that keeps words over it readable", () => {
    const bytes = readFileSync(path.join(DIR, theme.wallpaper.image));
    expect([bytes.subarray(0, 4).toString("latin1"), bytes.subarray(8, 12).toString("latin1"), bytes.subarray(12, 16).toString("latin1")]).toEqual(["RIFF", "WEBP", "VP8 "]);
    // A lossy WebP's key frame: its start code, then 14-bit width and height.
    expect([...bytes.subarray(23, 26)]).toEqual([0x9d, 0x01, 0x2a]);
    expect({ width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }).toEqual({ width: 1920, height: 1080 });
    expect(bytes.length).toBeLessThan(400 * 1024);
    expect(theme.wallpaper.brightness).toBeGreaterThanOrEqual(0.4);
    expect(theme.wallpaper.brightness).toBeLessThanOrEqual(1.1);
  });

  /** An Ogg Vorbis file's length in seconds: its last page's granule position over the sample rate. */
  const oggSeconds = (bytes: Buffer) => {
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("OggS");
    // The first page holds the identification header: 0x01 "vorbis", version, channels, rate.
    const id = bytes.indexOf("\x01vorbis", 0, "latin1");
    const rate = bytes.readUInt32LE(id + 12);
    const last = bytes.lastIndexOf("OggS", undefined, "latin1");
    return Number(bytes.readBigUInt64LE(last + 6)) / rate;
  };

  test("its sounds are Ogg Vorbis, each under 400 KB and 3 s: a bell for done, the gulls for needs, a horn for error", () => {
    expect(Object.keys(theme.sounds).sort()).toEqual(["done", "error", "needs"]);
    const seconds: Record<string, number> = {};
    for (const [moment, rel] of Object.entries(theme.sounds as Record<string, string>)) {
      const bytes = readFileSync(path.join(DIR, rel));
      expect(path.extname(rel)).toBe(".ogg");
      expect(bytes.length).toBeLessThanOrEqual(MOST_BYTES);
      seconds[moment] = oggSeconds(bytes);
      expect(seconds[moment]).toBeGreaterThan(0.3);
      expect(seconds[moment]).toBeLessThanOrEqual(3);
    }
    // A call is short; the bell rings out longest.
    expect(seconds.needs! < seconds.error! && seconds.error! < seconds.done!).toBe(true);
  });

  // The script rendered again into a folder of its own (a copy of it, with its sounds next to it),
  // and `change` applied to its source first.
  const render = (change = (src: string) => src) => {
    const root = mkdtempSync(path.join(tmpdir(), "harbour-sounds-"));
    mkdirSync(path.join(root, "scripts"));
    const changed = change(readFileSync(SCRIPT, "utf8"));
    writeFileSync(path.join(root, "scripts", path.basename(SCRIPT)), changed);
    execFileSync("node", [path.join(root, "scripts", path.basename(SCRIPT))], { stdio: "pipe" });
    return { dir: path.join(root, "themes/harbour/sounds"), done: () => rmSync(root, { recursive: true, force: true }) };
  };
  /** A sound decoded to 16-bit mono samples. */
  const pcm = (file: string) => {
    const b = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-"], { maxBuffer: 64 << 20 });
    return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
  };
  /** How far one decoded sound is from another: the difference's RMS over the first's. */
  const apart = (a: Int16Array, b: Int16Array) => {
    if (a.length !== b.length) return Infinity;
    let d = 0, e = 0;
    for (let i = 0; i < a.length; i++) { d += (a[i]! - b[i]!) ** 2; e += a[i]! ** 2; }
    return Math.sqrt(d / e);
  };
  const ffmpeg = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const HAS_FFMPEG = ffmpeg.status === 0 && /libvorbis/.test(ffmpeg.stdout);
  const MADE_WITH = /made with ffmpeg `([^`]+)`/.exec(readFileSync(path.join(DIR, "ASSETS.md"), "utf8"))?.[1];
  const VERSION = HAS_FFMPEG ? /^ffmpeg version (\S+)/.exec(spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout)?.[1] : undefined;
  test.skipIf(!HAS_FFMPEG)(`the committed sounds are what make-harbour-sounds.mjs renders: the same bytes on ffmpeg ${MADE_WITH}, the same sound decoded on any other, and a bell a third lower is told apart${HAS_FFMPEG ? "" : " (skipped: no ffmpeg with libvorbis)"}`, () => {
    expect(MADE_WITH).toBeDefined();
    const fresh = render();
    // The bell's pitch, from D5 down to B4: the same length, another sound.
    let found = false;
    const lower = render((src) => src.replace("const f0 = 587;", () => { found = true; return "const f0 = 494;"; }));
    try {
      expect(found).toBe(true);
      for (const rel of Object.values(theme.sounds as Record<string, string>)) {
        const was = path.join(DIR, rel), now = path.join(fresh.dir, path.basename(rel));
        if (VERSION === MADE_WITH) expect({ rel, same: readFileSync(now).equals(readFileSync(was)) }).toEqual({ rel, same: true });
        expect({ rel, close: apart(pcm(was), pcm(now)) < 0.05 }).toEqual({ rel, close: true });
      }
      expect(apart(pcm(path.join(DIR, theme.sounds.done)), pcm(path.join(lower.dir, "done.ogg")))).toBeGreaterThan(0.5);
    } finally { fresh.done(); lower.done(); }
  }, 60_000);

  test("the package lists it as a theme member, and leaves the version it needs to HiveHub, which works it out from the list", () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8"));
    expect(pkg.themes).toEqual([{ path: "themes/harbour" }]);
    expect("minAppVersion" in pkg).toBe(false);
    // The theme's folder holds data only: the script that makes its sounds is outside it.
    expect(readdirSync(DIR, { recursive: true }).filter((f) => /\.(m?[jt]s|sh|py)$/.test(String(f)))).toEqual([]);
  });
});
