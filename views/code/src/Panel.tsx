// The panel under the editors. Problems: every agent that needs you or failed, grouped by frame, each
// with the host's line (what it waits on, and the host's own Review for a permission) in the room
// `data-line` leaves. Output: what happened, as the host's events say it. Terminal: tiles moved into
// the panel, one shown live, with the list of them at the side as VS Code's terminal tabs.
import type { ViewTile } from "@hivemind/view-sdk";
import { Fragment, useLayoutEffect, useRef } from "react";
import type { Bench } from "./App";
import { Content } from "./Editor";
import { Icon, TileIcon } from "./Icon";
import { stateOf, type PanelTab } from "./model";
import type { World } from "./world";

/** Every tile that needs the person or failed: the Problems list, the status bar's counts, F8. */
export function problemsOf(world: World): ViewTile[] {
  return world.tiles.filter((t) => { const s = stateOf(t, world.seen.get(t.id)); return s?.tone === "attention" || s?.tone === "failed"; });
}

export function Panel({ b, height }: { b: Bench; height: number | "fill" }) {
  const { tab, maximized } = b.layout.panel;
  const problems = problemsOf(b.world);
  const pick = (t: PanelTab) => b.update((l) => ({ ...l, panel: { ...l.panel, tab: t } }));
  const tabs: [PanelTab, string, number?][] = [["problems", "Problems", problems.length], ["output", "Output"], ["terminal", "Terminal"]];
  const term = b.layout.terminal;
  return (
    <section className="panel" style={height === "fill" ? { flex: 1 } : { height }} aria-label="Panel">
      <div className="head">
        <div className="ptabs" role="tablist" aria-label="Panel">
          {tabs.map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`ptab${tab === id ? " on" : ""}`} onClick={() => pick(id)}>
              {label}{n ? <span className="badge">{n}</span> : null}
            </button>
          ))}
        </div>
        <div className="actions">
          {tab === "terminal" && <>
            <button className="act" title={`New Terminal (${b.keyLabel("mod+shift+`")})`} aria-label="New Terminal" disabled={!b.can.spawn} onClick={() => b.run("workbench.action.terminal.new")}><Icon name="add" /></button>
            <button className="act" title="Move Terminal into Editor Area" aria-label="Move Terminal into Editor Area" disabled={!term} onClick={() => term && b.open(term, { preview: false })}><Icon name="window" /></button>
            <button className="act" title="Kill Terminal" aria-label="Kill Terminal" disabled={!term || !b.can.close} onClick={() => term && b.closeTile(term)}><Icon name="trash" /></button>
          </>}
          {tab === "output" && <button className="act" title="Clear Output" aria-label="Clear Output" onClick={() => b.clearLog()}><Icon name="clearAll" /></button>}
          <button className="act" title={maximized ? "Restore Panel Size" : "Maximize Panel Size"} aria-label={maximized ? "Restore Panel Size" : "Maximize Panel Size"}
            onClick={() => b.update((l) => ({ ...l, panel: { ...l.panel, maximized: !l.panel.maximized } }))}><Icon name={maximized ? "chevronDown" : "chevronUp"} /></button>
          <button className="act" title="Hide Panel" aria-label="Hide Panel" onClick={() => b.update((l) => ({ ...l, panel: { ...l.panel, visible: false, maximized: false } }))}><Icon name="close" /></button>
        </div>
      </div>
      <div className="content">
        {tab === "problems" ? <Problems b={b} problems={problems} /> : tab === "output" ? <Output b={b} /> : <Terminals b={b} />}
      </div>
    </section>
  );
}

function Problems({ b, problems }: { b: Bench; problems: ViewTile[] }) {
  if (!problems.length) return <div className="scroll"><div className="empty-note">No problems have been detected in the workspace.</div></div>;
  const by = new Map<string | null, ViewTile[]>();
  for (const t of problems) by.set(t.frameId, [...(by.get(t.frameId) ?? []), t]);
  return (
    <div className="scroll list" role="tree" aria-label="Problems" ref={b.linesRef} tabIndex={0}>
      {[...by.entries()].map(([frameId, list]) => (
        <Fragment key={frameId ?? ""}>
          <div className="row" style={{ paddingLeft: 8 }}>
            <span className="twistie"><Icon name="chevronDown" /></span>
            <span className="name">{b.frameTitle(frameId) || "No frame"}</span>
            <span className="end"><span className="badge">{list.length}</span></span>
          </div>
          {list.map((t) => {
            const st = stateOf(t, b.world.seen.get(t.id))!;
            return (
              <div key={t.id} className={`row problem${st.tone === "failed" ? " failed" : ""}`} role="treeitem" style={{ paddingLeft: 38 }}
                onClick={() => b.open(t.id, { preview: false, focus: true })}>
                <span className="ico"><Icon name={st.tone === "failed" ? "error" : "warning"} title={st.tone === "failed" ? "Error" : "Warning"} /></span>
                <span className="name">{t.name}</span>
                {b.can.lines ? <span className="line" data-line={t.id} /> : <span className="desc">{st.why}</span>}
                <span className="end"><span className="why">{st.why}</span></span>
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false });

function Output({ b }: { b: Bench }) {
  const el = useRef<HTMLDivElement>(null);
  const lines = b.world.log.filter((l) => l.at >= b.logFrom);
  // On each line added: the log is a new array then, while at its 500-line cap its length is not.
  useLayoutEffect(() => { const e = el.current; if (e) e.scrollTop = e.scrollHeight; }, [b.world.log, b.logFrom]);
  return (
    <div ref={el} className="output" role="log" aria-label="Output">
      {lines.length ? lines.map((l, i) => <div key={i}><span className="time">{time(l.at)} [info]</span> {l.text}</div>)
        : <div className="time">Nothing has happened in the last hour.</div>}
    </div>
  );
}

function Terminals({ b }: { b: Bench }) {
  const { terminals, terminal } = b.layout;
  if (!terminals.length || !terminal) {
    return (
      <div className="scroll">
        <div className="empty-note">
          No terminal in the panel. Open one here, or move a tile here with <b>Move into Panel</b> from its tab.
          {b.can.spawn && <button className="button" style={{ width: "auto", marginTop: 10 }} onClick={() => b.run("workbench.action.terminal.new")}>New Terminal</button>}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="terminal-area"><Content b={b} tileId={terminal} /></div>
      {terminals.length > 1 && (
        <div className="term-list list" role="listbox" aria-label="Terminals">
          {terminals.map((id) => {
            const t = b.world.byId.get(id);
            if (!t) return null;
            return (
              <div key={id} className={`row${id === terminal ? " selected" : ""}`} role="option" aria-selected={id === terminal}
                onClick={() => b.update((l) => ({ ...l, terminal: id }))}
                onContextMenu={(e) => { e.preventDefault(); b.menu(b.tileMenu(id), { x: e.clientX, y: e.clientY }, t.name); }}>
                <span className="ico"><TileIcon tile={t} /></span>
                <span className="name">{t.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
