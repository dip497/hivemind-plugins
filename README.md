# Hivemind plugins

Every agent Hivemind can add, and the views the project publishes. They are listed on
[HiveHub](https://hivehub.griiken.workers.dev) with a SHA-256 for every file and the listing
pinned to a commit.

**Agents live here, and only here.** An agent stands for one CLI, so its id is one name
(`gemini`), and two publishers' `gemini` could only disagree. HiveHub lists an agent only from
this repository. **To add or fix one, open a pull request.**

**Views are anyone's.** A view's id is `@your-login/name`, and you publish it from your own
repository. The ones here are the project's: `@dip497/queue`, `@dip497/tiled`, `@dip497/board`.

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

After a merge, a maintainer runs `hivehub publish agents/<id>` or
`hivehub publish views/<id>/dist` on the pushed commit. HiveHub checks push access with GitHub,
fetches every file and hashes it; a file changed after publishing is refused at install.

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
