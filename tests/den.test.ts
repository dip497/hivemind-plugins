// Den, the package of the Den pup widget (whose behaviour tests/widgets.test.ts runs beside the
// other widgets'), the source of the Den game and the pup's model both are made from. Here: the app's
// package reader and HiveHub's check take the package, and only the widget installs.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";

const PKG = path.join(ROOT, "packages/den");

test("the app's package reader takes Den as @dip497/den, holding the Den pup widget alone, and offers no wallpaper on install", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "den" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup ?? null })
    .toEqual({ id: "@dip497/den", members: [["widget", "@dip497/den-pup", "Den pup"]], startup: null });
});

test("HiveHub lists Den, its widget sandboxed and asking for nothing, and installs the widget with a sheet for each pose, without the game or the pup's model; no file over 2 MB", async () => {
  const { checkPluginFolder } = await import(path.join(APP, "packages/hive-hub/src/plugin-checks.ts"));
  const { packageFiles, checkPackageManifest } = await import(path.join(APP, "packages/hive-hub/src/package-format.ts"));
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === "out" || e.name === "node_modules" || e.name === "three.module.js") continue;
      if (e.isDirectory()) walk(at);
      else files.push({ path: at, bytes: new Uint8Array(readFileSync(path.join(PKG, at))) });
    }
  };
  walk("");
  const c = await checkPluginFolder(files);
  expect("problem" in c ? c.problem : null).toBe(null);
  expect(c.plugin.members.map((m: { kind: string; id: string; runs: string; permissions: string[] }) => [m.kind, m.id, m.runs, m.permissions]))
    .toEqual([["widget", "@dip497/den-pup", "sandboxed", []]]);
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  // The package's own manifest and README, and the widget's folder: nothing of the game or the model.
  expect(installs.filter((f: string) => !f.startsWith("widgets/den-pup/"))).toEqual(["README.md", "hivemind-package.json"]);
  const POSES = ["walk", "sit", "sleep", "beg", "jump", "run", "shake", "roll", "spin", "carry", "ball"];
  for (const f of ["widget.json", "widget.js", "icon.png", ...POSES.map((p) => `pup-${p}.webp`)]) expect(installs).toContain(`widgets/den-pup/${f}`);
  for (const f of installs) expect({ f, small: statSync(path.join(PKG, f)).size <= 2 << 20 }).toEqual({ f, small: true });
});
