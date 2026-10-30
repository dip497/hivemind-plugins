# Patterns

Three live wallpapers for [Hivemind](https://github.com/dip497/hivemind), each a living pattern
grown from a few simple rules and drawn behind the canvas as a picture in characters: the picture is
painted first (gradients, light and shadow, glow), then characters go where they add something, on
the pattern itself and its edges, while the large areas stay the clean painted picture. Each fills
the whole window from its first frame, renews itself so it never runs down or fills up, and plays
with your pointer. Their grounds are kept dark at night and light by day, so the app's frosted
panels stay easy to read over them.

Each pattern is drawn in its own colours: a dark version on a dark theme and a light one on a light
theme. They know nothing of your agents or your tiles: nothing in them is named, and a click on one
opens nothing.

Needs **Hivemind 2026.10.8** or newer. They draw in WebGL2, and in a plainer 2D where a computer
has no WebGL2.

## The patterns

**Life** (`@dip497/patterns/life`). Conway's Game of Life on a board of character cells sized to
your window, its edges joined, drawn as a glowing colony in a dish. A newborn cell lights up as a
bright `@`, and as it lives on it settles through `&`, `*` and `x` into a dim `#`; its light glows
round it and pools where life is thick, and a cell that dies leaves its light behind, fading.
Wherever the board goes still, a seed is sown there again (an R-pentomino, a few gliders, a patch of
noise), so it never dies out or freezes. Greens and teals glowing in a dark teal dish at night;
indigo and sepia inks with watercolour washes on paper by day.
- *The pointer*: moving or resting, it sows living cells under and around it.
- *A click*: drops a glider, a small spaceship or an R-pentomino there, with a ring of light.

**Sand** (`@dip497/patterns/sand`). A falling-sand world in front of a painted desert: grains pour
slowly from a few spouts above the window, wandering from side to side and changing colour as they
go, then tumble and slide into dunes with sloping sides, laid down in bands. Once the sand covers a
sixth of the window it drains slowly through the floor, so the bands sink and it never fills up.
Behind it, mesas against a low sun; the dunes' faces toward the sun are lit, the far sides in
shadow, their outlines and lit crests drawn in characters, each stream a falling line of `|`. A
dusk with a few stars at night; a bright day by day.
- *The pointer*: rest it over the window and sand pours from it; move it and it sprinkles a few grains.
- *A click*: a burst knocks the grains near it up and outward, and they fall back.

**Glyph Rain** (`@dip497/patterns/glyphs`). Columns of letters, digits and symbols (Latin and Greek)
falling at three depths, the far ones smaller, slower and dimmer. Each stream has a bright head that
changes its character with every cell it enters, and a tail fading behind it whose characters flip
now and then, and the heads' light glows round them. Between the streams there are no characters,
only the sky and a haze thickening toward the ground. At night the rain runs from a pale cyan head
through teal and blue into violet; by day it is ink on paper, cobalt heads and indigo tails.
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
