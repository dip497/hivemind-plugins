# OpenHands

Runs `openhands`, the OpenHands command-line agent, in a Hivemind terminal tile.

> Launches only: Hivemind does not read its status yet, and other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `openhands` command you install yourself. Get it from [its install page](https://docs.openhands.dev/openhands/usage/cli), or run `uv tool install openhands --python 3.12`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:openhands <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Approval | always-approve: `--always-approve` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
