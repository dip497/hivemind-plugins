# Den

A fluffy wolf pup for [Hivemind](https://github.com/dip497/hivemind): the Den pup widget, a pup with
no card that lives along the bottom of your screen, above your tiles, keeps an eye on your agents
and plays with you. It is drawn from a 3D model of the pup, sculpted, furred and posed in code,
rendered to sprites at twice their size with its full fur, 24 frames to each move.

Needs **Hivemind 2026.10.8** or newer.

## The Den pup widget

`@dip497/den-pup`. Your agents come first: it yips and play-bows when an agent starts waiting on
you, then sits by the right edge until you answer, and a click on it takes you to that agent. It
leaps when a turn finishes, and curls up asleep once every agent has been idle a minute and a half.

It plays when you click it: a boop makes it shake, hop, chase its tail or roll over; every third
boop it fetches its ball, and while it holds it a click throws it, so it gallops across the screen,
pounces and trots back. Click it asleep for a belly rub. More in [its README](widgets/den-pup/README.md).

## Install and use

```bash
hive plugins install @dip497/den
hive ctl plugin open widget:@dip497/den-pup   # or add it from the toolbar's Add menu
```

It runs in a sandboxed worker and asks for no permissions. More about widgets:
https://hivemind.griiken.com/guide/widgets/

## In this folder

```
hivemind-package.json      the package: the pup widget
widgets/den-pup/           what installs: the widget, one sprite sheet a pose, its icon
pup/                       the pup itself: sculpt, mesher, fur, face, poses (three.js)
game/                      Den, the game the pup was made for (pick it up, toss it, pet it), and the
                           tools that render the widget's sprites from the pup
```

`game/tools/sprites.mjs` renders every pose (`node tools/sprites.mjs`, after `bun build.mjs` and
`tools/fetch-three.sh` in `game/`), and `game/tools/sheet-sprites.py ../widgets/den-pup` lays them
out as the widget's sheets. The widget's tests are in `tests/widgets.test.ts`; the package's in
`tests/den.test.ts`.
