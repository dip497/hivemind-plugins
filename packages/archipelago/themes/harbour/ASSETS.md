# Harbour's files

Harbour is Archipelago's theme: the sea's blues by night, a wood accent, a rounded font, a still of
the islands and three harbour sounds. Everything in it is either made here or comes under a licence
that lets it be shipped, changed and passed on.

| File | What | Where it comes from | Licence |
|---|---|---|---|
| `fonts/nunito-latin.woff2` | Nunito, the interface font: one variable file, weights 400 to 800, the Latin subset (Basic Latin, Latin-1, the common punctuation and symbols), 39 KB | Nunito, Copyright 2014 The Nunito Project Authors: https://github.com/googlefonts/nunito; this file is the Latin subset Google Fonts serves for `Nunito:wght@400..800` (https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2), unchanged | SIL Open Font License 1.1, in full in `fonts/OFL.txt` |
| `wallpaper.webp` | The islands by night, 1920 × 1080, 77 KB | Rendered from Archipelago's own view (`views/archipelago/dist`) in headless Chromium: five islands, no agents, the night sky, camera at distance 60, yaw 0.75, pitch 0.5. Its models and skies are the CC0 packs listed in `views/archipelago/ASSETS.md` | CC0 1.0, as the packs it is drawn from; the render is ours, given under the same terms |
| `sounds/done.ogg` | A ship's bell struck twice, 2.6 s | Synthesised by `../../scripts/make-harbour-sounds.mjs` | Ours, CC0 1.0 |
| `sounds/needs.ogg` | Two gull-like calls, each rising, the second higher, 1.0 s | Synthesised by `../../scripts/make-harbour-sounds.mjs` | Ours, CC0 1.0 |
| `sounds/error.ogg` | A low harbour horn, two pipes a fifth apart, 1.8 s | Synthesised by `../../scripts/make-harbour-sounds.mjs` | Ours, CC0 1.0 |

## Making the sounds again

```bash
node packages/archipelago/scripts/make-harbour-sounds.mjs
```

The script lives outside this folder: a theme holds data only, and its folder is published as it is.
It computes every sample itself (no samples, no randomness), scales each sound to peak at −6 dBFS,
and has `ffmpeg` (with libvorbis) encode it as Ogg Vorbis, mono 44.1 kHz, with bit-exact flags and a
fixed stream serial: a re-run on the same ffmpeg writes the same bytes. The committed sounds were
made with ffmpeg `6.1.1-3ubuntu5`; `tests/harbour-theme.test.ts` renders them again and expects the
same bytes on that version, and the same sound once decoded on any other. The app plays at most 3 s of
a theme's sound and scales its peak to −6 dBFS itself, so a pack cannot be louder than the
built-in sounds.

## Making the wallpaper again

There is no script for it in the repository; it is a still, made once. To make another, open
`views/archipelago/dist/index.html` in the views test harness (`tests/views-theme.test.ts` shows
how: the app's `serveViewFile`, the SDK's fake host), send it a structure of a few frames and no
agents with `settings: { sky: "night", motion: "less" }` and a saved camera, screenshot it at
1920 × 1080 and encode it with `ffmpeg -i still.png -c:v libwebp -quality 90 -compression_level 6
wallpaper.webp`.
