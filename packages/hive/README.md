# Hive

A live wallpaper for your canvas: **Bees**, a meadow and a straw hive drawn in characters, where
each of your agents is a bee. A glance at the meadow tells you who is at work, who is free, and
who needs you. Needs Hivemind 2026.10.8 or later.

```bash
hive plugins install @dip497/hive
```

| Member | What it is for |
| --- | --- |
| [Bees](wallpapers/bees) (live wallpaper) | A meadow at the bottom of your canvas, low hills behind it and a skep in one lower corner, small bees drifting between the flowers. Every agent is a bigger bee, one species per program: all your Claude agents are honeybees, say, and all your Codex agents bumblebees. What a bee does says what its agent is doing. |

## What the bees are doing

| Its agent | Its bee |
| --- | --- |
| Working | Flies from flower to flower gathering, a load of pollen growing under it, and takes a full load home to the hive. |
| Ready for a task | Hovers in loose loops over the hive. |
| Needs you (a permission, a question, a plan to review) | Flies to the open side of its own tile, where no other tile is, and dances the waggle dance there, as a bee does to show the hive where to go, glowing and pulsing in your theme's "needs you" colour. When its tile is out of sight it dances by the hive. |
| Resting (stopped, failed or asleep) | Sits on the hive, still and dimmed. |
| A turn finished well | A quick loop in the air, and a puff of pollen. |

Each program's agents are one species, told apart by build as well as by colour, so they still
differ in your theme's two colours: honeybee, bumblebee, carpenter bee, mason bee, leafcutter bee
(it carries a cut leaf), sweat bee, mining bee and red-tailed bumblebee.

Point at a bee and Hivemind shows its agent's name and state; click it to go to that agent's tile.
Click the open air and the small bees nearby scatter. A bee keeps out from under your tiles, flying
round one in its way; under a see-through tile it shows soft, as a shape behind the glass.

## Using it

Installing never changes your background by itself. Once Hive is installed and on, Hivemind asks
once whether to use Bees as your background ("Bees is installed. Use its wallpaper?"). You can
also pick it any time in **Settings ▸ Appearance ▸ Background**, after the built-in scenes, or
from a terminal:

```bash
hive config set appearance.wallpaper.kind '"@dip497/hive/bees"'
```

[The Appearance guide](https://github.com/dip497/hivemind/blob/main/guide/(use)/appearance.mdx) says
more about backgrounds; [Make a live wallpaper](https://hivemind.griiken.com/guide/live-wallpapers/)
is how one like this is built.

It draws in your theme's colours. Turn on **Colour** under it in Settings for its own: a summer
meadow by day on a light theme, the meadow at dusk on a dark one. Either way the ground stays close
to the sky in tone, so the text of a frosted panel over it reads.

It runs the way Hivemind's own live scenes do: at most 30 frames a second, nothing at all while
the window is hidden, idle or covered, and one still picture when **Animate the background** is
off or your system asks for less motion. It is not drawn behind a plugin view, such as
Archipelago, or on the phone page.

**What it asks for.** Nothing. It runs in a sandboxed frame with no network, and Hivemind tells it
only each agent's program and state and where your tiles are: never a name, a folder or anything
a terminal shows. It can say which bee is under the pointer, and nothing else.

## Working on it

The scene's TypeScript is in [src/bees](src/bees), beside the wallpaper, and `npm run build` at
the top of this repository bundles it into `wallpapers/bees/dist/main.js`, which is committed.
Only the wallpaper's folder installs; the sources, the harness and this package's tests do not.

| File | What it holds |
| --- | --- |
| `src/bees/meadow.ts` | The bees and where they fly: each state's place, the dance, the way round a tile, the hit test. No drawing. |
| `src/bees/ground.ts` | The meadow, the hills, the flowers and the hive, laid out in cells from a fixed seed. |
| `src/bees/species.ts` | Each species' body, cell by cell. |
| `src/bees/render.ts`, `palette.ts` | The drawing, and its colours in the theme's two and in its own. |
| `src/bees/scene.ts`, `main.ts` | What the app tells it, wired to the meadow and the app's clock. |
| `harness/` | A page that runs the build against the SDK's fake host, with tiles and a glass panel over it, for pictures and timing. |

```bash
npm run build
bun packages/hive/harness/shoot.ts --out /tmp/bees --perf    # pictures in four looks, then frame times
bun test tests/hive-wallpaper.test.ts                        # the scene, its colours, the package, the build in Chromium
hive plugins check packages/hive && hive plugins install packages/hive
```

Measured over 600 frames in headless Chromium, which draws in software: a median of 1 ms of script
a frame at 1440×900 and at 1280×800 at 2×, and 3.3 ms and 6.7 ms a frame with the canvas painted.

Merging to `main` publishes the package to HiveHub, as every package here is.
