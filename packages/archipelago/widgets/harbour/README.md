# Harbour

Who needs you now: agents calling you are boats waiting at your dock, longest first, each with why and for how long, and agents ready for their next task wait in port. Press one to go to it.

Each row says why and for how long before whose it is, so a row cut short at the card's edge keeps
them. The agents the card has no room for are still counted (`and 2 in port, 8 out at work`), so
the boats calling, in port and out at work add up to every agent running.

Options: how many boats to list, and **Ring the bell when a boat arrives**, which notifies you when an agent starts calling you, its name, project and why in the note.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/harbour
hive ctl plugin call @dip497/harbour dock   # the agents calling the person (name, project, why and for how long, longest first), the idle ones in port, ready for their next task (name, project and for how long, longest first), and how many are out at work.
```
