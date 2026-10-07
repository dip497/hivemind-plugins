# opencode

Runs `opencode`, the opencode command-line agent, in a Hivemind terminal tile.

## Before you add it

Hivemind installs no code for it: it runs the `opencode` command you install yourself. Get it from [its install page](https://opencode.ai/docs/), or run `curl -fsSL https://opencode.ai/install | bash`.

## What it can do in Hivemind

- Says when a turn ends, so another agent can hand it work and read its reply (`hive ctl read`, workflows).
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## What it asks for

Hivemind shows this before it adds the agent.

- Runs `opencode models` to list model values
- Reports its status and approval prompts to Hivemind through its own hooks, which can also read and type into your other tiles

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:opencode <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Approval | auto: `--auto`; yolo: `--auto` |
| Model | `--model <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
