# Diorama

A live wallpaper for [Hivemind](https://github.com/dip497/hivemind): **Coast**, an endless coast
seen from high above like a scale model on a table, drawn in coloured characters. The camera drifts
along it for ever and never comes to the end of it: the world is worked out from where you are, so
there is always more coast ahead, and it comes round again, without a seam, only after fifty minutes
of drifting.

Needs **Hivemind 2026.10.8** or newer.

## Coast

`@dip497/diorama/coast`. Below, the sea: deep blue far out, turning green over the shallows, swell
rolling in toward the shore and breaking white on the sand and round the rocks, the swash running
up the beach and back. Above it the land: beaches and coves, cliffs that rise and fall along the
coast, grass on the clifftops leaning in the wind, patches of flowers, woods inland, a path along
the top lit by lanterns, cottages now and then, and every so often a lighthouse. Boats ride at sea
and gulls wheel over it all. A band through the middle is sharp and the top and bottom go soft, the
way a photograph of a model does.

Every surface is drawn in its own characters: the water in rows of `~` and `-` that thicken where
the swell is high, the foam in `o`, `%` and `*`, the grass in strokes that lean with it, the cliffs
and stone in `#`, the path and the roofs in lines. Each character takes the colour of what is under
it.

- *The pointer*: a breeze through the grass round it.
- *A click*: on the sea, rings spread out across the water from where you clicked; on the land, a
  gust through the grass.

It draws in its own colours, glowing on a dark ground on a dark theme and inked on paper on a light
one; turn off **Colour** in Settings and it draws in your theme's two colours instead. The panels over it
stay readable either way: the sea and the land are kept dark enough on a dark theme (light enough on
a light one) for a frosted panel's text to read over them.

When **Animate the background** is off, or your system asks for reduced motion, it is one still
picture of the coast; while the window is hidden it draws nothing at all. It knows nothing of your
agents or your tiles: nothing in it is named, and a click on it opens nothing.

## Install and use

```bash
hive plugins install @dip497/diorama
```

The app offers Coast as your background once it is installed. To choose it yourself, open
**Settings ▸ Appearance ▸ Background**, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/diorama/coast"'
```

It runs in a sandboxed frame of its own and asks for no permissions. More about live wallpapers:
https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json      the package: the Coast wallpaper, offered on install
wallpapers/coast/          what installs: hivemind-wallpaper.json, dist/main.js, preview.webp, LICENSE
src/coast/                 the wallpaper's TypeScript
  world.ts                 the coast as functions of where you are (the shore, beaches, cliffs, the
                           path, what grows where), in GLSL for the shaders and in JS for the camera
  scene.ts                 the ground, the sea, the grass, the trees and the things along the path,
                           each drawn round the camera and coming round again as it moves
  ascii.ts                 the pass that draws the scene in characters, with the tilt-shift blur
  camera.ts                where the camera is and where it looks, along the coast
  main.ts                  the wallpaper: the clock, the pointer and clicks, the look
harness/                   pictures, films and timings of it (shoot.ts, film.ts, perf.ts)
```

`npm run build` at the repository's root bundles `src/coast/main.ts` into `wallpapers/coast/dist/`.
The tests are `tests/diorama.test.ts`. `bun packages/diorama/harness/shoot.ts <dir>` takes its
pictures in every look and the picker's previews; `bun packages/diorama/harness/film.ts <dir> own 20`
films 20 seconds of it, frame by frame; `bun packages/diorama/harness/perf.ts` times a frame.

## Credits

- The way the scene becomes characters (a class for each surface, written beside its colour, then
  a pass that picks each cell's character by its class, brightness and edge, over a blurred copy,
  and the tilt-shift) follows [JDhruv14/ascii-diorama](https://github.com/JDhruv14/ascii-diorama)
  (MIT, © 2026 JDhruv14). The coast, its world and its shaders are this package's own.
- It is drawn with [three.js](https://threejs.org) (MIT, © 2010–2026 three.js authors), bundled
  into `dist/main.js`. Both licences are in `wallpapers/coast/LICENSE`.
