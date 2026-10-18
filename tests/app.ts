// The Hivemind these plugins are tested against: a checkout of dip497/hivemind with its packages
// installed (`pnpm install`), whose own loaders read each plugin and whose widget prelude runs
// each widget, so a plugin passes here only if that app would take it.
import { existsSync } from "node:fs";
import path from "node:path";

export const APP = path.resolve(process.env.HIVEMIND_APP ?? path.join(import.meta.dir, "../.hivemind-app"));
if (!existsSync(path.join(APP, "packages/hive-core/node_modules"))) {
  throw new Error(`No installed Hivemind checkout at ${APP}. Clone dip497/hivemind there and run pnpm install, or set HIVEMIND_APP to one.`);
}

/** A module of the app's core, e.g. `core("widgets.ts")`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const core = (file: string): Promise<any> => import(path.join(APP, "packages/hive-core/src", file));
/** A module of the SDK the app serves to views, e.g. `viewSdk("manifest.ts")`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const viewSdk = (file: string): Promise<any> => import(path.join(APP, "packages/hive-view-sdk/src", file));

export const ROOT = path.resolve(import.meta.dir, "..");
