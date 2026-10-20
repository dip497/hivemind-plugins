# Weather

The whole workspace at a glance, as the sky over Archipelago: fair while agents work, a squall when some are calling you, a storm when one stopped on an error, becalmed when all are idle.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/weather
hive ctl plugin call @dip497/weather forecast   # the weather now (fair, squall, storm or becalmed), and how many agents are working, calling the person, stopped on an error or idle.
```
