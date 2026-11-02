# Code

Your workspace as VS Code's workbench. Frames are folders and tiles are files in the explorer;
open one and it is a tab whose editor is the tile's live terminal. Split the editors, keep a
terminal in the panel, and find anything with the command palette, with VS Code's own keys.

```bash
hive plugins install @dip497/code      # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/code      # or let an agent switch to it
```

It is for someone who lives in VS Code and runs agents in Hivemind: the workbench they already
know, with their agents in it, so nothing needs learning before the first agent is started.

| Part | What it shows |
|---|---|
| Activity bar | Explorer, Search, and Agents (Source Control's place), with how many agents need you |
| Explorer | Open editors; the workspace as a tree, a worktree under the frame it came from, each tile's state beside its name; the open tile's timeline |
| Search | Tiles by name, grouped by frame |
| Agents | A message box that sends the open agent its next task (the app shows you the words before they go), and every agent grouped as Needs You, Working, Ready and Stopped |
| Editors | Up to four groups side by side; tabs you drag between them; a single click opens a preview (italic) that the next one replaces, a double click keeps it; breadcrumbs of frame and tile |
| Panel | Problems (agents that need you or failed, each with the line the app draws: what it waits on, and its **Review** for a permission), Output (what happened in the last hour) and Terminal (tiles you moved into the panel) |
| Status bar | Failed and waiting counts, how many are working, the frame's branch, who else is here |
| Title bar | File, Edit, Selection, View, Go, Run, Terminal and Help menus, back and forward, the command center, and the layout buttons |

## Keys

While Code has the keyboard (a live terminal keeps its own). On a Mac, ⌘ for Ctrl.

| Keys | Does |
|---|---|
| Ctrl+P · Ctrl+Shift+P or F1 | Go to a tile · the command palette |
| Ctrl+B · Ctrl+J · Ctrl+\` | The side bar · the panel · the panel's terminals (⌃\` on a Mac) |
| Ctrl+Shift+E · F · G · M | Explorer · Search · Agents · Problems |
| Ctrl+\\ · Ctrl+1–4 | Split the editor · go to group 1 to 4 |
| Ctrl+W · Ctrl+K W · Ctrl+Shift+T | Close the tab · close the group's tabs · reopen the last closed |
| Ctrl+PageDown · Ctrl+PageUp | Next and previous tab |
| Alt+← · Alt+→ | Back and forward through the tiles you showed |
| F8 · Shift+F8 | The next and previous agent that needs you |
| F2 · Delete | Rename · close the tile picked in the explorer |
| Ctrl+K Ctrl+T · Ctrl+, | The app's theme panel · its Settings |
| Ctrl+Shift+\` | A new terminal in the panel |

Closing a tab leaves the tile running; **Close Tile…** stops it, after asking.

## For agents

```bash
hive ctl plugin call @dip497/code editors                          # what is open, group by group
hive ctl plugin call @dip497/code open '{"name":"api"}'             # as a tab in the active group
hive ctl plugin call @dip497/code open '{"name":"tests","side":true}'
hive ctl plugin call @dip497/code open '{"name":"server","panel":true}'
hive ctl plugin call @dip497/code close '{"name":"api"}'
hive ctl plugin call @dip497/code layout '{"sidebar":false,"panel":"problems"}'
```

## Permissions

| Asks for | Used by |
|---|---|
| `workspace:spawn` | New Terminal, New Agent…, New Frame, and waking or putting an agent to sleep |
| `workspace:close` | Close Tile… and Kill Terminal, after a dialog |
| `workspace:edit` | Rename (F2) and Open Folder in Frame… |
| `workspace:prompt` | The Agents view's message box; the app shows you each message before it is sent |

## How it was made

With React, in VS Code's measures: a 35px title bar and tabs, a 48px activity bar, 22px rows and
status bar, 16px icons. Its colours are VS Code's roles (the side bar's ground, the active tab's
top border, a list's selection) set from what the app gives every view, so your Hivemind theme
restyles it, light or dark, and an agent's state is the app's own mark in the app's colour. The
icons are Microsoft's codicons, CC BY 4.0 ([ASSETS.md](ASSETS.md)). What it works out from the
workspace is in `src/model.ts`, tested in `tests/views.test.ts`; where it puts the live terminals
is tested in `tests/code-view.test.ts`.

A terminal is the app's, drawn above the view, so whatever Code draws over the editors (a menu,
the palette, a dialog) takes away a terminal it would cover until it closes.
