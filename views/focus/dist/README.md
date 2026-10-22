# Focus

Your agents, one at a time. A calm list of every agent, whoever waits on you first, and beside it
the live terminal of the one you pick, with a box to give it its next task (the app shows you the
words before they are sent). Each agent's state is a shape as well as a colour: a diamond waits on
you, a filled dot works, a ring is ready, a square has stopped and a cross has failed.

```bash
hive plugins install @dip497/focus           # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/focus           # or let an agent switch to it
hive ctl plugin call @dip497/focus board
hive ctl plugin call @dip497/focus open '{"name":"docs"}'
hive ctl plugin call @dip497/focus release
```

It asks to give an agent a task you confirm (`workspace:prompt`). ↑ and ↓ move through the list,
Esc closes the terminal.

## How it was made

With the parts a [shadcn/ui](https://ui.shadcn.com) app is made of: React, Radix and Tailwind, and
shadcn's Button, Badge, Card, Input and Tabs copied into `src/ui/`. `src/focus.css` maps the names
those components use (`background`, `card`, `border`, `primary`…) onto the colours, corners and fonts
the app gives every view, so your theme restyles it, Clean or Dracula, light or dark. A component
from anyone who builds with shadcn/ui can be dropped into `src/ui/` the same way.

What it works out from the workspace is in `src/model.ts`, tested in `tests/views.test.ts`.
