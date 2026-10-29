# Hive

A live wallpaper for your canvas: **Bees**, a meadow drawn in characters behind your tiles, tall
grass and flowers, a straw hive in one corner, and its colony at work. Needs Hivemind 2026.10.8 or
later.

```bash
hive plugins install @dip497/hive
```

| Member | What it is for |
| --- | --- |
| [Bees](wallpapers/bees) (live wallpaper) | A meadow along the bottom of your canvas: low hills, grass in layers, flowers in a few colours standing among it, a skep on its stand, and a colony of bees living their own day. It plays with your pointer. |

## What it shows

- **The colony.** More bees on a bigger window, and all eight species among them, each its own
  shape as well as colour: honeybee, bumblebee, carpenter bee, mason bee, leafcutter bee (it
  carries a cut leaf), sweat bee, mining bee and red-tailed bumblebee. Small bees drift between the
  flowers and in and out of the hive.
- **Each bee's day, at its own pace.** It forages from flower to flower, a load of pollen growing
  under it, and carries the load home to the hive's door; it flies loose loops over the hive; now
  and then it rests on the hive, still and dimmed. A lazy bee rests more.
- **The meadow.** Grass in three layers, the far one short and pale, the near one tall and darker,
  reaching up a fifth of the window or so, blades of every height and lean, some with a seed head,
  swaying gently, each clump in its own time.

## How the pointer plays

- **Rest the pointer over the meadow,** and a few bees near it grow curious: they drift over and
  circle it loosely for a while, never more than three, then go back to work. Take the pointer
  away and they leave.
- **Click** the meadow, and there is a puff of pollen where you clicked: the bees near it scatter,
  and a few seconds later they are back at their flowers.

The pointer and clicks reach it only over empty canvas, never over a tile. Pointing at a bee shows
no name, and clicking one opens nothing: the bees are the meadow's, not your agents.

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

It always draws in its own colours, a summer meadow by day with a light theme and the meadow at
dusk with a dark one, so Settings shows no Colour switch for it. The ground stays close to the sky
in tone and the life along the bottom, so your terminals and the text of a frosted panel over it
read.

It runs the way Hivemind's own live scenes do: at most 30 frames a second, nothing at all while
the window is hidden, idle or covered, and one still picture when **Animate the background** is
off or your system asks for less motion. It is not drawn behind a plugin view, such as
Archipelago, or on the phone page.

**What it asks for.** Nothing. It runs in a sandboxed frame with no network. Hivemind tells a live
wallpaper its size, your theme and terminal font, whether to move, and the pointer and clicks over
empty canvas; it also tells it each agent's program and state and where your tiles are (never a
name, a folder or anything a terminal shows). Bees uses none of that last part: its colony lives a
day of its own. It says back only that it is ready and that its first frame is up, never that a bee
is under the pointer.

## Working on it

The scene's TypeScript is in [src/bees](src/bees), beside the wallpaper, and `npm run build` at
the top of this repository bundles it into `wallpapers/bees/dist/main.js`, which is committed.
Only the wallpaper's folder installs; the sources, the harness and this package's tests do not.

| File | What it holds |
| --- | --- |
| `src/bees/meadow.ts` | The colony and the small bees: each bee's day, the pointer's curious few, a click's scatter. No drawing. |
| `src/bees/ground.ts` | The hills, the grass, the flowers and the hive, laid out in cells from a fixed seed. |
| `src/bees/species.ts` | Each species' body, cell by cell. |
| `src/bees/render.ts`, `palette.ts` | The drawing, and its colours by day and at dusk. |
| `src/bees/scene.ts`, `main.ts` | What the app tells it, wired to the meadow and the app's clock. |
| `harness/` | A page that runs the build against the SDK's fake host, with tiles and a glass panel over it and the pointer drawn, for pictures and timing. |

```bash
npm run build
bun packages/hive/harness/shoot.ts --out /tmp/bees --perf    # pictures dark and light, pointer and click, then frame times
bun test tests/hive-wallpaper.test.ts                        # the scene, its colours, the package, the build in Chromium
hive plugins check packages/hive && hive plugins install packages/hive
```

Merging to `main` publishes the package to HiveHub, as every package here is.
