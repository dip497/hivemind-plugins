# Code's icons

Every icon Code draws in its bars, lists, tabs and menus is one of **codicons**, the icons VS Code
draws, by Microsoft:

| What | Source | Licence |
|---|---|---|
| The icons in `src/icons.ts` (files, search, chevrons, close, split, terminal, warning, error, bell and the rest) | [microsoft/vscode-codicons](https://github.com/microsoft/vscode-codicons), version 0.0.36, `src/icons/*.svg` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

They are copied as they are: each icon's viewBox and its `<path>` elements, nothing redrawn. What
is Code's own is the hexagon in the title bar and the watermark, and the view's icon (`icon.svg`).

The status marks (the triangle, dot, cross and square beside an agent) are Hivemind's own, from
the view SDK's `STATUS_MARKS`. An agent's icon is the one the app sends with its tile.

Code is not made by or connected with Microsoft. "VS Code" names the editor whose workbench it
follows.
