# Antigravity

Runs `agy`, the Antigravity command-line agent, in a Hivemind terminal tile.

> Launches and reads status; other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `agy` command you install yourself. Get it from [its install page](https://antigravity.google/docs/cli/overview/), or run `curl -fsSL https://antigravity.google/cli/install.sh | bash`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:antigravity <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |
| Permissions | yolo: `--dangerously-skip-permissions` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
