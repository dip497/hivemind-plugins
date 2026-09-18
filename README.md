# Hivemind plugins

The agents and views published by the Hivemind project. They are listed on
[HiveHub](https://hivehub.griiken.workers.dev) the same way anyone's are: signed in as the
publisher, with a SHA-256 recorded for every file and the listing pinned to a commit.
This repository gets no special treatment — it is one publisher among many.

```
agents/<id>/agent.yaml    an agent: a manifest describing a CLI you install yourself
views/<id>/src/           a view's source; views/<id>/dist/ is what is published
packages/<id>/            a bundle: views plus agent presets, inspected before anything runs
types/view-sdk/           the SDK the app serves to views, for tsc
```

## What ships in the app, and what lives here

Seven agents ship **inside** Hivemind — claude, codex, cursor, droid, kiro, openclaw and pi —
so a fresh install with no network can still run one. Everything here is something you add.

## Installing one

From HiveHub, or in the app from **Settings ▸ Plugins**. To try a folder directly:

```bash
hive agents install agents/<id>
npm install && npm run build
hive views install views/<id>/dist
```

## Publishing

Each folder is published on HiveHub — `hivehub publish agents/<id>` or
`hivehub publish views/<id>/dist` after the commit is pushed. HiveHub checks push access with
GitHub, fetches every file and hashes it; a file changed after publishing is refused at install.

Your own plugin does not need to be here. Publish it from your repository the same way.

## Views and the SDK

A view does not bundle `@hivemind/view-sdk`: the app serves it to every view, so `build.mjs`
leaves it external and each view gets the SDK of the app it runs in. `types/view-sdk/` is
that SDK's source, written by `hive views new`; refresh it from a newer `hive` the same way.
`dist/` is committed because it is what HiveHub lists.

## License

MIT — see [LICENSE](LICENSE). Each agent manifest describes a third-party CLI; the CLI
itself is its authors', under its own license.
