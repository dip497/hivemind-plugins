# Cline

Runs `cline`, the Cline command-line agent, in a Hivemind terminal tile.

> Launches and reads status; other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `cline` command you install yourself. Get it from [its install page](https://docs.cline.bot/cline-cli/installation), or run `npm install -g cline`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:cline <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |
| Mode | plan: `--plan`; ask: `--auto-approve false`; yolo: `--auto-approve true` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
