// Which Jira issues a workspace mirrors (design §7.1), as JQL, and the incremental poll's window
// (§7.2, §7.3).
import type { Scope } from "../commands.js";

export interface ScopeBoard {
  type: string;
  /** A Kanban board's sub-filter. */
  subQuery?: string;
  /** The board filter's JQL, when it can be read (not over MCP). */
  filterJql?: string;
}

const quote = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;
const withoutOrder = (jql: string) => jql.split(/\s+order\s+by\s+/i)[0]!.trim();

/** The board's own issues: Scrum's open sprints, Kanban's filter with done work fading out after
 *  14 days, or, with no board, the project's open issues. */
export function baseJql(project: string, board?: ScopeBoard): string {
  const p = `project = ${quote(project)}`;
  if (board?.type === "scrum") return `${p} AND sprint in openSprints()`;
  if (board?.type === "kanban") {
    const filter = board.filterJql ? `(${withoutOrder(board.filterJql)})` : p;
    const sub = board.subQuery ? ` AND (${withoutOrder(board.subQuery)})` : "";
    return `${filter}${sub} AND (statusCategory != Done OR updated >= -14d)`;
  }
  return `${p} AND statusCategory != Done`;
}

/** The scope's JQL, without ORDER BY. A JQL scope with nothing in it is refused: it would read as
 *  "nothing in scope". */
export function scopeJql(scope: Scope, project: string, board?: ScopeBoard, excludedTypes: string[] = []): string {
  const base = baseJql(project, board);
  let q: string;
  switch (scope.kind) {
    case "mine": q = `(${base}) AND assignee = currentUser()`; break;
    case "mine+unassigned": q = `(${base}) AND (assignee = currentUser() OR assignee is EMPTY)`; break;
    case "all": q = base; break;
    case "jql": {
      const own = withoutOrder(scope.jql ?? "");
      if (!own) throw new Error("the JQL scope is empty: write the JQL to pull, or pick another scope");
      q = `project = ${quote(project)} AND (${own})`;
      break;
    }
  }
  if (excludedTypes.length) q += ` AND issuetype not in (${excludedTypes.map(quote).join(", ")})`;
  return q;
}

/**
 * A JQL date for `iso` minus `overlapMs`, in `timeZone` (JQL reads dates in the user's profile time
 * zone, to the minute; design §7.3): `"2026-10-24 13:28"`. An unknown zone reads as UTC.
 */
export function jqlTime(iso: string, timeZone: string, overlapMs = 120_000): string {
  const t = new Date(Date.parse(iso) - overlapMs);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  }
  const v = (k: string) => parts.find((p) => p.type === k)!.value;
  return `"${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}"`;
}

/** The incremental poll: the scope, changed since the high-water mark less 2 minutes. */
export function pollJql(scope: string, highWater: string | undefined, timeZone: string): string {
  return `(${scope})${highWater ? ` AND updated >= ${jqlTime(highWater, timeZone)}` : ""} ORDER BY updated ASC`;
}
