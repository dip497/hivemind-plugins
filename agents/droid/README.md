# Droid

Runs `droid`, the Droid command-line agent, in a Hivemind terminal tile.

## Before you add it

Hivemind installs no code for it: it runs the `droid` command you install yourself. Get it from [its install page](https://docs.factory.ai/cli/getting-started/quickstart), or run `curl -fsSL https://app.factory.ai/cli | sh`.

## What it can do in Hivemind

- Says when a turn ends, so another agent can hand it work and read its reply (`hive ctl read`, workflows).
- Picks up the newest session for its folder after a restart.
- Its permission prompts stay with you, even when another agent started it.

## What it asks for

Hivemind shows this before it adds the agent.

- Links your {home}/.factory into a private copy it points droid at
- Reads {home}/.factory/sessions to find a session to resume
- Reports its status and approval prompts to Hivemind through its own hooks, which can also read and type into your other tiles

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:droid <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Autonomy | `--auto <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
