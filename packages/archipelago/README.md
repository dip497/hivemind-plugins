# Archipelago

Your workspace as islands you can walk, and four widgets drawn to match. One install, one switch,
one rollback; nothing in it runs outside its sandbox, so it arrives switched on.

```bash
hive plugins install @dip497/archipelago
```

| Member | What it is for |
| --- | --- |
| [Archipelago](views/archipelago) (view) | Every project an island, every agent a worker building its town. A pin over each agent from afar; press **J** to land and walk the islands, **E** beside an agent to open its terminal. Ships sail for the work between islands and the agents calling you, in a wind the work raises. Its own toolbar, a plank of the dock, starts agents and founds islands. Needs Hivemind 2026.10.6 or later. |
| [Harbour](widgets/harbour) (widget) | Who needs you now: agents calling you as boats at your dock, longest first, with their project and why, and agents back from a finished turn waiting in port for a task. Press one to go to it; it can ring a bell when a boat arrives. |
| [Town ledger](widgets/town-ledger) (widget) | What each project got done this week and today, the town it has grown to, from a well to a castle, and which projects have gone quiet. |
| [Weather](widgets/weather) (widget) | The whole workspace at a glance, and for how long: fair while agents work, a squall when some call you, a storm when one stopped, becalmed when all rest, with a button to what needs you. |
| [Ship's log](widgets/ships-log) (widget) | What happened while you were away, newest first: who finished a turn, asked for you, started or stopped, how long ago and where. Press an entry to go to that agent. |
| [Harbour](themes/harbour) (theme) | The look of the islands for the whole app: the sea's blues by night, a wood accent, the rounded Nunito font, a still of the islands as wallpaper, and harbour sounds for an agent that needs you, finishes or fails. Applied from **Settings ▸ Appearance**, undone with **Revert to previous look**. Needs Hivemind 2026.10.6 or later. |

Installing it selects the Archipelago view. The widgets go on any view, the canvas included; over Archipelago, its overview keeps clear of the column they sit in:

```bash
hive ctl plugin open widget:@dip497/harbour
hive ctl plugin call @dip497/harbour dock
hive ctl plugin call @dip497/town-ledger ledger
hive ctl plugin call @dip497/weather forecast
hive ctl plugin call @dip497/ships-log log
```

**What it asks for.** The view asks to tell an agent something (`workspace:prompt`, you send or cancel
each message) and to start agents (`workspace:spawn`). The widgets ask for nothing: they read the
agents, their status and the day's history, and press to go to an agent. There is no tool in the
package, so nothing in it runs with the app's access.

## Harbour, the theme

Installing Archipelago does not change how the app looks: Harbour waits in **Settings ▸ Appearance**
next to the presets, and applies only when you press **Apply** (or `hive theme use @dip497/archipelago/harbour`).
**Revert to previous look** (`hive theme revert`) puts back the look you had; [the Appearance guide](https://github.com/dip497/hivemind/blob/main/guide/(use)/appearance.mdx) says more. It shares its name
with the Harbour widget, the dock of agents calling you; the theme is the look, the widget a box.

| Part | What it is |
| --- | --- |
| Colours | Dark: panels of night sea, words in sea-foam white (15:1 on the ground), and one warm colour, the amber of "needs you", kept for what waits on you alone. |
| Accent | Wood: a brown well below the amber in lightness, so the two stay apart, also to colour-blind eyes. It is never a status. |
| Terminal | The same sea, with every ANSI colour but black reading at 4.5:1 on it; its yellow is a pale sand, not the amber. |
| Font | Nunito, rounded, for the interface (OFL 1.1); the terminal keeps your monospace font. |
| Wallpaper | The islands by night, rendered from this view, dimmed to 80%. |
| Sounds | A ship's bell when an agent finishes, two gull calls when one needs you, a low horn when one fails. `scripts/make-harbour-sounds.mjs` makes them. |

Where each file comes from, and its licence: [themes/harbour/ASSETS.md](themes/harbour/ASSETS.md).

It keeps [Island](../../views/island) as it was; Archipelago is a view of its own beside it.
