// How a hive status becomes Jira transitions (design §8.2, §6.3). Pure: the push engine fetches the
// live transitions and reads workflow.yaml; this decides.
//
// - A hive-only status shows in Jira as the status it follows, or leaves Jira alone (`stay`).
// - A transition straight to the target is taken; else the shortest path over the learned graph,
//   3 hops at most, its first hop one Jira offers now.
// - A screen's required fields become a form, pre-filled from the person's per-transition defaults
//   (and a resolution named like the target status). `resolution` is sent only when the screen has it.
// - A field Jira demands that isn't on the screen (a hidden validator) can't be set from hive: once
//   Jira named it, the move is refused up front with its words.
import type { Transition } from "../transport.js";
import type { WfTransition, Workflow } from "./workflow.js";

/** The Jira status a hive status shows as in Jira: itself for Jira's own, what a hive-only status
 *  follows, or null when Jira is left as it is (`stay`, or a status of hive's with no follow). */
export function jiraTargetOf(wf: Pick<Workflow, "statuses">, status: string): string | null {
  if (status.startsWith("jira:")) return status;
  const s = wf.statuses.find((x) => x.id === status);
  if (!s?.jira || s.jira === "stay") return null;
  return s.jira.follow.startsWith("jira:") ? s.jira.follow : null;
}

const jid = (id: string) => `jira:${id}`;

/**
 * `wf` with what a live `GET transitions` of an issue of type `typeKey` (`jira:10001`) in status
 * `from` said: each transition an edge from `from` (from anywhere when Jira says it's global), the
 * ones Jira no longer offers from there taken away. Undefined when nothing changed, or the type
 * isn't in the workflow. The Issues tool's status picker reads these edges (`issueTypes`).
 */
export function learnTransitions(wf: Workflow, typeKey: string, from: string, live: Transition[]): Workflow | undefined {
  const type = wf.issueTypes[typeKey];
  if (!type) return undefined;
  const before = JSON.stringify(type.transitions);
  const edges: WfTransition[] = type.transitions.map((t) => ({ ...t, from: t.from === "*" ? "*" : [...t.from] }));
  const offered = new Set(live.map((t) => t.id));
  // Live wins: an edge from here that Jira no longer offers isn't one any more.
  for (const e of edges) if (e.from !== "*" && e.from.includes(from) && !offered.has(e.id)) e.from = e.from.filter((f) => f !== from);
  for (const t of live) {
    const to = jid(t.to.id);
    const fields = Object.keys(t.fields);
    const facts = { name: t.name, to, screen: t.hasScreen, ...(fields.length ? { fields } : {}) };
    const e = edges.find((x) => x.id === t.id && x.to === to);
    if (!e) edges.push({ id: t.id, ...facts, from: t.isGlobal ? "*" : [from] });
    else {
      const { fields: _f, ...rest } = e;
      Object.assign(e, rest, facts);
      if (!fields.length) delete e.fields;
      if (t.isGlobal) e.from = "*";
      else if (e.from !== "*" && !e.from.includes(from)) e.from.push(from);
    }
  }
  const kept = edges.filter((e) => e.from === "*" || e.from.length > 0);
  if (JSON.stringify(kept) === before) return undefined;
  return { ...wf, issueTypes: { ...wf.issueTypes, [typeKey]: { ...type, transitions: kept } } };
}

export interface Step {
  /** The transition's id. */
  id: string;
  name: string;
  from: string;
  /** `jira:<id>`. */
  to: string;
  screen: boolean;
}

/**
 * The shortest way from `from` to `to`, at most `max` transitions: its first one among `live` (what
 * Jira offers this issue now, available), the rest over the learned `edges`. Undefined when there is
 * none that short.
 */
export function findPath(edges: readonly WfTransition[], live: readonly Transition[], from: string, to: string, max = 3): Step[] | undefined {
  if (from === to) return [];
  const next = (at: string): Step[] =>
    at === from
      ? live.filter((t) => t.isAvailable).map((t) => ({ id: t.id, name: t.name, from: at, to: jid(t.to.id), screen: t.hasScreen }))
      : edges.filter((e) => (e.from === "*" ? e.to !== at : e.from.includes(at))).map((e) => ({ id: e.id, name: e.name ?? e.id, from: at, to: e.to, screen: !!e.screen }));
  let frontier: { at: string; path: Step[] }[] = [{ at: from, path: [] }];
  const seen = new Set([from]);
  for (let hop = 0; hop < max; hop++) {
    const after: typeof frontier = [];
    for (const { at, path } of frontier) {
      for (const s of next(at)) {
        if (seen.has(s.to)) continue;
        const p = [...path, s];
        if (s.to === to) return p;
        seen.add(s.to);
        after.push({ at: s.to, path: p });
      }
    }
    frontier = after;
  }
  return undefined;
}

/** One field of a transition's screen, as a form shows it. */
export interface FormField {
  /** The transition (step) it belongs to. */
  step: string;
  id: string;
  name: string;
  required: boolean;
  kind: "select" | "text";
  options?: { id?: string; name: string }[];
  /** What it is set to before the person looks: their default for this transition, else a
   *  resolution named like the status the step goes to. */
  value?: string;
}

/** The fields a transition's screen asks for: the required ones, and `resolution` whenever it is on
 *  the screen. Other optional fields are left as Jira fills them. */
export function screenFields(t: Transition, toName: string, defaults: Record<string, string> = {}): FormField[] {
  const out: FormField[] = [];
  for (const [id, f] of Object.entries(t.fields)) {
    if (!f.required && id !== "resolution") continue;
    const options = f.allowedValues?.map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name }));
    const named = options?.find((o) => o.name.toLowerCase() === toName.toLowerCase());
    const pick = defaults[id] ?? (id === "resolution" ? (named ?? (options?.length === 1 ? options[0] : undefined))?.name : undefined);
    out.push({ step: t.id, id, name: f.name, required: f.required, kind: options?.length ? "select" : "text", ...(options?.length ? { options } : {}), ...(pick !== undefined ? { value: pick } : {}) });
  }
  return out;
}

/** The fields to send with a transition: each form value in the shape Jira takes (a choice by id, or
 *  by name), and only fields the screen has. Empty values are left out. */
export function fieldValues(fields: readonly FormField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.id] ?? f.value;
    if (v === undefined || v === "") continue;
    if (f.kind === "select") {
      const o = f.options?.find((x) => x.name === v || x.id === v);
      out[f.id] = o?.id ? { id: o.id } : { name: o?.name ?? v };
    } else out[f.id] = v;
  }
  return out;
}

/** The required fields a form leaves empty. */
export const missing = (fields: readonly FormField[], values: Record<string, string> = {}): FormField[] =>
  fields.filter((f) => f.required && !(values[f.id] ?? f.value));
