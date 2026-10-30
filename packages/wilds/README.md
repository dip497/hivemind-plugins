# Wilds

A live wallpaper for [Hivemind](https://github.com/dip497/hivemind): nature on land, a world of its
own behind the canvas that moves by itself and plays with your pointer. It is a painted
picture drawn with characters where they add something: its outlines in line glyphs (`/ \ | -`), its
subject in a ramp of glyphs, and its small moving things (sparks, stars, crickets) as
characters of their own. It fills the window from its first frame (more of it on a bigger screen).
The bright, busy parts keep low on the screen; the sky and the ground under your panels stay dark
enough (or light enough) for their text to read over them.

The scene has its own colours: a night picture on a dark theme and a dusk or daytime one on a light
theme. It knows nothing of your agents or your tiles: nothing in them is named, and a click on one
opens nothing.

Needs **Hivemind 2026.10.8** or newer.

## The scene

**Campfire** (`@dip497/wilds/campfire`). A clearing at night: a campfire in the lower middle, its
flames shaped by heat rising through them (tongues licking up, red at the edges, white-yellow at the
heart, characters over them), sparks rising and winking out, smoke curling up; a ring of stones, the
logs leaned together, a log to sit on and a woodpile, all lit on their fire side; fir silhouettes
all round under the stars and a crescent moon; crickets blinking in the grass. On a light theme,
dusk: a lavender sky going peach, violet firs, the fire smaller and calmer.
- *The pointer*: the flames lean toward it, and the sparks drift to it.
- *A click*: a log falls in, and the fire flares up with a burst of sparks.

When **Animate the background** is off, or your system asks for reduced motion, the scene is one
still picture; while the window is hidden or covered it draws nothing at all.

## Install and use

```bash
hive plugins install @dip497/wilds
```

The app offers Campfire as your background once it is installed. To choose it yourself, open
**Settings ▸ Appearance ▸ Background**, where it is listed after the built-in ones, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/wilds/campfire"'
```

Each wallpaper runs in a sandboxed frame of its own and asks for no permissions. More about live
wallpapers: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json          the package: its wallpaper, Campfire, offered on install
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
