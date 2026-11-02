# Den, the game

An original 2.5D browser game: a fluffy wolf pup in a forest clearing that you pick up by the
scruff, toss, catch, pet and boop. It is one page: three.js 0.160 from jsDelivr, everything else
bundled in. The pup's model, fur, face and animation are shared with the Den live wallpaper, in
`../pup/`.

## Build

```bash
bun build.mjs            # out/index.html (to publish) and out/test.html (for the tools)
```

## Look at it and test it

The tools open the page in headless Chromium with the clock paused, so frames are exact. They need
three.js locally (`tools/fetch-three.sh`) and Playwright's Chromium (`PW_CHROMIUM=<path>` when the
project's Playwright differs from the installed browser).

```bash
node tools/play.mjs 1100 720 g 2000 catch   # grab, toss, catch; screenshots in out/
node tools/pet.mjs                          # rub to pet, tap to boop
node tools/film.mjs play 9                  # a 30 fps film: out/film-play.mp4
node tools/shot.mjs '#lookdev' steps.json   # the pup alone, posed, for judging the character
node tools/audio.mjs                        # every sound rendered offline: out/sounds.wav
```
