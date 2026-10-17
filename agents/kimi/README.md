# Kimi

Runs `kimi`, the Kimi command-line agent, in a Hivemind terminal tile.

> Launches and reads status; other agents cannot collect its replies.

## Before you add it

Hivemind installs no code for it: it runs the `kimi` command you install yourself. Get it from [its install page](https://moonshotai.github.io/kimi-code/en/guides/getting-started), or run `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`.

## What it can do in Hivemind

- Is driven by hand: other agents cannot collect its replies.
- Starts a new session after a restart.
- Its permission prompts stay with you, even when another agent started it.

## Launch options

Set them on its page in Settings ▸ Plugins, or with `hive plugins set agent:kimi <option> <value>`.

| Option | How it is passed |
| --- | --- |
| Model | `--model <value>` |
| Approval | yolo: `--yolo`; auto: `--auto`; plan: `--plan` |

Listed from [`agent.yaml`](agent.yaml) in this folder; fix it by pull request.
