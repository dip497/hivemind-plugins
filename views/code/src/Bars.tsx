// The title bar (menu bar, command center, layout controls), the activity bar and the status bar.
// The app's settings gear floats over the top right corner of every view whose toolbar is off, so the
// title bar leaves that corner empty, where VS Code draws its window controls.
import { useRef } from "react";
import type { Bench } from "./App";
import { Icon, Logo } from "./Icon";
import { problemsOf } from "./Panel";
import { stateOf, type SideView } from "./model";
import type { IconName } from "./icons";

export const MENUS = ["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"] as const;
export type MenuName = (typeof MENUS)[number];

export function TitleBar({ b }: { b: Bench }) {
  const bar = useRef<HTMLDivElement>(null);
  const openAt = (name: MenuName, el: HTMLElement) => { const r = el.getBoundingClientRect(); b.openMenu(name, { x: r.left, y: r.bottom }); };
  return (
    <header className="titlebar">
      <span className="logo"><Logo /></span>
      <div ref={bar} className="menubar" role="menubar" aria-label="Menu bar">
        {MENUS.map((name) => (
          <button key={name} role="menuitem" aria-haspopup="menu" aria-expanded={b.menuOpen === name} className={b.menuOpen === name ? "open" : undefined}
            onClick={(e) => (b.menuOpen === name ? b.closeMenu() : openAt(name, e.currentTarget))}
            onPointerEnter={(e) => { if (b.menuOpen && b.menuOpen !== name) openAt(name, e.currentTarget); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const all = [...bar.current!.querySelectorAll<HTMLButtonElement>("button")];
                const next = all[(all.indexOf(e.currentTarget) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]!;
                next.focus();
                if (b.menuOpen) openAt(MENUS[all.indexOf(next)]!, next);
              } else if (e.key === "ArrowDown") { e.preventDefault(); openAt(name, e.currentTarget); }
            }}>
            <span>{name}</span>
          </button>
        ))}
      </div>
      <div className="command-center">
        <button className="nav" title={`Go Back (${b.keyLabel(b.mac ? "ctrl+-" : "alt+arrowleft")})`} aria-label="Go Back" disabled={!b.history.canBack} onClick={() => b.history.back()}><Icon name="arrowLeft" /></button>
        <button className="nav" title={`Go Forward (${b.keyLabel(b.mac ? "ctrl+shift+-" : "alt+arrowright")})`} aria-label="Go Forward" disabled={!b.history.canForward} onClick={() => b.history.forward()}><Icon name="arrowRight" /></button>
        <button className="search" title={`${b.code.on ? "Search files and tiles" : "Search tiles"} by name (${b.keyLabel("mod+p")})`} onClick={() => b.quick("")}>
          <Icon name="search" size={14} /><span>{b.workspaceName}</span>
        </button>
      </div>
      <div className="layout-controls">
        <button title={`Toggle Primary Side Bar (${b.keyLabel("mod+b")})`} aria-label="Toggle Primary Side Bar" aria-pressed={b.layout.sidebar.visible} onClick={() => b.run("workbench.action.toggleSidebarVisibility")}>
          <Icon name={b.layout.sidebar.visible ? "layoutSidebarLeft" : "layoutSidebarLeftOff"} />
        </button>
        <button title={`Toggle Panel (${b.keyLabel("mod+j")})`} aria-label="Toggle Panel" aria-pressed={b.layout.panel.visible} onClick={() => b.run("workbench.action.togglePanel")}>
          <Icon name={b.layout.panel.visible ? "layoutPanel" : "layoutPanelOff"} />
        </button>
        {b.can.menus && (
          <button title="Switch View…" aria-label="Switch View…" onClick={(e) => b.hostMenu("views", e.currentTarget)}><Icon name="layout" /></button>
        )}
      </div>
    </header>
  );
}

const VIEWS: [SideView, IconName, string, string][] = [
  ["explorer", "files", "Explorer", "mod+shift+e"],
  ["search", "search", "Search", "mod+shift+f"],
  ["scm", "sourceControl", "Source Control", "mod+shift+g"],
  ["agents", "sparkle", "Agents", "mod+shift+a"],
];

