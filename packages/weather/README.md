# Weather

Two live wallpapers for [Hivemind](https://github.com/dip497/hivemind): weather drawn in characters
behind the canvas. Each scene is painted as a picture first, then drawn through characters chosen
by the picture's light: dense ones where it is bright, lines along its edges, braille dots in the
sky. Each fills the whole screen from its first frame (more of it on a bigger screen), goes on by
itself, and plays with your pointer. They sit calmly behind your terminals: what is busy and bright
keeps low on the window, and the ground over the rest stays dark enough by night (or light enough by
day) for a frosted panel's text to read over it.

Each scene draws in its own colours: by night on a dark theme, by day on a light one. They know
nothing of your agents or your tiles: nothing in them is named, and a click on one opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scenes

**Snowfall** (`@dip497/weather/snow`). A mountain village under falling snow. Moonlit peaks stand
behind, each with a lit face and a face in shade. Below them is a forest of spruce, and a snowy
slope with the village on it in three depths. A white church with a spire stands at its heart, with
a lodge in front. The houses are dark wood under white roofs, and warm lanterns line the path up to
the church door. Flakes fall in three depths, carried by a wind that comes in gusts. The snow piles
up slowly on the ground, the roofs and the branches, and stops at its most. Smoke curls from the
chimneys, and windows light and go dark. By day it is a clear, sunlit valley: a blue sky, white snow
with blue shadows, dark wood and sharp pines.
- *The pointer*: a gust of its own. The flakes and the smoke near it are blown away from it, and
  swept along as it moves.
- *A click*: a puff of powder bursts out from there, hangs a moment and drifts down.

**Northern Lights** (`@dip497/weather/northern-lights`). A tundra at night: a far ridge, a dark line
of spruce along the snow, a cabin with its window lit. Above them the aurora is drawn in braille
dots, each cell two columns of four. It is one ribbon of light whose lower edge folds and ripples,
brightest along that edge and where it folds, fading upward in rays from green to teal to violet.
Its light lies on the snow. Now and then a shooting star crosses the sky. By day it is dawn: the sky
goes from periwinkle overhead to a peach glow where the sun will rise, and a faint aurora remains,
its edge drawn in dots.
- *The pointer*: the curtain leans toward it, dips toward it and brightens round it.
- *A click*: a shooting star streaks from there across the sky.

When **Animate the background** is off, or your system asks for reduced motion, each scene is one
still picture; while the window is hidden or idle it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/weather
```

The app offers Snowfall as your background once it is installed. To choose a scene yourself, open
**Settings ▸ Appearance ▸ Background**, where both are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/weather/northern-lights"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. More on live
wallpapers: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its two wallpapers, and Snowfall offered on install
wallpapers/<scene>/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp,
                               and fonts/ (JetBrains Mono, a Latin subset, semibold, and its licence)
src/                           the scenes' TypeScript: the picture and the character pass they
                               share, and a folder per scene
harness/                       a page that serves the scenes as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<scene>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/weather.test.ts`; `bun packages/weather/harness/shoot.ts
--preview --look --perf` draws each picker picture, a look at each scene, and times each scene's draw.

## Credits

The characters are drawn in [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © 2020 The
JetBrains Mono Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt` in each
wallpaper). Braille dots are drawn as shapes on the cell grid, not as characters.
