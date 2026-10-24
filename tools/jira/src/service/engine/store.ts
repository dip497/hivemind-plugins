// What the Jira service keeps in a workspace (design §5.3), all under `.hivemind/`:
//
//   sync/jira.json            the link: site, project, board, scope, push (written by `configure`)
//   sync/<slug>/schema.json   what discovery read, and the categories it proposed
//   sync/<slug>/service.json  the pull's own bookkeeping: high-water mark, mirrored ids, retries
//   sync/<slug>/request       touched by anyone to ask for a sync now (§7.2)
//   workflow.yaml             the statuses, regenerated from discovery (the person's parts kept)
//
// `sync/` is gitignored (ingest adds it). Every write is a temp file renamed into place.
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Push, Scope, Sprints } from "../commands.js";
import type { Discovered } from "../transport.js";
import type { Category, Workflow } from "./workflow.js";
import { workflowText } from "./workflow-file.js";

export interface Link {
  v: 1;
  /** `jira:<site>/<PROJECT>`: the ingest source. */
  source: string;
  site: string;
  cloudId: string;
  project: string;
  boardId?: number;
  scope: Scope;
  sprints?: Sprints;
  push: Push;
  excludedTypes?: string[];
  /** Resolutions the person counts as cancelled; absent = discovery's guess. */
  cancelledResolutions?: string[];
}

export interface Schema {
  v: 1;
  discoveredAt: string;
  discovered: Discovered;
  sprintField?: { id: string; name: string };
  estimateField?: { id: string; name: string };
  flaggedField?: { id: string; name: string };
  proposed: Record<string, Category>;
  notes: string[];
}

export interface Mirrored {
  key: string;
  /** Jira's `updated` as last pulled. */
  updated?: string;
  /** Jira's status id (`jira:…`) as last pulled. */
  status?: string;
  archived?: string;
}

export interface SyncState {
  v: 1;
  /** The newest Jira `updated` pulled (Jira's clock, never ours). */
  highWater?: string;
  lastSync?: string;
  lastReconcile?: string;
  mirrored: Record<string, Mirrored>;
  /** Imported with Track, kept while Jira has them though outside the scope. */
  tracked: string[];
  /** Ids a reconcile could not check (a retriable failure): checked again, never archived for it. */
  retry: string[];
  /** Ids whose comments are still to be read (the budget ran out). */
  commentsDue: string[];
}

/** The site's short name, for the source id: `acme.atlassian.net` → `acme`. */
export function siteName(site: string): string {
  const host = (() => { try { return new URL(site.includes("://") ? site : `https://${site}`).host; } catch { return site; } })();
  return host.replace(/\.atlassian\.net$/i, "").replace(/[^A-Za-z0-9.-]+/g, "-") || "jira";
}

export const sourceId = (site: string, project: string) => `jira:${siteName(site)}/${project}`;

/** The folder name ingest uses for a source (hive-core mirror.ts `sourceSlug`). */
export function sourceSlug(source: string): string {
  return source.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[-.]+|-+$/g, "");
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** One workspace's files. `root` is its `.hivemind` folder. */
export class Store {
  constructor(readonly root: string) {}

  get linkFile(): string {
    return path.join(this.root, "sync", "jira.json");
  }
  syncDir(source: string): string {
    return path.join(this.root, "sync", sourceSlug(source));
  }
  requestFile(source: string): string {
    return path.join(this.syncDir(source), "request");
  }
  get workflowFile(): string {
    return path.join(this.root, "workflow.yaml");
  }

  async link(): Promise<Link | undefined> {
    const l = await readJson<Link>(this.linkFile);
    return l?.v === 1 && l.source && l.project ? l : undefined;
  }
  saveLink(l: Link): Promise<void> {
    return writeAtomic(this.linkFile, JSON.stringify(l, null, 2) + "\n");
  }

  async schema(source: string): Promise<Schema | undefined> {
    const s = await readJson<Schema>(path.join(this.syncDir(source), "schema.json"));
    return s?.v === 1 ? s : undefined;
  }
  saveSchema(source: string, s: Schema): Promise<void> {
    return writeAtomic(path.join(this.syncDir(source), "schema.json"), JSON.stringify(s, null, 2) + "\n");
  }

  async state(source: string): Promise<SyncState> {
    const s = await readJson<SyncState>(path.join(this.syncDir(source), "service.json"));
    if (s?.v === 1 && s.mirrored) return { ...s, tracked: s.tracked ?? [], retry: s.retry ?? [], commentsDue: s.commentsDue ?? [] };
    // None yet: what ingest's ledger says was mirrored, so a lost state file archives nothing wrongly.
    const ledger = await readJson<{ entries?: Record<string, { id: string; remoteStatus?: string; remoteUpdated?: string }> }>(path.join(this.syncDir(source), "ledger.json"));
    const mirrored: Record<string, Mirrored> = {};
    for (const [id, e] of Object.entries(ledger?.entries ?? {})) mirrored[id] = { key: e.id, ...(e.remoteUpdated ? { updated: e.remoteUpdated } : {}), ...(e.remoteStatus ? { status: e.remoteStatus } : {}) };
    return { v: 1, mirrored, tracked: [], retry: [], commentsDue: [] };
  }
  saveState(source: string, s: SyncState): Promise<void> {
    return writeAtomic(path.join(this.syncDir(source), "service.json"), JSON.stringify(s) + "\n");
  }

  /** Ingest's open conflicts (its ledger, `sync/<slug>/ledger.json`). */
  async conflicts(source: string): Promise<{ id: string; local: string; remote: string; since: string }[]> {
    const ledger = await readJson<{ entries?: Record<string, { conflict?: { id: string; local: string; remote: string; since: string } }> }>(path.join(this.syncDir(source), "ledger.json"));
    return Object.values(ledger?.entries ?? {}).flatMap((e) => (e.conflict ? [{ id: e.conflict.id, local: e.conflict.local, remote: e.conflict.remote, since: e.conflict.since }] : []));
  }

  async workflow(): Promise<Workflow | undefined> {
    let text: string;
    try {
      text = await fs.readFile(this.workflowFile, "utf8");
    } catch {
      return undefined;
    }
    const wf = YAML.parse(text) as Workflow | null;
    if (!wf || !Array.isArray(wf.statuses)) throw new Error(`${this.workflowFile} isn't a workflow hive reads; fix it or move it away, then sync again`);
    return { ...wf, issueTypes: wf.issueTypes ?? {}, local: wf.local ?? {} };
  }
  /** Write `wf`, editing the file in place so the person's comments, order and formatting stay. */
  async saveWorkflow(wf: Workflow): Promise<void> {
    let text: string | undefined;
    try { text = await fs.readFile(this.workflowFile, "utf8"); } catch { text = undefined; }
    await writeAtomic(this.workflowFile, workflowText(text, wf));
  }

  /** Whether someone asked for a sync (the request file), taking the request. */
  async takeRequest(source: string): Promise<boolean> {
    try {
      await fs.rm(this.requestFile(source));
      return true;
    } catch {
      return false;
    }
  }
}
