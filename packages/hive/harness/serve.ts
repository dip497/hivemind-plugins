// The harness's server: its page and host (page.ts, on the SDK's fakeWallpaperHost), and Bees served
// as the app serves a package's live wallpaper: its folder through the app's own `serveViewFile`, the
// `.js` entry wrapped in the app's page with the SDK's import map, under the plugins' CSP. Nothing
// here is in the package: what installs is wallpapers/bees alone. Needs the app checkout the tests
// read (tests/app.ts), and the build (`npm run build`).
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { core, ROOT } from "../../../tests/app";

export const BEES = path.join(ROOT, "packages/hive/wallpapers/bees");

const bundle = async (entry: string) =>
  (await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, logLevel: "silent", tsconfig: path.join(ROOT, "tsconfig.json") })).outputFiles[0]!.text;

/** Serve the harness on a free port: `/` the page, `/wp/` the wallpaper's folder. */
export async function serveBees() {
  const { serveViewFile } = await core("view-files.ts");
  const { entry } = JSON.parse(readFileSync(path.join(BEES, "hivemind-wallpaper.json"), "utf8")) as { entry: string };
  const [sdk, page] = await Promise.all([bundle(path.join(ROOT, "types/view-sdk/index.ts")), bundle(path.join(import.meta.dir, "page.ts"))]);
  const html = readFileSync(path.join(import.meta.dir, "index.html"), "utf8");
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (u.pathname === "/page.js") return new Response(page, { headers: { "content-type": "text/javascript" } });
      if (!u.pathname.startsWith("/wp/")) return new Response(null, { status: 404 });
      const file = await serveViewFile(BEES, decodeURIComponent(u.pathname.slice(4)), { js: entry, sdk: async () => sdk });
      if (file.status !== 200) return new Response(null, { status: file.status });
      return new Response("text" in file ? file.text : Bun.file(file.file), { headers: { "content-type": file.type, "content-security-policy": file.csp } });
    },
  });
}
