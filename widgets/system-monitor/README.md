# System monitor

This computer, live: how busy its processor is, how much memory is in use, and the programs
using the most of either. Processes of one program are counted together (`chrome ×10`).
Memory is in GB of 10⁹ bytes, as the system's own monitor shows it, and a program's share is of
the whole computer: on 16 cores, one program spinning one core is about 6%.

```bash
hive plugins install @dip497/system-monitor   # then add it from the toolbar's Add menu
hive ctl plugin open @dip497/system-monitor   # or let an agent place it
```

Its gear sets which programs it lists (by processor or by memory), how many (0 hides them) and
how often it reads, every 1 to 10 seconds. Everyone in the workspace sees what it draws,
program names included.

## Readings

A Hivemind that reads the computer itself (the permission `machine:usage`) gives the widget its
readings, and it draws a processor chart and a table of programs.

On a Hivemind that does not yet, its readings come from [`feed.mjs`](https://github.com/dip497/hivemind-plugins/blob/main/feeders/system-monitor/feed.mjs), a small program in this repository
that reads this computer and hands each reading to the widget's `usage` command over one open
connection to the app. It runs on Linux, as you, and costs about 3% of one processor core and
100 MB of memory. Start it once per login:

```bash
mkdir -p ~/.local/share/hive-system-monitor && cd ~/.local/share/hive-system-monitor
curl -fsSLO https://raw.githubusercontent.com/dip497/hivemind-plugins/main/feeders/system-monitor/feed.mjs
npm install --prefix . ~/.hivemind-app/sdk/hivemind-api.tgz
setsid nohup node feed.mjs > feed.log 2>&1 &
```

It reads as often, sorts and sends as many programs as the widget's gear says, and stops
nothing when the widget is not placed. Stop it with `pkill -f "^node feed.mjs"`.

`hive ctl plugin call @dip497/system-monitor usage '{…}'` takes a reading from any program of
yours; the answer says what the widget wants next: `{ taken, every, by, count }`.

## How it was made

Built by a coding agent (Claude) from the widget contract and the
[Widgets guide](https://hivemind.griiken.com/guide/widgets/), then checked in the app. Its
behaviour test is `tests/widgets.test.ts` in this repository.
