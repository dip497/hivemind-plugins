// The primary side bar's three views. Explorer: frames as folders, tiles as files, with the open
// editors above and the active tile's timeline below. Search: tiles and frames by name, grouped by
// frame as VS Code groups results by file. Agents: Source Control's place, a message box that sends
// the active agent its next task, and every agent grouped by what it needs from you.
import type { ViewTile } from "@hivemind/view-sdk";
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Bench } from "./App";
import { Icon, Mark, TileIcon } from "./Icon";
import { fuzzy, highlight, isCode, stateOf, tree, type AgentGroup, type TreeRow } from "./model";

const TITLES = { explorer: "Explorer", search: "Search", scm: "Source Control", agents: "Agents" } as const;

export function SideBar({ b, width }: { b: Bench; width: number }) {
  const view = b.layout.sidebar.view;
  return (
    <aside className="sidebar" style={{ width }} aria-label={TITLES[view]}>
      <div className="title">
        <span>{TITLES[view]}</span>
        <div className="actions">
          <button className="act" title="More Actions…" aria-label="More Actions…" onClick={(e) => b.menu(b.viewMenu(view), at(e.currentTarget), `${TITLES[view]} actions`)}><Icon name="ellipsis" /></button>
        </div>
      </div>
      {view === "explorer" ? <Explorer b={b} /> : view === "search" ? <Search b={b} /> : view === "scm" ? <SourceControl b={b} /> : <Agents b={b} />}
    </aside>
  );
}

/** Below a button, as VS Code drops its menus. */
export const at = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 2 }; };

/** One of the side bar's sections, folded by its header. */
function Pane({ b, id, title, grow, actions, count, children }: { b: Bench; id: string; title: string; grow?: boolean; actions?: ReactNode; count?: ReactNode; children: ReactNode }) {
  const open = !b.layout.shut.includes(id);
  const toggle = () => b.update((l) => ({ ...l, shut: open ? [...l.shut, id] : l.shut.filter((s) => s !== id) }));
  return (
    <section className={`pane${open && grow ? " grow" : ""}`} aria-label={title}>
      <div className="head" role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
        <span className="twistie"><Icon name={open ? "chevronDown" : "chevronRight"} /></span>
        <span className="label">{title}</span>
        {open && actions && <div className="actions" onClick={(e) => e.stopPropagation()}>{actions}</div>}
        {count}
      </div>
      {open && <div className="body">{children}</div>}
    </section>
  );
}

/** A tile's row as every list here draws it: its icon, name, a dim second word and its state. */
function TileRow({ b, tile, depth = 0, desc, selected, children, onOpen }: { b: Bench; tile: ViewTile; depth?: number; desc?: ReactNode; selected: boolean; children?: ReactNode; onOpen?: (pinned: boolean) => void }) {
  const st = stateOf(tile, b.world.seen.get(tile.id));
  const renaming = b.renaming === tile.id;
  const people = b.world.participants.filter((p) => p.cursor?.tileId === tile.id || p.selection.includes(tile.id));
  const open = onOpen ?? ((pinned: boolean) => b.open(tile.id, { preview: !pinned }));
  return (
    <div className={`row${selected ? " selected" : ""}`} role="treeitem" aria-selected={selected} aria-level={depth + 1} data-id={tile.id}
      style={{ paddingLeft: 8 + depth * 8 + 16 }} draggable={!renaming}
      onDragStart={(e) => { e.dataTransfer.setData("application/x-hivemind-tile", tile.id); e.dataTransfer.effectAllowed = "move"; b.drag.start(tile.id); }}
      onDragEnd={() => b.drag.end()}
      onClick={(e) => { b.select(tile.id); if (e.detail === 1) open(false); }}
      onDoubleClick={() => open(true)}
      onContextMenu={(e) => { e.preventDefault(); b.select(tile.id); b.menu(b.tileMenu(tile.id), { x: e.clientX, y: e.clientY }, tile.name); }}>
      {Array.from({ length: depth }, (_, i) => <span key={i} className="indent" style={{ left: 8 + i * 8 + 7 }} />)}
      <span className="ico"><TileIcon tile={tile} /></span>
      {renaming ? <RenameField b={b} tile={tile} /> : (
        <>
          <span className="name" style={st?.tone === "attention" ? { color: "var(--attention-ink)" } : undefined}>{children ?? tile.name}</span>
          {desc && <span className="desc">{desc}</span>}
        </>
      )}
      <span className="end">
        {people.map((p) => <span key={p.id} className="who" style={{ background: p.color }} title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>)}
        {st && st.tone !== "idle" && <Mark tone={st.tone} title={`${tile.name} ${st.why}`} />}
      </span>
    </div>
  );
}

