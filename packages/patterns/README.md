# Patterns

Three live wallpapers for [Hivemind](https://github.com/dip497/hivemind), each a living pattern
grown from a few simple rules and drawn in characters behind the canvas. Each fills the whole window
from its first frame, renews itself so it never runs down or fills up, and plays with your pointer.
They are drawn calm and low in contrast, so your terminals and the app's frosted panels stay easy to
read over them.

Each pattern is drawn in its own colours: a dark version on a dark theme and a light one on a light
theme. They know nothing of your agents or your tiles: nothing in them is named, and a click on one
opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The patterns

**Life** (`@dip497/patterns/life`). Conway's Game of Life on a board of character cells sized to
your window, its edges joined. A newborn cell lights up as a bright `@`, and as it lives on it
settles through `#`, `%` and `*` into a quiet `o`; a cell that dies leaves a trace of dots that
fades. Wherever the board goes still, a seed is sown there again (an R-pentomino, a few gliders, a
patch of noise), so it never dies out or freezes. Soft greens and teals on near-black at night;
indigo and sepia inks on paper by day.
- *The pointer*: moving or resting, it sows living cells under and around it.
- *A click*: drops a glider, a small spaceship or an R-pentomino there, with a ring of light.

**Sand** (`@dip497/patterns/sand`). A falling-sand world: grains pour slowly from a few spouts above
the window, wandering from side to side and changing colour as they go, then tumble and slide into
dunes with sloping sides, laid down in bands. Once the sand covers a sixth of the window it drains
slowly through the floor, so the bands sink and it never fills up. Each grain is half a character
cell, a half block. Warm sands glowing softly on a dark sky at night; pastel sands on cream by day.
- *The pointer*: rest it over the window and sand pours from it; move it and it sprinkles a few grains.
- *A click*: a burst knocks the grains near it up and outward, and they fall back.

**Glyph Rain** (`@dip497/patterns/glyphs`). Columns of letters, digits and symbols (Latin and Greek)
falling at three depths, the far ones smaller, slower and dimmer. Each stream has a bright head that
changes its character with every cell it enters, and a tail fading behind it whose characters flip
now and then. At night the rain runs from a pale cyan head through teal and blue into violet; by day
it is ink on paper, dark heads and grey tails.
- *The pointer*: the columns part around it, and the characters near it flicker.
- *A click*: a ring spreads from it, scrambling and brightening the characters it passes.

When **Animate the background** is off, or your system asks for reduced motion, each pattern is one
still picture; while the window is hidden or idle it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/patterns
```

The app offers Life as your background once it is installed. To choose a pattern yourself, open
**Settings ▸ Appearance ▸ Background**, where the three are listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/patterns/sand"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. How live wallpapers
work, and how to make one: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its three wallpapers, and Life offered on install
wallpapers/<pattern>/          what installs: hivemind-wallpaper.json, dist/main.js, preview.webp,
                               and fonts/ (JetBrains Mono, semibold, in subsets, and its licence)
src/                           the patterns' TypeScript: what they share, and a folder per pattern
harness/                       a page that serves the patterns as the app does, for pictures and timing
```

`npm run build` at the repository's root bundles `src/<pattern>/main.ts` into each wallpaper's
`dist/main.js`. The tests are `tests/patterns.test.ts`; `bun packages/patterns/harness/shoot.ts
--preview --shots --perf` draws each picker picture, pictures each pattern at play, and times each
pattern's draw.

## Credits

The characters are drawn in [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), © 2020 The
JetBrains Mono Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt` in each
wallpaper). The Game of Life is John Conway's.
