// Build every view written in TypeScript into views/<name>/dist — the folder HiveHub lists. A view
// written as plain JavaScript (no src/) is its own folder, listed as it is. A package's live
// wallpapers are built after the views, below.
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

// A view of its own, or one a package holds (packages/<package>/views/<name>).
const roots = [
  ...readdirSync("views").map((name) => ({ name, dir: `views/${name}` })),
  ...readdirSync("packages").flatMap((p) => existsSync(`packages/${p}/views`) ? readdirSync(`packages/${p}/views`).map((name) => ({ name, dir: `packages/${p}/views/${name}` })) : []),
];
for (const { name, dir } of roots) {
  const src = `${dir}/src`, dist = `${dir}/dist`;
  if (!existsSync(`${src}/main.ts`)) continue;
  rmSync(dist, { recursive: true, force: true });
  await build({
    entryPoints: [`${src}/main.ts`], outfile: `${dist}/${name}.js`,
    bundle: true, format: "esm", target: "es2022", minify: true, logLevel: "warning",
    // A view written with React (Focus) takes the production build and the automatic JSX runtime.
    jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    // The app serves the SDK to every view; a view's packed assets load after it connects.
    external: ["@hivemind/view-sdk", `./${name}-assets.js`],
  });
  // A view may read only scripts from its package, not files (its page has no network), so its
  // models and skies ship as a script of their own, loaded once it is running.
  // Its models and skies: its own assets/, or another view's that assets.from names (a package may
  // hold no symlink, and what ships is dist/ alone).
  const assets = existsSync(`${dir}/assets.from`) ? `${dir}/${readFileSync(`${dir}/assets.from`, "utf8").trim()}` : `${dir}/assets`;
  if (existsSync(assets)) {
    const files = readdirSync(assets).filter((f) => /\.(glb|hdr)$/.test(f)).sort();
    const key = (f) => f.replace(/\.\w+$/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
    // One script per file: HiveHub takes no file over 2 MB.
    for (const f of files) {
      const body = `export const ${key(f)} = "${readFileSync(`${assets}/${f}`).toString("base64")}";\n`;
      if (body.length > 2 << 20) throw new Error(`${assets}/${f} packs to more than 2 MB; HiveHub refuses it`);
      writeFileSync(`${dist}/${name}-${key(f)}.js`, body);
    }
    writeFileSync(`${dist}/${name}-assets.js`, files.map((f) => `export { ${key(f)} } from "./${name}-${key(f)}.js";`).join("\n") + "\n");
  }
  for (const f of readdirSync(src).filter((f) => /\.(html|css)$/.test(f))) {
    // A stylesheet written with Tailwind is built into plain CSS; any other is copied.
    if (f.endsWith(".css") && readFileSync(`${src}/${f}`, "utf8").includes('@import "tailwindcss"')) {
      execFileSync(process.execPath, ["node_modules/@tailwindcss/cli/dist/index.mjs", "-i", `${src}/${f}`, "-o", `${dist}/${f}`, "--minify"], { stdio: ["ignore", "ignore", "pipe"] });
    } else cpSync(`${src}/${f}`, `${dist}/${f}`);
  }
  cpSync(`${dir}/hivemind-view.json`, `${dist}/hivemind-view.json`);
  // Shown on its HiveHub page and in the app before anyone installs it, with its icon.
  for (const doc of ["README.md", "ASSETS.md", "icon.svg"]) if (existsSync(`${dir}/${doc}`)) cpSync(`${dir}/${doc}`, `${dist}/${doc}`);
  console.log(`built ${dist}`);
}

// A live wallpaper a package holds (packages/<package>/wallpapers/<name>) is built from its
// TypeScript beside the package's members, packages/<package>/src/<name>/main.ts, into the entry its
// hivemind-wallpaper.json names: what installs is the wallpaper's folder, without its sources.
for (const p of readdirSync("packages")) {
  if (!existsSync(`packages/${p}/wallpapers`)) continue;
  for (const name of readdirSync(`packages/${p}/wallpapers`)) {
    const dir = `packages/${p}/wallpapers/${name}`, src = `packages/${p}/src/${name}/main.ts`;
    if (!existsSync(src) || !existsSync(`${dir}/hivemind-wallpaper.json`)) continue;
    const { entry } = JSON.parse(readFileSync(`${dir}/hivemind-wallpaper.json`, "utf8"));
    if (!/^[\w-]+(\/[\w.-]+)*\.m?js$/.test(entry)) throw new Error(`${dir}: its entry is built from ${src}, so it is a .js file in its folder, not ${entry}`);
    // Its build folder emptied first (dist/ of dist/main.js), so nothing stale ships.
    if (entry.includes("/")) rmSync(`${dir}/${entry.slice(0, entry.lastIndexOf("/"))}`, { recursive: true, force: true });
    await build({
      entryPoints: [src], outfile: `${dir}/${entry}`,
      bundle: true, format: "esm", target: "es2022", minify: true, logLevel: "warning",
      // The app serves the SDK to every wallpaper, as to every view.
      external: ["@hivemind/view-sdk"],
    });
    console.log(`built ${dir}/${entry}`);
  }
}
