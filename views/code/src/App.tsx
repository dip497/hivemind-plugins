// Code: the workspace as VS Code's workbench. This file holds what the parts share (the `Bench`):
// the layout and what changes it, the commands with VS Code's names and keys, the menus, and the
// hole punch, which places each shown tile's live terminal where its part left room for it.
import { HostError, type HostMenu, type ViewClient } from "@hivemind/view-sdk";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ActivityBar, StatusBar, TitleBar, type MenuName } from "./Bars";
import { EditorArea } from "./Editor";
import { Icon, TileIcon } from "./Icon";
import { MAC, chordOf, createKeymap, label as keyLabel } from "./keys";
import {
  PANEL_MIN, SIDEBAR_MIN, closeAll, codeOf, isCode, watchBeside, closeOthers, closeTab, cycle, framePath, fuzzy, joinAll, openTile, parseLayout, pin, prune,
  resizeGroups, split, stateOf, toPanel, whereIs, type Layout, type SideView,
} from "./model";
import { Dialog, Menu, QuickInput, type DialogSpec, type MenuItem, type QuickItem, type QuickSource } from "./Overlay";
import { Panel, problemsOf } from "./Panel";
import { Sash } from "./Sash";
import { SideBar } from "./SideBar";
import { useWorld, type World } from "./world";
import { canSearchCode, codeRoots, goTo, rootOf, useFoundFiles, type CodeRoot } from "./finding";

export interface Command { id: string; title: string; category?: string; keys?: string[]; run: () => void; enabled?: () => boolean }

export interface Bench {
  hm: ViewClient;
  world: World;
  layout: Layout;
  now: number;
  mac: boolean;
  update(f: (l: Layout) => Layout): void;
  can: { spawn: boolean; close: boolean; edit: boolean; prompt: boolean; wake: boolean; menus: boolean; surfaces: boolean; lines: boolean };
  activeTile: string | null;
  workspaceName: string;
  selected: string | null;
  select(id: string | null): void;
  open(tileId: string, opts?: { preview?: boolean; group?: string; index?: number; focus?: boolean }): void;
  closeTab(tileId: string): void;
  closeTile(tileId: string): void;
  splitWith(groupId: string, tileId: string | null): void;
  resizeGroups(i: number, dx: number, total: number): void;
  renaming: string | null;
  rename(tileId: string): void;
  finishRename(tileId: string, name: string | null): void;
  revealInExplorer(id: string): void;
  showView(view: SideView, toggle?: boolean): void;
  query: string;
  setQuery(q: string): void;
  searchFocus: number;
  prompt(tileId: string, text: string): Promise<"sent" | "cancelled" | "failed">;
  frameTitle(frameId: string | null): string;
  keyLabel(keys: string): string;
  run(id: string): void;
  menu(items: readonly MenuItem[], at: { x: number; y: number }, label: string): void;
  menuOpen: MenuName | null;
  openMenu(name: MenuName, at: { x: number; y: number }): void;
  closeMenu(): void;
  hostMenu(menu: HostMenu, from?: Element): void;
  quick(initial: string): void;
  tileMenu(id: string): MenuItem[];
  frameMenu(id: string): MenuItem[];
  tabMenu(groupId: string, id: string): MenuItem[];
  groupMenu(groupId: string): MenuItem[];
  viewMenu(view: SideView): MenuItem[];
  manageMenu(): MenuItem[];
  drag: { tile: string | null; start(id: string): void; end(): void; resizing(on: boolean): void };
  history: { canBack: boolean; canForward: boolean; back(): void; forward(): void };
  openCode(frameId: string | null, beside?: string): void;
  /** 1.19: the workspace's code, when the app finds it for the view: its folders, and a file opened
   *  in its frame's editor (at a line), as a tab here. */
  code: { on: boolean; roots: CodeRoot[]; openFile(frameId: string | null, path: string, at?: { line?: number; col?: number }): void };
  editorsRef: RefObject<HTMLDivElement | null>;
  linesRef: RefObject<HTMLDivElement | null>;
  logFrom: number;
  clearLog(): void;
  unread: boolean;
}

const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** VS Code's binding on this platform: `pc` on Windows and Linux, `mac` on a Mac. */
const K = (pc: string, mac = pc) => (MAC ? mac : pc);
/** How long a tile asked for (New Terminal, Start Agent) is waited for to open it where it was asked. */
const EXPECT_MS = 15_000;

