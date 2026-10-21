# Archipelago's models and skies

Archipelago keeps its own copy of the models and skies it was made with (they began as Island's), so a
change to Island's never changes it. Every one comes from the packs below, all **CC0** (public domain): free to
use, change and pass on, with no credit required. We credit them anyway.

| What | Pack | Source | Licence |
|---|---|---|---|
| Hex tiles, trees, hills, mountains, rocks, fields, lilies, clouds, bridge; every building (homes, tavern, market, blacksmith, well, windmill, church, castle) in four colours and its building stages and scaffolding; props (barrels, crates, timber, stone, tents, flags) | KayKit Medieval Hexagon Pack 1.0, by Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 (also https://kaylousberg.itch.io/kaykit-medieval-hexagon) | CC0 1.0 |
| The workers (Barbarian, Knight, Mage, Rogue) and their moves: walking, standing, sitting, cheering, chopping, casting, working with their hands | KayKit Character Pack: Adventurers 1.0, by Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 1.0 |
| Daylight (sky and light by day) | Poly Haven, *Kloofendal 48d Partly Cloudy (Pure Sky)*, by Greg Zaal | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 1.0 |
| Night light | Poly Haven, *Kloppenheim 02 (Pure Sky)*, by Greg Zaal | https://polyhaven.com/a/kloppenheim_02_puresky | CC0 1.0 |

The workers come from KayKit's own character pack rather than another set, so they share the
buildings' texture style and proportions.

## How they are packed

`assets/make.mjs`, here, reads the packs (as data; nothing in them runs) and writes the files the view
ships:

| File | What | Size |
|---|---|---|
| `kit.glb` | 75 models, one shared 15 KB texture, meshopt-compressed | 0.93 MB |
| `workers.glb` | the four workers, each holding only its own tool | 0.49 MB |
| `moves.glb` | the seven moves it plays, shared by all four | 0.11 MB |
| `sky-day.hdr`, `sky-night.hdr` | the two skies cut to 256 × 128, for light only | 0.13 MB each |

About 1.8 MB in all, and 2.4 MB once `build.mjs` writes each into a script of its own
(`island-kit.js`, `island-workers.js`, `island-moves.js`, `island-skyDay.js`, `island-skyNight.js`).

```bash
node views/island/assets/make.mjs <KayKit-Medieval-Hexagon-Pack-1.0> <KayKit-Character-Pack-Adventures-1.0> <folder with the two .hdr files>
```

## What is not a model

The sea is drawn by a shader, not a model: the pack's water is a flat tile, and the sea needs to
reach the horizon, move, and know how far each point is from the shore for its shallows and foam.
The sky's colours, the smoke, sparks, fire and dust are drawn the same way. The light over an agent
calling you is a plain thin column, the one shape kept simple on purpose so it reads at any distance.
