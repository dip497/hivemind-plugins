// The view itself: a list of agents and, beside it, the one you picked. Everything it knows comes
// from the host's messages; everything it does goes through the host (dock a terminal, show a tile,
// ask the person to send a task). It keeps no state of its own beyond what is on screen.
import type { StatusInfo, ViewClient, ViewFrame, ViewTile } from "@hivemind/view-sdk";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GROUPS, ago, filtered, rows, step, type Group, type Row, type Seen } from "./model";
import { StatusMark } from "./StatusMark";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { cn } from "./ui/cn";
import { Input } from "./ui/input";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

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

const VARIANT = (r: Row) => (r.group === "stopped" && r.failed ? "failed" : r.group);
/** The badge in the header says the state; the line under the name already says what it runs. */
const BADGE = (r: Row) => (r.group === "ready" ? "Ready" : r.group === "working" && r.detail === r.agent ? "Working" : r.detail);

export function App({ hm }: { hm: ViewClient }) {
  const { all, now } = useAgents(hm);
  const [tab, setTab] = useState<Group | "all">("all");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useMemo(() => filtered(all, tab, text), [all, tab, text]);
  const current = all.find((r) => r.id === selected) ?? null;
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, all.filter((r) => r.group === g.id).length])) as Record<Group, number>, [all]);
  const dock = useRef<HTMLDivElement>(null);
  const canDock = hm.supports("surfaces");

  // The picked agent's live terminal, in the hole the dock leaves; nothing when none is picked.
  const place = useCallback(() => {
    const el = dock.current;
    if (!canDock) return;
    if (!selected || !el) { hm.setSurfaceRects([]); return; }
    const b = el.getBoundingClientRect();
    hm.setSurfaceRects([{ tileId: selected, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), chrome: "none", radius: Math.min(24, Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) }]);
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
  // An agent that went away, or that the person undocked from the host's side, closes here too.
  useEffect(() => { if (selected && !all.some((r) => r.id === selected)) setSelected(null); }, [all, selected]);
  useEffect(() => hm.on("undock", ({ tileId }) => setSelected((s) => (s === tileId ? null : s))), [hm]);

  const pick = useCallback((id: string | null) => {
    setSelected(id);
    if (id) hm.commands.selectTile(id);
  }, [hm]);

  // Asked to show a tile (from Layers, a notification): pick it, and say where its terminal is.
  const latest = useRef({ all, pick });
  latest.current = { all, pick };
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
      hm.onCommand("release", () => { latest.current.pick(null); return { open: null }; }),
    ];
    return () => { for (const off of offs) off(); };
  }, [hm]);

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pick(step(list, selected, e.key === "ArrowDown" ? 1 : -1)); }
    else if (e.key === "Escape" && selected) { e.preventDefault(); pick(null); }
  };

  const waiting = counts.needs;
  return (
    <main className="flex h-full flex-col gap-4 px-6 pt-5 pb-20">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">Focus</h1>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {all.length} agent{all.length === 1 ? "" : "s"} · {waiting ? `${waiting} waiting on you` : "nobody waiting on you"}
          </p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Group | "all")} className="ml-auto">
          <TabsList aria-label="Show">
            <TabsTrigger value="all">All <span className="tabular-nums opacity-70">{all.length}</span></TabsTrigger>
            {GROUPS.map((g) => (
              <TabsTrigger key={g.id} value={g.id} data-group={g.id}>
                <StatusMark row={{ group: g.id, failed: false }} className="size-2.5" />
                {g.title} <span className="tabular-nums opacity-70">{counts[g.id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find an agent" aria-label="Find an agent" className="w-44" />
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <Card className="flex w-80 shrink-0 flex-col overflow-hidden">
          <ul role="listbox" aria-label="Agents" tabIndex={0} onKeyDown={onListKey} className="flex-1 overflow-y-auto p-1.5 outline-none">
            {list.map((r) => (
              <li
                key={r.id}
                role="option"
                aria-selected={r.id === selected}
                data-agent={r.name}
                onClick={() => pick(r.id === selected ? null : r.id)}
                className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent", r.id === selected && "bg-accent ring-1 ring-input")}
              >
                <StatusMark row={r} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{ago(r.since, now)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {r.frame && <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: r.frame.color }} />}
                    {r.frame && <span className="truncate">{r.frame.title}</span>}
                    {r.frame && <span aria-hidden="true">·</span>}
                    <span className={cn("truncate", r.group === "needs" && "text-attention")}>{r.detail}</span>
                  </div>
                </div>
              </li>
            ))}
            {!list.length && <li className="px-3 py-6 text-center text-xs text-muted-foreground">{all.length ? "No agent matches." : "No agents yet. Start one from the toolbar."}</li>}
          </ul>
        </Card>

        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {current ? (
            <>
              <CardHeader className="border-b border-border">
                <StatusMark row={current} />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{current.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">{current.agent}{current.frame ? ` · ${current.frame.title}` : ""}</p>
                </div>
                <Badge variant={VARIANT(current)} className="ml-2">{BADGE(current)}</Badge>
                <div className="ml-auto flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => hm.commands.focusTile(current.id)}>Show on canvas</Button>
                  <Button variant="ghost" size="sm" onClick={() => pick(null)} aria-label="Close its terminal">Close</Button>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
                <div ref={dock} data-dock className="min-h-0 flex-1 rounded-lg border border-border bg-muted" aria-label={`${current.name}'s terminal`} />
                <Composer hm={hm} row={current} />
              </CardContent>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div className="max-w-xs space-y-2">
                <p className="text-sm font-medium">Pick an agent to see its terminal.</p>
                <p className="text-xs text-muted-foreground">↑ and ↓ move through the list; Esc closes. Whoever waits on you is at the top.</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

/** The next task for an agent that is ready. The app shows the person the words before they go. */
function Composer({ hm, row }: { hm: ViewClient; row: Row }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const canPrompt = hm.capabilities.includes("workspace:prompt") && hm.supports("prompt");
  useEffect(() => { setText(""); setNote(""); }, [row.id]);
  if (!canPrompt) return null;
  if (row.group !== "ready") {
    return <p className="text-xs text-muted-foreground">{row.group === "needs" ? "It is waiting on you: answer in its terminal." : row.group === "working" ? "It is working. Type in its terminal to steer it." : "It has stopped."}</p>;
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
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void give(); } }}
          placeholder="Give it its next task…"
          aria-label={`Give ${row.name} its next task`}
        />
        <Button onClick={() => void give()} disabled={!text.trim()}>Send</Button>
      </div>
      {note && <p className="text-xs text-attention">{note}</p>}
    </div>
  );
}
