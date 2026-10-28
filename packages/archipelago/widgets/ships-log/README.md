# Ship's log

What happened while you were away, newest first: which agent finished a turn, asked for you, started or stopped, how long ago and in which project. Press an entry to go to that agent.

Each entry says how long ago and what happened, in few words, before who, so a name too long for
the card is what it cuts. An ask an agent is still waiting on is marked, and says why in the word
Harbour's rows give it (`9s · permission · sla leader`); once answered it reads in the past tense
(`asked permission`). The `log` command gives an ask in the view's words ("needs your permission",
"asked for your permission"). It keeps its last thirty entries in the widget's own state, so
closing the app does not wipe it. An entry whose agent has since closed still reads, but no longer
goes anywhere. Options: how many entries to show, and whether agents starting and closing are
logged as well as turns and calls.

Part of the [Archipelago package](../../README.md), drawn to match its view; it works on any view.
It asks for no permission.

```bash
hive plugins install @dip497/archipelago
hive ctl plugin open widget:@dip497/ships-log
hive ctl plugin call @dip497/ships-log log   # the latest entries, newest first: how long ago, what happened (finished a turn, turn failed, asked for your permission or had a question, started, closed or stopped on an error) and which agent in which project; needsYou is true only on an ask its agent is still waiting on.
```
