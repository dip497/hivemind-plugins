# Hivemind plugins

The agents and views published by the Hivemind project. They are listed on
[HiveHub](https://hivehub.griiken.workers.dev) the same way anyone's are: signed in as the
publisher, with a SHA-256 recorded for every file and the listing pinned to a commit.
This repository gets no special treatment — it is one publisher among many.

```
agents/<id>/agent.yaml    an agent: a manifest describing a CLI you install yourself
views/<id>/               a view: hivemind-view.json and the built bundle it names
```

## What ships in the app, and what lives here

Seven agents ship **inside** Hivemind — claude, codex, cursor, droid, kiro, openclaw and pi —
so a fresh install with no network can still run one. Everything here is something you add.

## Installing one

From HiveHub, or in the app from **Settings ▸ Plugins**. To try a folder directly:

```bash
hive agents install agents/<id>
hive views install views/<id>
```

## Publishing

Each folder is published on HiveHub: sign in with GitHub, give `dip497/hivemind-plugins`,
the commit, and the folder. HiveHub checks push access with GitHub, fetches every file and
hashes it; a file changed after publishing is refused at install.

Your own plugin does not need to be here. Publish it from your repository the same way.

## Where the source is

Both are copied here from the [Hivemind repository](https://github.com/dip497/hivemind)
to publish: agents from `examples/agents/<id>`, where the app's detector tests read them,
and views from `examples/views/<id>`, because they build against `@hivemind/view-sdk`,
which is not on npm yet. Change them there, then copy the result here — the one line that
differs is the id, which here carries the scope: `@dip497/board`, not `board`. HiveHub refuses
a manifest whose scope is not the account publishing it.

## License

MIT — see [LICENSE](LICENSE). Each agent manifest describes a third-party CLI; the CLI
itself is its authors', under its own license.
