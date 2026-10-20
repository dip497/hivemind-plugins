# Town ledger

What each project got done this week: the turns its agents finished in the last seven days, and the town it has grown to, from a well to a windmill, a church and a castle.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/town-ledger
hive ctl plugin call @dip497/town-ledger ledger   # each project's turns finished in the last seven days, busiest first, with the town it has grown to and how many more turns its next one takes.
```
