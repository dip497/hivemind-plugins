// The editor area: groups side by side, each with its tabs, breadcrumbs and the active tile's live
// terminal in the hole `.dock` leaves (the host places it there: see App's surfaces). With nothing
// open, VS Code's watermark: the mark, letterpressed, and the keys to start with.
import { useState, type DragEvent } from "react";
import type { Bench } from "./App";
import { Icon, Logo, Mark, TileIcon } from "./Icon";
import { framePath, stateOf, type EditorGroup } from "./model";
import { Sash } from "./Sash";

const TILE = "application/x-hivemind-tile";

export function EditorArea({ b }: { b: Bench }) {
  const { groups, sizes } = b.layout;
  return (
    <div className="editors" ref={b.editorsRef}>
      {groups.map((g, i) => (
        <Group key={g.id} b={b} g={g} index={i} share={sizes[i] ?? 1 / groups.length} last={i === groups.length - 1} />
      ))}
    </div>
  );
}

function Group({ b, g, index, share, last }: { b: Bench; g: EditorGroup; index: number; share: number; last: boolean }) {
  const focused = b.layout.activeGroup === g.id;
  const [dropAt, setDropAt] = useState<number | "end" | "side" | null>(null);
  const take = (e: DragEvent, where: number | "end" | "side") => {
    const id = e.dataTransfer.getData(TILE) || b.drag.tile;
    setDropAt(null);
    b.drag.end();
    if (!id || !b.world.byId.has(id)) return;
    e.preventDefault();
    if (where === "side") b.splitWith(g.id, id);
    else b.open(id, { group: g.id, index: where === "end" ? undefined : where, preview: false });
  };
  const over = (e: DragEvent, where: number | "end" | "side") => {
    if (!b.drag.tile && !e.dataTransfer.types.includes(TILE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropAt !== where) setDropAt(where);
  };
  const active = g.active ? b.world.byId.get(g.active) : undefined;
  const crumbs = active ? framePath(b.world.frames, active.frameId) : [];
  return (
    <>
      <div className={`group${focused ? " focused" : ""}`} style={{ flex: `${share} 1 0`, minWidth: 0 }} data-group={g.id} role="group" aria-label={`Editor group ${index + 1}`}
        onPointerDown={() => { if (!focused) b.update((l) => ({ ...l, activeGroup: g.id })); }}>
        <div className={`tabs${dropAt === "end" ? " drop" : ""}`} role="tablist" aria-label={`Editor group ${index + 1}`}
          onDragOver={(e) => over(e, "end")} onDragLeave={() => setDropAt(null)} onDrop={(e) => take(e, "end")}
          onDoubleClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).classList.contains("fill")) b.run("workbench.action.terminal.newInEditor"); }}>
          <div className="strip">
            {g.tabs.map((id, i) => {
              const t = b.world.byId.get(id);
              if (!t) return null;
              const st = stateOf(t, b.world.seen.get(id));
              const on = g.active === id;
              // Two tabs of one name say where each lives, as VS Code adds the folder.
              const twin = b.world.tiles.some((o) => o.id !== id && o.name === t.name && g.tabs.includes(o.id));
              return (
                <div key={id} className={`tab${on ? " active" : ""}${g.preview === id ? " preview" : ""}${dropAt === i ? " drop-before" : ""}`}
                  data-tile={id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} title={[b.frameTitle(t.frameId), t.name].filter(Boolean).join(" › ")} draggable
                  onDragStart={(e) => { e.dataTransfer.setData(TILE, id); e.dataTransfer.effectAllowed = "move"; b.drag.start(id); }}
                  onDragEnd={() => { b.drag.end(); setDropAt(null); }}
                  onDragOver={(e) => { e.stopPropagation(); over(e, i); }} onDrop={(e) => { e.stopPropagation(); take(e, i); }}
                  onClick={() => b.open(id, { group: g.id })}
                  onDoubleClick={() => b.update((l) => ({ ...l, groups: l.groups.map((x) => (x.preview === id ? { ...x, preview: null } : x)) }))}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); b.closeTab(id); } }}
                  onContextMenu={(e) => { e.preventDefault(); b.menu(b.tabMenu(g.id, id), { x: e.clientX, y: e.clientY }, t.name); }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = g.tabs[(i + (e.key === "ArrowRight" ? 1 : g.tabs.length - 1)) % g.tabs.length]; if (next) b.open(next, { group: g.id }); }
                  }}>
                  <span className="ico"><TileIcon tile={t} /></span>
                  <span className="label"><span className="name">{t.name}</span>{twin && <span className="desc">{b.frameTitle(t.frameId) || "no frame"}</span>}</span>
                  <span className="close">
                    {st && st.tone !== "idle" && <span className="mark"><Mark tone={st.tone} title={`${t.name} ${st.why}`} /></span>}
                    <button title={`Close (${b.keyLabel("mod+w")})`} aria-label={`Close ${t.name}`} tabIndex={-1} onClick={(e) => { e.stopPropagation(); b.closeTab(id); }}><Icon name="close" /></button>
                  </span>
                </div>
              );
            })}
            <div className="fill" />
          </div>
          <div className="actions">
            <button className="act" title={`Split Editor Right (${b.keyLabel("mod+\\")})`} aria-label="Split Editor Right" onClick={() => b.splitWith(g.id, g.active)}><Icon name="splitHorizontal" /></button>
            <button className="act" title="More Actions…" aria-label="More Actions…" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); b.menu(b.groupMenu(g.id), { x: r.left, y: r.bottom + 2 }, "Editor actions"); }}><Icon name="ellipsis" /></button>
          </div>
        </div>
        {active && (
          <div className={`crumbs${dropAt === "side" ? " drop" : ""}`} aria-label="Breadcrumbs" onDragOver={(e) => over(e, "side")} onDragLeave={() => setDropAt(null)} onDrop={(e) => take(e, "side")}>
            {crumbs.map((f) => (
              <span key={f.id} style={{ display: "contents" }}>
                <button className="crumb" onClick={() => b.revealInExplorer(f.id)}>{f.title || "Untitled"}</button>
                <span className="sep"><Icon name="chevronRight" /></span>
              </span>
            ))}
            <span className="crumb"><span className="ico"><TileIcon tile={active} /></span>{active.name}</span>
          </div>
        )}
        <div className="body" onDragOver={(e) => over(e, e.nativeEvent.offsetX > e.currentTarget.clientWidth * 0.66 ? "side" : "end")} onDragLeave={() => setDropAt(null)}
          onDrop={(e) => take(e, e.nativeEvent.offsetX > e.currentTarget.clientWidth * 0.66 ? "side" : "end")}>
          {active ? <Content b={b} tileId={active.id} /> : <Watermark b={b} />}
        </div>
      </div>
      {!last && <Sash dir="v" b={b} onMove={(dx, total) => b.resizeGroups(index, dx, total)} />}
    </>
  );
}