export function App({ hm }: { hm: ViewClient }) {
  const world = useWorld(hm);
  const [layout, setLayout] = useState<Layout>(() => parseLayout(hm.hello.layout));
  const update = useCallback((f: (l: Layout) => Layout) => setLayout((l) => f(l)), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState(0);
  const [menuState, setMenuState] = useState<{ items: readonly MenuItem[]; at: { x: number; y: number }; label: string; bar?: MenuName } | null>(null);
  const [quickState, setQuickState] = useState<{ initial: string; source?: (v: string) => QuickSource } | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [dragTile, setDragTile] = useState<string | null>(null);
  const [resizingNow, setResizing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [logFrom, setLogFrom] = useState(0);
  const [seenLog, setSeenLog] = useState(0);
  const editorsRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** A tile asked for here (New Terminal, Start Agent, Open Code), awaited to open it where it was
   *  asked: in the editors, the panel, or for Watch beside `beside`. `code`: only a Code tile, of
   *  `frameId`, answers. */
  const expect = useRef<{ where: "editor" | "panel" | "watch"; at: number; known: Set<string>; code?: boolean; frameId?: string; beside?: string; tileId?: string } | null>(null);

  const can = useMemo(() => ({
    spawn: hm.capabilities.includes("workspace:spawn"),
    close: hm.capabilities.includes("workspace:close"),
    edit: hm.capabilities.includes("workspace:edit"),
    prompt: hm.capabilities.includes("workspace:prompt") && hm.supports("prompt"),
    wake: hm.capabilities.includes("workspace:spawn") && hm.supports("sleep"),
    menus: hm.supports("hostMenu"),
    surfaces: hm.supports("surfaces"),
    lines: hm.supports("lineSlots"),
  }), [hm]);

  // ── keep the layout ──
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } hm.setLayout(layout); }, [hm, layout]);
  // Tabs and terminals of tiles that closed go, once the host has said what is there.
  useEffect(() => { if (world.known) update((l) => prune(l, new Set(world.tiles.map((t) => t.id)))); }, [world.known, world.tiles, update]);
  // "5 mins" moves on while nothing else changes.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const group = layout.groups.find((g) => g.id === layout.activeGroup) ?? layout.groups[0]!;
  const activeTile = group.active;

  // The app's selection follows the editor shown, as the canvas's follows the tile clicked.
  // Only a tile the host has named: one from a saved layout may be gone, and the app refuses that.
  const activeKnown = !!activeTile && world.byId.has(activeTile);
  useEffect(() => { if (activeTile && activeKnown) hm.commands.selectTile(activeTile); }, [hm, activeTile, activeKnown]);
  // The host's selection is marked in the explorer, never opened: the person came to this view, not
  // to that tile. One made since (fresh) is brought into sight there.
  useEffect(() => hm.on("selection", (s) => {
    const id = s.tileId ?? s.frameId;
    if (id) setSelected(id);
  }), [hm]);

  // ── back and forward through the editors shown ──
  const trail = useRef<{ list: string[]; at: number; walking: boolean }>({ list: [], at: -1, walking: false });
  const [, setTrailVersion] = useState(0);
  useEffect(() => {
    const t = trail.current;
    if (!activeTile) return;
    if (t.walking) { t.walking = false; return; }
    if (t.list[t.at] === activeTile) return;
    t.list = [...t.list.slice(0, t.at + 1), activeTile].slice(-50);
    t.at = t.list.length - 1;
    setTrailVersion((v) => v + 1);
  }, [activeTile]);
  const walk = useCallback((step: 1 | -1) => {
    const t = trail.current;
    let i = t.at + step;
    while (i >= 0 && i < t.list.length && !world.byId.has(t.list[i]!)) i += step;
    const id = t.list[i];
    if (!id) return;
    t.at = i;
    t.walking = true;
    update((l) => openTile(l, id));
    setTrailVersion((v) => v + 1);
  }, [world.byId, update]);

  const frameTitle = useCallback((frameId: string | null) => (frameId ? world.frameById.get(frameId)?.title ?? "" : ""), [world.frameById]);
  const closedStack = useRef<string[]>([]);

  const focusLater = useCallback((tileId: string) => {
    // Once its terminal is placed: the host gives it the keys.
    requestAnimationFrame(() => requestAnimationFrame(() => hm.commands.focusTile(tileId)));
  }, [hm]);

  const open = useCallback((tileId: string, opts: { preview?: boolean; group?: string; index?: number; focus?: boolean } = {}) => {
    if (!world.byId.has(tileId)) return;
    update((l) => {
      const next = openTile(l, tileId, { group: opts.group, preview: opts.preview, index: opts.index });
      return opts.preview === false ? pin(next, tileId) : next;
    });
    setSelected(tileId);
    if (opts.focus) focusLater(tileId);
  }, [world.byId, update, focusLater]);

  const closeTabFn = useCallback((tileId: string) => {
    closedStack.current = [...closedStack.current.filter((t) => t !== tileId), tileId].slice(-20);
    update((l) => closeTab(l, tileId));
  }, [update]);

  const closeTile = useCallback((tileId: string) => {
    const t = world.byId.get(tileId);
    if (!t || !can.close) return;
    setDialog({
      title: `Do you want to close '${t.name}'?`,
      detail: t.agent ? "The agent stops, and its tile goes from the workspace. This cannot be undone." : "Its terminal and whatever runs in it stop. This cannot be undone.",
      buttons: [{ label: "Close Tile", run: () => hm.commands.closeTile(tileId) }, { label: "Cancel" }],
    });
  }, [world.byId, can.close, hm]);

  const splitWith = useCallback((groupId: string, tileId: string | null) => update((l) => split(l, groupId, tileId)), [update]);

  const revealInExplorer = useCallback((id: string) => {
    update((l) => {
      const tile = world.byId.get(id);
      const frames = framePath(world.frames, tile ? tile.frameId : (world.frameById.get(id)?.parentId ?? null)).map((f) => f.id);
      return { ...l, sidebar: { ...l.sidebar, visible: true, view: "explorer" }, folded: l.folded.filter((f) => !frames.includes(f)), shut: l.shut.filter((s) => s !== "workspace") };
    });
    setSelected(id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Workspace"][role="tree"]')?.focus());
  }, [update, world.byId, world.frames, world.frameById]);

  const showView = useCallback((view: SideView, toggle = false) => {
    update((l) => {
      const on = l.sidebar.visible && l.sidebar.view === view;
      return { ...l, sidebar: { ...l.sidebar, visible: toggle ? !on : true, view } };
    });
    if (view === "search") setSearchFocus((n) => n + 1);
  }, [update]);

  const prompt = useCallback(async (tileId: string, text: string) => {
    try { return await hm.prompt(tileId, text); } catch (e) {
      const asleep = e instanceof HostError && e.code === "ASLEEP";
      setDialog({ title: asleep ? "This agent is asleep" : "The message was not sent", detail: asleep ? "Wake it first, then send the message again." : e instanceof Error ? e.message : String(e), icon: "info", buttons: [{ label: "OK" }] });
      return "failed" as const;
    }
  }, [hm]);

  // ── tiles asked for here open here ──
  const expectTile = useCallback((where: "editor" | "panel" | "watch", more: { code?: boolean; frameId?: string; beside?: string; tileId?: string } = {}) => {
    expect.current = { where, at: Date.now(), known: new Set(world.tiles.map((t) => t.id)), ...more };
  }, [world.tiles]);
  useEffect(() => {
    const e = expect.current;
    if (!e) return;
    if (Date.now() - e.at > EXPECT_MS) { expect.current = null; return; }
    // A tile the app named (the Code tile it opened a file in) is that one, and no other that comes.
    const fresh = e.tileId ? world.tiles.find((t) => t.id === e.tileId) : world.tiles.find((t) => !e.known.has(t.id) && (!e.code || (isCode(t) && t.frameId === e.frameId)));
    if (!fresh) return;
    expect.current = null;
    if (e.where === "panel") update((l) => toPanel(l, fresh.id));
    // Watch keeps the keyboard where it was: the code is to look at.
    else if (e.where === "watch" && e.beside) { update((l) => watchBeside(l, e.beside!, fresh.id)); return; }
    else update((l) => openTile(l, fresh.id));
    focusLater(fresh.id);
  }, [world.tiles, update, focusLater]);

  const activeFrame = (activeTile ? world.byId.get(activeTile)?.frameId : null)
    ?? (selected && world.frameById.has(selected) ? selected : selected ? world.byId.get(selected)?.frameId : null) ?? null;

  const newTerminal = useCallback((where: "editor" | "panel" = "panel", frameId: string | null = activeFrame) => {
    if (!can.spawn) return;
    expectTile(where);
    hm.commands.spawnTile("shell", frameId);
  }, [can.spawn, expectTile, hm, activeFrame]);

  /**
   * A frame's code: the app's Code tile (its files, an editor and the working tree's changes, which
   * it watches as agents write; it opens on the side, Explorer or Changes, the person last chose).
   * The app keeps one per frame, so the one there is opens; a view may start one only as `editor`. Its folder is the frame's own (a worktree, a bound folder), else the
   * workspace's: the app says so in the tile when there is none.
   */
  const openCode = useCallback((frameId: string | null, beside?: string) => {
    const frame = frameId ? world.frameById.get(frameId) : undefined;
    if (!frame || !frameId) return;
    const code = codeOf(world.tiles, frameId);
    if (code) {
      if (beside) update((l) => watchBeside(l, beside, code.id));
      else open(code.id, { preview: false });
      return;
    }
    if (!can.spawn) return;
    expectTile(beside ? "watch" : "editor", { code: true, frameId, beside });
    hm.commands.spawnTile("editor", frameId);
  }, [world.frameById, world.tiles, update, open, can, hm, expectTile]);

  // A file of a frame's folder in that frame's Code tile, at a line when given, shown as a tab here.
  // The app opens it (starting the frame's Code tile when it has none) and says which tile it is in.
  const codeOn = canSearchCode(hm);
  // The world as it is when the answer lands, not as it was at the click.
  const worldNow = useRef(world);
  worldNow.current = world;
  const openFile = useCallback((frameId: string | null, path: string, at?: { line?: number; col?: number }) => {
    hm.code.open(frameId, path, at).then(({ tileId }) => {
      if (tileId && worldNow.current.byId.has(tileId)) open(tileId, { preview: false, focus: true });
      else if (tileId) expectTile("editor", { tileId });
    }, (e: unknown) => setDialog({ title: "The file did not open", detail: e instanceof Error ? e.message : String(e), icon: "info", buttons: [{ label: "OK" }] }));
  }, [hm, open, expectTile]);

  // Watch: whichever agent or terminal is shown, its frame's code beside it. Asked
  // once per frame while the app opens it; nothing moves while the code itself is shown.
  const watchAsked = useRef(new Map<string, number>());
  useEffect(() => {
    if (!layout.watch || !world.known || !activeTile) return;
    const t = world.byId.get(activeTile);
    if (!t || isCode(t) || !t.frameId || !world.frameById.has(t.frameId)) return;
    const code = codeOf(world.tiles, t.frameId);
    if (code) { update((l) => watchBeside(l, t.id, code.id)); return; }
    const asked = watchAsked.current.get(t.frameId);
    if (!can.spawn || (asked && Date.now() - asked < EXPECT_MS)) return;
    watchAsked.current.set(t.frameId, Date.now());
    openCode(t.frameId, t.id);
  }, [layout.watch, world.known, world.byId, world.frameById, world.tiles, activeTile, can.spawn, update, openCode]);

  const quick = useCallback((initial: string, source?: (v: string) => QuickSource) => { setMenuState(null); setQuickState({ initial, source }); }, []);

  const newAgent = useCallback(async (frameId: string | null = activeFrame) => {
    if (!can.spawn) return;
    let agents: { id: string; label: string }[] = [];
    try { if (hm.supports("agents")) agents = await hm.agents(); } catch { /* the host's default is offered alone */ }
    const start = (id: string | null) => { expectTile("editor"); hm.commands.spawnAgent(id, frameId); };
    if (!agents.length) { start(null); return; }
    quick("", () => ({
      placeholder: `Select an agent to start${frameId ? ` in ${frameTitle(frameId)}` : ""}`,
      none: "No matching agents",
      items: (v) => [{ id: "", label: "Default agent" }, ...agents].flatMap((a) => {
        const m = fuzzy(v, a.label);
        return m ? [{ id: a.id || "default", label: a.label, at: m.at, icon: <Icon name="sparkle" />, desc: a.id || undefined, run: () => start(a.id || null) } satisfies QuickItem] : [];
      }),
    }));
  }, [can.spawn, hm, expectTile, quick, frameTitle, activeFrame]);

  const hostMenu = useCallback((menu: HostMenu, from?: Element) => {
    if (!can.menus) return;
    const r = from?.getBoundingClientRect();
    hm.commands.openHostMenu(menu, r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : undefined);
  }, [can.menus, hm]);

  const nextProblem = useCallback((step: 1 | -1) => {
    const list = problemsOf(world);
    if (!list.length) return;
    const i = activeTile ? list.findIndex((t) => t.id === activeTile) : -1;
    const t = list[(i + step + list.length) % list.length]!;
    open(t.id, { preview: false, focus: true });
  }, [world, activeTile, open]);

  const focusGroup = useCallback((n: number) => {
    update((l) => {
      const g = l.groups[n];
      if (g) return { ...l, activeGroup: g.id };
      // Ctrl+2 with one group splits, as VS Code does.
      return n === l.groups.length ? split(l, l.groups[l.groups.length - 1]!.id, null) : l;
    });
    const g = layout.groups[n];
    if (g?.active) focusLater(g.active);
  }, [update, layout.groups, focusLater]);

  // ── commands, by VS Code's ids ──
  const commands: Command[] = useMemo(() => {
    const active = activeTile;
    const activeT = active ? world.byId.get(active) : undefined;
    const list: Command[] = [
      { id: "workbench.action.showCommands", title: "Show All Commands", keys: [K("mod+shift+p"), "f1"], run: () => quick(">") },
      { id: "workbench.action.quickOpen", title: codeOn ? "Go to File…" : "Go to Tile…", keys: [K("mod+p")], run: () => quick("") },
      { id: "workbench.view.explorer", title: "Show Explorer", category: "View", keys: [K("mod+shift+e")], run: () => showView("explorer") },
      { id: "workbench.view.search", title: "Show Search", category: "View", keys: [K("mod+shift+f")], run: () => showView("search") },
      { id: "workbench.view.scm", title: "Show Source Control", category: "View", keys: [K("mod+shift+g", "ctrl+shift+g")], run: () => showView("scm") },
      { id: "workbench.view.agents", title: "Show Agents", category: "View", keys: [K("mod+shift+a")], run: () => showView("agents") },
      { id: "hivemind.openCode", title: "Open Code (Files and Changes)", category: "Source Control", keys: [K("mod+k mod+d")], run: () => openCode(activeFrame), enabled: () => !!activeFrame },
      { id: "hivemind.openCodeBeside", title: "Open Code Beside", category: "Source Control", run: () => active && openCode(activeT?.frameId ?? null, active), enabled: () => !!activeT?.frameId && !isCode(activeT) },
      { id: "hivemind.toggleWatch", title: "Toggle Watch Code Beside the Agent", category: "View", keys: [K("mod+k mod+e")], run: () => update((l) => ({ ...l, watch: !l.watch })) },
      { id: "workbench.action.toggleSidebarVisibility", title: "Toggle Primary Side Bar Visibility", category: "View", keys: [K("mod+b")], run: () => update((l) => ({ ...l, sidebar: { ...l.sidebar, visible: !l.sidebar.visible } })) },
      { id: "workbench.action.togglePanel", title: "Toggle Panel Visibility", category: "View", keys: [K("mod+j")], run: () => update((l) => ({ ...l, panel: { ...l.panel, visible: !l.panel.visible } })) },
      { id: "workbench.action.toggleMaximizedPanel", title: "Toggle Maximized Panel", category: "View", run: () => update((l) => ({ ...l, panel: { ...l.panel, visible: true, maximized: !l.panel.maximized } })) },
      { id: "workbench.actions.view.problems", title: "Focus on Problems View", category: "View", keys: [K("mod+shift+m")], run: () => update((l) => ({ ...l, panel: { ...l.panel, visible: true, tab: "problems" } })) },
      { id: "workbench.action.output.toggleOutput", title: "Toggle Output", category: "View", keys: [K("mod+k mod+h")], run: () => update((l) => ({ ...l, panel: { ...l.panel, visible: !(l.panel.visible && l.panel.tab === "output"), tab: "output" } })) },
      { id: "workbench.action.terminal.toggleTerminal", title: "Toggle Terminal", category: "View", keys: [K("mod+`", "ctrl+`")], run: () => update((l) => ({ ...l, panel: { ...l.panel, visible: !(l.panel.visible && l.panel.tab === "terminal"), tab: "terminal" } })) },
      { id: "workbench.action.terminal.new", title: "Create New Terminal", category: "Terminal", keys: [K("mod+shift+`", "ctrl+shift+`")], run: () => newTerminal("panel"), enabled: () => can.spawn },
      { id: "workbench.action.terminal.newInEditor", title: "Create New Terminal in Editor Area", category: "Terminal", run: () => newTerminal("editor"), enabled: () => can.spawn },
      { id: "workbench.action.terminal.moveToTerminalPanel", title: "Move Terminal into Panel", category: "Terminal", run: () => active && update((l) => toPanel(l, active)), enabled: () => !!active },
      { id: "workbench.action.terminal.moveToEditor", title: "Move Terminal into Editor Area", category: "Terminal", run: () => layout.terminal && open(layout.terminal, { preview: false }), enabled: () => !!layout.terminal },
      { id: "workbench.action.terminal.kill", title: "Kill the Active Terminal Instance", category: "Terminal", run: () => layout.terminal && closeTile(layout.terminal), enabled: () => !!layout.terminal && can.close },
      { id: "workbench.action.terminal.focus", title: "Focus Terminal", category: "Terminal", run: () => { const t = active ?? layout.terminal; if (t) hm.commands.focusTile(t); }, enabled: () => !!(active ?? layout.terminal) },
      { id: "hivemind.newAgent", title: "Start Agent…", category: "Agents", run: () => void newAgent(), enabled: () => can.spawn },
      { id: "hivemind.newFrame", title: "New Frame", category: "File", run: () => hm.commands.addFrame(), enabled: () => can.spawn },
      { id: "hivemind.bindFolder", title: "Open Folder in Frame…", category: "File", run: () => activeFrame && hm.commands.openFolder(activeFrame), enabled: () => can.edit && !!activeFrame },
      { id: "workbench.action.splitEditor", title: "Split Editor", category: "View", keys: [K("mod+\\")], run: () => splitWith(layout.activeGroup, active) },
      { id: "workbench.action.joinAllGroups", title: "Join All Editor Groups", category: "View", run: () => update(joinAll), enabled: () => layout.groups.length > 1 },
      { id: "workbench.action.closeActiveEditor", title: "Close Editor", category: "View", keys: [K("mod+w", "mod+w"), ...(MAC ? [] : ["mod+f4"])], run: () => active && closeTabFn(active), enabled: () => !!active },
      { id: "workbench.action.closeOtherEditors", title: "Close Other Editors in Group", category: "View", run: () => active && update((l) => closeOthers(l, active)), enabled: () => !!active },
      { id: "workbench.action.closeEditorsInGroup", title: "Close All Editors in Group", category: "View", keys: [K("mod+k w")], run: () => update((l) => closeAll(l, l.activeGroup)) },
      { id: "workbench.action.closeAllEditors", title: "Close All Editors", category: "View", keys: [K("mod+k mod+w")], run: () => update((l) => closeAll(l)) },
      { id: "workbench.action.reopenClosedEditor", title: "Reopen Closed Editor", category: "View", keys: [K("mod+shift+t")], run: () => {
        const stack = closedStack.current;
        while (stack.length) { const id = stack.pop()!; if (world.byId.has(id) && !whereIs(layout, id)) { open(id, { preview: false }); return; } }
      } },
      { id: "workbench.action.keepEditor", title: "Keep Editor", category: "View", keys: [K("mod+k enter")], run: () => active && update((l) => pin(l, active)), enabled: () => !!active },
      { id: "workbench.action.nextEditor", title: "Open Next Editor", category: "View", keys: [K("mod+pagedown", "mod+alt+arrowright")], run: () => update((l) => cycle(l, 1)) },
      { id: "workbench.action.previousEditor", title: "Open Previous Editor", category: "View", keys: [K("mod+pageup", "mod+alt+arrowleft")], run: () => update((l) => cycle(l, -1)) },
      ...[0, 1, 2, 3].map((n): Command => ({ id: `workbench.action.focus${["First", "Second", "Third", "Fourth"][n]}EditorGroup`, title: `Focus ${["First", "Second", "Third", "Fourth"][n]} Editor Group`, category: "View", keys: [K(`mod+${n + 1}`)], run: () => focusGroup(n) })),
      { id: "workbench.action.navigateBack", title: "Go Back", category: "Go", keys: [K("alt+arrowleft", "ctrl+-")], run: () => walk(-1) },
      { id: "workbench.action.navigateForward", title: "Go Forward", category: "Go", keys: [K("alt+arrowright", "ctrl+shift+-")], run: () => walk(1) },
      { id: "editor.action.marker.nextInFiles", title: "Go to Next Problem (Agent That Needs You)", category: "Go", keys: ["f8"], run: () => nextProblem(1) },
      { id: "editor.action.marker.prevInFiles", title: "Go to Previous Problem (Agent That Needs You)", category: "Go", keys: ["shift+f8"], run: () => nextProblem(-1) },
      { id: "workbench.files.action.showActiveFileInExplorer", title: "Reveal Active Tile in Explorer View", category: "File", run: () => active && revealInExplorer(active), enabled: () => !!active },
      { id: "renameFile", title: "Rename Tile…", category: "File", keys: ["f2"], run: () => { const t = active ?? (selected && world.byId.has(selected) ? selected : null); if (t) { revealInExplorer(t); setRenaming(t); } }, enabled: () => can.edit },
      { id: "hivemind.closeTile", title: "Close Tile…", category: "File", run: () => active && closeTile(active), enabled: () => can.close && !!active },
      { id: "hivemind.wake", title: "Wake Agent", category: "Agents", run: () => active && hm.commands.wakeAgent(active), enabled: () => can.wake && !!activeT?.asleep },
      { id: "hivemind.sleep", title: "Put Agent to Sleep", category: "Agents", run: () => active && hm.commands.sleepAgent(active), enabled: () => can.wake && !!activeT?.agent && !activeT.asleep },
      { id: "hivemind.message", title: "Send Message to Agent…", category: "Agents", run: () => showView("agents"), enabled: () => can.prompt && !!activeT?.agent },
      { id: "workbench.action.selectTheme", title: "Color Theme", category: "Preferences", keys: [K("mod+k mod+t")], run: () => hostMenu("appearance"), enabled: () => can.menus },
      { id: "workbench.action.openSettings", title: "Open Settings", category: "Preferences", keys: [K("mod+,")], run: () => hostMenu("settings"), enabled: () => can.menus },
      { id: "hivemind.add", title: "Add Widget or Tool…", category: "Hivemind", run: () => hostMenu("add"), enabled: () => can.menus },
      { id: "hivemind.switchView", title: "Switch View…", category: "Hivemind", run: () => hostMenu("views"), enabled: () => can.menus },
      { id: "workbench.action.openGlobalKeybindings", title: "Open Keyboard Shortcuts", category: "Preferences", keys: [K("mod+k mod+s")], run: () => quick(">") },
      { id: "workbench.action.showAbout", title: "About", category: "Help", run: () => setDialog({ title: "Code", detail: "Your Hivemind workspace as VS Code's workbench: frames are folders, tiles are files, and each editor is a live terminal. Icons: Microsoft's codicons, CC BY 4.0.", icon: "info", buttons: [{ label: "OK" }] }) },
    ];
    return list;
  }, [activeTile, world, quick, showView, update, newTerminal, can, layout, open, closeTile, hm, newAgent, activeFrame, splitWith, closeTabFn, focusGroup, walk, nextProblem, revealInExplorer, selected, hostMenu, openCode]);

  const byId = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);
  const run = useCallback((id: string) => { const c = byId.get(id); if (c && (c.enabled?.() ?? true)) c.run(); }, [byId]);
  const item = useCallback((id: string, title?: string): MenuItem => {
    const c = byId.get(id);
    return c ? { label: title ?? c.title, keys: c.keys?.[0], run: c.run, disabled: !(c.enabled?.() ?? true) } : { label: title ?? id, disabled: true };
  }, [byId]);

  // ── keys ──
  const latest = useRef({ commands, overlay: false });
  latest.current = { commands, overlay: !!(menuState || quickState || dialog) };
  const keymap = useMemo(() => createKeymap(() => latest.current.commands.flatMap((c) => (c.keys ?? []).map((k) => ({ keys: k, value: c.id })))), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.overlay || e.defaultPrevented || e.isComposing) return;
      const chord = chordOf(e);
      if (!chord) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      // In a field, only chords with a modifier are the workbench's; its letters and F-keys are the field's.
      if (typing && !/(^|\+)(mod|ctrl|alt)\+/.test(chord) && chord !== "f1") return;
      const r = keymap(chord);
      if (r === "pending") { e.preventDefault(); return; }
      if (r) { e.preventDefault(); e.stopPropagation(); run(r.hit); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keymap, run]);

  // ── menus ──
  const barMenu = useCallback((name: MenuName): MenuItem[] => {
    switch (name) {
      case "File": return [item("workbench.action.terminal.new", "New Terminal"), item("hivemind.newAgent", "New Agent…"), item("hivemind.newFrame"), "-", item("hivemind.openCode", "Open Code"), item("hivemind.bindFolder"), "-", item("workbench.action.closeActiveEditor"), item("workbench.action.closeAllEditors"), "-", item("workbench.action.openSettings", "Preferences: Settings"), item("workbench.action.selectTheme", "Preferences: Color Theme"), "-", item("hivemind.closeTile")];
      case "Edit": return [item("renameFile"), "-", item("workbench.view.search", "Find in Workspace"), item("workbench.action.quickOpen")];
      case "Selection": return [item("workbench.action.nextEditor", "Select Next Editor"), item("workbench.action.previousEditor", "Select Previous Editor"), "-", item("workbench.files.action.showActiveFileInExplorer")];
      case "View": return [item("workbench.action.showCommands", "Command Palette…"), item("hivemind.switchView"), "-",
        { ...(item("workbench.action.toggleSidebarVisibility", "Primary Side Bar") as object), checked: layout.sidebar.visible } as MenuItem,
        { ...(item("workbench.action.togglePanel", "Panel") as object), checked: layout.panel.visible } as MenuItem, "-",
        item("workbench.view.explorer", "Explorer"), item("workbench.view.search", "Search"), item("workbench.view.scm", "Source Control"), item("workbench.view.agents", "Agents"), "-",
        { ...(item("hivemind.toggleWatch", "Watch Code Beside the Agent") as object), checked: layout.watch } as MenuItem, "-",
        item("workbench.actions.view.problems", "Problems"), item("workbench.action.output.toggleOutput", "Output"), item("workbench.action.terminal.toggleTerminal", "Terminal"), "-",
        item("workbench.action.splitEditor"), item("workbench.action.joinAllGroups")];
      case "Go": return [item("workbench.action.navigateBack", "Back"), item("workbench.action.navigateForward", "Forward"), "-", item("workbench.action.quickOpen"), "-", item("workbench.action.nextEditor", "Next Editor"), item("workbench.action.previousEditor", "Previous Editor"), "-", item("editor.action.marker.nextInFiles", "Next Problem"), item("editor.action.marker.prevInFiles", "Previous Problem")];
      case "Run": return [item("hivemind.newAgent"), "-", item("hivemind.message"), item("hivemind.wake"), item("hivemind.sleep")];
      case "Terminal": return [item("workbench.action.terminal.new", "New Terminal"), item("workbench.action.terminal.newInEditor", "New Terminal in Editor Area"), "-", item("workbench.action.terminal.moveToTerminalPanel"), item("workbench.action.terminal.moveToEditor"), "-", item("workbench.action.terminal.focus"), item("workbench.action.terminal.kill", "Kill Terminal")];
      case "Help": return [item("workbench.action.showCommands"), item("workbench.action.openGlobalKeybindings", "Keyboard Shortcuts"), "-", item("workbench.action.showAbout")];
    }
  }, [item, layout.sidebar.visible, layout.panel.visible, layout.watch]);

  const tileMenu = useCallback((id: string): MenuItem[] => {
    const t = world.byId.get(id);
    const inPanel = layout.terminals.includes(id);
    return [
      { label: "Open", run: () => open(id, { preview: false, focus: true }) },
      { label: "Open to the Side", keys: K("mod+enter", "mod+enter"), run: () => splitWith(layout.activeGroup, id) },
      inPanel ? { label: "Move into Editor Area", run: () => open(id, { preview: false }) } : { label: "Move into Panel", run: () => update((l) => toPanel(l, id)) },
      "-",
      ...(t && !isCode(t) && t.frameId ? [{ label: "Open Code Beside", run: () => { open(id, { preview: false }); openCode(t.frameId, id); } }] : []),
      { label: "Reveal in Explorer View", run: () => revealInExplorer(id) },
      { label: "Rename…", keys: "f2", run: () => { revealInExplorer(id); setRenaming(id); }, disabled: !can.edit },
      ...(t?.agent && can.wake ? ["-" as const, t.asleep ? { label: "Wake Agent", run: () => hm.commands.wakeAgent(id) } : { label: "Put Agent to Sleep", run: () => hm.commands.sleepAgent(id) }] : []),
      "-",
      { label: "Close Tile…", keys: "delete", run: () => closeTile(id), disabled: !can.close },
    ];
  }, [world.byId, layout.terminals, layout.activeGroup, open, splitWith, update, revealInExplorer, can, hm, closeTile, openCode]);

  const frameMenu = useCallback((id: string): MenuItem[] => [
    { label: "Open Code", run: () => openCode(id) },
    "-",
    { label: "New Terminal", run: () => newTerminal("editor", id), disabled: !can.spawn },
    { label: "New Agent…", run: () => void newAgent(id), disabled: !can.spawn },
    "-",
    { label: "Open Folder in Frame…", run: () => hm.commands.openFolder(id), disabled: !can.edit },
    "-",
    { label: layout.folded.includes(id) ? "Expand" : "Collapse", run: () => update((l) => ({ ...l, folded: l.folded.includes(id) ? l.folded.filter((f) => f !== id) : [...l.folded, id] })) },
  ], [newTerminal, newAgent, can, hm, layout.folded, update, openCode]);

  const tabMenu = useCallback((groupId: string, id: string): MenuItem[] => {
    const g = layout.groups.find((x) => x.id === groupId);
    return [
      { label: "Close", keys: K("mod+w"), run: () => closeTabFn(id) },
      { label: "Close Others", run: () => update((l) => closeOthers(l, id)), disabled: (g?.tabs.length ?? 0) < 2 },
      { label: "Close All", keys: K("mod+k w"), run: () => update((l) => closeAll(l, groupId)) },
      "-",
      { label: "Keep Open", keys: K("mod+k enter"), run: () => update((l) => pin(l, id)), disabled: g?.preview !== id },
      "-",
      { label: "Split Right", run: () => splitWith(groupId, id) },
      { label: "Move into Panel", run: () => update((l) => toPanel(l, id)) },
      "-",
      { label: "Reveal in Explorer View", run: () => revealInExplorer(id) },
      { label: "Rename…", keys: "f2", run: () => { revealInExplorer(id); setRenaming(id); }, disabled: !can.edit },
      { label: "Close Tile…", run: () => closeTile(id), disabled: !can.close },
    ];
  }, [layout.groups, closeTabFn, update, splitWith, revealInExplorer, can, closeTile]);

  const groupMenu = useCallback((groupId: string): MenuItem[] => [
    { label: "Close All", run: () => update((l) => closeAll(l, groupId)) },
    { label: "Join All Editor Groups", run: () => update(joinAll), disabled: layout.groups.length < 2 },
    "-",
    item("workbench.action.terminal.newInEditor", "New Terminal in Editor Area"),
    item("hivemind.newAgent", "New Agent…"),
  ], [update, layout.groups.length, item]);

  const viewMenu = useCallback((view: SideView): MenuItem[] => view === "search"
    ? [{ label: "Clear Search Results", run: () => setQuery(""), disabled: !query }]
    : view === "agents"
      ? [item("hivemind.newAgent"), item("editor.action.marker.nextInFiles", "Next Agent That Needs You")]
      : [item("workbench.action.terminal.newInEditor", "New Terminal"), item("hivemind.newAgent"), item("hivemind.newFrame"), "-", { label: "Collapse Folders in Explorer", run: () => update((l) => ({ ...l, folded: world.frames.map((f) => f.id) })) }],
  [item, query, update, world.frames]);

  const manageMenu = useCallback((): MenuItem[] => [
    item("workbench.action.showCommands", "Command Palette…"), "-",
    item("workbench.action.openSettings", "Settings"), item("workbench.action.openGlobalKeybindings", "Keyboard Shortcuts"), "-",
    item("workbench.action.selectTheme", "Themes"), item("hivemind.add"), item("hivemind.switchView"),
  ], [item]);

  // ── the quick input's sources: Go to File and tiles, the Command Palette, help ──
  const mru = trail.current.list;
  // Go to File asks the app for files as the person types, in the folder of the frame shown.
  const [quickValue, setQuickValue] = useState("");
  const fileRoot = rootOf(world.frames, activeFrame);
  const filesWanted = codeOn && !!quickState && !quickState.source && !/^[>?]/.test(quickValue);
  const found = useFoundFiles(hm, filesWanted, fileRoot, goTo(quickValue).query);
  const quickSource = useCallback((v: string): QuickSource => {
    if (v.startsWith(">")) {
      const q = v.slice(1).trim();
      return {
        placeholder: "Type the name of a command to run.",
        none: "No matching commands",
        items: () => commands.filter((c) => c.enabled?.() ?? true).flatMap((c) => {
          const label = c.category ? `${c.category}: ${c.title}` : c.title;
          const m = fuzzy(q, label);
          return m ? [{ m, it: { id: c.id, label, at: m.at, keys: c.keys?.[0], run: c.run } }] : [];
        }).sort((a, b) => (q ? b.m.score - a.m.score : a.it.label.localeCompare(b.it.label))).map((x) => x.it),
      };
    }
    if (v.startsWith("?")) {
      return {
        placeholder: "", none: "",
        items: () => [
          { id: "files", label: codeOn ? "… Go to File" : "… Go to Tile", desc: codeOn ? "Type a file's or a tile's name" : "Type a tile's name", tag: "", run: () => quick("") },
          { id: "cmds", label: "> Show and Run Commands", run: () => quick(">") },
        ],
      };
    }
    return {
      placeholder: codeOn ? "Search files and tiles by name (append :line to go to a line, ? for help)" : "Search tiles by name (append ? for help)",
      none: "No matching results",
      items: () => {
        // `cart.ts:42` (or `:42:7`): the file found by its name, opened at that line, as in VS Code.
        const { query: q, at } = codeOn ? goTo(v) : { query: v.trim(), at: undefined };
        // Files first, as fff ranks them (the ones opened most and lately lead); the tiles after.
        // The last answer stays until the next one lands, so the rows do not blink out on each key.
        const files: QuickItem[] = found ? found.page.files.map((f, i) => {
          const slash = f.path.lastIndexOf("/");
          const name = f.path.slice(slash + 1);
          const m = fuzzy(q, name);
          return {
            id: `file:${f.path}`, label: name, at: m?.at ?? [], icon: <Icon name="fileCode" />, desc: f.path.slice(0, Math.max(0, slash)),
            ...(i === 0 && !q ? { tag: "recently opened" } : {}),
            run: () => { if (q) void hm.code.picked(fileRoot, q, f.path).catch(() => {}); openFile(fileRoot, f.path, at); },
          };
        }) : [];
        const recent = [...mru].reverse().filter((id, i, a) => a.indexOf(id) === i && world.byId.has(id));
        const rows = world.tiles.flatMap((t) => {
          const m = fuzzy(q, t.name);
          if (!m) return [];
          const st = stateOf(t, world.seen.get(t.id));
          return [{ t, m, r: recent.indexOf(t.id), it: { id: t.id, label: t.name, at: m.at, icon: <TileIcon tile={t} />, desc: [frameTitle(t.frameId), st && st.tone !== "idle" ? st.why : ""].filter(Boolean).join(" · "), run: () => open(t.id, { preview: false, focus: true }) } as QuickItem }];
        });
        rows.sort((a, b) => (q ? b.m.score - a.m.score : (a.r < 0 ? 1e9 : a.r) - (b.r < 0 ? 1e9 : b.r)));
        if (!q && rows.length) {
          const firstOther = rows.findIndex((x) => x.r < 0);
          if (rows[0]!.r >= 0 && !files.length) rows[0]!.it.tag = "recently opened";
          if (firstOther > 0) rows[firstOther]!.it.tag = "other tiles";
        }
        if (files.length && rows.length) rows[0]!.it.tag = "tiles";
        return [...files, ...rows.map((x) => x.it)];
      },
    };
  }, [commands, quick, world, frameTitle, open, mru, codeOn, found, hm, fileRoot, openFile]);

  // ── the hole punch: each shown tile's live terminal where its part left room ──
  const [inert, setInert] = useState(false);
  useEffect(() => { setInert(!!dragTile || resizingNow); }, [dragTile, resizingNow]);
  const place = useCallback(() => {
    if (!can.surfaces && !can.lines) return;
    // What floats over the workbench (a menu, the quick input, a dialog): the host draws a terminal
    // above the view, so one it would cover is taken away while it is open.
    const over = [...document.querySelectorAll<HTMLElement>("[data-overlay]")].map((e) => e.getBoundingClientRect());
    const covered = (r: DOMRect) => over.some((o) => o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top);
    const round = (r: DOMRect) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    if (can.surfaces) {
      const rects = [...document.querySelectorAll<HTMLElement>("[data-dock]")].flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 24 || covered(r)) return [];
        return [{ tileId: el.dataset.dock!, ...round(r), chrome: "none" as const, radius: 0, ...(inert ? { inert: true as const } : {}) }];
      });
      hm.setSurfaceRects(rects.slice(0, 16));
    }
    if (can.lines) {
      const rects = [...document.querySelectorAll<HTMLElement>("[data-line]")].flatMap((el) => {
        const r = el.getBoundingClientRect();
        const box = el.closest(".scroll")?.getBoundingClientRect();
        // Only a slot wholly in sight: the host would draw one scrolled away over what is above it.
        if (r.width < 24 || covered(r) || (box && (r.top < box.top || r.bottom > box.bottom))) return [];
        return [{ tileId: el.dataset.line!, ...round(r), h: Math.max(20, Math.round(r.height)) }];
      });
      hm.setLineRects(rects.slice(0, 64));
    }
  }, [hm, can.surfaces, can.lines, inert]);
  useLayoutEffect(() => { place(); hm.reportFrame(); });
  useEffect(() => {
    const seen = new ResizeObserver(() => place());
    if (rootRef.current) seen.observe(rootRef.current);
    if (editorsRef.current) seen.observe(editorsRef.current);
    const offResize = hm.on("resize", () => place());
    const onScroll = () => place();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { seen.disconnect(); offResize(); document.removeEventListener("scroll", onScroll, true); };
  }, [hm, place]);
  useEffect(() => () => { hm.setSurfaceRects([]); if (can.lines) hm.setLineRects([]); }, [hm, can.lines]);

  // The host undocked a terminal (its bar, Shift+Esc): its tab closes, as the tile left the editor.
  useEffect(() => hm.on("undock", ({ tileId }) => update((l) => closeTab(l, tileId))), [hm, update]);

  // Asked to show a tile (a notification's View, a widget's go-to, `hive ctl focus`): open it, then say
  // where it is drawn: its terminal, or for one asleep the body of the group it is shown in.
  const reveal = useRef({ open });
  reveal.current = { open };
  useEffect(() => hm.onReveal(async (tileId) => {
    reveal.current.open(tileId, { preview: false });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const id = CSS.escape(tileId);
    const el = document.querySelector(`[data-dock="${id}"]`) ?? document.querySelector(`.tab.active[data-tile="${id}"]`)?.closest(".group")?.querySelector(".body");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }), [hm]);

  // What an agent may ask of Code (`hive ctl plugin call @dip497/code …`): see the manifest's commands.
  const ask = useRef({ layout, world, open, update, splitWith, openCode });
  ask.current = { layout, world, open, update, splitWith, openCode };
  useEffect(() => {
    const find = (name: unknown) => {
      const { world: w } = ask.current;
      if (typeof name !== "string" || !name.trim()) throw new Error("say which tile: { \"name\": \"…\" }");
      const n = name.trim().toLowerCase();
      const t = w.tiles.find((x) => x.name.toLowerCase() === n) ?? w.tiles.find((x) => x.name.toLowerCase().includes(n));
      if (!t) throw new Error(`no tile's name holds "${name}"`);
      return t;
    };
    const editors = () => {
      const { layout: l, world: w } = ask.current;
      const name = (id: string) => w.byId.get(id)?.name ?? id;
      return {
        groups: l.groups.map((g, i) => ({ group: i + 1, active: g.active ? name(g.active) : null, tabs: g.tabs.map(name), focused: g.id === l.activeGroup })),
        panel: { visible: l.panel.visible, tab: l.panel.tab, terminals: l.terminals.map(name) },
        sidebar: { visible: l.sidebar.visible, view: l.sidebar.view },
      };
    };
    const offs = [
      hm.onCommand("editors", () => editors()),
      hm.onCommand("open", (args) => {
        const a = (args ?? {}) as { name?: unknown; side?: unknown; panel?: unknown };
        const t = find(a.name);
        const { layout: l } = ask.current;
        if (a.panel === true) ask.current.update((x) => toPanel(x, t.id));
        else if (a.side === true) ask.current.splitWith(l.activeGroup, t.id);
        else ask.current.open(t.id, { preview: false });
        return { opened: t.name };
      }),
      hm.onCommand("close", (args) => {
        const t = find((args as { name?: unknown } | null)?.name);
        ask.current.update((x) => closeTab(x, t.id));
        return { closed: t.name };
      }),
      hm.onCommand("code", (args) => {
        const { world: w, layout: l } = ask.current;
        const name = (args as { frame?: unknown } | null)?.frame;
        const active = l.groups.find((g) => g.id === l.activeGroup)?.active;
        let frameId = active ? w.byId.get(active)?.frameId ?? null : null;
        if (typeof name === "string" && name.trim()) {
          const n = name.trim().toLowerCase();
          const f = w.frames.find((x) => x.title.toLowerCase() === n) ?? w.frames.find((x) => x.title.toLowerCase().includes(n));
          if (!f) throw new Error(`no frame's name holds "${name}"`);
          frameId = f.id;
        }
        if (!frameId) throw new Error("say which frame: { \"frame\": \"…\" }, or show a tile in one first");
        const f = w.frameById.get(frameId)!;
        ask.current.openCode(frameId);
        return { frame: f.title, code: codeOf(w.tiles, frameId) ? "opened" : "starting" };
      }),
      hm.onCommand("watch", (args) => {
        const on = (args as { on?: unknown } | null)?.on;
        ask.current.update((l) => ({ ...l, watch: typeof on === "boolean" ? on : !l.watch }));
        return { watch: typeof on === "boolean" ? on : !ask.current.layout.watch };
      }),
      hm.onCommand("layout", (args) => {
        const a = (args ?? {}) as { sidebar?: unknown; panel?: unknown; view?: unknown };
        ask.current.update((l) => ({
          ...l,
          sidebar: { ...l.sidebar, visible: typeof a.sidebar === "boolean" ? a.sidebar : l.sidebar.visible, view: a.view === "explorer" || a.view === "search" || a.view === "scm" || a.view === "agents" ? a.view : l.sidebar.view },
          panel: { ...l.panel, visible: typeof a.panel === "boolean" ? a.panel : l.panel.visible, tab: a.panel === "problems" || a.panel === "output" || a.panel === "terminal" ? a.panel : l.panel.tab, ...(typeof a.panel === "string" ? { visible: true } : {}) },
        }));
        return { ok: true };
      }),
    ];
    return () => { for (const off of offs) off(); };
  }, [hm]);

  // Words on the accent (a badge, the status bar's remote item, a button): the theme's ground or its
  // ink, whichever stands further off the accent, so a pale accent takes dark words and a deep one light.
  useEffect(() => hm.on("theme", (t) => {
    const lum = (hex: string) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!; };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
    const hex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
    const accent = [t.accent, t.colors.accent].find(hex);
    const { bg, fg } = t.colors;
    if (!accent || !hex(bg) || !hex(fg)) return;
    document.documentElement.style.setProperty("--on-accent", ratio(accent, bg) >= ratio(accent, fg) ? "var(--hm-color-bg)" : "var(--hm-color-fg)");
  }), [hm]);

  // The Output's bell: lines since the person last looked at it.
  const outputOpen = layout.panel.visible && layout.panel.tab === "output";
  // By the newest line's time, not the count: the log keeps its last 500, so at the cap its length stops.
  const newest = world.log.at(-1)?.at ?? 0;
  useEffect(() => { if (outputOpen) setSeenLog(newest); }, [outputOpen, newest]);

  const workspaceName = (() => {
    const t = activeTile ? world.byId.get(activeTile) : undefined;
    const top = t ? framePath(world.frames, t.frameId)[0] : undefined;
    return top?.title || world.frames[0]?.title || "Hivemind";
  })();

  const b: Bench = {
    hm, world, layout, now, mac: MAC, update, can, activeTile, workspaceName,
    selected, select: (id) => { setSelected(id); if (id && world.byId.has(id)) hm.commands.selectTile(id); else if (id && world.frameById.has(id)) hm.commands.selectFrame(id); },
    open, closeTab: closeTabFn, closeTile, splitWith,
    resizeGroups: (i, dx, total) => update((l) => ({ ...l, sizes: resizeGroups(l.sizes, i, dx, total) })),
    renaming, rename: (id) => { if (can.edit) setRenaming(id); },
    finishRename: (id, name) => { setRenaming(null); const t = world.byId.get(id); if (name !== null && t && name.trim() && name.trim() !== t.name) hm.commands.renameTile(id, name.trim()); },
    revealInExplorer, showView, query, setQuery, searchFocus, prompt, frameTitle, keyLabel: (k) => keyLabel(k), run,
    menu: (items, at, label) => setMenuState({ items, at, label }),
    menuOpen: menuState?.bar ?? null,
    openMenu: (name, at) => setMenuState({ items: barMenu(name), at, label: name, bar: name }),
    closeMenu: () => setMenuState(null),
    hostMenu, quick: (v) => quick(v),
    tileMenu, frameMenu, tabMenu, groupMenu, viewMenu, manageMenu,
    drag: { tile: dragTile, start: (id) => setDragTile(id), end: () => setDragTile(null), resizing: setResizing },
    history: { canBack: trail.current.at > 0, canForward: trail.current.at < trail.current.list.length - 1, back: () => walk(-1), forward: () => walk(1) },
    openCode, code: { on: codeOn, roots: codeRoots(world.frames, "Workspace"), openFile }, editorsRef, linesRef, logFrom, clearLog: () => setLogFrom(Date.now()), unread: newest > seenLog && !outputOpen,
  };

  // ── the frame: VS Code's grid, kept clear of the app's widget cards ──
  const band = world.band;
  // A sash moves from where the part is drawn and stops at its limits, so dragging back past one
  // answers at once instead of first using up what was dragged beyond it.
  const sidebarMax = Math.max(SIDEBAR_MIN, Math.round(hm.viewport.w * 0.6));
  const panelMax = Math.max(PANEL_MIN, Math.round(hm.viewport.h * 0.8));
  const sidebarW = Math.max(SIDEBAR_MIN, Math.min(layout.sidebar.width, sidebarMax));
  const panelH = layout.panel.maximized ? "fill" as const : Math.max(PANEL_MIN, layout.panel.height);
  const aux = band.width > 0 ? <div className={`aux ${band.edge}`} style={{ width: band.width }} aria-hidden="true" /> : null;
  return (
    <div className="root" ref={rootRef}>
      {band.edge === "left" && aux}
      <div className="workbench">
        <TitleBar b={b} />
        <div className="main">
          <ActivityBar b={b} />
          {layout.sidebar.visible && <>
            <SideBar b={b} width={sidebarW} />
            <Sash dir="v" b={b} onMove={(dx) => update((l) => ({ ...l, sidebar: { ...l.sidebar, width: clampTo(Math.min(l.sidebar.width, sidebarMax) + dx, SIDEBAR_MIN, sidebarMax) } }))}
              onReset={() => update((l) => ({ ...l, sidebar: { ...l.sidebar, width: 256 } }))} />
          </>}
          <div className="center">
            {!layout.panel.maximized || !layout.panel.visible ? <EditorArea b={b} /> : null}
            {layout.panel.visible && <>
              {!layout.panel.maximized && <Sash dir="h" b={b} onMove={(dy) => update((l) => ({ ...l, panel: { ...l.panel, height: clampTo(Math.min(l.panel.height, panelMax) - dy, PANEL_MIN, panelMax) } }))} />}
              <Panel b={b} height={panelH} />
            </>}
          </div>
        </div>
        <StatusBar b={b} />
      </div>
      {band.edge === "right" && aux}
      {menuState && <Menu items={menuState.items} at={menuState.at} label={menuState.label} onClose={() => setMenuState(null)} onDrawn={place} />}
      {quickState && <QuickInput initial={quickState.initial} source={quickState.source ?? quickSource} onValue={setQuickValue} onClose={() => setQuickState(null)} onDrawn={place} />}
      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

