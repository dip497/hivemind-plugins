# Weather

Three live wallpapers for [Hivemind](https://github.com/dip497/hivemind): weather drawn in
characters behind the canvas, each in a different way of drawing with them. Each fills the whole
screen from its first frame (more of it on a bigger screen), goes on by itself, and plays with your
pointer. They sit calmly behind your terminals: what is busy and bright keeps low on the window,
and the ground over the rest stays dark enough by night (or light enough by day) for a frosted
panel's text to read over it.

Each scene draws in its own colours: by night on a dark theme, by day on a light one. They know
nothing of your agents or your tiles: nothing in them is named, and a click on one opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scenes

**Rain on Glass** (`@dip497/weather/rain`). Looking out through a rainy window at night: a city's
lights out of focus behind the glass (street lamps running off down the street, signs, cars,
windows), raindrops beading on the glass a cell at a time, swelling, running down in wandering
streaks that take up the beads in their way and leave a trail of small ones and a clear line through
the condensation. Each drop shows the light behind it: amber by the lamps, pink by the signs. By day,
a grey-white overcast street, its lights pale, the drops dark on it.
- *The pointer*: a finger on the glass. Resting or moving, it wipes a clear path through the
  condensation, which fogs over again in a quarter of a minute.
- *A click*: a tap on the glass. The drops near it shiver, then shake loose and run.

**Snowfall** (`@dip497/weather/snow`). A mountain village at dusk, in block cells: peaks behind,
forested hills, houses with steep roofs and warm windows, pines in tiers. Flakes fall in three
depths (far ones a dot, the ones among the houses a character, near ones a six-armed star), carried
by a wind that comes in gusts. The snow piles up on the ground, the roofs and the branches, slowly,
and stops at its most; smoke curls from the chimneys. By day, a bright cold blue-white valley.
- *The pointer*: a gust of its own. The flakes and the smoke near it are blown away from it, and
  swept along as it moves.
- *A click*: a puff of powder bursts out from there, hangs a moment and drifts down.

**Northern Lights** (`@dip497/weather/northern-lights`). A tundra at night under the stars, a dark line of spruce
along the snow, and over it curtains of the northern lights drawn in braille dots, each cell two
columns of four: a bright lower edge folding and rippling, rays rising from it, green going teal and
violet as they rise, a pink fringe under its brightest edge, shimmering. Shooting stars now and
then; snow blowing along the ground. By day, a pale polar sky, a low sun with its halo and sun dogs,
and a faint pastel aurora.
- *The pointer*: the curtain leans toward it and brightens round it.
- *A click*: a shooting star streaks from there across the sky.

When **Animate the background** is off, or your system asks for reduced motion, each scene is one
still picture; while the window is hidden or idle it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/weather
```

The app offers Rain on Glass as your background once it is installed. To choose a scene yourself,
open **Settings ▸ Appearance ▸ Background**, where the three are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/weather/northern-lights"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. More on live
wallpapers: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its three wallpapers, and Rain on Glass offered on install
wallpapers/<scene>/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp,
                               and fonts/ (JetBrains Mono, a Latin subset, semibold, and its licence)
src/                           the scenes' TypeScript: what they share, and a folder per scene
harness/                       a page that serves the scenes as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<scene>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/weather.test.ts`; `bun packages/weather/harness/shoot.ts
--preview --look --perf` draws each picker picture, a look at each scene, and times each scene's draw.

## Credits

The characters are drawn in [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © 2020 The
JetBrains Mono Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt` in each
wallpaper). Blocks, braille dots and the big snowflakes are drawn as shapes on the cell grid, not as
characters.
