// What an agent may ask of a tool through its commands, in the real app: SQLite browser opens only
// a database the tile lists, never through a symbolic link, and API explorer sends nothing an agent
// asks for until the person sends it from the tile, to exactly the address it showed.
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { PLUGINS, session } from "./app";

const s = session("agent-requests");
const { root, repo, hive, hiveLater } = s;
const received: string[] = [];
const elsewhere: string[] = [];
const server = (log: string[]) => http.createServer((req, res) => { log.push(`${req.method} ${req.url}`); res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
const api = server(received);
const other = server(elsewhere);
const portOf = (srv: http.Server) => (srv.address() as AddressInfo).port;
let page: Page;

test.beforeAll(async () => {
  for (const srv of [api, other]) await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "app.py"), '@app.get("/items/{item_id}")\ndef item(item_id): ...\n@app.post("/items")\ndef add(): ...\n');
  fs.mkdirSync(path.join(repo, "data"));
  for (const name of ["app.db", "swap.db"]) execFileSync("sqlite3", [path.join(repo, "data", name), "CREATE TABLE orders (id INTEGER); INSERT INTO orders VALUES (1), (2);"]);
  fs.mkdirSync(path.join(repo, "more"));
  execFileSync("sqlite3", [path.join(repo, "more", "x.db"), "CREATE TABLE orders (id INTEGER);"]);
  // A database beside the repository, not in it, and a link to it inside.
  execFileSync("sqlite3", [path.join(root, "outside.db"), "CREATE TABLE secrets (v TEXT); INSERT INTO secrets VALUES ('do not read');"]);
  fs.symlinkSync(path.join(root, "outside.db"), path.join(repo, "data", "link.db"));
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: repo });
  for (const name of ["sqlite-browser", "api-explorer"]) {
    expect(hive("plugins", "install", path.join(PLUGINS, "tools", name)).status).toBe(0);
    expect(hive("plugins", "enable", `tool:@dip497/${name}`).status).toBe(0);
  }
  expect(hive("plugins", "set", "tool:@dip497/api-explorer", "baseUrl", `http://127.0.0.1:${portOf(api)}`).status).toBe(0);
  page = await s.launch();
});
test.afterAll(async () => {
  await s.close();
  api.close();
  other.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("SQLite browser answers an agent from a database the tile lists, and refuses any other path or a link", async () => {
  expect(hive("ctl", "open-tool", "@dip497/sqlite-browser/browser").status).toBe(0);
  const tile = page.locator('[data-tool-plugin="@dip497/sqlite-browser"]');
  await expect(tile).toContainText("orders", { timeout: 20_000 });
  // The link is not listed.
  await expect(tile.locator('select[aria-label="Database file"] option')).toHaveText(["data/app.db", "data/swap.db", "more/x.db"]);
  const query = (args: object) => hive("ctl", "plugin", "call", "@dip497/sqlite-browser", "query", JSON.stringify(args));
  expect(query({ file: "data/app.db", sql: "SELECT COUNT(*) AS n FROM orders" }).data.result.result).toEqual([{ n: 2 }]);
  for (const file of ["../outside.db", path.join(root, "outside.db"), "-cmd", "data/link.db"]) {
    const r = query({ file, sql: "SELECT * FROM secrets" });
    expect([file, r.status, JSON.stringify(r.data)]).toEqual([file, 1, expect.stringContaining("is not one of this repository's database files")]);
  }
  // A listed file, or a folder on its way, swapped for a link after it was listed is not opened through it.
  fs.rmSync(path.join(repo, "data", "swap.db"));
  fs.symlinkSync(path.join(root, "outside.db"), path.join(repo, "data", "swap.db"));
  const outsideFolder = path.join(root, "outside-folder");
  fs.mkdirSync(outsideFolder);
  fs.copyFileSync(path.join(root, "outside.db"), path.join(outsideFolder, "x.db"));
  fs.rmSync(path.join(repo, "more"), { recursive: true });
  fs.symlinkSync(outsideFolder, path.join(repo, "more"));
  for (const file of ["data/swap.db", "more/x.db"]) {
    const swapped = query({ file, sql: "SELECT * FROM secrets" });
    expect([file, swapped.status, JSON.stringify(swapped.data)]).toEqual([file, 1, expect.stringContaining("is no longer a database file in this repository")]);
  }
});

test("API explorer sends nothing an agent asks for until the person sends it, and then to the address it showed", async () => {
  expect(hive("ctl", "open-tool", "@dip497/api-explorer/explorer").status).toBe(0);
  const tile = page.locator('[data-tool-plugin="@dip497/api-explorer"]');
  await expect(tile).toContainText("/items/{item_id}", { timeout: 20_000 });
  const base = `http://127.0.0.1:${portOf(api)}`;
  const request = (args: object) => hiveLater("ctl", "plugin", "call", "@dip497/api-explorer", "request", JSON.stringify(args));

  // Even a GET to an endpoint in the code waits for the person.
  const get = request({ method: "GET", path: "/items/1" });
  const asking = tile.locator(`[data-agent-request="GET ${base}/items/1"]`);
  await expect(asking).toContainText(`GET ${base}/items/1`);
  expect(received).toEqual([]);
  await asking.getByRole("button", { name: "Refuse" }).click();
  const r = await get;
  expect([r.status, JSON.stringify(r.data)]).toEqual([1, expect.stringContaining(`The person refused to send GET ${base}/items/1`)]);
  expect(received).toEqual([]);

  // Sent from the tile: it goes to the address shown, even when the base changed meanwhile.
  const post = request({ method: "POST", path: "/items", body: { name: "lamp" } });
  const shown = tile.locator(`[data-agent-request="POST ${base}/items"]`);
  await expect(shown).toBeVisible();
  expect(hive("plugins", "set", "tool:@dip497/api-explorer", "baseUrl", `http://127.0.0.1:${portOf(other)}`).status).toBe(0);
  await expect(tile).toContainText(`http://127.0.0.1:${portOf(other)}`);
  await shown.getByRole("button", { name: "Send it" }).click();
  expect((await post).data.result.status).toBe(200);
  expect([received, elsewhere]).toEqual([["POST /items"], []]);
});
