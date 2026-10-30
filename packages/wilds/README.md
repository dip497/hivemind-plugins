# Wilds

Three live wallpapers for [Hivemind](https://github.com/dip497/hivemind): nature on land, drawn in
characters behind the canvas, each a world of its own that moves by itself and plays with your
pointer. Each fills the window from its first frame (more of it on a bigger screen) and draws each
in a different way of drawing in characters: blocks of leaves, a shaded ramp of glyphs, a character
fire. The busy, bright parts keep low on the screen and to its edges; the sky and the ground under
your panels stay dark enough (or light enough) for their text to read over them.

Each scene has its own colours: a night picture on a dark theme and a daytime (or dusk) one on a
light theme. They know nothing of your agents or your tiles: nothing in them is named, and a click
on one opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scenes

**Autumn Wood** (`@dip497/wilds/autumn`). A forest edge in autumn: a big tree at each edge and
smaller ones further back, their trunks grooved with bark and their crowns clumps of leaves in reds,
ambers, golds and a few late greens; leaves letting go and tumbling down on a gusting wind and piling
up along the floor, the pile slowly settling; now and then a fox trotting or a deer stepping across
the bottom; mist low between the trees. At night, dusk: a deep violet-blue sky, a low sun glowing
warm behind the far trees, a lantern on a branch and fireflies. By day, a crisp blue sky and bright
leaves.
- *The pointer*: a breeze from it swirls the falling leaves round it, and lifts them off the pile.
- *A click*: the nearest tree shakes and lets go of a flurry of leaves (and a fox or deer near it bolts).

**Dunes** (`@dip497/wilds/dunes`). A desert of rolling dunes, each cell shaded from the sand's height
lit from the side, in the ramp ` .:-=+*#%@`, wind ripples banding their faces; sand streaming off the
crests; a caravan of camels and walkers crossing slowly along a ridge, going behind a nearer dune
and out again. At night a huge moon low over the horizon, stars, cool blue-silver dunes; by day hot
gold dunes under a pale sky, heat shimmering far off over a mirage.
- *The pointer*: a small dust devil follows it, whirling sand up round it.
- *A click*: a gust bursts sand up and out from there, and it settles back.

**Campfire** (`@dip497/wilds/campfire`). A clearing at night: a campfire in the lower middle, a
character fire (heat rising cell by cell through a ramp of glyphs and colours, deep red to
white-yellow) in a ring of stones, its logs leaned together; sparks rising and winking out, smoke
curling up; firs all round, warm where the firelight reaches; stars and a crescent moon; crickets
blinking in the grass. On a light theme, dusk: a lavender sky going peach, soft violet firs, the fire
smaller and calmer.
- *The pointer*: the flames lean toward it, and the sparks drift to it.
- *A click*: a log falls in, and the fire flares up with a burst of sparks.

When **Animate the background** is off, or your system asks for reduced motion, each scene is one
still picture; while the window is hidden or covered it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/wilds
```

The app offers Autumn Wood as your background once it is installed. To choose a scene yourself, open
**Settings ▸ Appearance ▸ Background**, where the three are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/wilds/dunes"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. More about live
wallpapers: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its three wallpapers, and Autumn Wood offered on install
wallpapers/<scene>/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp, and
                               fonts/ (JetBrains Mono, a Latin subset, semibold, and its licence)
src/                           the scenes' TypeScript: what they share, and a folder per scene
harness/                       a page that serves the scenes as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<scene>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/wilds.test.ts`; `bun packages/wilds/harness/shoot.ts --preview
--perf` draws each picker picture and times each scene's draw (`--look` draws each at play).

## Credits

The characters are drawn in [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © 2020 The
JetBrains Mono Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt` in each
wallpaper). The scenes' code is this package's own.