function RenameField({ b, tile }: { b: Bench; tile: ViewTile }) {
  const el = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { el.current?.focus(); el.current?.select(); }, []);
  const done = useRef(false);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; b.finishRename(tile.id, name); };
  return (
    <input ref={el} className="rename" defaultValue={tile.name} aria-label={`Rename ${tile.name}`} spellCheck={false}
      onClick={(e) => e.stopPropagation()} onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }} />
  );
}

/** Arrows, Home and End through a list's rows; Enter opens; what each list adds on top. */
function listKeys(e: KeyboardEvent, ids: readonly string[], b: Bench, more?: (key: string, id: string) => boolean) {
  if (b.renaming) return;
  const i = b.selected ? ids.indexOf(b.selected) : -1;
  const go = (j: number) => { e.preventDefault(); const id = ids[Math.max(0, Math.min(ids.length - 1, j))]; if (id) b.select(id); };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i < 0 ? ids.length - 1 : i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(ids.length - 1);
  else if (b.selected && more?.(e.key, b.selected)) e.preventDefault();
  else if (e.key === "Enter" && b.selected && b.world.byId.has(b.selected)) { e.preventDefault(); b.open(b.selected, { preview: false, focus: true }); }
  else if (e.key === " " && b.selected && b.world.byId.has(b.selected)) { e.preventDefault(); b.open(b.selected, { preview: true }); }
}

// ── Explorer ─────────────────────────────────────────────────────────────────