/** A tile's body: its live terminal, or why it cannot be shown. */
export function Content({ b, tileId }: { b: Bench; tileId: string }) {
  const t = b.world.byId.get(tileId);
  if (!t) return null;
  if (t.asleep) {
    return (
      <div className="placeholder">
        <Icon name="debugDisconnect" size={32} />
        <div className="big">{t.name} is asleep.</div>
        <div>Its conversation is kept until you wake it.</div>
        {b.can.wake && <button className="button" onClick={() => b.hm.commands.wakeAgent(tileId)}>Wake {t.name}</button>}
      </div>
    );
  }
  if (!b.can.surfaces) {
    return (
      <div className="placeholder">
        <Icon name="terminal" size={32} />
        <div className="big">{t.name}</div>
        <div>This screen cannot show a live terminal.</div>
      </div>
    );
  }
  return <div className="dock" data-dock={tileId} aria-label={`${t.name}, live`} />;
}

function Watermark({ b }: { b: Bench }) {
  const keys: [string, string][] = [
    ["Show All Commands", "mod+shift+p"],
    ["Go to Tile", "mod+p"],
    ["Find in Workspace", "mod+shift+f"],
    ["New Terminal", "mod+shift+`"],
    ["Toggle Panel", "mod+j"],
  ];
  return (
    <div className="watermark">
      <div className="letterpress"><Logo size={256} /></div>
      <dl>
        {keys.map(([what, k]) => (
          <div key={what} style={{ display: "contents" }}>
            <dt>{what}</dt>
            <dd>{b.keyLabel(k).split(/(?<=\+)|(?=\+)/).filter((p) => p !== "+").map((c, i) => <kbd key={i}>{c}</kbd>)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
