// What Focus shows, worked out from the workspace alone: each agent in one of four groups, the
// line under its name, and the order of the list. No DOM here; tests/views.test.ts checks it.
import type { ViewAgentStatus, ViewFrame, ViewStatus, ViewTile } from "@hivemind/view-sdk";

export type Group = "needs" | "working" | "ready" | "stopped";

/** The groups, in the order the list shows them: whoever waits on you first. */
export const GROUPS: readonly { id: Group; title: string }[] = [
  { id: "needs", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "ready", title: "Ready" },
  { id: "stopped", title: "Stopped" },
];

/** The group for an agent with this status and what it reports doing. */
export function groupOf(status: ViewStatus | undefined, agent: ViewAgentStatus | undefined): Group {
  const s = agent?.state;
  if (status === "blocked" || s === "waiting") return "needs";
  if (s === "failed" || s === "limited" || s === "interrupted" || s === "exited" || status === "exited") return "stopped";
  if (status === "working" || s === "working") return "working";
  return "ready";
}

export interface Row {
  id: string;
  name: string;
  agent: string;
  group: Group;
  since: number;
  /** Why it waits, how it stopped, what it runs. */
  detail: string;
  frame: { title: string; color?: string } | null;
  /** The agent's own mark as the app draws it (an `<svg>` in currentColor), when the host sends one. */
  icon?: string;
  /** It failed (an error, a usage limit), as against stopping cleanly. */
  failed: boolean;
}

export interface Seen { status?: ViewStatus; since?: number; agent?: ViewAgentStatus }

const WHY: Record<string, string> = { permission: "wants permission", question: "asked a question", plan: "has a plan for you", approval: "wants approval" };

export function detailOf(group: Group, agent: ViewAgentStatus | undefined, kind: string): string {
  if (group === "needs") return WHY[agent?.waitingFor ?? ""] ?? "needs you";
  if (group === "stopped") {
    const s = agent?.state;
    return s === "limited" ? "hit a usage limit" : s === "failed" ? "stopped on an error" : s === "interrupted" ? "was interrupted" : "has exited";
  }
  const helpers = agent?.subagents ?? 0;
  if (group === "working" && helpers) return `${helpers} helper${helpers === 1 ? "" : "s"} running`;
  return kind;
}

/** Every agent tile as a row: grouped in GROUPS order, and in a group, longest there first. */
export function rows(tiles: readonly ViewTile[], frames: readonly ViewFrame[], seen: ReadonlyMap<string, Seen>, names: ReadonlyMap<string, string>, now: number): Row[] {
  const order = new Map(GROUPS.map((g, i) => [g.id, i]));
  return tiles.filter((t) => t.agent).map((t): Row => {
    const s = seen.get(t.id) ?? {};
    // An agent put to sleep has no process: it stopped, cleanly, until it is woken.
    const group = t.asleep ? "stopped" : groupOf(s.status, s.agent);
    const f = frames.find((x) => x.id === t.frameId);
    const state = s.agent?.state;
    return {
      id: t.id, name: names.get(t.id) ?? t.name, agent: t.agent!, group, since: s.since ?? now,
      detail: t.asleep ? "is asleep" : detailOf(group, s.agent, t.agent!),
      frame: f ? { title: f.title, color: f.color } : null,
      icon: t.icon,
      failed: !t.asleep && group === "stopped" && (state === "failed" || state === "limited"),
    };
  }).sort((a, b) => order.get(a.group)! - order.get(b.group)! || a.since - b.since || a.name.localeCompare(b.name));
}

/** The rows whose name, agent or folder holds the text typed. */
export function filtered(all: readonly Row[], text: string): Row[] {
  const q = text.trim().toLowerCase();
  return q ? all.filter((r) => [r.name, r.agent, r.frame?.title ?? ""].some((s) => s.toLowerCase().includes(q))) : [...all];
}

/** The agent Focus opens on, so it never opens on an empty pane: whoever has waited on you longest,
 *  else the ready agent that came back most recently (its turn just finished), else the first. */
export function firstToOpen(all: readonly Row[]): Row | null {
  const needs = all.find((r) => r.group === "needs");
  if (needs) return needs;
  const ready = all.filter((r) => r.group === "ready").sort((a, b) => b.since - a.since)[0];
  return ready ?? all[0] ?? null;
}

/** The line under the title: who waits on you, by name, else what the agents are doing. */
export function finding(all: readonly Row[]): { text: string; waits: boolean } {
  const needs = all.filter((r) => r.group === "needs");
  if (needs.length) {
    const first = needs[0]!;
    const more = needs.length - 1;
    return { text: `${first.name} ${first.detail}${more ? `, and ${more} more wait${more === 1 ? "s" : ""} on you` : ""}`, waits: true };
  }
  if (!all.length) return { text: "No agents yet", waits: false };
  const count = (g: Group) => all.filter((r) => r.group === g).length;
  const parts = ([["working", "working"], ["ready", "ready"], ["stopped", "stopped"]] as const).filter(([g]) => count(g)).map(([g, w]) => `${count(g)} ${w}`);
  return { text: `Nobody waits on you · ${parts.join(", ")}`, waits: false };
}

/** How long, in a few characters: 45s, 12m, 3h 5m. */
export function ago(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** The row after (or before) the selected one, wrapping; the first when none is selected. */
export function step(list: readonly Row[], selected: string | null, by: 1 | -1): string | null {
  if (!list.length) return null;
  const i = list.findIndex((r) => r.id === selected);
  if (i < 0) return list[by === 1 ? 0 : list.length - 1]!.id;
  return list[(i + by + list.length) % list.length]!.id;
}
