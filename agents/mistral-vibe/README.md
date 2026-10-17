# Mistral Vibe

Runs `vibe`, the Mistral Vibe command-line agent, in a Hivemind terminal tile.

> Launches only: Hivemind does not read its status yet, and other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `vibe` command you install yourself. Get it from [its install page](https://github.com/mistralai/mistral-vibe), or run `curl -LsSf https://mistral.ai/vibe/install.sh | bash`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:mistral-vibe <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Agent | `--agent <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
