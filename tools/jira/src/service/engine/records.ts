// A Jira issue as hive's ingest takes it (`IngestRecordZ` in hive-core's ingest.ts; design §5.1,
// §6.4). Transport-neutral: it reads `RawIssue`, where a custom field is under its id (REST) or,
// over MCP, under `customFields` by its name.
import type { RawComment, RawIssue } from "../transport.js";
import type { Category } from "./workflow.js";

export interface IngestRecord {
  external: {
    id: string;
    key: string;
    url?: string;
    type?: { id: string; name: string; hierarchyLevel?: number };
    assignee?: { accountId?: string; name: string; me?: boolean } | null;
    reporter?: { accountId?: string; name: string } | null;
    sprint?: { id: number; name: string; state: string } | null;
    priority?: string;
    estimate?: number;
    parentKey?: string;
    remoteUpdated?: string;
  };
  title?: string;
  description?: string | null;
  status?: { id: string; name: string; category: Category };
  labels?: string[];
  acceptanceCriteria?: { done: boolean; text: string }[];
  comments?: { id: string; author: string; body: string; created: string; updated?: string }[];
  archived?: { reason: "left scope" | "deleted" | "no access" };
}

export interface FieldRef { id: string; name: string }

export interface RecordContext {
  siteUrl: string;
  me: string;
  /** The category of each workflow status (`jira:<id>` → category), the person's edits included. */
  categoryOf(statusId: string, jira: { name: string; categoryKey?: string }): Category;
  sprintField?: FieldRef;
  estimateField?: FieldRef;
  flaggedField?: FieldRef;
}

/** The fields a pull asks for. */
export function pullFields(ctx: Pick<RecordContext, "sprintField" | "estimateField" | "flaggedField">): string[] {
  return [
    "summary", "status", "assignee", "reporter", "issuetype", "priority", "labels", "components", "fixVersions",
    "parent", "updated", "created", "description", "resolution",
    ...[ctx.sprintField, ctx.estimateField, ctx.flaggedField].filter((f): f is FieldRef => !!f).map((f) => f.id),
  ];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);

/** A custom field's value: under its id, or over MCP under `customFields` by name. */
export function customValue(raw: RawIssue, f: FieldRef | undefined): unknown {
  if (!f) return undefined;
  if (raw.fields[f.id] !== undefined) return raw.fields[f.id];
  return obj(raw.fields.customFields)?.[f.name];
}

/** The sprint an issue is in now: an active one, else the next, else the last. */
function sprintOf(v: unknown): IngestRecord["external"]["sprint"] {
  const list = (Array.isArray(v) ? v : v ? [v] : []).map(obj).filter((s): s is Obj => !!s && typeof s.id === "number" && typeof s.name === "string");
  const pick = list.find((s) => s.state === "active") ?? list.find((s) => s.state === "future") ?? list.at(-1);
  return pick ? { id: pick.id as number, name: pick.name as string, state: String(pick.state ?? "") } : null;
}

const AC_HEADING = /^\s*(#{1,6}\s*|\*\*|__)?\s*acceptance\s+criteria\s*:?\s*(\*\*|__)?\s*:?\s*$/i;
const ITEM = /^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*\S)\s*$/;

/**
 * Acceptance criteria written in the description — a heading (or bold line) "Acceptance criteria"
 * followed by a list, checkboxes or plain bullets — taken out of it into hive's own list.
 */
export function splitAcceptance(md: string): { description: string; items?: { done: boolean; text: string }[] } {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => AC_HEADING.test(l));
  if (at < 0) return { description: md };
  const items: { done: boolean; text: string }[] = [];
  let end = at + 1;
  while (end < lines.length && lines[end]!.trim() === "") end++;
  for (; end < lines.length; end++) {
    const m = ITEM.exec(lines[end]!);
    if (!m) break;
    items.push({ done: m[1] === "x" || m[1] === "X", text: m[2]! });
  }
  if (!items.length) return { description: md };
  const description = [...lines.slice(0, at), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { description, items };
}

const user = (v: unknown) => {
  const u = obj(v);
  return u && typeof u.displayName === "string" ? { ...(typeof u.accountId === "string" ? { accountId: u.accountId } : {}), name: u.displayName } : null;
};

/** The ingest record for a pulled issue (and its comments, when they were read). */
export function toRecord(raw: RawIssue, ctx: RecordContext, comments?: RawComment[]): IngestRecord {
  const f = raw.fields;
  const status = obj(f.status);
  const type = obj(f.issuetype);
  const priority = obj(f.priority);
  const assignee = user(f.assignee);
  const reporter = user(f.reporter);
  const estimate = customValue(raw, ctx.estimateField);
  const flagged = customValue(raw, ctx.flaggedField);
  const statusId = `jira:${String(status?.id ?? "")}`;
  const statusName = String(status?.name ?? status?.id ?? "unknown");
  const split = raw.descriptionMd === undefined ? undefined : splitAcceptance(raw.descriptionMd ?? "");
  const named = (v: unknown, prefix: string) => (Array.isArray(v) ? v.map(obj).filter((x): x is Obj => !!x && typeof x.name === "string").map((x) => `${prefix}${x.name as string}`) : []);
  const labels = [
    ...(Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === "string") : []),
    ...named(f.components, "comp:"),
    ...named(f.fixVersions, "ver:"),
    ...(type?.name ? [`type:${type.name as string}`] : []),
    ...(priority?.name ? [`p:${priority.name as string}`] : []),
    ...((Array.isArray(flagged) ? flagged.length > 0 : !!flagged) ? ["flagged"] : []),
  ];
  const parent = obj(f.parent);
  return {
    external: {
      id: raw.id,
      key: raw.key,
      url: `${ctx.siteUrl.replace(/\/$/, "")}/browse/${raw.key}`,
      ...(type ? { type: { id: String(type.id), name: String(type.name), ...(typeof type.hierarchyLevel === "number" ? { hierarchyLevel: type.hierarchyLevel } : {}) } } : {}),
      assignee: assignee ? { ...assignee, me: assignee.accountId === ctx.me } : null,
      reporter,
      ...(ctx.sprintField ? { sprint: sprintOf(customValue(raw, ctx.sprintField)) } : {}),
      ...(priority?.name ? { priority: String(priority.name) } : {}),
      ...(typeof estimate === "number" ? { estimate } : {}),
      ...(parent?.key ? { parentKey: String(parent.key) } : {}),
      ...(typeof f.updated === "string" ? { remoteUpdated: f.updated } : {}),
    },
    title: typeof f.summary === "string" && f.summary.trim() ? f.summary : raw.key,
    ...(split ? { description: split.description } : {}),
    status: { id: statusId, name: statusName, category: ctx.categoryOf(statusId, { name: statusName, categoryKey: (obj(status?.statusCategory)?.key as string | undefined) }) },
    labels,
    ...(split?.items ? { acceptanceCriteria: split.items } : {}),
    ...(comments ? { comments: comments.map((c) => ({ id: c.id, author: c.author.displayName, body: c.bodyMd, created: c.created, updated: c.updated })) } : {}),
  };
}

/** A record saying a mirrored issue is hidden, and why. */
export const archivedRecord = (id: string, key: string, reason: "left scope" | "deleted" | "no access"): IngestRecord => ({ external: { id, key }, archived: { reason } });
