# Harbour

Who needs you now: agents calling you are boats waiting at your dock, longest first, and agents back from a finished turn wait in port for their next task. Press one to go to it.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/harbour
hive ctl plugin call @dip497/harbour dock   # the agents calling the person (name, why and for how long, longest first) and the ones back in port after a finished turn, ready for their next task.
```
