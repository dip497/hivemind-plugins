// The Jira service (design jira-sync §3, §12): a long-lived Node child of the host, started with
// its drive grant. One drive connection per workspace it is given (`HIVE_WORKSPACES`), one
// Atlassian account for all of them. It answers its commands on every connection; a call that
// names `workspace` (its folder) goes to that workspace, else to the connection's own.
import path from "node:path";
import { Account, readOptions } from "./account.js";
import { DriveClient } from "./drive.js";
import { log } from "./log.js";
import { COMMANDS, Workspace, asCommandError, hostOver } from "./workspace.js";

const PLUGIN = "@dip497/jira";

async function main(): Promise<void> {
  const sock = process.env.HIVE_DRIVE_SOCK;
  const token = process.env.HIVE_DRIVE_TOKEN;
  const repos = (process.env.HIVE_WORKSPACES ?? "").split(path.delimiter).filter(Boolean);
  if (!sock || !token) throw new Error("HIVE_DRIVE_SOCK and HIVE_DRIVE_TOKEN are set by the host that starts this service");
  if (repos.length === 0) {
    log("no workspace to sync; waiting to be stopped");
    return;
  }

  const drives: DriveClient[] = [];
  for (const repo of repos) {
    const d = new DriveClient(sock, token);
    await d.connect(repo);
    drives.push(d);
  }
  const first = drives[0]!;
  let workspaces: Workspace[] = [];
  let secretsSet = JSON.stringify(((await first.call<{ secrets?: string[] }>("plugin.options")) ?? {}).secrets ?? []);
  const account = new Account({
    secrets: {
      get: (name) => first.call<string | null>("secret.get", name),
      set: async (name, value) => { await first.call("secret.set", `tool:${PLUGIN}`, name, value); },
    },
    options: readOptions(await first.call("plugin.options")),
    log,
    ...(process.env.HIVE_JIRA_MCP_URL ? { mcpUrl: process.env.HIVE_JIRA_MCP_URL } : {}),
    onSignedIn: () => { for (const w of workspaces) w.wake(); },
  });
  await account.init();
  first.on("options.changed", ([o]) => {
    const next = o as { values?: Record<string, unknown>; secrets?: string[] };
    account.setOptions(readOptions(next));
    const s = JSON.stringify(next.secrets ?? []);
    // The person cleared the sign-in in the settings (or set it): read it again.
    if (s !== secretsSet) { secretsSet = s; void account.secretsChanged().then(() => { for (const w of workspaces) w.wake(); }); }
  });

  workspaces = repos.map((repo, i) => new Workspace({ repo, account, host: hostOver(drives[i]!, path.join(repo, ".hivemind")), log }));
  drives.forEach((d, i) => {
    d.notice("plugin.serve", COMMANDS.map((c) => ({ name: c.name, description: c.description, ...(c.args ? { args: c.args } : {}) })));
    d.on("plugin.called", ([p]) => {
      const { call, command, args } = (p ?? {}) as { call: number; command: string; args: unknown };
      const named = args && typeof args === "object" ? (args as { workspace?: unknown }).workspace : undefined;
      const w = typeof named === "string" ? workspaces.find((x) => path.resolve(x.repo) === path.resolve(named)) : workspaces[i];
      const answer = w ? w.handle(command, args) : Promise.reject(asCommandError(new Error(`${String(named)} is not a workspace this service syncs`)));
      answer.then(
        (result) => d.notice("plugin.answer", call, { result: result ?? null }),
        (e: unknown) => {
          const err = asCommandError(e);
          d.notice("plugin.answer", call, { error: { code: err.code, message: err.message } });
        },
      );
    });
  });
  for (const w of workspaces) await w.start();
  log(`serving ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}${account.signedIn ? "" : `; ${account.problem()}`}`);

  const stop = async () => {
    for (const w of workspaces) w.stop();
    await account.close();
    for (const d of drives) d.close();
    process.exit(0);
  };
  process.stdin.on("end", () => void stop()).resume();
  process.on("SIGTERM", () => void stop());
  // The host going away closes the connection: nothing left to serve.
  void Promise.race(drives.map((d) => d.closed)).then(() => void stop());
}

main().catch((e: unknown) => {
  log("the Jira service stopped", e);
  process.exit(1);
});
