# Ship's log

What happened while you were away, newest first: which agent finished a turn, asked for you, started or stopped, how long ago and in which project. Press an entry to go to that agent.

It keeps its last thirty entries in the widget's own state, so closing the app does not wipe it. An
entry whose agent has since closed still reads, but no longer goes anywhere. Options: how many
entries to show, and whether agents starting and closing are logged as well as turns and calls.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/ships-log
hive ctl plugin call @dip497/ships-log log   # the latest entries, newest first: when, which agent, its project and what happened (finished a turn, turn failed, asked for permission or input, started, closed or stopped on an error).
```
