// The workspace's code as the app finds it (view protocol 1.19, feature `code`): files by a fuzzy
// name and lines by their text, from fff on the app's side, in each folder the workspace has. A
// frame bound to a folder or worktree is a folder of its own; every other frame shares the
// workspace's, which the view names `null`.
import type { ViewClient, ViewFindFilesPage, ViewFrame, ViewGrepMode, ViewGrepPage } from "@hivemind/view-sdk";
import { useEffect, useRef, useState } from "react";

/** A folder to search: the frame that names it (null: the workspace's own) and what it is called. */
export interface CodeRoot { frameId: string | null; title: string }

/** Whether this app finds code for the view: it is 1.19 or newer and granted `workspace:code`. */
export const canSearchCode = (hm: ViewClient): boolean => hm.capabilities.includes("workspace:code") && hm.supports("code");

/** The folders of the workspace, the workspace's own first: one per frame bound to a folder. */
export function codeRoots(frames: readonly ViewFrame[], workspaceName: string): CodeRoot[] {
  return [{ frameId: null, title: workspaceName }, ...frames.filter((f) => f.folder).map((f) => ({ frameId: f.id, title: f.folder!.name }))];
}

/** The folder a frame's code is in: its own when bound to one, else the workspace's. */
export function rootOf(frames: readonly ViewFrame[], frameId: string | null): string | null {
  const f = frameId ? frames.find((x) => x.id === frameId) : undefined;
  return f?.folder ? f.id : null;
}

/** How long typing waits before it asks: a search per pause, not per key. */
const QUIET_MS = { files: 60, lines: 250 } as const;

/** Files by name in `root` for `query`, asked once typing pauses; the last answer meanwhile. */
export function useFoundFiles(hm: ViewClient, on: boolean, root: string | null, query: string): { query: string; page: ViewFindFilesPage } | null {
  const [found, setFound] = useState<{ query: string; page: ViewFindFilesPage } | null>(null);
  useEffect(() => {
    if (!on) { setFound(null); return; }
    let live = true;
    const t = setTimeout(() => {
      hm.code.findFiles(root, query, { limit: 30 }).then((page) => { if (live) setFound({ query, page }); }, () => { if (live) setFound(null); });
    }, QUIET_MS.files);
    return () => { live = false; clearTimeout(t); };
  }, [hm, on, root, query]);
  return found;
}

export interface GrepOpts { mode: ViewGrepMode; caseSensitive: boolean }
/** One folder's lines found: its pages so far, whether there are more, and why it failed. */
export interface RootHits { root: CodeRoot; pages: ViewGrepPage[]; next: number | null; error?: string }

/**
 * Lines holding `query` in every folder, a page each, asked once typing pauses. `more(i)` asks the
 * next page of folder `i`. A new query drops the answers still coming for the one before.
 */
export function useGrep(hm: ViewClient, roots: readonly CodeRoot[], query: string, opts: GrepOpts): { hits: RootHits[]; busy: boolean; more: (i: number) => void } {
  const [hits, setHits] = useState<RootHits[]>([]);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);
  const key = roots.map((r) => r.frameId ?? "").join("\n");
  useEffect(() => {
    const seq = ++asked.current;
    if (!query.trim()) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(() => {
      void Promise.all(roots.map((root) => hm.code.grep(root.frameId, query, opts).then(
        (page): RootHits => ({ root, pages: [page], next: page.next }),
        (e: unknown): RootHits => ({ root, pages: [], next: null, error: e instanceof Error ? e.message : String(e) }),
      ))).then((all) => { if (seq === asked.current) { setHits(all); setBusy(false); } });
    }, QUIET_MS.lines);
    return () => clearTimeout(t);
    // `key` stands for the roots: a new array of the same folders asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hm, key, query, opts.mode, opts.caseSensitive]);
  const more = (i: number) => {
    const h = hits[i];
    if (!h || h.next === null) return;
    const seq = asked.current;
    void hm.code.grep(h.root.frameId, query, { ...opts, cursor: h.next }).then((page) => {
      if (seq !== asked.current) return;
      setHits((all) => all.map((x, k) => (k === i ? { ...x, pages: [...x.pages, page], next: page.next } : x)));
    }, () => {});
  };
  return { hits, busy, more };
}
