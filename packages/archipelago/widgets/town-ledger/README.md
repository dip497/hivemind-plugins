# Town ledger

What each project got done this week: the turns its agents finished in the last seven days and today, the town it has grown to, from a well to a windmill, a church and a castle, and which projects have gone quiet.

Today's turns show beside the project's name (`+3 today`). A project says how long it has been quiet once two days or more pass without a finished turn; it counts only the days the app watched, and is never quiet while one of its agents works or calls you, or with no turn on record this week. With no turn finished anywhere yet, the card says how a town grows instead of listing wells. The history the app keeps can trail the turns it sees live by a little, so the ledger reads today's again shortly after it opens and every few minutes, and a count never goes down.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/town-ledger
hive ctl plugin call @dip497/town-ledger ledger   # each project's turns in the last seven days and today, busiest first, with the town it has grown to, how many more turns its next one takes, and quietDays: the days the app watched it go without a finished turn (0 while one of its agents works or calls you, null with none on record this week).
```
