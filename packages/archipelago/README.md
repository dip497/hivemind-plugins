# Archipelago

Your workspace as islands you can walk, and three widgets drawn to match. One install, one switch,
one rollback; nothing in it runs outside its sandbox, so it arrives switched on.

```bash
hive plugins install @dip497/archipelago
```

| Member | What it is for |
| --- | --- |
| [Archipelago](views/archipelago) (view) | Every project an island, every agent a worker building its town. A pin over each agent from afar; press **J** to land and walk the islands, **E** beside an agent to open its terminal. |
| [Harbour](widgets/harbour) (widget) | Who needs you now: agents calling you as boats at your dock, longest first, with their project and why, and agents back from a finished turn waiting in port for a task. Press one to go to it; it can ring a bell when a boat arrives. |
| [Town ledger](widgets/town-ledger) (widget) | What each project got done this week and today, the town it has grown to, from a well to a castle, and which projects have gone quiet. |
| [Weather](widgets/weather) (widget) | The whole workspace at a glance, and for how long: fair while agents work, a squall when some call you, a storm when one stopped, becalmed when all rest, with a button to what needs you. |

Installing it selects the Archipelago view. The widgets go on any view, the canvas included; over Archipelago, its overview keeps clear of the column they sit in:

```bash
hive ctl plugin open widget:@dip497/harbour
hive ctl plugin call @dip497/harbour dock
hive ctl plugin call @dip497/town-ledger ledger
hive ctl plugin call @dip497/weather forecast
```

**What it asks for.** The view asks to tell an agent something (`workspace:prompt`, you send or cancel
each message) and to start agents (`workspace:spawn`). The widgets ask for nothing: they read the
agents, their status and the day's history, and press to go to an agent. There is no tool in the
package, so nothing in it runs with the app's access.

It keeps [Island](../../views/island) as it was; Archipelago is a view of its own beside it.
