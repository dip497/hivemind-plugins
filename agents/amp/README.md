# Amp

Runs `amp`, the Amp command-line agent, in a Hivemind terminal tile.

> Launches and reads status; other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `amp` command you install yourself. Get it from [its install page](https://ampcode.com/docs/cli), or run `curl -fsSL https://ampcode.com/install.sh | bash`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
