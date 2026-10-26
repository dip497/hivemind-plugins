// The Jira service's part in the start-work guard (design §10): registered with the host's
// `issue.provideStart` for the link's source, the host asks it to refresh a stale issue (`refresh`),
// for the checks only Jira can answer (`start-checks`) and to "Assign to me" (`assign-me`).
//
// - #8: the person may not transition the issue, or be assigned it, by the permissions discovery
//   read (REST's `mypermissions`; over MCP alone they can't be read, and nothing is said).
// - #10: the issue's `hivemind` property says another install is on it (a branch or a PR, by
//   another `by`).
// - Assign to me: the person whose sign-in syncs (`myself`), never an agent, never anyone named
//   by the caller; refused up front without ASSIGN_ISSUES or ASSIGNABLE_USER when those are known.
import type { Push } from "../commands.js";
import { TransportError, type JiraTransport } from "../transport.js";
import { PROPERTY, type HiveProperty } from "./push-side.js";
import type { Schema } from "./store.js";

/** The commands the host calls, by the hook's part. */
export const PROVIDED = { refresh: "refresh", checks: "start-checks", assignMe: "assign-me" } as const;

/** One finding, as core's guard takes it (`StartFinding` in hive-core's start-guard.ts). */
export interface StartFinding {
  check: "no-permission" | "claimed-elsewhere";
  severity: "info" | "warn" | "block";
  message: string;
  actions: ("start" | "start-local" | "cancel")[];
}

export interface ProviderContext {
  transport: JiraTransport;
  /** What discovery read: the permissions and who signed in. */
  schema?: Schema;
  push: Push;
  installId: string;
}

/** The permissions discovery read, or undefined when they couldn't be read (MCP alone). */
const permissionsOf = (s?: Schema): Set<string> | undefined => (s?.discovered.permissions.length ? new Set(s.discovered.permissions) : undefined);

const isProperty = (v: unknown): v is Partial<HiveProperty> => !!v && typeof v === "object" && !Array.isArray(v);

/** The checks only Jira can answer, for the issue `key`. A check that can't be made (no
 *  permissions read, the property unreadable now) says nothing rather than stopping a start. */
export async function startChecks(key: string, c: ProviderContext): Promise<StartFinding[]> {
  const out: StartFinding[] = [];
  const perms = permissionsOf(c.schema);
  if (perms) {
    const lacks = [!perms.has("TRANSITION_ISSUES") && `move ${key} in Jira`, !perms.has("ASSIGNABLE_USER") && `be assigned ${key}`].filter(Boolean);
    if (lacks.length) out.push({ check: "no-permission", severity: "info", message: `you may not ${lacks.join(" or ")}: work on it stays in hive`, actions: ["start-local", "cancel"] });
  }
  if (c.transport.getProperty) {
    let p: unknown;
    try {
      p = await c.transport.getProperty(key, PROPERTY);
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
    }
    if (isProperty(p) && p.by && p.by !== c.installId && (p.branch || p.pr)) {
      const on = [p.branch ? `on branch ${p.branch}` : "", p.pr ? `with PR ${p.pr.repo}#${p.pr.number}` : ""].filter(Boolean).join(", ");
      out.push({ check: "claimed-elsewhere", severity: "warn", message: `another hive install is already working ${key} (${on})`, actions: ["start", "cancel"] });
    }
  }
  return out;
}

/** Make the person whose sign-in syncs the issue's assignee in Jira. */
export async function assignMe(key: string, c: ProviderContext): Promise<void> {
  if (c.push === "off") throw new TransportError("forbidden", `Send to Jira is off for this workspace: ${key} isn't assigned in Jira`);
  const me = c.schema?.discovered.me.accountId;
  if (!me) throw new TransportError("unavailable", "who signed in isn't known yet: sync once, then assign");
  const perms = permissionsOf(c.schema);
  if (perms && !perms.has("ASSIGN_ISSUES")) throw new TransportError("forbidden", `You may not assign issues in Jira (no Assign Issues permission): ${key} stays as it is`);
  if (perms && !perms.has("ASSIGNABLE_USER")) throw new TransportError("forbidden", `Jira doesn't let you be assigned issues (no Assignable User permission): ${key} stays as it is`);
  await c.transport.assign(key, me);
}
