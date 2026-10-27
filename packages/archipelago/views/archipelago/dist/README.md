# Archipelago

Your workspace as islands you can walk, and a town that grows as your agents work. It is
[Island](../../../../views/island) made into a living place: rolling land in place of tiles, a sea
with depth and surf, cloud shadows and fireflies, a pin over every agent from afar, and you on the
islands as a worker of your own. It comes in the [Archipelago package](../../README.md) with four
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
however far you are: a turning arc while it works, a still, closed ring when it is ready for work,
**!** when it is calling you (larger, and it pulses), **✓** when it finished a turn, **×** when it
stopped on an error. Point at a pin for the agent's name and what it is doing, and click it to fly
there. An agent's name stands above its pin, and an island's above the pins on it. The pins fade out
as you come close enough to see the workers.

Each island's name floats over it. Where it would cover another name, such as that of an agent
calling you from the island's far edge, it stands directly above that name. It stops at the top of
the window, and at the edge of the widget column as at the window's.

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
(Hivemind 2026.10.6 or later), so none covers the terminal; the header and the card start where they
end, and the overview and the names keep clear of them, as wide as the app says they are when they
stack into more than one column. Press **N** (or ⌘⌥N / Ctrl+Alt+N anywhere in the app) to go
to the next agent calling you. On an agent that is ready for work, write its next task: the app
shows you the message before it is sent. Click an island to start an agent there.

The list of agents calling you sits at the top right; click its title to open it. In a narrow space
(beside a docked terminal, with the widget column, or in a narrow window) it folds to how many are
calling, and a click on that count goes to the next one, as **N** does. Where even the count has no
room, the header's count and the toolbar's bell say how many.

**Ships on the sea**, each one something going on: work passing between two projects (one agent
started by, or sending its replies to, an agent on another island) sails as a ship between their
islands; an agent calling you puts out a boat that lies off its island, its lantern lit, until you
answer; and fishing boats work the water round the islands that are busy. They find their way
round the islands and never onto one, ride the same swells the sea draws, and leave a wake. The
wind is the work: a calm while agents work, a squall while any calls you, the harder the more do,
and with it the swell rises, the ships heel and their sails fill. Their lanterns light at dusk.

**Its own toolbar**, a plank of the dock along the bottom, takes the place of the app's over this
view: **Start an agent** on the island you are looking at (pick which agent; where that island is
only the one nearest the middle, the menu lists every island to start on instead), **New island** for
another project, see every island, walk, the next agent calling you (with how many are), sounds,
then the app's own Add, Appearance and view menu (Hivemind 2026.10.6 or later); Settings is the app's
gear in the corner. An agent you start here, from the toolbar or an island, is flown to with its card
open, where **Open its terminal** is. Where it
has no room for every label on one row (a narrow window, or a wide interface font), its labels give
way to their icons, and with no room for its icons alone it takes a second row.

Drag to move, right-drag or Shift-drag to turn, scroll to come closer, Home to see every island.
Arrow keys move, + and − zoom (walking, from behind, as near and as far as the wheel goes), Esc closes
the terminal. **Tab** goes to the list of agents calling you, then to each island's name, every
island's even when its name has no room on screen: Enter flies to the island and opens its card,
which lists its agents, each a button that flies to that agent and opens its card. The app's keys
for tiles work here too: ⌃Tab / Ctrl+Tab and ⌃⇧Tab / Ctrl+Shift+Tab go to the next and the previous
tile, and ⌘1 … ⌘9 / Ctrl+1 … Ctrl+9 to tile 1 to 9; on an agent, the view flies to it and opens its
terminal.

**Walk the islands yourself**: press **J** (or the walking figure on the toolbar) and you land on
the island in the middle of the view as a worker of your own, a ring at your feet; with an agent
picked (clicked, or the next calling you with **N**), in front of it, facing it, near enough to
talk. WASD or the arrow keys walk the way the camera faces, Shift runs, and a drag turns the camera
round you. You keep to open ground and bridges: not the sea, a forest, a hill, a keep or a workshop,
and round a tree, a rock, a house or another worker rather than through it, your body's width away;
the other workers go round you too, or wait for you to make way. Walk up to an agent and press **E**
to talk to it: its live terminal opens beside you. Where no agent is near, **E** opens the island
you stand on, with Start an agent here. **C** changes which worker you are (kept for next time), and
Esc, Home or the see-every-island button flies you back up; the walking figure on the toolbar stays
pressed, underlined, while you walk. Just after you land, and after you change how you see, the line
at the bottom says how to walk and how to fly up, until you first move; then what **E** does where you
stand.

**Through your eyes**: press **V** while you walk, or the **Through your eyes** switch beside the
walking line, and the camera moves into your worker's eyes, at its face: roofs rise above you and
you meet the other workers' eyes. You see the islands, the other workers, their names and the light
over an agent calling you as they stand, and your own worker is not drawn. W walks where you look,
at a calmer pace than from behind, **←** and **→** turn you (A and D step aside), and a drag turns
you and tips your look up or down (as far as 60 degrees); walking on, your look comes back to level.
The view is as wide as a person's, 60 degrees up and down and never more than 100 across, however
wide the window; the model-town focus goes, the haze suits eye level, the name of the island you
stand on goes (the header says it), and your head rises and falls a little as you walk. **V** again
steps back behind you. The change takes under half a second, from high above a little under a
second, and is at once with less motion, which also keeps your head still.

Landing through your eyes, you face the agent calling you longest, or with none calling the nearest,
turned aside only as far as it takes to see open ground, never out to sea. Walk up to it and you
stop at talking distance, its name over its head; the light over it gives way to the ring at its
feet so it does not stand in your face. With two agents in reach, **E** talks to the one you face,
and turns you to face it as its terminal opens. An arrow on the edge points at an agent calling you
out of sight: behind you, low on the left or right, the way to turn. Which way you see is kept for
the next time you walk.

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
hive ctl plugin call @dip497/archipelago walk '{"pov":"first"}'    # walk through your own eyes; "third" from behind
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
`src/world.ts`, walking in `src/walker.ts` and seeing through your own eyes in `src/eye.ts`, tested in
`tests/archipelago.test.ts`, and in the real app by `e2e/archipelago-fpp.spec.ts`.
