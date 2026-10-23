// The view itself: every agent down the left, grouped by what it needs from you, and beside it the
// live terminal of one of them, whoever has waited on you longest unless you pick another. The
// terminal is the page: no card around it, its header above and its next task below its edge.
// Everything it knows comes from the host's messages; everything it does goes through the host.
import type { StatusInfo, ViewClient, ViewFrame, ViewTile } from "@hivemind/view-sdk";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GROUPS, ago, filtered, finding, firstToOpen, rows, step, type Row, type Seen } from "./model";
import { StatusMark, toneOf } from "./StatusMark";
import { Button } from "./ui/button";
import { cn } from "./ui/cn";
import { Input } from "./ui/input";

/** A search box only once the list is longer than a glance. */
const SEARCH_FROM = 9;

/** The workspace's agents as rows, kept up to date from the host's messages. */
function useAgents(hm: ViewClient): { all: Row[]; now: number } {
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const world = useRef({ frames: [] as ViewFrame[], tiles: [] as ViewTile[], seen: new Map<string, Seen>(), names: new Map<string, string>(), watching: new Map<string, () => void>() });
  useEffect(() => {
    const w = world.current;
    const bump = () => setVersion((v) => v + 1);
    const offStructure = hm.on("structure", (s) => {
      w.frames = s.frames;
      w.tiles = s.tiles;
      for (const t of s.tiles) {
        w.names.set(t.id, t.name);
        if (t.agent && !w.watching.has(t.id)) {
          w.watching.set(t.id, hm.subscribeStatus(t.id, (status, info?: StatusInfo) => {
            w.seen.set(t.id, { status, since: info?.since, agent: info?.agent });
            bump();
          }));
        }
      }
      for (const [id, stop] of w.watching) if (!s.tiles.some((t) => t.id === id)) { stop(); w.watching.delete(id); w.seen.delete(id); }
      bump();
    });
    const offNames = hm.on("names", ({ names }) => { for (const [id, v] of Object.entries(names)) w.names.set(id, v); bump(); });
    // "12m" moves on while nothing else changes.
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { offStructure(); offNames(); clearInterval(tick); for (const stop of w.watching.values()) stop(); w.watching.clear(); };
  }, [hm]);
  const all = useMemo(() => { const w = world.current; return rows(w.tiles, w.frames, w.seen, w.names, Date.now()); }, [version]);
  return { all, now };
}

/** What the line under a name says: why it waits, else where it lives and what it is doing. */
const lineOf = (r: Row) => (r.group === "needs" ? r.detail : [r.frame?.title, r.detail].filter(Boolean).join(" · "));

