// A stand-in agent for views: a shell script the app reads from its screen, as it reads an agent
// without hooks. Told `work N` it prints for N seconds (working), told `ask` it asks a permission
// question and waits for a key (calling the person; 1 allows), and otherwise it waits at its prompt
// (idle). With STANDIN_AUTO=1 it does all three by itself, at random, for recordings: mostly
// working, about one in ten asking.
import fs from "node:fs";
import path from "node:path";

export function standinAgent(xdg: string, root: string): Record<string, string> {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "standin-agent"), `#!/bin/bash
RANDOM=$(( $$ % 32768 ))
work() { printf '\\033[2J\\033[H'; local end=$(( SECONDS + $1 )); while [ $SECONDS -lt $end ]; do printf '  editing src/module%d.ts: %d lines\\n' $(( RANDOM % 40 )) $(( RANDOM % 300 )); sleep 0.$(( RANDOM % 6 + 2 )); done; }
ask() {
  printf '\\033[2J\\033[H Bash command\\n   npm test\\n Do you want to proceed?\\n > 1. Yes\\n   3. No\\n'
  if read -rsn1 \${1:+-t "$1"} key; then printf '\\033[2J\\033[H answered %s\\n' "$key"; fi
}
prompt() { printf '\\033[2J\\033[Hstandin> '; }
prompt
while :; do
  if [ "$STANDIN_AUTO" = 1 ]; then
    r=$(( RANDOM % 10 ))
    if [ $r -lt 7 ]; then work $(( RANDOM % 30 + 10 ));
    elif [ $r -lt 8 ]; then ask $(( RANDOM % 20 + 15 ));
    else prompt; sleep $(( RANDOM % 15 + 6 )); fi
    prompt
    continue
  fi
  read -r line || exit 0
  case "$line" in
    work*) work "\${line#work }" ;;
    ask) ask ;;
  esac
  prompt
done
`, { mode: 0o755 });
  const dir = path.join(xdg, "hivemind", "agents", "standin");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent.yaml"), [
    "manifestVersion: 2", "id: standin", "label: Stand-in", "bin: standin-agent", "enabled: true",
    "caps: { promptDelivery: typed, turnSignal: false, resume: none, supervise: human, blockedDetection: true }",
    "answer: { permission: { allow: ['1'], deny: [escape] } }",
    "interrupt: [escape]",
    "detect:", "  default: working", "  rules:",
    "  - when: { contains: 'Do you want to proceed?' }", "    then: permission",
    "  - when: { contains: 'standin>' }", "    then: idle",
    "",
  ].join("\n"));
  return { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
}
