# Hivemind plugins

The official catalog for [Hivemind](https://github.com/dip497/hivemind): the agents and
views you can add from **Settings ▸ Plugins ▸ Browse**, or from
[HiveHub](https://hivehub.griiken.workers.dev).

```
index.json            what the app lists — every plugin, and a SHA-256 for every file
agents/<id>/          an agent: one agent.yaml describing a CLI you install yourself
views/<id>/           a view: hivemind-view.json and the built bundle it names
```

## What ships in the app, and what lives here

Seven agents ship **inside** Hivemind — claude, codex, cursor, droid, kiro, openclaw and pi —
so a fresh install with no network can still run one. They are reviewed and tested with the
app, and their names are reserved. Everything in this repository is something you add.

## The one rule: every file is hashed

`index.json` lists each file with its SHA-256. The app refuses a file that no longer
matches, mid-download, so where a file is fetched from never decides whether it is
trusted. `node scripts/check.mjs` verifies that every listed file exists with the hash it
claims and that no plugin carries a file the index does not cover; it runs on every push.

## Where the source is

The files here are what gets installed. For now they are **published from** the Hivemind
repository, where they are written and tested:

- agents — `examples/agents/<id>/agent.yaml`, part of the app's detector test suite
- views — `examples/views/<id>/`, built against `@hivemind/view-sdk`

```bash
# in a checkout of dip497/hivemind, next to this one
node scripts/build-plugin-index.mjs --out ../hivemind-plugins
```

The views' source moves here once `@hivemind/view-sdk` is published to npm; until then a
view could not be built from this repository alone.

## Adding a plugin

A plugin keeps its own repository — an entry here is a pointer and a set of hashes, never
someone else's code. Before an entry is merged:

1. Does it work on a machine that is not the author's — no absolute paths, no assumed CLI?
2. Is the source public, and does the listed version match a tag in it?
3. Does it ask for anything it does not use? A view's permissions and an agent's `bin` are
   both declarations the app enforces.
4. Is there someone to fix it when an app change breaks it?

Not being listed is never a dead end: **Settings ▸ Plugins ▸ Installed ▸ Install from
folder** takes any plugin directory, and `hive agents install` / `hive views install` do the
same from a terminal.

## License

MIT — see [LICENSE](LICENSE). Each agent manifest describes a third-party CLI; the CLI
itself is its authors', under its own license.
