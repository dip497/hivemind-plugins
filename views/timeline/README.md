# Timeline

Today as a timeline: one row per agent, grouped by frame, with a bar for each stretch it spent
working or waiting on you, an empty box for each stretch it sat idle and a hatched one once it had
exited, and a tick for each turn it finished. The past comes from the app's history, so it shows the
hours before you opened the view; the present is kept live. The header adds it up: time working, time
waiting on you, turns finished.

```bash
hive plugins install @dip497/timeline    # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/timeline       # or let an agent switch to it
hive ctl plugin call @dip497/timeline summary
```

Its commands are there while it is the view shown. It asks for no permissions.

Settings (its page in Settings ▸ Plugins, or `hive plugins set @dip497/timeline <id> <value>`): `everyTile`: show terminals and tools too, not only agents.

## How it was made

Built by a coding agent (Claude) from the view contract: `hive plugins new view`'s brief and the
[Extension authoring guide](https://github.com/dip497/hivemind/blob/main/site/src/content/docs/guide/extension-authoring.md),
then checked in the app over the demo workspace. What it works out from the workspace is in `lib.js`,
tested in `tests/views.test.ts` in this repository.
