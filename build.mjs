// Build every view written in TypeScript into views/<name>/dist — the folder HiveHub lists. A view
// written as plain JavaScript (no src/) is its own folder, listed as it is.
import { build } from "esbuild";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

for (const name of readdirSync("views")) {
  const src = `views/${name}/src`, dist = `views/${name}/dist`;
  if (!existsSync(`${src}/main.ts`)) continue;
  rmSync(dist, { recursive: true, force: true });
  await build({
    entryPoints: [`${src}/main.ts`], outfile: `${dist}/${name}.js`,
    bundle: true, format: "esm", target: "es2022", minify: true, logLevel: "warning",
    // The app serves the SDK to every view; a view's packed assets load after it connects.
    external: ["@hivemind/view-sdk", `./${name}-assets.js`],
  });
  // A view may read only scripts from its package, not files (its page has no network), so its
  // models and skies ship as a script of their own, loaded once it is running.
  const assets = `views/${name}/assets`;
  if (existsSync(assets)) {
    const files = readdirSync(assets).filter((f) => /\.(glb|hdr)$/.test(f)).sort();
    const key = (f) => f.replace(/\.\w+$/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
    // One script per file: HiveHub takes no file over 2 MB.
    for (const f of files) {
      const body = `export const ${key(f)} = "${readFileSync(`${assets}/${f}`).toString("base64")}";\n`;
      if (body.length > 2 << 20) throw new Error(`views/${name}/assets/${f} packs to more than 2 MB; HiveHub refuses it`);
      writeFileSync(`${dist}/${name}-${key(f)}.js`, body);
    }
    writeFileSync(`${dist}/${name}-assets.js`, files.map((f) => `export { ${key(f)} } from "./${name}-${key(f)}.js";`).join("\n") + "\n");
  }
  for (const f of readdirSync(src).filter((f) => /\.(html|css)$/.test(f))) cpSync(`${src}/${f}`, `${dist}/${f}`);
  cpSync(`views/${name}/hivemind-view.json`, `${dist}/hivemind-view.json`);
  // Shown on its HiveHub page and in the app before anyone installs it.
  for (const doc of ["README.md", "ASSETS.md"]) if (existsSync(`views/${name}/${doc}`)) cpSync(`views/${name}/${doc}`, `${dist}/${doc}`);
  console.log(`built ${dist}`);
}
