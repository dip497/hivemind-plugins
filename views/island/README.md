# Island

Your workspace as islands, and a town that grows as your agents work. Each frame is an island of
hex tiles ringed by a beach, each tile its own shade of grass, whose trees are a mix of greens with
more or fewer turned by its season (meadow, blossom, autumn or snow) and whose buildings take its
colour; a worktree is an islet joined to it by a bridge. Each agent has a workshop and four lots
beside it, and every turn it finishes raises the next lot one step: ground laid, the frame up in
scaffolding, then a finished house, tavern or market. The keep in the middle of an island grows with
all its agents' turns that day, from a well to a windmill, a church and a castle.

- **working**: its worker walks to the lot it is building and works there (chopping, casting or
  hammering, by who it is), sparks flying, smoke from the workshop chimney;
- **calling you**: it stands at its door facing you under a thin light, and joins the list of agents
  calling you, the one calling longest first. Out of sight, an arrow on the edge of the view points at it;
- **finished a turn**: it cheers, the lot goes up with a puff of dust, sparks over the workshop;
- **ready for work**: it sits by its fire; **stopped on an error**: red smoke.

The light follows your clock: morning sun from the east, long shadows at dusk, lit windows and stars
at night. Clouds gather as more agents work. Left alone, the camera turns slowly round the islands.
Its helpers (subagents) carry timber round the site, and a dashed arc with travelling lights joins
an agent to the ones it started or feeds.

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
hive ctl plugin call @dip497/island island '{"name":"docs"}'   # fly to an island: its agents and turns today
```

It asks to **tell an agent something** (`workspace:prompt`: you send or cancel each message) and to
**start agents** (`workspace:spawn`: the island's Start an agent here).

Settings: **Light** follows the clock, or stays at morning, midday, dusk or night. **Motion** follows
the system's reduced-motion setting by default; with less motion there are no flights, walking,
waves, smoke or sparks, new houses appear without rising, and it draws only when something changes.
**Frames a second** (15 to 60), **Shadows** (turned off on their own above 60 agents), **Camera
effects** (the model-town focus and the glow of lit windows). When frames come too slowly for a few
seconds, it draws less on its own so it stays smooth: first without multisampling, then without the
focus blur and at one pixel a point, then without shadows and effects. Changing a setting tries
everything again.
Sounds are off until you press the speaker: two soft bell notes when an agent starts calling you, a
quiet tick when one finishes a turn. They are made on the spot; nothing is loaded.

It draws with [three.js](https://threejs.org) 0.186.0 and
[postprocessing](https://github.com/pmndrs/postprocessing) 6.39.5 (both MIT), bundled into
`island.js`. Its models are the CC0 KayKit packs by Kay Lousberg and its light two CC0 Poly Haven
skies; see [ASSETS.md](ASSETS.md) for each source and licence. A view cannot read files from its own
package (its page has no network), so the models ship inside `island-assets.js`, about 2.4 MB.

## How it was made

Built by a coding agent (Claude) from the view contract, after studying WorldClaw (Tencent Hunyuan,
arXiv 2608.05248): low-poly regional worlds, each region its own season, laid out first and
detailed after. What it works out from the workspace is in `src/world.ts`, tested in
`tests/views.test.ts`.
