# Kiro

Runs `kiro-cli`, the Kiro command-line agent, in a Hivemind terminal tile.

## Before you add it

Hivemind installs no code for it: it runs the `kiro-cli` command you install yourself. Get it from [its install page](https://kiro.dev/docs/cli/), or run `curl -fsSL https://cli.kiro.dev/install | bash`.

## What it can do in Hivemind

- Says when a turn ends, so another agent can hand it work and read its reply (`hive ctl read`, workflows).
- Picks up its own session again after a restart.
- Can be supervised: its permission prompts can go to the agent that started it.

## What it asks for

Hivemind shows this before it adds the agent.

- Links your {home}/.kiro into a private copy it points kiro-cli at
- Reports its status and approval prompts to Hivemind through its own hooks, which can also read and type into your other tiles

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:kiro <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Tools | yolo: `--trust-all-tools` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
