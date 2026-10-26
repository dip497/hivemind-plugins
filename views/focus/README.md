# Focus

Your agents, one at a time. Every agent down the left, grouped by what it needs from you (needs
you, working, ready, stopped), and beside the list the live terminal of whoever has waited on you
longest, with a box to give a ready agent its next task (the app shows you the words before they
are sent). Pick another agent and it stays open until you pick again or close it; a bar on the
edge of its row says which one is open. Each state is a mark the app draws everywhere (from the view
SDK's `STATUS_MARKS`): a triangle waits on you and pulses, a dot works, a cross failed, a square
stopped; a ready agent shows nothing. A stopped agent's name is quieter, and its words read whole.

Under each name is the agent's last line: what its terminal last showed or its agent last said,
or, while it waits on you, what for, with a **Review** button when it asks permission. Hivemind
draws that line itself, in room Focus leaves for it; Focus never receives the text, and Review
opens the app's own popover, which shows all of what the agent would run before you allow it. It
needs a Hivemind with view protocol 1.17 (the release after 2026.10.5); on an older one each row
shows only why it waits or where it lives.

```bash
hive plugins install @dip497/focus           # then switch to it with ⌘E (Ctrl+E)
hive ctl plugin open @dip497/focus           # or let an agent switch to it
hive ctl plugin call @dip497/focus board
hive ctl plugin call @dip497/focus open '{"name":"docs"}'
hive ctl plugin call @dip497/focus release
```

It asks to give an agent a task you confirm (`workspace:prompt`). ↑ and ↓ move through the list,
Esc closes the terminal. A search box appears once there are nine agents or more.

## How it was made

With React and Tailwind, in the app's own design system ([DESIGN.md](https://github.com/dip497/hivemind/blob/main/apps/desktop/DESIGN.md)):
graphite steps, one warm colour for what waits on you, the named type steps (15, 14, 13, 12, 11,
10) and the app's two buttons and one field, in `src/ui/`. `src/focus.css` names those roles
(`ground`, `sheet`, `chalk`, `pencil`, `attention`…) and maps each onto what the app gives every
view, so your theme restyles it, Clean or Dracula, light or dark. The first version was built from
shadcn/ui's components; a review with the design-taste-frontend, Impeccable and Hallmark skills
read it as their stock inbox example, and it was redrawn as the terminal-first screen it is now.

What it works out from the workspace is in `src/model.ts`, tested in `tests/views.test.ts`.
