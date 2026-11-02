# Den

Fluffy wolf pups for [Hivemind](https://github.com/dip497/hivemind): a live wallpaper where each of
your agents is a pup in a yard behind your canvas, and a pup widget that sits along the bottom of
your screen. Both pups are the same 3D model, sculpted, furred and posed in code, and both keep an
eye on what your agents are doing.

Needs **Hivemind 2026.10.8** or newer.

## The Den wallpaper

`@dip497/den/den`. Each agent is a pup, its coat chosen by which program it is (all of one
program's pups look alike, in six coats). The yard is the theme's own page colour, a few tufts of
grass swaying in it; with **Colour** on it is a meadow, deep green on a dark theme and pale on a
light one. The pups keep out from under your tiles, finding their way round them, and stay apart.

- **Working:** it potters about the open ground at a trot, stopping to sniff.
- **Ready:** it wanders at a walk and sits, watching the pointer.
- **Needs you:** it runs to the open side of its agent's tile, a ring pulsing under it, and
  play-bows there, hopping and yipping, until you answer.
- **Resting:** it goes down to the bottom of the window and curls up asleep.
- **Gone:** it trots off by the nearest open edge.

What you can do with it:

- **Hover** a pup to see whose it is; **click** it to go to that agent's tile (the pup hops).
- **Rub** the pointer back and forth over a pup to pet it: it sits for it, and bounces up when you
  stop.
- **Click open ground** to drop a ball: the free pup with the shortest way there runs and pounces
  on it.

When **Animate the background** is off, or your system asks for reduced motion, it is one still
picture in which only a pup whose agent changed moves; while the window is hidden or idle it draws
nothing. It draws at most 30 frames a second: in headless Chromium, on software rendering, a frame
with 5 pups takes 2.3 ms (3.1 ms at the 90th percentile) and one with 8 takes 4.6 ms (5.9 ms).

## The Den pup widget

`@dip497/den-pup`, a pup with no card that lives along the bottom of your screen. It yips and
play-bows when an agent starts waiting on you, then sits by the right edge until you answer; leaps
when a turn finishes; and curls up asleep once every agent has been idle a minute and a half. Click
it to go to the agent that waits. More in [its README](widgets/den-pup/README.md).

## Install and use

```bash
hive plugins install @dip497/den
```

The app offers the Den as your background once it is installed. To choose it yourself, open
**Settings ▸ Appearance ▸ Background**, or:

```bash
hive config set appearance.wallpaper.kind '"@dip497/den/den"'
hive ctl plugin open widget:@dip497/den-pup   # the pup widget, or from the toolbar's Add menu
```

Both run in sandboxed frames and ask for no permissions. More about live wallpapers:
https://hivemind.griiken.com/guide/live-wallpapers/

## In this folder

```
hivemind-package.json      the package: the wallpaper and the widget, the wallpaper offered on install
wallpapers/den/            what installs: hivemind-wallpaper.json, dist/main.js, preview.webp, and
                           LICENSE (three.js's, which dist/main.js bundles)
widgets/den-pup/           what installs: the widget, its sprite sheet pup.webp and its icon
src/den/                   the wallpaper's TypeScript: yard.ts (what the pups do, no drawing),
                           view.ts (the 3D yard), scene.ts (the app's clock and events), main.ts
pup/                       the pup itself, shared by all three: sculpt, mesher, fur, face, poses
game/                      Den, the game: the pup in a forest clearing to pick up, toss and pet
harness/                   a page that serves the wallpaper as the app does, for pictures
```

`npm run build` at the repository's root bundles `src/den/main.ts` into `wallpapers/den/dist/main.js`.
The tests are `tests/den.test.ts` (the yard over 20 seeds, the app's clock, the package reader,
HiveHub's check, the build in Chromium) and the Den pup's in `tests/widgets.test.ts`.
`bun packages/den/harness/shoot.ts <dir>` draws the wallpaper in four looks with tiles over it, and
the picker's preview.
