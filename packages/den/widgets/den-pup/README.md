# Den pup

A fluffy wolf pup that lives along the bottom of your screen, with no card around it, above
everything on your canvas. It keeps an eye on your agents, and you can play with it.

**Your agents come first:**

- **An agent starts waiting on you:** it play-bows and yips, sends one notification, then trots to
  the right edge and sits there wagging until you answer. A click on it then takes you to that
  agent.
- **A turn finishes:** it leaps for joy.
- **Every agent idle for a minute and a half:** it curls up asleep. Any agent getting to work wakes it.

**Play, by clicking it:**

- **A boop:** each click makes it shake, hop, chase its tail or roll over, in turn. Every third
  boop it runs off for its ball and comes back holding it.
- **Fetch:** while it holds the ball, a click throws it. It gallops across the screen after it,
  pounces, and trots back to you with it. Not thrown for 20 seconds, it drops it.
- **A belly rub:** click it while it sleeps and it rolls over for it, then dozes off again.
- **Left alone a long while** (20 minutes awake with nothing going on), it brings you its ball.

On its own it never goes faster than a trot: crossing the whole screen takes it 12 seconds. Only
after its ball does it run. You can also drag it anywhere, as any widget. With reduced motion on,
it stays where it is and only changes pose.

```bash
hive plugins install @dip497/den             # the Den package: this pup
hive ctl plugin open widget:@dip497/den-pup  # or add it from the toolbar's Add menu
hive ctl plugin call @dip497/den-pup status  # what it is doing, and who it waits for
```

Options: its **name** (Pip), and **quiet**, which keeps the yip but drops the notification. It asks
for no permissions: it reads the agents' states through `hive.hm` and goes to a tile with
`focusTile`, which needs none.

Each pose is a sprite sheet of its own, `pup-<pose>.webp`: one seamless loop of 24 frames of
320 × 256, shown at 0.4 of that so it stays sharp on a high-density screen. The poses are walk, sit
(wagging), sleep (breathing), beg (a play bow, yipping), jump, run, shake, roll (on its back), spin
(chasing its tail), carry (trotting with its ball) and ball (sitting with it). They are rendered
from the Den pup's 3D model with its full fur and a light rim round its coat, so it stands clear of
a dark theme too (`../../pup`, with `../../game/tools/sprites.mjs`). Under reduced motion the app
holds each sheet on its first frame.