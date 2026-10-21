# Town ledger

What each project got done this week: the turns its agents finished in the last seven days and today, the town it has grown to, from a well to a windmill, a church and a castle, and which projects have gone quiet.

Today's turns show beside the week's (`+3 today`), and a project with no finished turn for two days or more says how long it has been quiet. The history the app keeps can trail the turns it sees live by a little, so the ledger reads today's again shortly after it opens and every few minutes, and a count never goes down.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/town-ledger
hive ctl plugin call @dip497/town-ledger ledger   # each project's turns in the last seven days and today, busiest first, with the town it has grown to, how many more turns its next one takes, and how many days it has been quiet.
```
