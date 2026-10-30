# City

Three live wallpapers for [Hivemind](https://github.com/dip497/hivemind): a city drawn in
characters behind the canvas, each scene in a way of its own. Each fills the whole window from its
first frame (more of it on a bigger screen), goes on by itself, and plays with your pointer. Each has
a night, on a dark theme, and a day, on a light one. They sit calmly behind your terminals: the busy,
bright part of each scene keeps low or to the sides, and the sky over the rest stays dark enough (or
light enough) for a frosted panel's text to read over it.

They know nothing of your agents or your tiles: nothing in them is named, and a click on one opens
nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scenes

**Skyline** (`@dip497/city/skyline`). A city's skyline across the lower part of the window, two rows
of buildings outlined in box-drawing lines, each its own height and roof (water tanks, masts with
blinking red lights, spires, domes, setbacks), their windows lighting up and going dark as people
come and go; a street along the bottom with headlights and tail lights passing, street lamps, and
now and then a plane crossing the sky. At night a deep blue-black sky, a moon, warm and cool windows;
by day a pale sky, drifting clouds, buildings in soft greys, cream stone and brick, their glass
catching the sky.
- *The pointer*: rest it by the buildings, and people come to the windows nearest it, one after
  another, each switching on a light to look out.
- *A click*: a firework goes up and bursts in the sky above it.

**Metro** (`@dip497/city/metro`). A transit map made up for your window: five to eight coloured
lines running across, down and at 45°, crossing at interchanges, a station at every tick, a river
winding under them, parks, and invented districts named in small capitals; trains run each line end
to end, slowing into each station and standing there a moment. At night the lines glow on a dark
map; by day it is a printed paper map, off-white, with ink-dark names.
- *The pointer*: rest it by a line, and that line lights up over the rest and its trains hurry.
- *A click*: a new train comes onto the nearest line from there; a line holds five, and when a new
  one comes, its oldest leaves.

**Sunset Drive** (`@dip497/city/sunset`). A drive toward a big striped sun going down behind layered
mountains, in half-block pixels (each character cell an upper and a lower pixel): a grid floor
scrolling toward you, palms and cacti passing at the sides, the stars coming out as the sun sinks.
At night magenta, violet and orange on deep indigo; by day a pastel dawn of lilac, peach and pale
gold.
- *The pointer*: the view leans toward it, the horizon and the sun drifting a little its way, the
  far mountains more than the near ones.
- *A click*: a pulse of light runs along the grid from it to the horizon (down the sky, if you click
  above it), and flashes along the horizon where it gets there.

When **Animate the background** is off, or your system asks for reduced motion, each scene is one
still picture; while the window is hidden or idle it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/city
```

The app offers Skyline as your background once it is installed. To choose a scene yourself, open
**Settings ▸ Appearance ▸ Background**, where the three are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/city/metro"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. More about live
wallpapers: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its three wallpapers, and Skyline offered on install
wallpapers/<scene>/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp,
                               and fonts/ (JetBrains Mono, a Latin subset, semibold, and its licence)
src/                           the scenes' TypeScript: what they share, and a folder per scene
harness/                       a page that serves the scenes as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<scene>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/city.test.ts`; `bun packages/city/harness/shoot.ts --preview
--shots --perf` draws each picker picture, pictures each scene at play, and times each scene's draw.

## Credits

The characters are drawn in [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © 2020 The
JetBrains Mono Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt` in each
wallpaper). Box-drawing lines, blocks and half blocks are drawn as shapes on the cell grid, not taken
from the font.