export function ActivityBar({ b }: { b: Bench }) {
  const needs = b.world.tiles.filter((t) => stateOf(t, b.world.seen.get(t.id))?.tone === "attention").length;
  // Agents writing code now: working, with output moving.
  const writing = b.world.tiles.filter((t) => t.agent && stateOf(t, b.world.seen.get(t.id))?.tone === "working" && (b.world.levels.get(t.id) ?? 0) > 0).length;
  return (
    <nav className="activitybar" aria-label="Activity bar">
      <div className="actions" role="tablist" aria-orientation="vertical">
        {VIEWS.map(([id, icon, title, keys]) => {
          const on = b.layout.sidebar.visible && b.layout.sidebar.view === id;
          return (
            <button key={id} role="tab" aria-selected={on} className={on ? "on" : undefined} title={`${title} (${b.keyLabel(keys)})`} aria-label={title}
              onClick={() => b.showView(id, true)}>
              <Icon name={icon} size={24} />
              {id === "scm" && writing > 0 && <span className="badge" aria-label={`${writing} writing`}>{writing}</span>}
              {id === "agents" && needs > 0 && <span className="badge attention" aria-label={`${needs} need${needs === 1 ? "s" : ""} you`}>{needs}</span>}
            </button>
          );
        })}
      </div>
      <div className="actions bottom">
        {b.world.participants.length > 0 && (
          <button title={`In this workspace: ${b.world.participants.map((p) => p.name).join(", ")}`} aria-label="People in this workspace"><Icon name="account" size={24} /><span className="badge">{b.world.participants.length}</span></button>
        )}
        <button title="Manage" aria-label="Manage" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); b.menu(b.manageMenu(), { x: r.right + 2, y: r.bottom - 8 }, "Manage"); }}>
          <Icon name="settingsGear" size={24} />
        </button>
      </div>
    </nav>
  );
}

export function StatusBar({ b }: { b: Bench }) {
  const problems = problemsOf(b.world);
  const failed = problems.filter((t) => stateOf(t, b.world.seen.get(t.id))?.tone === "failed").length;
  const waiting = problems.length - failed;
  const working = b.world.tiles.filter((t) => stateOf(t, b.world.seen.get(t.id))?.tone === "working").length;
  const active = b.activeTile ? b.world.byId.get(b.activeTile) : undefined;
  const frame = active?.frameId ? b.world.frameById.get(active.frameId) : undefined;
  const presence = b.world.presence;
  const showProblems = () => b.update((l) => ({ ...l, panel: { ...l.panel, visible: !(l.panel.visible && l.panel.tab === "problems"), tab: "problems" } }));
  return (
    <footer className="statusbar" aria-label="Status bar">
      <div className="side">
        <button className="item remote" title={b.can.menus ? "Switch View…" : "Hivemind"} onClick={(e) => b.can.menus && b.hostMenu("views", e.currentTarget)}>
          <Icon name="remote" size={14} /><span>Hivemind</span>
        </button>
        {frame?.branch && <span className="item" title={`${frame.title}: ${frame.branch}`}><Icon name="sourceControl" size={14} />{frame.branch}</span>}
        <button className="item" title={`${failed} failed, ${waiting} need${waiting === 1 ? "s" : ""} you`} aria-label={`Problems: ${failed} failed, ${waiting} need you`} onClick={showProblems}>
          <Icon name="error" size={14} />{failed}<Icon name="warning" size={14} /><span className={waiting ? "attention" : undefined}>{waiting}</span>
        </button>
        {working > 0 && <span className="item" title={`${working} working`}><Icon name="sync" size={14} />{working} working</span>}
        <button className={`item${b.layout.watch ? " on" : ""}`} aria-pressed={b.layout.watch} title={b.layout.watch ? "Watching code beside the agent: click to stop" : "Watch code beside the agent"} onClick={() => b.run("hivemind.toggleWatch")}>
          <Icon name={b.layout.watch ? "eye" : "eyeClosed"} size={14} />{b.layout.watch ? "Watching" : "Watch"}
        </button>
      </div>
      <div className="side right">
        {active && <span className="item" title="The tile's kind">{active.agent ?? (active.kind === "shell" ? "Shell" : active.kind)}</span>}
        {active && frame && <span className="item" title="The frame it is in">{frame.title}</span>}
        {presence && presence.state !== "active" && <span className="item" title="Whether you are at this machine">{presence.state === "idle" ? "Idle" : "Away"}</span>}
        {b.world.participants.length > 0 && <span className="item" title={b.world.participants.map((p) => p.name).join(", ")}><Icon name="broadcast" size={14} />{b.world.participants.length}</span>}
        <button className="item" title="Output" aria-label="Show Output" onClick={() => b.update((l) => ({ ...l, panel: { ...l.panel, visible: true, tab: "output" } }))}>
          <Icon name={b.unread ? "bellDot" : "bell"} size={14} />
        </button>
      </div>
    </footer>
  );
}
