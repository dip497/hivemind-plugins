# Weather

The whole workspace at a glance, as the sky over Archipelago, and what to do about it: a storm when an agent stopped on an error, with a button to it; a squall when some are calling you, with one to the agent waiting longest; fair while they work; becalmed when all are idle.

Once the weather has held a minute it says for how long, from when it last changed (`Fair for 12m`). In a storm there is a button to each agent that stopped (up to two); in a squall, one to the agent that has waited on you longest.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/weather
hive ctl plugin call @dip497/weather forecast   # the weather now (fair, squall, storm or becalmed) and for how long it has held since it last changed, how many agents are working, calling the person, stopped on an error or idle, which stopped, and which has waited longest.
```
