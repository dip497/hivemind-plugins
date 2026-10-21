# Archipelago

Your workspace as islands you can walk, and a town that grows as your agents work. It is
[Island](../../../../views/island) made into a living place: rolling land in place of tiles, a sea
with depth and surf, cloud shadows and fireflies, a pin over every agent from afar, and you on the
islands as a worker of your own. It comes in the [Archipelago package](../../README.md) with three
widgets drawn to match.

Each frame is an island of rolling land with a sandy coast, whose trees are a mix of greens with
more or fewer turned by its season (meadow, blossom, autumn or snow) and whose buildings take its
colour; a worktree is an islet joined to it by a bridge. Each agent has a workshop and four lots
beside it, and every turn it finishes raises the next lot one step: ground laid, the frame up in
scaffolding, then a finished house, tavern or market. The keep in the middle of an island grows with
all its agents' turns, from a well to a windmill, a church and a castle. A town stands on the last
seven days of turns, so it is not bare each morning.

- **working**: its worker walks to the lot it is building and works there (chopping, casting or
  hammering, by who it is), sparks flying, smoke from the workshop chimney;
- **calling you**: it stands at its door facing you under a thin light, and joins the list of agents
  calling you, the one calling longest first. Out of sight, an arrow on the edge of the view points at it;
- **finished a turn**: it cheers, the lot goes up with a puff of dust, sparks over the workshop;
- **ready for work**: it sits by its fire; **stopped on an error**: red smoke.

From far away, where the workers are a few pixels tall, a pin stands over each agent at the same size
however far you are: a turning arc while it works, **!** when it is calling you (larger, and it
pulses), **✓** when it finished a turn, **×** when it stopped on an error, **…** when it is ready for
work. Click a pin to fly to that agent. The pins fade out as you come close enough to see the workers.

The light follows your clock: morning sun from the east, long shadows at dusk, lit windows and stars
at night, under a moon bright enough to read the islands by. The sea is clear over the sand at the
beach, turquoise over the shelf and deep blue beyond, with surf rolling in to a broken white edge.
Each island is one rolling stretch of land: a coast that wanders, a beach sloping into the sea, and
ground that rises with every ring in from the shore to its middle. Its meadows run in broad patches
of sunlit, shaded and sun-dried grass, with tufts of grass and wildflowers swaying together in one wind. Soft clouds
drift over the open sea, more of them as more agents work, and their shadows pass over land and
water by day; the trees sway, birds wheel over the islands by day, and fireflies rise over the
meadows at dusk and by night. Left alone, the camera turns slowly round the islands.
Its helpers (subagents) carry timber round the site, and a dashed arc with travelling lights joins
an agent to the ones it started or feeds.

Click a worker to fly there and see what it is doing; **Open its terminal** docks its live terminal
on the right, where you answer it. The view asks the app to start widget cards down the left edge
(Hivemind 2026.10.6 or later), so none covers the terminal; the header and tools move beside them. Press **N** (or ⌘⌥N / Ctrl+Alt+N anywhere in the app) to go
to the next agent calling you. On an agent that is ready for work, write its next task: the app
shows you the message before it is sent. Click an island to start an agent there.

**Its own toolbar**, a plank of the dock along the bottom, takes the place of the app's over this
view: **Start an agent** on the island you are looking at (pick which agent), **New island** for
another project, see every island, walk, the next agent calling you (with how many are), sounds,
then the app's own Add, Appearance, view menu and Settings (Hivemind 2026.10.6 or later).

Drag to move, right-drag or Shift-drag to turn, scroll to come closer, Home to see every island.
Arrow keys move, + and − zoom, Esc closes the terminal.

**Walk the islands yourself**: press **J** (or the walking figure on the toolbar) and you land on
the island in the middle of the view as a worker of your own, a ring at your feet. WASD or the arrow
keys walk the way the camera faces, Shift runs, and a drag turns the camera round you. You keep to
open ground and bridges: not the sea, a forest, a hill, a keep or a workshop. Walk up to an agent and
press **E** to talk to it: its live terminal opens beside you. Where no agent is near, **E** opens
the island you stand on, with Start an agent here. **C** changes which worker you are (kept for next
time), and Esc or Home flies you back up.

```bash
hive plugins install @dip497/archipelago  # the package: this view and its widgets; switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/archipelago
hive ctl plugin call @dip497/archipelago census
hive ctl plugin call @dip497/archipelago next                    # the agent calling longest, terminal open
hive ctl plugin call @dip497/archipelago show '{"name":"docs"}'
hive ctl plugin call @dip497/archipelago release
hive ctl plugin call @dip497/archipelago overview
hive ctl plugin call @dip497/archipelago island '{"name":"docs"}'   # fly to an island: its agents and turns today
hive ctl plugin call @dip497/archipelago walk '{"who":"mage"}'     # land on the islands and walk them; '{"on":false}' flies back up
```

It asks to **tell an agent something** (`workspace:prompt`: you send or cancel each message) and to
**start agents** (`workspace:spawn`: the island's Start an agent here).

Settings: **Light** follows the clock, or stays at morning, midday, dusk or night. **Motion** follows
the system's reduced-motion setting by default; with less motion there are no flights, walking,
waves, smoke or sparks, new houses appear without rising, and it draws only when something changes.
**Frames a second** (15 to 60), **Shadows** (turned off on their own above 60 agents), **Camera
effects** (the model-town focus, soft shadow where things meet the ground, and the glow of lit
windows). When frames come too slowly for a few seconds, it draws less on its own so it stays smooth:
first without edge smoothing and the soft contact shadow, then without the
focus blur and at one pixel a point, then without shadows and effects. Changing a setting tries
everything again.
Sounds are off until you press the speaker: two soft bell notes when an agent starts calling you, a
quiet tick when one finishes a turn. They are made on the spot; nothing is loaded.

It draws with [three.js](https://threejs.org) 0.186.0 and
[postprocessing](https://github.com/pmndrs/postprocessing) 6.39.5 (both MIT) and
[N8AO](https://github.com/N8python/n8ao) 2.0.1 (ISC) for the contact shadow, bundled into `island.js`. Its models are the CC0 KayKit packs by Kay Lousberg and its light two CC0 Poly Haven
skies; see [ASSETS.md](ASSETS.md) for each source and licence. A view cannot read files from its own
package (its page has no network), so the models and skies ship as scripts, one per file:
`archipelago-kit.js` (1.3 MB), `archipelago-workers.js` (0.67 MB), `archipelago-moves.js` (0.16 MB),
`archipelago-skyDay.js` and `archipelago-skyNight.js` (0.17 MB each), about 2.4 MB in all. HiveHub
takes no file over 2 MB. `archipelago-assets.js` loads them once the view is running. The models are
Island's: `assets.from` here names `views/island/assets`, which the build packs.

## How it was made

Built by a coding agent (Claude) from the view contract, after studying WorldClaw (Tencent Hunyuan,
arXiv 2608.05248): low-poly regional worlds, each region its own season, laid out first and
detailed after, then grown into Archipelago. What it works out from the workspace is in
`src/world.ts`, and walking in `src/walker.ts`, tested in `tests/archipelago.test.ts`.