export function App({ hm }: { hm: ViewClient }) {
  const { all, now } = useAgents(hm);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useMemo(() => filtered(all, text), [all, text]);
  const current = all.find((r) => r.id === selected) ?? null;
  const said = finding(all);
  const dock = useRef<HTMLDivElement>(null);
  const canDock = hm.supports("surfaces");

  // The picked agent's live terminal, in the hole the dock leaves; nothing when none is picked.
  const place = useCallback(() => {
    const el = dock.current;
    if (!canDock) return;
    if (!selected || !el) { hm.setSurfaceRects([]); return; }
    const b = el.getBoundingClientRect();
    hm.setSurfaceRects([{ tileId: selected, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), chrome: "none", radius: 0 }]);
  }, [hm, selected, canDock]);
  useEffect(() => {
    place();
    const el = dock.current;
    const seen = el ? new ResizeObserver(place) : null;
    if (el) seen!.observe(el);
    const offResize = hm.on("resize", place);
    return () => { seen?.disconnect(); offResize(); };
  }, [hm, place]);
  useEffect(() => () => { if (canDock) hm.setSurfaceRects([]); }, [hm, canDock]);

  // Never an empty pane: Focus opens whoever has waited on you longest. What Focus opened gives way
  // when someone new needs you; what the person picked stays until they pick again. Once they close
  // it, it stays closed until someone new needs them.
  const chosenByFocus = useRef(true);
  const closed = useRef(false);
  const waiting = useRef(new Set<string>());
  const pick = useCallback((id: string | null) => {
    chosenByFocus.current = false;
    setSelected(id);
    if (id) hm.commands.selectTile(id);
  }, [hm]);
  useEffect(() => {
    const needs = all.filter((r) => r.group === "needs").map((r) => r.id);
    const fresh = needs.some((id) => !waiting.current.has(id));
    waiting.current = new Set(needs);
    const open = selected !== null && all.some((r) => r.id === selected);
    if (open && !(chosenByFocus.current && fresh)) return;
    if (!open && closed.current && !fresh) { if (selected) setSelected(null); return; }
    closed.current = false;
    chosenByFocus.current = true;
    setSelected(firstToOpen(all)?.id ?? null);
  }, [all, selected]);
  const close = useCallback(() => { pick(null); closed.current = true; }, [pick]);
  useEffect(() => hm.on("undock", ({ tileId }) => { if (tileId === selected) close(); }), [hm, selected, close]);

  // Asked to show a tile (from Layers, a notification): pick it, and say where its terminal is.
  const latest = useRef({ all, pick, close });
  latest.current = { all, pick, close };
  useEffect(() => hm.onReveal(async (tileId) => {
    if (!latest.current.all.some((r) => r.id === tileId)) return null;
    latest.current.pick(tileId);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = dock.current?.getBoundingClientRect();
    return b ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
  }), [hm]);

  // What an agent driving this view can ask of it.
  useEffect(() => {
    const offs = [
      hm.onCommand("board", () => Object.fromEntries(GROUPS.map((g) => [g.title, latest.current.all.filter((r) => r.group === g.id).map((r) => ({ name: r.name, agent: r.agent, frame: r.frame?.title ?? null, for: ago(r.since, Date.now()), detail: r.detail }))]))),
      hm.onCommand("open", (a) => {
        const want = String((a as { name?: unknown } | null)?.name ?? "").toLowerCase();
        const r = latest.current.all.find((x) => want && x.name.toLowerCase().includes(want));
        if (!r) throw new Error(`no agent is called ${JSON.stringify((a as { name?: unknown } | null)?.name)}`);
        latest.current.pick(r.id);
        return { open: r.name };
      }),
      hm.onCommand("release", () => { latest.current.close(); return { open: null }; }),
    ];
    return () => { for (const off of offs) off(); };
  }, [hm]);

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pick(step(list, selected, e.key === "ArrowDown" ? 1 : -1)); }
    else if (e.key === "Escape" && selected) { e.preventDefault(); close(); }
  };

  return (
    <main className="grid h-full grid-cols-[296px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-hairline">
        <header className="flex flex-col gap-1 px-4 pt-4 pb-2">
          <h1 className="text-title font-semibold tracking-[-0.014em]">Agents</h1>
          <p aria-live="polite" data-finding className={cn("text-label", said.waits ? "text-attention" : "text-pencil")}>{said.text}</p>
          {all.length >= SEARCH_FROM && (
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find an agent, a folder" aria-label="Find an agent" className="mt-2" />
          )}
        </header>
        <div role="listbox" aria-label="Agents" tabIndex={0} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto pb-3 outline-none">
          {GROUPS.map((g) => {
            const here = list.filter((r) => r.group === g.id);
            if (!here.length) return null;
            return (
              <div key={g.id} role="group" aria-label={g.title} data-group={g.id}>
                <h2 className="flex items-baseline gap-1.5 px-4 pt-3 pb-1 text-label font-medium text-pencil">
                  {g.title}<span className="text-count tabular-nums text-dust">{here.length}</span>
                </h2>
                {here.map((r) => <AgentRow key={r.id} row={r} now={now} selected={r.id === selected} onPick={() => pick(r.id)} />)}
              </div>
            );
          })}
          {!list.length && <p className="px-4 py-3 text-label text-pencil">{all.length ? "No agent matches." : "No agents yet. Start one from the toolbar."}</p>}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col" aria-label={current ? `${current.name}'s terminal` : "Terminal"}>
        {current ? (
          <>
            {/* The name and where it lives; why it waits is said in the list and the line under the title. */}
            <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-hairline pr-2 pl-2">
              <Logo row={current} />
              <h2 className="truncate text-title font-semibold tracking-[-0.014em]">{current.name}</h2>
              <span className="truncate text-label text-pencil">{[current.frame?.title, current.agent].filter(Boolean).join(" · ")}</span>
              <div className="ml-auto flex shrink-0 gap-0.5">
                <Button onClick={() => hm.commands.focusTile(current.id)}>Show on canvas</Button>
                <Button onClick={close} aria-label="Close its terminal">Close</Button>
              </div>
            </header>
            <div ref={dock} data-dock className="min-h-0 flex-1 bg-terminal" />
            <Composer hm={hm} row={current} />
          </>
        ) : (
          <p className="m-auto text-body text-pencil">{all.length ? "Pick an agent from the list to see its terminal." : "No agents yet. Start one from the toolbar."}</p>
        )}
      </section>
    </main>
  );
}

