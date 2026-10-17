// Build every view into views/<name>/dist — the folder HiveHub lists.
import { build } from "esbuild";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";

for (const name of readdirSync("views")) {
  const src = `views/${name}/src`, dist = `views/${name}/dist`;
  rmSync(dist, { recursive: true, force: true });
  await build({
    entryPoints: [`${src}/main.ts`], outfile: `${dist}/${name}.js`,
    bundle: true, format: "esm", target: "es2022", minify: true, logLevel: "warning",
    // The app serves the SDK to every view.
    external: ["@hivemind/view-sdk"],
  });
  for (const f of readdirSync(src).filter((f) => /\.(html|css)$/.test(f))) cpSync(`${src}/${f}`, `${dist}/${f}`);
  cpSync(`views/${name}/hivemind-view.json`, `${dist}/hivemind-view.json`);
  // Shown on its HiveHub page and in the app before anyone installs it.
  if (existsSync(`views/${name}/README.md`)) cpSync(`views/${name}/README.md`, `${dist}/README.md`);
  console.log(`built ${dist}`);
}
