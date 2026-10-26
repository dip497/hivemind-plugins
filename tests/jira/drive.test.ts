// The service's drive client hears every event the host sends, also when the host batches the
// events of one moment into one frame (a JSON list on one line). It once read only single objects,
// so a `plugin.called` batched with the `options.changed` a `secret.set` causes was dropped and the
// tile's call hung (the token sign-in's first status after it).
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DriveClient } from "../../tools/jira/src/service/drive.ts";

const servers: net.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

/** A drive that welcomes the hello, then sends `frames`, each a line. */
async function drive(frames: unknown[]): Promise<string> {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jira-drive-")), "d.sock");
  const server = net.createServer((c) => {
    c.setEncoding("utf8");
    c.once("data", () => {
      c.write(JSON.stringify({ hello: { api: "0.35", as: { workspace: "/w" } } }) + "\n");
      for (const f of frames) c.write(JSON.stringify(f) + "\n");
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(sock, r));
  return sock;
}

test("events batched into one frame are each heard, like single ones", async () => {
  const sock = await drive([
    [{ event: "options.changed", params: [{ site: "acme" }] }, { event: "plugin.called", params: [{ call: 5, command: "status" }] }],
    { event: "plugin.called", params: [{ call: 6, command: "sync-now" }] },
  ]);
  const d = new DriveClient(sock, "t");
  const heard: string[] = [];
  d.on("options.changed", () => heard.push("options.changed"));
  d.on("plugin.called", ([p]) => heard.push(`called ${(p as { call: number }).call}`));
  await d.connect();
  for (let i = 0; i < 50 && heard.length < 3; i++) await new Promise((r) => setTimeout(r, 10));
  expect(heard).toEqual(["options.changed", "called 5", "called 6"]);
  d.close?.();
});
