# Aider

Runs `aider`, the Aider command-line agent, in a Hivemind terminal tile.

> Launches only: Hivemind does not read its status yet, and other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `aider` command you install yourself. Get it from [its install page](https://aider.chat/docs/install.html), or run `python -m pip install aider-install && aider-install`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:aider <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |
| Approval | yes-always: `--yes-always` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
