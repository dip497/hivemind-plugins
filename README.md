# Hivemind plugins

Every agent Hivemind can add, and the widgets, tools and views the project publishes. They are
listed on [HiveHub](https://hivehub.griiken.workers.dev) with a SHA-256 for every file and the
listing pinned to a commit.

**Agents live here, and only here.** An agent stands for one CLI, so its id is one name
(`gemini`), and two publishers' `gemini` could only disagree. HiveHub lists an agent only from
this repository. **To add or fix one, open a pull request.**

**Widgets, tools and views are anyone's.** A widget's or a view's id is `@your-login/name`, a
tool's `your-login/name`, and you publish it from your own repository. The ones here are the
project's, under `@dip497/…` and `dip497/…`.

```
agents/<id>/agent.yaml        an agent: a manifest describing a CLI you install yourself
agents/<id>/README.md         what it is, what it needs and what it can do: shown on HiveHub and in the app
widgets/<name>/widget.json    a widget: a box on the screen, drawn by its widget.js
tools/<name>/hivemind-tool.json   a tool: a kind of tile, drawn by its own code inside the app
views/<name>/hivemind-view.json   a view written as plain JavaScript, listed from its folder
views/<name>/src/             a view written in TypeScript; views/<name>/dist/ is what is published
packages/<id>/                a bundle: views plus agent presets, inspected before anything runs
types/view-sdk/               the SDK the app serves to views, for tsc
tests/                        each widget, tool and view read and run by the app's own code
e2e/                          tools loaded into the real app
```

Every widget, tool and view says in its README what it does and which permissions it asks for.

## What ships in the app, and what lives here

Seven agents ship **inside** Hivemind — claude, codex, cursor, droid, kiro, openclaw and pi —
so a fresh install with no network can still run one. Everything here is something you add.

## Installing one

From HiveHub, or in the app from **Settings ▸ Plugins**:

```bash
hive widgets install @dip497/dog
hive tools install dip497/worktrees
hive views install @dip497/constellation
```

To try a folder directly:

```bash
hive agents install agents/<id>
hive widgets install widgets/<name>
hive tools install tools/<name>
npm install && npm run build
hive views install views/<name>          # views/<name>/dist for one written in TypeScript
```

## Tests

Each plugin is checked by the app itself: the tests load a checkout of
[dip497/hivemind](https://github.com/dip497/hivemind) and use its loaders and its widget prelude,
so a plugin passes only if that app takes it.

```bash
git clone https://github.com/dip497/hivemind .hivemind-app
(cd .hivemind-app && pnpm install --filter "@hivemind/core..." --filter "@hivemind/view-sdk...")
npm test                                  # or HIVEMIND_APP=<another checkout> npm test
```

CI runs them on every pull request against the app's latest release and its main branch.

The tools are also tested inside the real app (`e2e/`). Build the app first
(`pnpm install && pnpm exec electron-vite build` in `.hivemind-app/apps/desktop`), then run it
on a display of its own: `xvfb-run -n 91 npm run e2e`. Like the app's own e2e suite, CI does not
run it; run it before merging a change to a tool.

## Publishing

Merging is publishing. When a push to `main` changes a folder under `agents/`, `widgets/`,
`tools/` or `views/`, `.github/workflows/publish.yml` runs the tests, then publishes that folder to
HiveHub at that commit. HiveHub checks GitHub's signed proof that the job runs in this repository
on `main`, fetches every file and hashes it; a file changed after publishing is refused at install.
A maintainer can publish chosen folders again from the workflow's **Run workflow** button.

### Adding an agent

1. `agents/<id>/agent.yaml`, where `<id>` is the CLI's name, lowercase.
2. `hive agents validate agents/<id>` shows exactly what a user will be asked to allow.
3. Open a pull request. Say which CLI version you checked it against.

## Views and the SDK

A view does not bundle `@hivemind/view-sdk`: the app serves it to every view, so `build.mjs`
leaves it external and each view gets the SDK of the app it runs in. `types/view-sdk/` is
that SDK's source, written by `hive views new`; refresh it from a newer `hive` the same way.
`dist/` is committed because it is what HiveHub lists.

## License

MIT — see [LICENSE](LICENSE). Each agent manifest describes a third-party CLI; the CLI
itself is its authors', under its own license.
