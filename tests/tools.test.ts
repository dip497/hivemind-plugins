// Every tool plugin here, read by the app's own loader: what HiveHub lists is what the app installs.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, core } from "./app";

const { readToolPackage } = await core("tool-packages.ts");
const { createToolRegistry } = await core("tool-registry.ts");
const { BUNDLED_TOOL_PLUGINS } = await core("tool-plugins.ts");

test("every tool here loads in the app under its folder's name, with a version, the app it needs and an icon, beside the app's own tools", async () => {
  const dir = path.join(ROOT, "tools");
  for (const name of readdirSync(dir)) {
    const p = await readToolPackage(path.join(dir, name), null);
    const icons = Object.values(p.tiles as Record<string, { icon?: string }>).map((t) => t.icon?.startsWith("data:image/svg+xml"));
    expect([p.id, p.problem, !!p.version, !!p.minAppVersion, icons.length > 0 && icons.every(Boolean)]).toEqual([`dip497/${name}`, null, true, true, true]);
    expect(() => createToolRegistry([...BUNDLED_TOOL_PLUGINS, p])).not.toThrow();
  }
});
