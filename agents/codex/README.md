# Codex

Runs `codex`, the Codex command-line agent, in a Hivemind terminal tile.

## Before you add it

Hivemind installs no code for it: it runs the `codex` command you install yourself. Get it from [its install page](https://developers.openai.com/codex/cli), or run `npm install -g @openai/codex`.

## What it can do in Hivemind

- Says when a turn ends, so another agent can hand it work and read its reply (`hive ctl read`, workflows).
- Picks up the newest session for its folder after a restart.
- Its permission prompts stay with you, even when another agent started it.

## What it asks for

Hivemind shows this before it adds the agent.

- Reads {home}/.codex/sessions to find a session to resume
- Reports its status and approval prompts to Hivemind through its own hooks, which can also read and type into your other tiles
- Starts codex with its hook review waived, so every hook its configuration enables — this agent's and your own — runs without being reviewed first

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:codex <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |
| Approval | `--ask-for-approval <value>`; yolo: `--dangerously-bypass-approvals-and-sandbox` |
| Sandbox | `--sandbox <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
