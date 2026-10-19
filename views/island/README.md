# Island

Your workspace as islands. Each frame is an island whose land follows its colour (meadow, blossom,
autumn or snow), and a worktree is an islet joined to it by a bridge. Each agent is a worker at its
own workshop:

- **working**: it hammers at its anvil and its chimney smokes, as busy as its terminal;
- **calling you**: it walks out to a beacon, a column of light you can see from anywhere, and joins
  the list of agents calling you, the one calling longest first. Out of sight, an arrow on the edge
  of the view points at it;
- **finished a turn**: fireworks over its workshop, then it rests by its fire;
- **stopped on an error**: red smoke; **closed**: its workshop goes grey.

Its helpers (subagents) trot around it, and a dashed arc with travelling lights joins an agent to
the ones it started or feeds.

Click a worker to fly there and see what it is doing; **Open its terminal** docks its live terminal
beside the islands, where you answer it. Press **N** (or ⌘⌥N / Ctrl+Alt+N anywhere in the app) to go
to the next agent calling you. On an agent that is ready for work, write its next task: the app
shows you the message before it is sent. Click an island to start an agent there.

Drag to move, right-drag or Shift-drag to turn, scroll to come closer, Home to see every island.
Arrow keys move, + and − zoom, Esc closes the terminal.

```bash
hive views install @dip497/island       # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open view:@dip497/island
hive ctl plugin call @dip497/island census
hive ctl plugin call @dip497/island next                    # the agent calling longest, terminal open
hive ctl plugin call @dip497/island show '{"name":"docs"}'
hive ctl plugin call @dip497/island release
hive ctl plugin call @dip497/island overview
```

It asks to **tell an agent something** (`workspace:prompt`: you send or cancel each message) and to
**start agents** (`workspace:spawn`: the island's Start an agent here).

Settings: **Motion** follows the system's reduced-motion setting by default; with less motion there
are no flights, smoke, sparks or bobbing, beacons stand still and it draws only when something
changes. **Frames a second** (15 to 60), **Shadows** (turned off on their own above 60 agents).
Sounds are off until you press the speaker: two soft bell notes when an agent starts calling you, a
quiet tick when one finishes a turn. They are made on the spot; nothing is loaded.

It draws with [three.js](https://threejs.org) 0.186.0 (MIT), bundled into `island.js`.

## How it was made

Built by a coding agent (Claude) from the view contract, after studying WorldClaw (Tencent Hunyuan,
arXiv 2608.05248): low-poly regional worlds, each region its own season, laid out first and
detailed after. What it works out from the workspace is in `src/world.ts`, tested in
`tests/views.test.ts`.
