# Claude

Runs `claude`, the Claude command-line agent, in a Hivemind terminal tile.

## Before you add it

Hivemind installs no code for it: it runs the `claude` command you install yourself. Get it from [its install page](https://code.claude.com/docs/en/setup), or run `curl -fsSL https://claude.ai/install.sh | bash`.

## What it can do in Hivemind

- Says when a turn ends, so another agent can hand it work and read its reply (`hive ctl read`, workflows).
- Picks up its own session again after a restart.
- Can be supervised: its permission prompts can go to the agent that started it.

## What it asks for

Hivemind shows this before it adds the agent.

- Reports its status and approval prompts to Hivemind through its own hooks, which can also read and type into your other tiles

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:claude <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Permission mode | `--permission-mode <value>`; bypassPermissions: `--dangerously-skip-permissions` |
| Model | `--model <value>` |
| Effort | `--effort <value>` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
