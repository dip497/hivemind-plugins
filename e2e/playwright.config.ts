// The tool plugins here, loaded into a real Hivemind: HIVEMIND_APP is a checkout of dip497/hivemind
// whose desktop app is built (`pnpm exec electron-vite build` in apps/desktop). Run headless, on a
// display of its own: `xvfb-run -n 91 npm run e2e`.
import { defineConfig } from "@playwright/test";

// Windows go to the X display xvfb-run gives, never a Wayland desktop, and nothing reaches the
// person's session bus or the app they are running.
delete process.env.WAYLAND_DISPLAY;
delete process.env.DBUS_SESSION_BUS_ADDRESS;
if (process.platform === "linux") process.env.XDG_SESSION_TYPE = "x11";
for (const name of ["HCP_TOKEN", "HIVE_HCP_SOCK", "HIVE_DRIVE_SOCK", "HIVEMIND_TILE", "HIVEMIND_APP_DATA", "ELECTRON_RUN_AS_NODE"]) delete process.env[name];
// No terminal daemon outlives a run, and no catalog is fetched.
process.env.HIVEMIND_PTY_DAEMON = "0";
process.env.HIVEMIND_PLUGIN_INDEX = "file:///hivemind-e2e-unreachable/index.json";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