function Explorer({ b }: { b: Bench }) {
  const { frames, tiles } = b.world;
  const folded = useMemo(() => new Set(b.layout.folded), [b.layout.folded]);
  const rows = useMemo(() => tree(frames, tiles, folded), [frames, tiles, folded]);
  const fold = (id: string, shut: boolean) => b.update((l) => ({ ...l, folded: shut ? [...new Set([...l.folded, id])] : l.folded.filter((f) => f !== id) }));
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { list.current?.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" }); }, [b.selected]);
  const [drop, setDrop] = useState<string | null>(null);
  // A frame whose tiles wait on you says so while folded, as a folder shows its files' decorations.
  const calling = useMemo(() => {
    const out = new Set<string>();
    for (const t of tiles) if (t.frameId && stateOf(t, b.world.seen.get(t.id))?.tone === "attention") {
      for (let f = b.world.frameById.get(t.frameId); f && !out.has(f.id); f = f.parentId ? b.world.frameById.get(f.parentId) : undefined) out.add(f.id);
    }
    return out;
  }, [tiles, b.world.seen, b.world.frameById]);
  const openEditors = b.layout.groups.flatMap((g, gi) => g.tabs.map((t) => ({ t, gi, g })));

  return (
    <div className="panes">
      <Pane b={b} id="open-editors" title="Open Editors" count={openEditors.length ? <span className="badge count">{openEditors.length}</span> : undefined}
        actions={<>
          <button className="act" title="Close All Editors" aria-label="Close All Editors" onClick={() => b.run("workbench.action.closeAllEditors")}><Icon name="closeAll" /></button>
        </>}>
        <div className="list" role="tree" aria-label="Open editors">
          {b.layout.groups.map((g, gi) => (
            <Fragment key={g.id}>
              {b.layout.groups.length > 1 && <div className="row" style={{ paddingLeft: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Group {gi + 1}</div>}
              {g.tabs.map((id) => {
                const t = b.world.byId.get(id);
                if (!t) return null;
                return (
                  <TileRow key={id} b={b} tile={t} selected={g.active === id && g.id === b.layout.activeGroup} desc={b.frameTitle(t.frameId)} onOpen={() => b.open(id, { group: g.id })}>
                    {g.preview === id ? <i>{t.name}</i> : t.name}
                  </TileRow>
                );
              })}
            </Fragment>
          ))}
        </div>
      </Pane>
      <Pane b={b} id="workspace" title="Workspace" grow
        actions={<>
          <button className="act" title="New Terminal" aria-label="New Terminal" disabled={!b.can.spawn} onClick={() => b.run("workbench.action.terminal.new")}><Icon name="newFile" /></button>
          <button className="act" title="New Agent…" aria-label="New Agent…" disabled={!b.can.spawn} onClick={() => b.run("hivemind.newAgent")}><Icon name="sparkle" /></button>
          <button className="act" title="New Frame" aria-label="New Frame" disabled={!b.can.spawn} onClick={() => b.run("hivemind.newFrame")}><Icon name="newFolder" /></button>
          <button className="act" title="Collapse Folders in Explorer" aria-label="Collapse Folders in Explorer" onClick={() => b.update((l) => ({ ...l, folded: frames.map((f) => f.id) }))}><Icon name="collapseAll" /></button>
        </>}>
        <div ref={list} className="list" role="tree" aria-label="Workspace" tabIndex={0} style={{ minHeight: "100%" }}
          onKeyDown={(e) => listKeys(e, rows.map((r) => r.id), b, (key, id) => {
            const r = rows.find((x) => x.id === id);
            if (!r) return false;
            if (key === "ArrowRight" && r.kind === "frame") { if (!r.open) fold(id, false); else { const next = rows[rows.indexOf(r) + 1]; if (next && next.depth > r.depth) b.select(next.id); } return true; }
            if (key === "ArrowLeft") {
              if (r.kind === "frame" && r.open && r.parent) { fold(id, true); return true; }
              const up = rows.slice(0, rows.indexOf(r)).reverse().find((x) => x.kind === "frame" && x.depth < r.depth);
              if (up) b.select(up.id);
              return true;
            }
            if ((key === "Enter" || key === " ") && r.kind === "frame") { fold(id, r.open); return true; }
            if (key === "F2" && r.kind === "tile") { b.rename(id); return true; }
            if (key === "Delete" && r.kind === "tile") { b.closeTile(id); return true; }
            return false;
          })}>
          {rows.length === 0 ? (
            <div className="empty-note">
              This workspace has nothing in it yet.
              {b.can.spawn && <button className="button" onClick={() => b.run("workbench.action.terminal.new")}>New Terminal</button>}
              {b.can.spawn && <button className="button" onClick={() => b.run("hivemind.newAgent")}>Start an Agent</button>}
            </div>
          ) : rows.map((r) => r.kind === "frame"
            ? <FrameRow key={r.id} b={b} row={r} calling={!r.open && calling.has(r.id)} onFold={() => fold(r.id, r.open)} drop={drop === r.id} setDrop={setDrop} />
            : <TileRow key={r.id} b={b} tile={b.world.byId.get(r.id)!} depth={r.depth} selected={b.selected === r.id} />)}
        </div>
      </Pane>
      <Pane b={b} id="timeline" title="Timeline">
        <Timeline b={b} />
      </Pane>
    </div>
  );
}

function FrameRow({ b, row, calling, onFold, drop, setDrop }: { b: Bench; row: TreeRow; calling: boolean; onFold: () => void; drop: boolean; setDrop: (id: string | null) => void }) {
  const f = b.world.frameById.get(row.id)!;
  const selected = b.selected === row.id;
  return (
    <div className={`row${selected ? " selected" : ""}${drop ? " drop" : ""}`} role="treeitem" aria-expanded={row.parent ? row.open : undefined} aria-selected={selected} aria-level={row.depth + 1}
      data-id={row.id} style={{ paddingLeft: 8 + row.depth * 8 }}
      onClick={() => { b.select(row.id); if (row.parent) onFold(); }}
      onContextMenu={(e) => { e.preventDefault(); b.select(row.id); b.menu(b.frameMenu(row.id), { x: e.clientX, y: e.clientY }, f.title); }}
      onDragOver={(e) => { if (b.drag.tile) { e.preventDefault(); setDrop(row.id); } }} onDragLeave={() => setDrop(null)}
      onDrop={(e) => { e.preventDefault(); setDrop(null); }}>
      {Array.from({ length: row.depth }, (_, i) => <span key={i} className="indent" style={{ left: 8 + i * 8 + 7 }} />)}
      <span className="twistie">{row.parent && <Icon name={row.open ? "chevronDown" : "chevronRight"} />}</span>
      <span className="name" style={calling ? { color: "var(--attention-ink)" } : undefined}>{f.title || "Untitled"}</span>
      {(f.branch || f.folder) && <span className="desc">{f.branch ?? f.folder?.name}</span>}
      <span className="end">
        <CodeButtons b={b} frameId={f.id} />
        {calling && <Mark tone="attention" title={`${f.title}: an agent in it needs you`} />}
      </span>
    </div>
  );
}

function Timeline({ b }: { b: Bench }) {
  const id = b.activeTile;
  const tile = id ? b.world.byId.get(id) : undefined;
  if (!tile) return <div className="empty-note">The active editor cannot provide timeline information.</div>;
  const lines = b.world.log.filter((l) => l.tileId === id).slice(-50).reverse();
  if (!lines.length) return <div className="empty-note">No timeline information was provided for {tile.name}.</div>;
  return (
    <div className="list" role="list" aria-label={`Timeline of ${tile.name}`}>
      {lines.map((l, i) => (
        <div key={i} className="row" role="listitem" style={{ paddingLeft: 20 }}>
          <span className="ico"><Icon name={l.kind === "needsInput" ? "warning" : l.kind === "turn" ? "pass" : "history"} /></span>
          <span className="name">{l.text.replace(`${tile.name}: `, "").replace(`${tile.name} `, "")}</span>
          <span className="end"><span className="why">{ago(l.at, b.now)}</span></span>
        </div>
      ))}
    </div>
  );
}

/** "now", "5 mins", "3 hrs", as VS Code's timeline writes it. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

// ── Search ───────────────────────────────────────────────────────────────────

function Search({ b }: { b: Bench }) {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { field.current?.focus(); }, [b.searchFocus]);
  const q = b.query;
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const by = new Map<string | null, { tile: ViewTile; at: number[] }[]>();
    for (const t of b.world.tiles) {
      const m = fuzzy(q, t.name) ?? (t.agent && fuzzy(q, t.agent)) ?? fuzzy(q, t.kind);
      if (!m) continue;
      const k = t.frameId && b.world.frameById.has(t.frameId) ? t.frameId : null;
      by.set(k, [...(by.get(k) ?? []), { tile: t, at: fuzzy(q, t.name)?.at ?? [] }]);
    }
    return [...by.entries()];
  }, [q, b.world.tiles, b.world.frameById]);
  const count = results.reduce((n, [, r]) => n + r.length, 0);
  const ids = results.flatMap(([, r]) => r.map((x) => x.tile.id));
  return (
    <div className="panes">
      <div className="search-box">
        <input ref={field} className="field" placeholder="Search" aria-label="Search" value={q} spellCheck={false}
          onChange={(e) => b.setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "ArrowDown" && ids[0]) { e.preventDefault(); b.select(ids[0]); (e.currentTarget.parentElement?.nextElementSibling?.nextElementSibling as HTMLElement | null)?.focus(); } }} />
      </div>
      {q.trim() && <div className="summary">{count ? `${count} result${count === 1 ? "" : "s"} in ${results.length} ${results.length === 1 ? "frame" : "frames"}` : "No results found."}</div>}
      <div className="list" role="tree" aria-label="Search results" tabIndex={0} style={{ flex: 1, overflowY: "auto" }} onKeyDown={(e) => listKeys(e, ids, b)}>
        {results.map(([frameId, hits]) => (
          <Fragment key={frameId ?? ""}>
            <div className="row" style={{ paddingLeft: 8 }}>
              <span className="twistie"><Icon name="chevronDown" /></span>
              <span className="ico"><Icon name="folder" /></span>
              <span className="name">{frameId ? b.frameTitle(frameId) : "No frame"}</span>
              <span className="end"><span className="badge" style={{ background: "var(--selected-quiet)", color: "var(--fg)" }}>{hits.length}</span></span>
            </div>
            {hits.map(({ tile, at: hit }) => (
              <TileRow key={tile.id} b={b} tile={tile} depth={2} selected={b.selected === tile.id}>
                {highlight(tile.name, hit).map((p, i) => (p.hit ? <mark key={i} className="find">{p.text}</mark> : p.text))}
              </TileRow>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Agents ───────────────────────────────────────────────────────────────────

const GROUP_TITLES: Record<AgentGroup, string> = { needs: "Needs You", working: "Working", ready: "Ready", stopped: "Stopped" };

function Agents({ b }: { b: Bench }) {
  const agents = b.world.tiles.filter((t) => t.agent);
  const by = new Map<AgentGroup, ViewTile[]>();
  for (const t of agents) {
    const g = stateOf(t, b.world.seen.get(t.id))?.group ?? "ready";
    by.set(g, [...(by.get(g) ?? []), t]);
  }
  // In a group, the one there longest first, as Focus orders them.
  for (const list of by.values()) list.sort((x, y) => (b.world.seen.get(x.id)?.since ?? Infinity) - (b.world.seen.get(y.id)?.since ?? Infinity));
  const order: AgentGroup[] = ["needs", "working", "ready", "stopped"];
  const ids = order.flatMap((g) => (b.layout.shut.includes(`agents:${g}`) ? [] : (by.get(g) ?? []).map((t) => t.id)));
  const target = b.activeTile && b.world.byId.get(b.activeTile)?.agent ? b.world.byId.get(b.activeTile)! : null;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!target || !text.trim() || sending) return;
    setSending(true);
    try { if ((await b.prompt(target.id, text.trim())) === "sent") setText(""); } finally { setSending(false); }
  };
  return (
    <div className="panes">
      {b.can.prompt && (
        <div className="message">
          <textarea aria-label="Message" placeholder={target ? `Message (${b.keyLabel("mod+enter")} to send to ${target.name})` : "Open an agent to send it a message"} value={text} disabled={!target}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
          <button className="button" disabled={!target || !text.trim() || sending} onClick={() => void send()}><Icon name="send" />{target ? `Send to ${target.name}` : "Send"}</button>
        </div>
      )}
      <div className="list" role="tree" aria-label="Agents" tabIndex={0} style={{ flex: 1, overflowY: "auto" }} onKeyDown={(e) => listKeys(e, ids, b)}>
        {agents.length === 0 && (
          <div className="empty-note">
            No agents in this workspace.
            {b.can.spawn && <button className="button" onClick={() => b.run("hivemind.newAgent")}>Start an Agent</button>}
          </div>
        )}
        {order.filter((g) => by.get(g)?.length).map((g) => {
          const shut = b.layout.shut.includes(`agents:${g}`);
          const list = by.get(g)!;
          return (
            <Fragment key={g}>
              <div className="row" role="treeitem" aria-expanded={!shut} style={{ paddingLeft: 8, fontWeight: 600 }}
                onClick={() => b.update((l) => ({ ...l, shut: shut ? l.shut.filter((s) => s !== `agents:${g}`) : [...l.shut, `agents:${g}`] }))}>
                <span className="twistie"><Icon name={shut ? "chevronRight" : "chevronDown"} /></span>
                <span className="name">{GROUP_TITLES[g]}</span>
                <span className="end"><span className={`badge${g === "needs" ? " attention" : ""}`} style={g === "needs" ? undefined : { background: "var(--selected-quiet)", color: "var(--fg)" }}>{list.length}</span></span>
              </div>
              {!shut && list.map((t) => {
                const st = stateOf(t, b.world.seen.get(t.id));
                return (
                  <TileRow key={t.id} b={b} tile={t} depth={1} selected={b.selected === t.id}
                    desc={[b.frameTitle(t.frameId), st && st.group !== "ready" ? st.why : null].filter(Boolean).join(" · ")} />
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** A frame's code (its files, an editor and its changes), from its row. Shown on hover. */
function CodeButtons({ b, frameId }: { b: Bench; frameId: string }) {
  return (
    <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
      <button className="act" title="Open Code (Files and Changes)" aria-label="Open Code" onClick={() => b.openCode(frameId)}><Icon name="gitCompare" /></button>
    </span>
  );
}

// ── Source Control ───────────────────────────────────────────────────────────

/**
 * Source Control's place, for watching code change: every frame as a repository (its own folder, a
 * worktree's branch, else the workspace's folder), which of its agents are writing now, and its
 * changes a click away (the app's Code tile, which watches the working tree). Watch puts those
 * changes beside whichever agent is shown.
 */
function SourceControl({ b }: { b: Bench }) {
  const repos = b.world.frames;
  return (
    <div className="panes">
      <div className="message">
        <button className={`button${b.layout.watch ? "" : " secondary"}`} aria-pressed={b.layout.watch} onClick={() => b.run("hivemind.toggleWatch")}
          title={`Beside whichever agent is shown, its frame's code and changes as it writes (${b.keyLabel("mod+k mod+e")})`}>
          <Icon name={b.layout.watch ? "eye" : "eyeClosed"} />{b.layout.watch ? "Watching Code" : "Watch Code Beside the Agent"}
        </button>
      </div>
      <Pane b={b} id="scm-repos" title="Repositories" grow count={repos.length ? <span className="badge count">{repos.length}</span> : undefined}>
        <div className="list" role="tree" aria-label="Repositories" tabIndex={0}>
          {repos.length === 0 && (
            <div className="empty-note">
              No frames yet. A frame's code is its folder, or the workspace's: add a frame to see its files and changes here.
              {b.can.spawn && <button className="button" onClick={() => b.run("hivemind.newFrame")}>New Frame</button>}
            </div>
          )}
          {repos.map((f) => {
            const agents = b.world.tiles.filter((t) => t.frameId === f.id && t.agent);
            const writing = agents.filter((t) => stateOf(t, b.world.seen.get(t.id))?.tone === "working" && (b.world.levels.get(t.id) ?? 0) > 0);
            const code = b.world.tiles.find((t) => t.frameId === f.id && isCode(t));
            const shut = b.layout.shut.includes(`scm:${f.id}`);
            const shown = code && b.layout.groups.some((g) => g.active === code.id);
            return (
              <Fragment key={f.id}>
                <div className={`row${b.selected === f.id ? " selected" : ""}`} role="treeitem" aria-expanded={agents.length ? !shut : undefined} data-id={f.id} style={{ paddingLeft: 8 }}
                  onClick={() => { b.select(f.id); b.openCode(f.id); }}
                  onContextMenu={(e) => { e.preventDefault(); b.select(f.id); b.menu(b.frameMenu(f.id), { x: e.clientX, y: e.clientY }, f.title); }}>
                  <span className="twistie" onClick={(e) => { if (!agents.length) return; e.stopPropagation(); b.update((l) => ({ ...l, shut: shut ? l.shut.filter((s) => s !== `scm:${f.id}`) : [...l.shut, `scm:${f.id}`] })); }}>
                    {agents.length > 0 && <Icon name={shut ? "chevronRight" : "chevronDown"} />}
                  </span>
                  <span className="ico"><Icon name="repo" /></span>
                  <span className="name">{f.title || f.folder?.name || "Untitled"}</span>
                  {(f.branch || f.folder) && <span className="desc"><Icon name="sourceControl" size={12} />{f.branch ?? f.folder!.name}</span>}
                  <span className="end">
                    <CodeButtons b={b} frameId={f.id} />
                    {writing.length > 0 && <span className="why writing" title={`${writing.map((t) => t.name).join(", ")} writing now`}><Icon name="edit" size={14} />{writing.length}</span>}
                    {shown && <span className="why" title="Its code is open"><Icon name="eye" size={14} /></span>}
                  </span>
                </div>
                {!shut && agents.map((t) => {
                  const st = stateOf(t, b.world.seen.get(t.id));
                  const busy = writing.includes(t);
                  return <TileRow key={t.id} b={b} tile={t} depth={2} selected={b.selected === t.id} desc={busy ? "writing" : st && st.group !== "ready" ? st.why : undefined} />;
                })}
              </Fragment>
            );
          })}
        </div>
      </Pane>
    </div>
  );
}
