// The widgets here, each run as the app runs it: the app's widget prelude and the widget's own code
// in one worker scope, driven by the messages the window sends (start, a press, hive.hm's
// callbacks, an agent's command), and judged by what it draws and answers.
import { expect, setSystemTime, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT as REPO, core } from "./app";

const { WIDGET_PRELUDE } = await core("widget-api.ts");
const { readWidget } = await core("widgets.ts");
const ROOT = path.join(REPO, "widgets");
type Msg = { type: string; [k: string]: unknown };
type Node = { type: string; text?: string; row?: number; value?: unknown; label?: string; src?: string; tint?: string; action?: unknown; max?: number; children?: Node[] };

/** One widget's worker: its prelude and code, the messages it posted, and the window's side of hive.hm. */
function run(name: string, { state, options = {}, replies = {}, values = true }: { state?: unknown; options?: Record<string, unknown>; replies?: Record<string, unknown>; values?: boolean } = {}) {
  const posted: Msg[] = [];
  const self: { onmessage?: (e: { data: Msg }) => void } = {};
  const fns = new Map<string, number[]>();
  const calls: { path: string[]; args: unknown[] }[] = [];
  let answers = 0;
  const pending = new Map<number, unknown>();
  const send = (m: Msg) => self.onmessage!({ data: m });
  const postMessage = (m: Msg) => {
    posted.push(m);
    if (m.type === "hm-answer") pending.set(m.answer as number, m.ok ? m.value : { error: m.error });
    if (m.type !== "hm-call") return;
    const p = m.path as string[];
    const args = (m.args as unknown[]).map((a) => ((a as { __fn?: number })?.__fn ? `fn:${(a as { __fn: number }).__fn}` : a));
    calls.push({ path: p, args });
    const fn = (m.args as { __fn?: number }[]).find((a) => a?.__fn)?.__fn;
    const key = p.join(".") === "onCommand" || p.join(".") === "on" ? `${p.join(".")}:${String(args[0])}` : p.join(".");
    if (fn) fns.set(key, [...(fns.get(key) ?? []), fn]);
    else void Promise.resolve(replies[p.join(".")] ?? null).then((value) => send({ type: "hm-reply", req: m.req as number, ok: true, value }));
  };
  // Its timeouts run when the test lets time pass (`wait`), in the order they fall due.
  let clock = 0;
  let ids = 0;
  const timers: { at: number; id: number; f: () => void }[] = [];
  const setTimeout = (f: () => void, ms = 0) => { timers.push({ at: clock + ms, id: ++ids, f }); return ids; };
  const clearTimeout = (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const code = readFileSync(path.join(ROOT, name, "widget.js"), "utf8");
  new Function("self", "postMessage", "setInterval", "setTimeout", "clearTimeout", WIDGET_PRELUDE + code)(self, postMessage, () => 0, setTimeout, clearTimeout);
  if (values) send({ type: "hm-values", values: { capabilities: ["workspace:spawn", "workspace:prompt", "workspace:issues"] } });
  send({ type: "init", state, options });
  const tick = () => new Promise((r) => globalThis.setTimeout(r, 0));
  return {
    posted,
    /** Let `ms` of its time pass. */
    wait: async (ms: number) => {
      const until = clock + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        clearTimeout(due.id);
        clock = due.at;
        due.f();
      }
      clock = until;
      await tick();
    },
    click: async () => { send({ type: "click" }); await tick(); },
    calls,
    /** What it drew last. */
    tree: () => [...posted].reverse().find((m) => m.type === "render")?.tree as Node,
    state: () => [...posted].reverse().find((m) => m.type === "state")?.state as Record<string, unknown>,
    notes: () => posted.filter((m) => m.type === "notify").map((m) => m.text),
    press: async (action: unknown) => { send({ type: "action", payload: action }); await tick(); },
    /** Call back what it handed hive.hm for `key` (e.g. "on:structure", "subscribeStatus"). */
    fire: async (key: string, ...args: unknown[]) => {
      for (const fn of fns.get(key) ?? []) send({ type: "hm-cb", fn, args });
      await tick();
    },
    /** A `hive ctl view emit`: to each onCustom whose pattern names it, as the host matches them. */
    emit: async (name: string, data: unknown) => {
      for (const c of calls.filter((x) => x.path[0] === "onCustom")) {
        const patterns = ([] as string[]).concat(c.args[0] as string);
        if (patterns.some((p) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : p === name))) send({ type: "hm-cb", fn: Number(String(c.args[1]).slice(3)), args: [{ kind: "custom", name, data }] });
      }
      await tick();
    },
    /** Each callback handed to `key`, separately: the n-th subscription. */
    fireNth: async (key: string, n: number, ...args: unknown[]) => {
      const fn = fns.get(key)?.[n];
      if (!fn) throw new Error(`it handed hive.hm no ${key} callback number ${n}`);
      send({ type: "hm-cb", fn, args });
      await tick();
    },
    /** Run an agent's command and get its answer, or { error }. */
    command: async (cmd: string, args?: unknown) => {
      const fn = fns.get(`onCommand:${cmd}`)?.[0];
      if (!fn) throw new Error(`it does not answer ${cmd}`);
      const answer = ++answers;
      send({ type: "hm-cb", fn, args: [args], answer });
      for (let i = 0; i < 10 && !pending.has(answer); i++) await tick();
      return pending.get(answer) as Record<string, unknown>;
    },
  };
}

