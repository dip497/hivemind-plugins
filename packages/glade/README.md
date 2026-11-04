# Glade

A live wallpaper for [Hivemind](https://github.com/dip497/hivemind): **Glade**, a clearing in a deep
forest at night, in pixel art lit like a real scene. Every pixel knows which way it faces, how high
it stands and how near it is, so the fire lights the side of the tent that faces it, warms the
ground round it and glows through the leaves, and the fog thickens toward the far trees.

Needs **Hivemind 2026.10.8** or newer.

## Glade

`@dip497/glade/glade`. A campfire burns in its ring of stones in the middle of the clearing, a tent
and a woodpile behind it, a fox asleep at its side. An old stump has been made a cottage, its round
windows lit and smoke curling from its chimney; lanterns stand along the path to it, past a
signpost; candles burn on a stump by the trees. A pond lies to the right with lily pads and reeds,
mirroring the forest beyond it, moonlight glinting on it. Glowing mushrooms and red toadstools
grow at the trees' feet. Above, the moon in a gap of sky and the stars; all round, the forest,
greyer the further off it is.

It goes on by itself:

- The fire flickers and throws sparks, its embers breathing in the ash.
- Fireflies wander and blink, and the brightest light up what is near them.
- Grass, reeds and leaves lean in the wind, a pixel at a time.
- Now and then a deer comes out of the trees to graze at the clearing's edge, and eyes shine in the
  dark of the forest. A fish rises in the pond.
- The weather turns over about seven minutes: a clear night, then mist rising off the ground, then
  rain, which rings the pond and dims the stars and leaves the ground wet a while after.

You can play with it:

- *The pointer*: rest it in the glade, and the fireflies near it drift over to it.
- *A click*: on the fire, it flares up with a burst of sparks; on the pond, rings spread across
  it; anywhere else, the fireflies near it scatter.

It draws in its own colours: a night on a dark theme, and on a light theme a pale misty morning,
the sun low through the trees and the lamps out. Turn off **Colour** in Settings and it draws in
your theme's two colours instead. The panels over it stay readable either way: the scene is kept
dark enough on a dark theme (light enough on a light one) for a frosted panel's text to read over
everything but the fire itself.

When **Animate the background** is off, or your system asks for reduced motion, it is one still
picture of a clear night; while the window is hidden it draws nothing at all. It knows nothing of
your agents or your tiles: nothing in it is named, and a click on it opens nothing.

## Install and use

```bash
hive plugins install @dip497/glade
```

The app offers Glade as your background once it is installed. To choose it yourself, open
**Settings ▸ Appearance ▸ Background**, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/glade/glade"'
```

It runs in a sandboxed frame of its own and asks for no permissions. It draws with WebGL2. More
about live wallpapers: https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json      the package: the Glade wallpaper, offered on install
wallpapers/glade/          what installs: hivemind-wallpaper.json, dist/main.js, preview.webp
src/glade/                 the wallpaper's TypeScript
  px.ts                    the painter: art pixels with colour, normal, height, depth and glow
  art.ts                   the things of the glade, each painted with its normals
  glade.ts                 the glade laid out for a screen, and the lights its still things give
  sprites.ts               the moving things' frames: flames, the fox, the deer, smoke, a dot
  life.ts                  what goes on: the fire, sparks, smoke, fireflies, visitors, the weather
  looks.ts                 how it is lit on each theme, and the frame's scene from the life
  shaders.ts, render.ts    the WebGL2 passes: layers, light, water and rain, glow, the picture
  main.ts                  the wallpaper: the clock, the pointer and clicks, the look
harness/                   pictures, films and timings of it (shoot.ts, film.ts, perf.ts)
```

`npm run build` at the repository's root bundles `src/glade/main.ts` into `wallpapers/glade/dist/`.
The tests are `tests/glade.test.ts`. `bun packages/glade/harness/shoot.ts <dir>` takes its pictures
in every look and the picker's previews; `bun packages/glade/harness/film.ts <dir> night 14 30` films
fourteen seconds of it from thirty seconds into its life, frame by frame; `bun
packages/glade/harness/perf.ts` times a frame.

## Credits

The idea of a little pixel-art world lit with real normals and glowing materials came from a work
in progress Caidan Williams shared (https://x.com/caidanwilliams). Glade is its own scene, drawn and
written from scratch; nothing of it is copied.
