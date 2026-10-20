# Agents by state

Your agents as a board with four columns: waiting on you, working, ready for work and stopped.
Cards move by themselves as each agent's status changes, longest waiting first. Click a card to dock
its live terminal beside the board; on a card that is ready, write its next task and the app shows
you the message before it is sent.

```bash
hive plugins install @dip497/agents-by-state    # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/agents-by-state       # or let an agent switch to it
hive ctl plugin call @dip497/agents-by-state board
hive ctl plugin call @dip497/agents-by-state open '{"name":"docs"}'
```

Its commands are there while it is the view shown. It asks to give an agent a message you confirm (`workspace:prompt`).

## How it was made

Built by a coding agent (Claude) from the view contract: `hive plugins new view`'s brief and the
[Extension authoring guide](https://hivemind.griiken.com/guide/extension-authoring/),
then checked in the app over the demo workspace. What it works out from the workspace is in `lib.js`,
tested in `tests/views.test.ts` in this repository.

Switching views: [Switch views](https://hivemind.griiken.com/guide/views/). Writing your own view: [Write a view](https://hivemind.griiken.com/guide/extension-authoring/).
