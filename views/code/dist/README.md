# Code

Your workspace as VS Code's workbench. Frames are folders and tiles are files in the explorer;
open one and it is a tab whose editor is the tile's live terminal. Every frame's code (its files,
an editor and the working tree's changes) opens as a tab too, and **Watch** keeps it beside
whichever agent you are on, so you see the code change as the agent writes it. Split the editors,
keep a terminal in the panel, and find any file or line with Go to File and Search, with VS Code's
own keys.

```bash
hive plugins install @dip497/code      # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/code      # or let an agent switch to it
```

It is for developers who live in VS Code and want to keep their eyes on the code while agents
write it: the workbench they already know, with their agents in it and every change in sight.

## Watching code change

1. Press **Watch** in the status bar (or Ctrl+K Ctrl+E, or **Watch Code Beside the Agent** in
   Source Control).
2. Open an agent. Its frame's code opens in the group to its right; your keys stay with the agent.
3. Open another agent: the code beside it is now that agent's frame's.

The code is the app's own Code tile: the file tree, an editor, and **Changes**, the working
tree's diff, which the app refreshes as files are written. It opens on whichever side you last
chose in it, Explorer or Changes. Its folder is the frame's own (a worktree, a folder you bound),
else the workspace's. The app keeps one per frame, so Code opens the one there is.

**Source Control** (Ctrl+Shift+G) lists every frame as a repository with its branch, its agents,
and a pencil with how many are writing now (working, with their terminal moving). Click a
repository to open its code. **Open Code Beside** (on an editor's title bar, a tile's menu, or the
palette) puts one frame's code beside the tile once, without turning Watch on.

| Part | What it shows |
|---|---|
| Activity bar | Explorer, Search, Source Control (with how many agents are writing) and Agents (with how many need you) |
| Explorer | Open editors; the workspace as a tree, a worktree under the frame it came from, each tile's state beside its name and each frame's **Open Code** on hover; the open tile's timeline |
| Source Control | Each frame as a repository: branch, agents, who is writing, its code a click away; the Watch switch |
| Search | Every line holding what you type, in the workspace's folder and each frame's own (a worktree, a bound folder), grouped by file with each match marked; **Aa** matches case and **.\*** reads it as a regular expression. Click a line: its file opens in that frame's Code tile at that line. The app finds them, with fff |
| Agents | A message box that sends the open agent its next task (the app shows you the words before they go), and every agent grouped as Needs You, Working, Ready and Stopped |
| Editors | Up to four groups side by side; tabs you drag between them; a single click opens a preview (italic) that the next one replaces, a double click keeps it; breadcrumbs of frame and tile |
| Panel | Problems (agents that need you or failed, each with the line the app draws: what it waits on, and its **Review** for a permission), Output (what happened in the last hour) and Terminal (tiles you moved into the panel) |
| Status bar | Failed and waiting counts, how many are working, **Watch**, the frame's branch, who else is here |
| Title bar | File, Edit, Selection, View, Go, Run, Terminal and Help menus, back and forward, the command center, and the layout buttons |

## Keys

While Code has the keyboard (a live terminal keeps its own). On a Mac, ⌘ for Ctrl.

| Keys | Does |
|---|---|
| Ctrl+P · Ctrl+Shift+P or F1 | Go to a file (typos too, the ones you open most first; `cart.ts:42` opens it at line 42), or a tile · the command palette |
| Ctrl+B · Ctrl+J · Ctrl+\` | The side bar · the panel · the panel's terminals (⌃\` on a Mac) |
| Ctrl+Shift+E · F · G · A · M | Explorer · Search · Source Control · Agents · Problems |
| Ctrl+K Ctrl+D · Ctrl+K Ctrl+E | Open the frame's code · Watch on or off |
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
hive ctl plugin call @dip497/code code '{"frame":"web"}'            # a frame's files and changes
hive ctl plugin call @dip497/code watch '{"on":true}'               # its code beside each agent shown
hive ctl plugin call @dip497/code layout '{"sidebar":false,"panel":"problems"}'
```

## Permissions

| Asks for | Used by |
|---|---|
| `workspace:spawn` | New Terminal, New Agent…, New Frame, opening a frame's code, and waking or putting an agent to sleep |
| `workspace:close` | Close Tile… and Kill Terminal, after a dialog |
| `workspace:edit` | Rename (F2) and Open Folder in Frame… |
| `workspace:prompt` | The Agents view's message box; the app shows you each message before it is sent |
| `workspace:code` | Search and Go to File: the app finds the files and lines and opens a file in a frame's Code tile. Code sees only the lines a search finds. Needs Hivemind 2026.11.3 or newer |

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
