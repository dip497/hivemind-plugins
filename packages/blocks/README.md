# Blocks

Three live wallpapers for [Hivemind](https://github.com/dip497/hivemind): toy-like worlds of blocks
and studded bricks behind the canvas, whose life goes on by itself and plays with your pointer.
Each fills the whole screen from its first frame, with more of it on a bigger screen, and keeps the
world as it was when the window changes size.

Each scene is drawn in its own colours: a pale daytime version on a light theme, a night one
on a dark theme. They keep calm behind your work: the busiest, brightest parts sit low and toward the
edges, and everything large stays light enough (or dark enough) for a frosted panel's text to read
over it. They know nothing of your agents or your tiles: nothing in them is named, and a click on one
opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scenes

**Block Island** (`@dip497/blocks/island`). An island of blocks floating in the sky over a sea of
clouds: grass over dirt over stone, rock hanging underneath, a cottage with a smoking chimney,
lantern posts, trees whose leaves rustle as a gust passes, and a pond whose water runs over the
edge and falls away into the clouds. Sheep and hens wander block by block, graze and peck, and hop up
and down a block. By day the sky is pale blue under a square sun; by night it is deep blue with stars
and a square moon, and the windows and lanterns glow.
- *The pointer*: rest it on the island (or the sky beside it), and the animals nearest it turn and
  wander over to stand round it, facing it.
- *A click*: on the island, a block pops out with a puff of crumbs; a little later it grows back, or
  a sapling sprouts there and grows into a tree (while the island has room for a few more). On the
  pond, a splash; on a tree, a shower of leaves; in the sky, a small cloud puffs out.

**Brick Town** (`@dip497/blocks/bricktown`). A town of studded toy bricks on a baseplate that runs
past every edge of the window: houses in bright colours with windows, doors and stepped roofs, a
tower or two, gardens with round brick trees and flower beds, fountain squares, street lamps, cars
driving the streets and taking turns at the crossings, little brick people strolling the pavements,
and a train going round its loop in the park. At night the windows and the street lamps are lit and
the cars drive with their lights on.
- *The pointer*: rest it over the town, and the people near it stop, turn to it and look up at it,
  one arm raised.
- *A click*: a brick drops from above the window, bounces and snaps onto the stack nearest the
  click: a roof, a garden, or the bricks dropped there before. Sixteen stay; past that, the brick
  dropped longest ago is lifted away again.

**Block Valley** (`@dip497/blocks/valley`). A valley of blocks in 3D, seen from a camera that
sweeps slowly to and fro above it: a river comes down between two snow-capped peaks into a lake,
past a village of cottages with lanterns and fenced fields of crops, over rolling hills of trees,
pines and bushes, with more peaks fading into the haze. Clouds of blocks drift over and small V
flocks of birds fly past. A hazy summer morning by day; a moonlit night on a dark theme, with stars
and a square moon, the tops of the blocks catching the moonlight and the village's windows and
lanterns lit. It draws with WebGL2; on a computer without it, or if it loses it, it shows the
valley as one still picture of blocks instead.
- *The pointer*: the camera turns gently toward it.
- *A click*: on the land, a block falls from the sky onto the spot, bounces and settles (stacking on
  any dropped there before; the oldest sink away past 24). In the sky, a small cloud puffs out.

When **Animate the background** is off, or your system asks for reduced motion, each scene is one
still picture; while the window is hidden or idle it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/blocks
```

The app offers Block Island as your background once it is installed. To choose a scene yourself,
open **Settings ▸ Appearance ▸ Background**, where the three are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/blocks/bricktown"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. How live
wallpapers work, and how to make your own: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its three wallpapers, and Block Island offered on install
wallpapers/<scene>/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp
src/                           the scenes' TypeScript: what they share, and a folder per scene
harness/                       a page that serves the scenes as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<scene>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/blocks.test.ts`; `bun packages/blocks/harness/shoot.ts --preview
--perf` draws each picker picture and times each scene's draw.

Everything here is drawn by its own code: no pictures, fonts or models are bundled.
