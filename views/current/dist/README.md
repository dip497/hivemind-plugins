# Current

Your workspace as water. Each agent is a spring in its frame's basin. While it works, its work runs
down a stream, as much as its terminal is busy, meets the other streams of its frame and reaches
you: the lake at the bottom, which lights up as work arrives and counts the turns that reached you
today. A finished turn sends a bright wave all the way down.

An agent **calling you** dams its stream. Its water backs up into an amber pool that keeps growing
the longer it waits, with rings pushing against the dam, so the agent that has waited longest is
plainly the biggest thing on the screen. It also joins the list of agents calling you, the one
calling longest first. Dashed canals with lights travelling along them join an agent to the ones it
feeds or started.

Click a spring to see what it is doing; **Open its terminal** docks its live terminal beside the
water, where you answer it. Press **N** (or ⌘⌥N / Ctrl+Alt+N anywhere in the app) for the next agent
calling you, Esc to close. On an agent that is ready for work, write its next task: the app shows
you the message before it is sent.

```bash
hive views install @dip497/current       # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open view:@dip497/current
hive ctl plugin call @dip497/current census
hive ctl plugin call @dip497/current next
hive ctl plugin call @dip497/current show '{"name":"docs"}'
hive ctl plugin call @dip497/current release
```

It asks to **tell an agent something** (`workspace:prompt`: you send or cancel each message).

Settings: **Motion** follows the system's reduced-motion setting by default; with less motion the
water is still (each stream as wide as its agent is busy, each pool as big as its wait) and it draws
only when something changes. **Frames a second** (15 to 60). Sounds are off until you press the
speaker. It draws on a plain 2D canvas and loads nothing.

What it works out from the workspace is in `src/flow.ts`, tested in `tests/views.test.ts`.
