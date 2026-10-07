# Pi

Runs `pi`, the Pi command-line agent, in a Hivemind terminal tile.

> Pi has no permission system: it always runs autonomously and cannot be supervised.

## Before you add it

Hivemind installs no code for it: it runs the `pi` command you install yourself. Get it from [its install page](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md), or run `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.

## What it can do in Hivemind

- Says when a turn ends, so another agent can hand it work and read its reply (`hive ctl read`, workflows).
- Picks up the newest session for its folder after a restart.
- Has no permission prompts of its own.

## What it asks for

Hivemind shows this before it adds the agent.

- Runs `pi --list-models` to list model values
- Reads {home}/.pi/agent/sessions to find a session to resume
- Reports its status and approval prompts to Hivemind through its own hooks, which can also read and type into your other tiles

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:pi <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
