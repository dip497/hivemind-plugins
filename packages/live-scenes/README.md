# Live scenes

Four live wallpapers for [Hivemind](https://github.com/dip497/hivemind): worlds drawn in characters
behind the canvas, whose life goes on by itself and plays with your pointer. Each fills the whole
screen from its first frame, a creature of every kind in it and more on a bigger screen, each going
about its own business in its own rhythm. They sit calmly behind your terminals: the busy part of
each scene keeps to the bottom of the window, and the water or the sky over the rest stays dark
enough (or light enough) for a frosted panel's text to read over it.

Each scene is drawn in its own colours, a dark version on a dark theme and a light one on a light
theme. They know nothing of your agents or your tiles: nothing in them is named, and a click on one
opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scenes

**Shoal** (`@dip497/live-scenes/shoal`). A reef's water seen from above: schools of small fish of
five species, and a shark of each of eight kinds (classic, hammerhead, tiger, mako, thresher, zebra,
great hammerhead, nurse) hunting them, cruising, or resting low over the reef, each in its own
time. Light shafts sway down from the surface. Along the bottom, a reef of coral, sea fans, sponges
and rocks on the sand, meadows of seagrass, and stands of tall kelp, floats and blades along each
stalk, swaying from the root.
- *The pointer*: the fish scatter from it; now and then a curious shark comes up to glide past it.
- *A click*: a ring spreads through the water, and the fish near it burst away.

**Koi Pond** (`@dip497/live-scenes/koi`). Koi under drifting lily pads, seen from above, one of each
variety (kohaku, showa, ogon, asagi, sanke, tancho, platinum, chagoi), each known by its pattern;
they cruise, idle deep, come up to mouth at the surface, and chase the fry now and then. Pads turn
slowly, some in flower; rings spread where something touches the water. In both bottom corners a
bed of reeds, rushes and cattails stands in the mud, a few smaller clumps along the bank between.
- *The pointer*: rest it on the pond, and the koi near it drift over and mill about under it.
- *A click*: drops a few pellets, and the koi nearest race to eat them.

**Jellyfish** (`@dip497/live-scenes/jellyfish`). Jellies pulsing through the deep sea, one of each
of eight kinds (moon, mauve stinger, sea nettle, crystal, lion's mane, fried egg, spotted, crown):
each a glowing dome wider than it is tall, its rim scalloped, its pattern showing through, frilled
oral arms under it and long fine tentacles trailing and swaying behind it. They roam, drift with the
current or rest low, and marine snow falls through it all.
- *The pointer*: pushes the snow aside, and nudges the jellies away.
- *A click*: a pulse spreads through the water; the jellies it reaches flash, and jet away from it.

**Fireflies** (`@dip497/live-scenes/fireflies`). A meadow at night under the stars (at dusk on a
light theme): fireflies of eight kinds, each known by the colour of its light and the code it
flashes, flying about, drifting, or settled glowing in the grass, and many small ones blinking over
the meadow. The grass stands in layers: a turf along the very bottom, short pale grass far back,
tufts in the middle, and in front the tall grass, darker, some blades with leaves and many gone to
seed, reaching a fifth to a quarter of the way up the window, each clump swaying out of step.
- *The pointer*: rest it in the night, and the fireflies near it drift over and circle it.
- *A click*: a burst of light; the fireflies near it flash and scatter, the small ones answering as
  it reaches them.

When **Animate the background** is off, or your system asks for reduced motion, each scene is one
still picture; while the window is hidden or idle it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/live-scenes
```

The app offers Shoal as your background once it is installed. To choose a scene yourself, open
**Settings ▸ Appearance ▸ Background**, where the four are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/live-scenes/jellyfish"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions.

## In this folder

```
hivemind-package.json          the package: its four wallpapers, and Shoal offered on install
wallpapers/<scene>/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp,
                               fonts/ (JetBrains Mono, a Latin subset, semibold, and its licence),
                               and LICENSE (ascii-sharks', the code Shoal grew from)
src/                           the scenes' TypeScript: what they share, and a folder per scene
harness/                       a page that serves the scenes as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<scene>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/live-scenes.test.ts`; `bun packages/live-scenes/harness/shoot.ts
--preview --perf` draws each picker picture and times each scene's draw.

## Credits

- Shoal grew from [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks) (MIT,
  © 2026 drewdi). Koi Pond swims on the same code, and every scene shares a few of its helpers, so
  its licence is in each wallpaper's folder (`wallpapers/<scene>/LICENSE`), and beside Shoal's
  sources in `src/shoal/LICENSE`.
- The characters are drawn in [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © 2020
  The JetBrains Mono Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt` in each
  wallpaper).
