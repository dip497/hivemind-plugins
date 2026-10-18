// What an agent may ask of a tool through its commands, in the real app: SQLite browser opens only
// a database the tile lists, and API explorer sends a request it was not shown in the code only
// once the person says so in the tile.
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
const server = http.createServer((req, res) => { received.push(`${req.method} ${req.url}`); res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
let page: Page;

test.beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "app.py"), '@app.get("/items/{item_id}")\ndef item(item_id): ...\n@app.post("/items")\ndef add(): ...\n');
  fs.mkdirSync(path.join(repo, "data"));
  execFileSync("sqlite3", [path.join(repo, "data/app.db"), "CREATE TABLE orders (id INTEGER); INSERT INTO orders VALUES (1), (2);"]);
  // A database beside the repository, not in it.
  execFileSync("sqlite3", [path.join(root, "outside.db"), "CREATE TABLE secrets (v TEXT); INSERT INTO secrets VALUES ('do not read');"]);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: repo });
  for (const name of ["sqlite-browser", "api-explorer"]) {
    expect(hive("tools", "install", path.join(PLUGINS, "tools", name)).status).toBe(0);
    expect(hive("plugins", "enable", `tool:dip497/${name}`).status).toBe(0);
  }
  expect(hive("plugins", "set", "tool:dip497/api-explorer", "baseUrl", `http://127.0.0.1:${port}`).status).toBe(0);
  page = await s.launch();
});
test.afterAll(async () => {
  await s.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("SQLite browser answers an agent from a database the tile lists, and refuses any other path", async () => {
  expect(hive("ctl", "open-tool", "dip497/sqlite-browser/browser").status).toBe(0);
  await expect(page.locator('[data-tool-plugin="dip497/sqlite-browser"]')).toContainText("orders", { timeout: 20_000 });
  const query = (args: object) => hive("ctl", "plugin", "call", "dip497/sqlite-browser", "query", JSON.stringify(args));
  expect(query({ file: "data/app.db", sql: "SELECT COUNT(*) AS n FROM orders" }).data.result.result).toEqual([{ n: 2 }]);
  for (const file of ["../outside.db", path.join(root, "outside.db"), "-cmd"]) {
    const r = query({ file, sql: "SELECT * FROM secrets" });
    expect([file, r.status, JSON.stringify(r.data)]).toEqual([file, 1, expect.stringContaining("is not one of this repository's database files")]);
  }
});

test("API explorer sends an agent's GET to an endpoint in the code at once, and anything else only when the person sends it", async () => {
  expect(hive("ctl", "open-tool", "dip497/api-explorer/explorer").status).toBe(0);
  const tile = page.locator('[data-tool-plugin="dip497/api-explorer"]');
  await expect(tile).toContainText("/items/{item_id}", { timeout: 20_000 });
  const request = (args: object) => hiveLater("ctl", "plugin", "call", "dip497/api-explorer", "request", JSON.stringify(args));

  expect((await request({ method: "GET", path: "/items/1" })).data.result.status).toBe(200);
  expect(received).toEqual(["GET /items/1"]);

  // Refused in the tile: nothing reaches the server.
  const refused = request({ method: "DELETE", path: "/items/1" });
  const asking = tile.locator('[data-agent-request="DELETE /items/1"]');
  await expect(asking).toContainText("An agent asks to send");
  expect(received).toEqual(["GET /items/1"]);
  await asking.getByRole("button", { name: "Refuse" }).click();
  const r = await refused;
  expect([r.status, JSON.stringify(r.data)]).toEqual([1, expect.stringContaining("The person refused to send DELETE /items/1")]);
  expect(received).toEqual(["GET /items/1"]);

  // Sent from the tile: it goes, and the agent gets the answer.
  const sent = request({ method: "GET", path: "/admin" });
  await tile.locator('[data-agent-request="GET /admin"]').getByRole("button", { name: "Send it" }).click();
  expect((await sent).data.result.status).toBe(200);
  expect(received).toEqual(["GET /items/1", "GET /admin"]);
});
