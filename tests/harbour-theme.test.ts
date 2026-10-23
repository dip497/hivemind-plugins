// Harbour, Archipelago's theme: its theme.json read field by field against the app's table
// (docs/plans/sounds-and-themes.md, T2), its colours measured, and its files opened. The checker is
// local (theme-format.ts, here), mirroring the app's `packages/hive-core/src/theme-format.ts` until
// the view SDK carries a copy; then this test should take the app's, as the other tests do.
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MOST_BYTES, PALETTE_KEYS, REQUIRED_PAIRS, checkTheme, contrast, deltaE, oklchOf, rgbOf, simulate, type RGB } from "./theme-format";

const PKG = path.resolve(import.meta.dir, "../packages/archipelago");
const DIR = path.join(PKG, "themes/harbour");
const theme = JSON.parse(readFileSync(path.join(DIR, "theme.json"), "utf8"));
const P = theme.palette as Record<(typeof PALETTE_KEYS)[number], string>;
const WHITE: RGB = [1, 1, 1];
const ratio = (a: string | RGB, b: string | RGB) => contrast(typeof a === "string" ? rgbOf(a) : a, typeof b === "string" ? rgbOf(b) : b);

describe("the local checker", () => {
  // A copy of Harbour, changed one field at a time, so the checker is seen to refuse what the app does.
  const broken = (change: (t: any) => void) => {
    const dir = mkdtempSync(path.join(tmpdir(), "harbour-"));
    try {
      cpSync(DIR, dir, { recursive: true });
      const t = structuredClone(theme);
      change(t);
      writeFileSync(path.join(dir, "theme.json"), JSON.stringify(t));
      return checkTheme(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  test("refuses each field out of the table, naming it", () => {
    expect(broken((t) => { t.format = 2; })).toEqual(["format: must be 1"]);
    expect(broken((t) => { delete t.palette.line2; })).toEqual(["palette.line2: a colour"]);
    expect(broken((t) => { t.palette.fg = t.palette.fg3; t.palette.fg2 = t.palette.bg4; })[0]).toMatch(/^palette: fg on bg2 is .* under 4.5:1|^palette: fg2 on bg/);
    expect(broken((t) => { t.accent = "teak"; })).toEqual(['accent: no accent "teak"']);
    expect(broken((t) => { t.terminal.ansi.pop(); })).toEqual(["terminal.ansi: 16 colours"]);
    expect(broken((t) => { t.radius = 30; })).toEqual(["radius: 0 to 24"]);
    expect(broken((t) => { t.fonts.ui.files[0].path = "fonts/OFL.txt"; })).toEqual(["fonts.ui.files[0].path: fonts/OFL.txt is not .woff2"]);
    expect(broken((t) => { t.wallpaper.brightness = 1.3; })).toEqual(["wallpaper.brightness: 0.4 to 1.1"]);
    expect(broken((t) => { t.sounds.done = "../theme.json"; })).toEqual(["sounds.done: ../theme.json is outside the theme's folder"]);
    expect(broken((t) => { t.sounds.ring = "sounds/done.ogg"; })).toEqual(["sounds.ring: not a moment"]);
    expect(broken((t) => { t.glass = true; })).toEqual(["glass: not a theme field"]);
  });
});

describe("Harbour", () => {
  test("its theme.json is what the app's table takes: format 1, a dark theme named Harbour, every field present and in range", () => {
    expect(checkTheme(DIR)).toEqual([]);
    expect({ format: theme.format, name: theme.name, mode: theme.mode }).toEqual({ format: 1, name: "Harbour", mode: "dark" });
    expect(Object.keys(P).sort()).toEqual([...PALETTE_KEYS].sort());
    // The sea's blues, written as the presets are, in oklch().
    for (const k of PALETTE_KEYS) expect(P[k]).toMatch(/^oklch\(/);
    expect(Object.keys(theme).sort()).toEqual(["accent", "fonts", "format", "mode", "name", "palette", "radius", "sounds", "terminal", "wallpaper"]);
  });

  test("its words read: fg on bg and bg2 at 4.5:1, fg2 on bg at 3:1 (the pairs the app refuses below), and fg3, select and every status at 3:1 on bg as marks", () => {
    for (const [a, b, least] of REQUIRED_PAIRS) expect({ pair: `${a} on ${b}`, ok: ratio(P[a], P[b]) >= least }).toEqual({ pair: `${a} on ${b}`, ok: true });
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

  const ffmpeg = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  test.skipIf(ffmpeg.status !== 0 || !/libvorbis/.test(ffmpeg.stdout))("make-sounds.mjs renders the committed sounds again: the same length, the same size near enough, the same bytes on the same ffmpeg (skipped without ffmpeg and libvorbis)", () => {
    const out = mkdtempSync(path.join(tmpdir(), "harbour-sounds-"));
    try {
      execFileSync("node", [path.join(DIR, "make-sounds.mjs")], { env: { ...process.env, HARBOUR_SOUNDS_OUT: out }, stdio: "pipe" });
      for (const rel of Object.values(theme.sounds as Record<string, string>)) {
        const was = readFileSync(path.join(DIR, rel)), now = readFileSync(path.join(out, path.basename(rel)));
        expect(oggSeconds(now)).toBeCloseTo(oggSeconds(was), 3);
        expect(Math.abs(now.length - was.length) / was.length).toBeLessThan(0.1);
        // Two renders here are byte for byte the same.
        execFileSync("node", [path.join(DIR, "make-sounds.mjs")], { env: { ...process.env, HARBOUR_SOUNDS_OUT: out }, stdio: "pipe" });
        expect(readFileSync(path.join(out, path.basename(rel))).equals(now)).toBe(true);
      }
    } finally { rmSync(out, { recursive: true, force: true }); }
  }, 60_000);

  test("the package lists it as a theme member and needs the release that first takes themes", () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8"));
    expect(pkg.themes).toEqual([{ path: "themes/harbour" }]);
    expect(pkg.minAppVersion).toBe("2026.10.6");
    expect(statSync(path.join(PKG, "themes/harbour/theme.json")).isFile()).toBe(true);
  });
});