const flat = (n: Node | undefined): Node[] => (n ? [n, ...(n.children ?? []).flatMap(flat)] : []);
const texts = (n: Node | undefined) => flat(n).flatMap((x) => [x.text, x.label, x.value === undefined ? undefined : String(x.value)]).filter((t): t is string => !!t);

test("every widget here is one the app reads, under its folder's name, with a version, an icon and the commands an agent runs", async () => {
  for (const name of readdirSync(ROOT)) {
    const w = await readWidget(path.join(ROOT, name));
    // HiveHub lists it under the id its widget.json says.
    const { id } = JSON.parse(readFileSync(path.join(ROOT, name, "widget.json"), "utf8"));
    expect([id, w.code.length > 0, !!w.version, w.icon?.startsWith("data:image/"), w.commands.length > 0]).toEqual([`@dip497/${name}`, true, true, true, true]);
  }
});

test("Dog: it barks, and notifies once, when an agent starts waiting on you, sits by it at a walk, and a click goes to that agent", async () => {
  const w = run("dog");
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "t", kind: "term", name: "shell" }] });
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  expect(w.notes()).toEqual([]);
  await w.fireNth("subscribeStatus", 0, "blocked", { agent: { state: "waiting", waitingFor: "question" } });
  await w.fireNth("subscribeStatus", 0, "blocked", { agent: { state: "waiting", waitingFor: "question" } });
  expect(w.tree().label).toBe("Biscuit is barking");
  expect(w.notes()).toEqual(["Biscuit barks: tests is waiting on you"]);
  await w.wait(20_000);
  expect(w.tree().label).toBe("Biscuit is waiting with you");
  expect(await w.command("status")).toEqual({ name: "Biscuit", doing: "waiting with you", waitingOn: ["tests"] });
  const moves = w.posted.filter((m) => m.type === "move") as unknown as { x: number; over: number }[];
  expect(moves.at(-1)!.x).toBeGreaterThan(0.9);
  // Never faster than a walk: a whole screen's width takes it 14 s.
  for (let i = 1; i < moves.length; i++) expect(moves[i]!.over).toBeGreaterThanOrEqual(Math.abs(moves[i]!.x - moves[i - 1]!.x) * 14_000);
  await w.click();
  expect(w.calls.find((c) => c.path.join(".") === "commands.focusTile")?.args).toEqual(["a"]);
});

test("Dog: it naps once every agent has been idle a while, not while one works, and wakes when one starts", async () => {
  const w = run("dog", { options: { name: "Rex" } });
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "b", agent: "codex", name: "docs" }] });
  await w.fireNth("subscribeStatus", 0, "idle", { agent: { state: "idle" } });
  await w.fireNth("subscribeStatus", 1, "working", { agent: { state: "working" } });
  await w.wait(300_000);
  expect(w.tree().label).not.toBe("Rex is asleep");
  await w.fireNth("subscribeStatus", 1, "idle", { agent: { state: "idle" } });
  await w.wait(120_000);
  expect(w.tree().label).toBe("Rex is asleep");
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  expect(w.tree().label).not.toBe("Rex is asleep");
});

test("Dog: quiet, it still barks but sends no notification", async () => {
  const w = run("dog", { options: { quiet: true } });
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }] });
  await w.fireNth("subscribeStatus", 0, "blocked", { agent: { state: "waiting" } });
  expect(w.tree().label).toBe("Biscuit is barking");
  expect(w.notes()).toEqual([]);
});