/** The agent's own mark (DESIGN.md: the tile row's 16px icon slot), as the app sends it. */
function Logo({ row }: { row: Row }) {
  if (!row.icon) return <span className="size-4 shrink-0" aria-hidden="true" />;
  return <span className="flex size-4 shrink-0 text-pencil [&>svg]:size-4" aria-hidden="true" dangerouslySetInnerHTML={{ __html: row.icon }} />;
}

function AgentRow({ row: r, now, selected, onPick }: { row: Row; now: number; selected: boolean; onPick: () => void }) {
  const tone = toneOf(r);
  return (
    <div
      role="option"
      aria-selected={selected}
      data-agent={r.name}
      onClick={onPick}
      className={cn(
        "mx-2 flex h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 transition-colors duration-150 hover:bg-card",
        selected && "bg-hover hover:bg-hover",
        r.group === "stopped" && "opacity-70",
      )}
    >
      <Logo row={r} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-row">{r.name}</span>
          <span className="ml-auto shrink-0 text-count tabular-nums text-dust">{ago(r.since, now)}</span>
        </div>
        <div className={cn("truncate text-label", r.group === "needs" ? "text-attention" : "text-pencil")}>{lineOf(r)}</div>
      </div>
      {/* One slot on every row, so the times above it share an edge. */}
      <span className="flex w-2 shrink-0 justify-center">{tone && <StatusMark tone={tone} />}</span>
    </div>
  );
}

/** The next task for an agent that is ready, joined to its terminal's lower edge. The app shows the
 *  person the words before they go. */
function Composer({ hm, row }: { hm: ViewClient; row: Row }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const canPrompt = hm.capabilities.includes("workspace:prompt") && hm.supports("prompt");
  useEffect(() => { setText(""); setNote(""); }, [row.id]);
  if (!canPrompt) return null;
  // Waiting on you: its request is in the terminal above, answered there.
  if (row.group === "needs") return null;
  if (row.group !== "ready") {
    return (
      <p className="shrink-0 border-t border-hairline px-2 py-3 text-label text-pencil">
        {row.group === "working" ? "It is working. Type in its terminal to steer it." : "It has stopped."}
      </p>
    );
  }
  const give = async () => {
    const words = text.trim();
    if (!words) return;
    const out = await hm.prompt(row.id, words).catch((e: { code?: string }) => (e?.code === "ASLEEP" ? "asleep" : "cancelled"));
    if (out === "sent") { setText(""); setNote(""); }
    else if (out === "asleep") setNote("It is asleep: wake it on the canvas first.");
  };
  // Enter and Send are heard directly: a view's frame may not submit a form.
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-hairline px-2 py-2.5">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void give(); } }}
          placeholder="Give it its next task…"
          aria-label={`Give ${row.name} its next task`}
        />
        <Button variant="primary" onClick={() => void give()} disabled={!text.trim()}>Send</Button>
      </div>
      {note && <p className="text-label text-attention">{note}</p>}
    </div>
  );
}
