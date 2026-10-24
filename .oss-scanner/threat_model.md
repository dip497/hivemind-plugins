# Threat model: hivemind-plugins

Report vulnerabilities to Contact@griiken.com, or privately through
[Report a vulnerability](https://github.com/dip497/hivemind/security/advisories/new) on the app's
repository, naming the plugin. The app these plugins run in, and its sandboxes, is
[dip497/hivemind](https://github.com/dip497/hivemind), enrolled on its own with its own threat model
(`.oss-scanner/threat_model.md` there). A flaw in a sandbox belongs there; a flaw in a plugin's own
code belongs here.

## What this project does

This repository holds the plugins the Hivemind project publishes to HiveHub, its plugin registry
(`README.md`). HiveHub lists each one pinned to a commit with a SHA-256 for every file, and the
`publish` workflow (`.github/workflows/publish.yml`) publishes a changed folder when it lands on
`main`. People install them into the Hivemind desktop app. There are five kinds:

| Folder | What it is | Where its code runs (in the app) |
|---|---|---|
| `agents/<id>/agent.yaml` | A manifest describing an agent CLI the person installs themselves: its binary, flags, options, how its status is read from the terminal (`detect.rules`), its install hint | No code. The app reads the manifest declaratively (`packages/hive-agents/src/manifest.ts` in the app) and shows what it does before it installs |
| `widgets/<name>/widget.js` | A small box on the screen | A Web Worker with the app's widget prelude. It talks through `hive.*` / `hive.hm.*` messages and draws a tree of data nodes the app renders (`tests/widgets.test.ts` runs each one the same way) |
| `tools/<name>/index.js` | A kind of tile, drawn by its own React code | Inside the app, imported from `hm-plugin://host/…`. It may run commands through `host.run(cmd, args)` and drive the workspace through `hm.*` within the permissions its `hivemind-tool.json` asks for (`workspace:spawn`, `workspace:prompt`) |
| `views/<name>/` | A whole-canvas view (plain JS, or TypeScript built into `dist/`) | A sandboxed `hm-view:` page with its own origin and CSP, talking over one validated channel, within the permissions its `hivemind-view.json` asks for |
| `packages/<id>/` | A bundle: views plus agent presets (provider, prompt) and a startup plan | Inspected before anything runs; starting it is a separate, reviewed step |

`types/view-sdk/` is the SDK's types, for `tsc`. `tests/` loads each plugin through the app's own
loaders (`tests/app.ts` points at a checkout of dip497/hivemind). `e2e/` runs tools in the real app.

## Where untrusted input enters

A plugin here is trusted code once the person installs it. What it reads is not:

- **Workspace state from the app**: tile titles, agent names, issue titles, notes, terminal
  status text and events. Agents write much of this, and an agent's output is shaped by whatever
  it read (a repository, a web page, an issue), so treat every string as attacker-controlled.
- **Repository content read by tools**: branch and worktree names, file paths, commit messages,
  diff text, `package.json` and lock files, TODO comments, log files, SQLite files
  (`tools/git-history`, `tools/worktrees`, `tools/changelog-writer`, `tools/todo-finder`,
  `tools/dependency-audit`, `tools/log-tail`, `tools/sqlite-browser`, `tools/bundle-size`).
- **Network data read by tools**: GitHub pull requests and CI runs through `gh`
  (`tools/github-prs`, `tools/ci-runs`), advisories through `curl` (`tools/dependency-audit`), and
  the responses of whatever endpoint the person tries (`tools/api-explorer`).
- **Settings and options** the person types, and the arguments an agent passes to a plugin's
  command (`commands` in a manifest: an agent may call `hive widgets …` / `hive tools …` commands).

## What matters most

1. **Commands built from untrusted strings** in tools. Every `host.run` passes an argument list,
   never a shell line; a value that reaches a command's options (a path or branch name beginning
   with `-` passed to `git`, `find`, `tail`, `sqlite3`, `curl`, `gh`) or a shell (`python3 -c`, a
   script string) is in scope.
2. **HTML built from untrusted strings** in views that use `innerHTML`
   (`views/timeline`, `views/constellation`, `views/workspace-map`, `views/agents-by-state`,
   `views/island`) and in tools. A view's page is sandboxed, but script injected into it acts with
   that view's permissions: `views/agents-by-state` and `views/island` hold `workspace:prompt`
   (type into an agent) and `views/island` holds `workspace:spawn` (start one). A tool runs inside
   the app, so markup injected into one is worse.
3. **A plugin acting beyond what it says**: a tool that types a prompt or starts an agent the
   person did not see first (the worktrees tool shows its prompt before sending it), a view or
   widget using a permission its README does not mention, a widget posting messages the prelude
   does not expect.
4. **Agent manifests** whose `detect.rules` regexes can be driven into catastrophic backtracking
   by terminal output, whose `options[].list` command or `install.command` does more than its
   README says, or whose flags let terminal text or a model name reach an argument unquoted.
5. **The publish workflow**: anything that lets a pull request from a fork publish to HiveHub,
   change what is published, or read the OIDC token (`publish.yml` runs only on pushes to `main`
   and manual dispatch; `test.yml` runs on pull requests with `contents: read`).

## How to exercise it

The image built from `.oss-scanner/Dockerfile` has the plugins built and the app checked out at
`/src/.hivemind-app` with its core and view SDK installed:

```bash
cd /src
npm test              # bun test tests: every widget run in its worker scope, every tool's logic,
                      # every view's manifest and model, each through the app's own loaders
npm run typecheck
npm run build         # rebuilds views/<name>/dist from views/<name>/src
```

`tests/helpers/widget.ts` shows how to drive a widget with messages; `tests/tool-logic.test.ts`
imports a tool's `lib.js` directly. The Playwright e2e in `e2e/` needs a built desktop app and a
display, and is not set up in the image.

## How we rate severity

- **Critical**: a plugin here that runs a command or code the person never chose, from data
  alone (a branch name, an issue title, an agent's output, a GitHub PR) — command injection in a
  tool, script injection into a tool's tile; or a way for a fork's pull request to publish to
  HiveHub.
- **High**: injected script in a view that uses the view's `workspace:prompt` or
  `workspace:spawn` (it can type into or start agents); a tool or view prompting or starting an
  agent without showing it first; argument injection into `git`/`gh`/`curl` that writes, deletes
  or sends data.
- **Medium**: injection into a view without those permissions (it is still sandboxed: no
  network, no filesystem); argument injection that only reads; a manifest regex that hangs the
  status reader on crafted terminal output; a plugin that leaks a token or setting into a prompt,
  a notification or a log.
- **Low**: a widget or view that can be made to stop drawing or loop until the app's budget
  disables it for the session; wrong output with no security effect.

A report is most useful with the plugin's folder, the input that triggers it (a branch name, a
tile title, a JSON reply) and the line where it reaches the sink. A patch should keep the
plugin's behaviour and pass `npm test`.

## Out of scope

- **The app's sandboxes and loaders** (the `hm-view:` page, the widget worker and prelude, the
  tool loader, permission checks, HiveHub's checksums): report those against dip497/hivemind.
- **The agent CLIs** an agent manifest describes (claude, codex, gemini, pi, …): their own bugs go
  to their projects. What an agent does once the person started it is the product.
- **A tool doing what its manifest and README say** it does: a tool is trusted code the person
  chose to install and enable, and `host.run` is its stated power. A person who installs a
  malicious tool, or another publisher's plugin, is outside this repository.
- **HiveHub's server** (`hivehub.griiken.workers.dev`), GitHub and `gh` themselves.
- `node_modules`, the generated `views/*/dist/` (report against `views/*/src/`), the 3D models
  and sky images under `views/*/assets/`, and `types/`.
