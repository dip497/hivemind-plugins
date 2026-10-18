# Focus timer

A focus timer for you while your agents work: 25 minutes of focus, then a break, round after
round, with a notification at each change. The timer is the widget's state, so everyone in the
workspace sees the same one and it survives a restart. An agent can start one for you.

```bash
hive widgets install @dip497/focus-timer   # then add it from the toolbar's Add menu
hive ctl plugin open widget:@dip497/focus-timer        # or let an agent place it
hive ctl plugin call @dip497/focus-timer start '{"minutes":50}'
hive ctl plugin call @dip497/focus-timer status
hive ctl plugin call @dip497/focus-timer pause
```

It asks for no permissions.

Options (the gear on the widget): `focus` and `break`: their lengths in minutes.

## How it was made

Built by a coding agent (Claude) from the widget contract: `hive widgets new`'s brief, `hive.d.ts`
and the [Widgets guide](https://github.com/dip497/hivemind/blob/main/site/src/content/docs/guide/widgets.md), then checked
in the app over the demo workspace. Its behaviour test is `tests/widgets.test.ts` in this repository,
which runs `widget.js` with the same worker prelude the app uses.
