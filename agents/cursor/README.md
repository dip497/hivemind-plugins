# Cursor

Runs `cursor-agent`, the Cursor command-line agent, in a Hivemind terminal tile.

> No turn reporting, so other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `cursor-agent` command you install yourself. Get it from [its install page](https://cursor.com/docs/cli/installation), or run `curl https://cursor.com/install -fsS | bash`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Picks up the newest session for its folder after a restart.
- Its permission prompts stay with you, even when another agent started it.

## What it asks for

Hivemind shows this before it adds the agent.

- Runs `cursor-agent models` to list model values
- Reads {home}/.cursor/chats to find a session to resume

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:cursor <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Mode | `--mode <value>`; auto-review: `--auto-review`; force: `--force` |
| Model | `--model <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
