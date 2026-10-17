# Copilot

Runs `copilot`, the Copilot command-line agent, in a Hivemind terminal tile.

> Launches and reads status; other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `copilot` command you install yourself. Get it from [its install page](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli), or run `npm install -g @github/copilot`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:copilot <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |
| Mode | `--mode <value>`; yolo: `--yolo` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
