// A widget run as the app runs it: the app's widget prelude and the widget's own code in one worker
// scope, driven by the messages the window sends (start, a press, hive.hm's callbacks, an agent's
// command). What the widgets do is judged in widgets.test.ts, how their pictures read in
// archipelago-widget-pictures.test.ts; both run them here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { core } from "../app";

const { WIDGET_PRELUDE } = await core("widget-api.ts");
export type Msg = { type: string; [k: string]: unknown };
export type Node = { type: string; text?: string; row?: number; value?: unknown; label?: string; src?: string; tint?: string; action?: unknown; max?: number; w?: number; h?: number; wrap?: boolean; children?: Node[] };

/** The worker of the widget in folder `dir`: its prelude and code, the messages it posted, and the
 *  window's side of hive.hm. */
export function run(dir: string, { state, options = {}, replies = {}, values = true }: { state?: unknown; options?: Record<string, unknown>; replies?: Record<string, unknown>; values?: boolean } = {}) {
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
  const code = readFileSync(path.join(dir, "widget.js"), "utf8");
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

/** A tree's nodes, it first. */
export const flat = (n: Node | undefined): Node[] => (n ? [n, ...(n.children ?? []).flatMap(flat)] : []);
