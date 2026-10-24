// Build every view written in TypeScript into views/<name>/dist — the folder HiveHub lists. A view
// written as plain JavaScript (no src/) is its own folder, listed as it is. A tool with a service in
// TypeScript (tools/<name>/src/service/main.ts) is bundled into tools/<name>/service.mjs.
import { build } from "esbuild";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";

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
  for (const f of readdirSync(src).filter((f) => /\.(html|css)$/.test(f))) cpSync(`${src}/${f}`, `${dist}/${f}`);
  cpSync(`${dir}/hivemind-view.json`, `${dist}/hivemind-view.json`);
  // Shown on its HiveHub page and in the app before anyone installs it, with its icon.
  for (const doc of ["README.md", "ASSETS.md", "icon.svg"]) if (existsSync(`${dir}/${doc}`)) cpSync(`${dir}/${doc}`, `${dist}/${doc}`);
  console.log(`built ${dist}`);
}

// A tool's service: one file with its dependencies inlined, since HiveHub installs only the listed
// files (no npm install) and takes none over 20 MB (design jira-sync §12.7). It runs on node >= 20,
// or the host's own runtime.
for (const name of readdirSync("tools")) {
  const entry = `tools/${name}/src/service/main.ts`;
  if (!existsSync(entry)) continue;
  const outfile = `tools/${name}/service.mjs`;
  await build({
    entryPoints: [entry], outfile,
    bundle: true, platform: "node", format: "esm", target: "node20", minify: true, legalComments: "eof", logLevel: "warning",
    // Bundled CommonJS dependencies still `require` node's own modules.
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  });
  const size = statSync(outfile).size;
  if (size > 20 << 20) throw new Error(`${outfile} is ${size} bytes; HiveHub takes no file over 20 MB`);
  console.log(`built ${outfile} (${Math.round(size / 1024)} KB)`);
}
