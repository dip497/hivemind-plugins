# Crush

Runs `crush`, the Crush command-line agent, in a Hivemind terminal tile.

> Launches only: Hivemind does not read its status yet, and other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `crush` command you install yourself. Get it from [its install page](https://github.com/charmbracelet/crush#installation), or run `npm install -g @charmland/crush`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:crush <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Approval | yolo: `--yolo` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
