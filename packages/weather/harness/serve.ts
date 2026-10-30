// The harness's server: its page and host (page.ts, on the SDK's fakeWallpaperHost), its timing page
// (perf.ts, the scenes from their sources), and each scene served as the app serves a package's live
// wallpaper: its folder through the app's own `serveViewFile`, the `.js` entry wrapped in the app's
// page with the SDK's import map, under the plugins' CSP, its own files open to its opaque origin as
// the app's `hm-view:` answers them. Nothing here is in the package: what installs is each
// wallpaper's folder. Needs the app checkout the tests read (tests/app.ts), and the build
// (`npm run build`).
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { core, ROOT } from "../../../tests/app";

export const WALLPAPERS = path.join(ROOT, "packages/weather/wallpapers");
export const SCENES = ["snow", "northern-lights"] as const;

const bundle = async (entry: string) =>
  (await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, logLevel: "silent", tsconfig: path.join(ROOT, "tsconfig.json") })).outputFiles[0]!.text;

/** Serve the harness on a free port: `/` the page, `/wp/<scene>/` that scene's folder. */
export async function serveScenes() {
  const { serveViewFile } = await core("view-files.ts");
  const [sdk, page, perf] = await Promise.all([bundle(path.join(ROOT, "types/view-sdk/index.ts")), bundle(path.join(import.meta.dir, "page.ts")), bundle(path.join(import.meta.dir, "perf.ts"))]);
  const html = readFileSync(path.join(import.meta.dir, "index.html"), "utf8");
  const perfHtml = readFileSync(path.join(import.meta.dir, "perf.html"), "utf8");
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (u.pathname === "/page.js") return new Response(page, { headers: { "content-type": "text/javascript" } });
      if (u.pathname === "/perf.html") return new Response(perfHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (u.pathname === "/perf.js") return new Response(perf, { headers: { "content-type": "text/javascript" } });
      const m = /^\/wp\/([a-z-]+)\/(.*)$/.exec(u.pathname);
      if (!m || !(SCENES as readonly string[]).includes(m[1]!)) return new Response(null, { status: 404 });
      const dir = path.join(WALLPAPERS, m[1]!);
      const { entry } = JSON.parse(readFileSync(path.join(dir, "hivemind-wallpaper.json"), "utf8")) as { entry: string };
      const own = { at: `${u.origin}/wp/${m[1]}/`, fetch: false };
      const file = await serveViewFile(dir, decodeURIComponent(m[2]!), { js: entry, sdk: async () => sdk, own });
      if (file.status !== 200) return new Response(null, { status: file.status });
      const headers = { "content-type": file.type, "content-security-policy": file.csp, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
      return new Response("text" in file ? file.text : Bun.file(file.file), { headers });
    },
  });
  return server;
}
