# Den pup

A fluffy wolf pup that lives along the bottom of your screen, with no card around it, and keeps an
eye on your agents:

- **An agent starts waiting on you:** it play-bows and yips, sends one notification, then trots to
  the right edge and sits there wagging until you answer.
- **A turn finishes:** it leaps for joy.
- **Every agent idle for a minute and a half:** it curls up asleep. Any agent getting to work wakes it.
- **Click it:** if someone is waiting, it takes you to that agent; otherwise it jumps for joy.

It never goes faster than a trot: crossing the whole screen takes it 12 seconds.

```bash
hive plugins install @dip497/den             # the Den package: this pup and the Den wallpaper
hive ctl plugin open widget:@dip497/den-pup  # or add it from the toolbar's Add menu
hive ctl plugin call @dip497/den-pup status  # what it is doing, and who it waits for
```

Options: its **name** (Pip), and **quiet**, which keeps the yip but drops the notification. It asks
for no permissions: it reads the agents' states through `hive.hm` and goes to a tile with
`focusTile`, which needs none.

`pup.webp` is one sprite sheet, eight frames of 160 × 128 a row: walk, sit (wagging), sleep
(breathing), beg (a play bow, yipping) and jump. They are rendered from the Den pup's 3D model
(`../../pup`, with `../../game/tools/sprites.mjs`). Under reduced motion the app holds each row on
its first frame.
