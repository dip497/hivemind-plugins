# Harbour

Who needs you now: agents calling you are boats waiting at your dock, longest first, and agents back from a finished turn wait in port for their next task. Press one to go to it.

Options: how many boats to list, and **Ring the bell when a boat arrives**, which notifies you when an agent starts calling you, its name, project and why in the note.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/harbour
hive ctl plugin call @dip497/harbour dock   # the agents calling the person (name, project, why and for how long, longest first), the ones back in port after a finished turn and ready for their next task, and how many are out at work.
```
