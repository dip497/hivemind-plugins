// Island: the workspace as an archipelago. Each frame is an island whose land follows its colour, a
// worktree an islet joined by a bridge, and each agent a worker with a workshop and a village: every
// turn it finishes raises its next house a step, so a busy day leaves a town. It works at the house
// it is building, rests by its fire when idle, and stands at its door under a thin light when it is
// calling you. The light follows the clock. Click a worker to open its live terminal beside it.
import { applyThemeVars, connect, type ViewAgentStatus, type ViewStatus, type ViewFrame, type ViewTile } from "@hivemind/view-sdk";
import { loadAssets } from "./assets";
import { Scene, type Palette } from "./scene";
import { playCall, playDone, setSound, soundOn } from "./sound";
import { LOOSE, TONE, callReason, callers, census, howLong, inkOn, layout, moodOf, type Mood } from "./world";

const hm = await connect();
applyThemeVars(hm);
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const can = (p: string) => hm.capabilities.includes(p as never);

const scene = new Scene(await loadAssets());
$(".stage").append(scene.renderer.domElement);
const canvas = scene.renderer.domElement;
scene.resize(innerWidth, innerHeight);

// ── what the person set ─────────────────────────────────────────────────────
const systemCalm = matchMedia("(prefers-reduced-motion: reduce)");
function motion(): void {
  const m = String(hm.settings.motion ?? "system");
  scene.reduced = m === "less" || (m === "system" && systemCalm.matches);
  document.documentElement.dataset.motion = scene.reduced ? "less" : "full";
  scene.setShadows(hm.settings.shadows !== false);
  scene.setEffects(hm.settings.effects !== false);
  scene.setQuality(0);
  sky();
  wake();
}
/** The hour the light shows: the clock's, or the one the person picked. */
const HOURS: Record<string, number> = { morning: 8, day: 12.5, dusk: 18.6, night: 22.5 };
function sky(): void {
  const d = new Date();
  scene.setHour(HOURS[String(hm.settings.sky ?? "clock")] ?? d.getHours() + d.getMinutes() / 60);
  stats.hour = +scene.hour.toFixed(2);
}
setInterval(() => { sky(); wake(); }, 60_000);
systemCalm.addEventListener("change", motion);

function palette(): Palette {
  // The mode the theme is in now: applyThemeVars keeps --hm-mode current, and hello was only the first theme.
  const mode = css("--hm-mode", "dark") === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.dataset.mode = mode;
  const p: Palette = {
    mode,
    working: css("--hm-status-working", "#22c55e"), attention: css("--hm-status-attention", "#f59e0b"), idle: css("--hm-status-idle", "#94a3b8"),
    exited: css("--hm-status-exited", "#64748b"), failed: css("--hm-status-failed", "#ef4444"), done: css("--hm-status-done", "#38bdf8"),
    accent: css("--hm-accent", "#6366f1"),
  };
  root.style.setProperty("--on-call", inkOn(p.attention));
  root.style.setProperty("--on-accent", inkOn(p.accent));
  return p;
}
let pal = palette();
scene.setPalette(pal);

// ── the workspace ───────────────────────────────────────────────────────────
let frames: ViewFrame[] = [], tiles: ViewTile[] = [];
let links: { a: string; b: string; kind: "spawn" | "pipe" }[] = [];
const names = new Map<string, string>();
/** What the person has typed for each agent: every status change repaints the card, and the text,
 *  and the caret when the box had it, move to the new box. */
const drafts = new Map<string, string>();
const live = new Map<string, { mood: Mood; since: number; status?: ViewStatus; agent?: ViewAgentStatus }>();
const watching = new Map<string, () => void>();
const busy = new Map<string, () => void>();
let world: ReturnType<typeof layout> | null = null;
let picked: { kind: "agent" | "island"; id: string } | null = null;
let docked: string | null = null;
const fresh = new Set<string>();
let first = true;
/** Whether the calls tray is open, or folded to a chip. */
let trayOpen = false;
// Every handler below may run as soon as it is registered (the host replays what it already sent),
// so all the state they touch is declared here, first.
let day = "";
let awaySince = 0, awayTurns = 0, awayCalls = 0;
let toastTimer = 0;
interface Label { el: HTMLElement; at: () => ReturnType<Scene["agentAnchor"]>; kind: "island" | "agent"; id: string; size?: { w: number; h: number } }
let labels: Label[] = [];
let labelsDirty = true;
let saveTimer = 0;
let drag: { x: number; y: number; moved: boolean; turn: boolean } | null = null;
let hovered: string | null = null;
let running = false, last = 0, prev = 0, frames60 = 0, fpsAt = 0;
let spent = 0;
let sized = "";
/** When the person last moved the camera; left alone, it turns slowly round the islands. */
let touched = performance.now();
const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`;
/** Turns each agent finished today, by tile. */
const turns = new Map<string, number>();
const stats = { quality: 0, fps: 0, calls: 0, triangles: 0, agents: 0, frameMs: 0, biomes: [] as string[], lots: [0, 0, 0, 0], hour: 0, turns: 0, gpu: scene.gpu, labels: 0 };


const nameOf = (id: string) => names.get(id) ?? tiles.find((t) => t.id === id)?.name ?? "agent";
const tileOf = (id: string) => tiles.find((t) => t.id === id);
const agents = () => tiles.filter((t) => t.agent);
const moodOfTile = (id: string): Mood => live.get(id)?.mood ?? "idle";
const WORDS: Record<Mood, string> = { calling: "calling you", working: "working", failed: "stopped on an error", done: "finished its turn", idle: "ready for work", asleep: "asleep", gone: "closed" };
/** When an agent was put to sleep, while it sleeps; never on a host without sleep. */
const asleepOf = (id: string): { since?: number } | undefined => (hm.supports("sleep") ? tileOf(id)?.asleep : undefined);
/** An agent's mood from its status and whether it sleeps; a change starts its clock again. */
function setLive(id: string, status: ViewStatus | undefined, agent: ViewAgentStatus | undefined, since?: number): Mood {
  const sleep = asleepOf(id), mood = moodOf(status, agent, !!sleep), before = live.get(id);
  const start = mood === "asleep" ? sleep?.since ?? (before?.mood === "asleep" ? before.since : Date.now()) : since ?? (before?.mood === mood ? before.since : Date.now());
  live.set(id, { mood, since: start, status, agent });
  scene.setMood(id, mood);
  return mood;
}

function rebuild(): void {
  world = layout(frames, tiles);
  const kinds = new Map(tiles.map((t) => [t.id, t.agent]));
  scene.build(world.islands, world.spots, kinds, links);
  stats.biomes = [...world.islands.values()].map((i) => `${i.title} ${i.color} ${i.biome}`);
  for (const [id, s] of live) scene.setMood(id, s.mood), scene.setSubagents(id, s.agent?.subagents ?? 0);
  scene.setTurns(turns, false);
  for (const id of fresh) scene.arrive(id);
  fresh.clear();
  if (first) {
    first = false;
    const saved = hm.hello.layout as { camera?: Partial<typeof scene.goal>; sound?: boolean } | null;
    scene.overview();
    Object.assign(scene.view, scene.goal);
    if (saved?.camera) Object.assign(scene.goal, saved.camera);
    // Come down onto the islands from high above.
    if (!scene.reduced) { scene.view.dist = scene.goal.dist * 2.4; scene.view.pitch = 1.3; scene.view.yaw = scene.goal.yaw - 0.7; }
    else Object.assign(scene.view, scene.goal);
    if (saved?.sound) toggleSound(true, false);
  }
  buildLabels();
  refresh();
  wake();
}

hm.on("structure", (s) => {
  frames = s.frames; tiles = s.tiles;
  links = [...(s.links?.spawns ?? []).map((x) => ({ a: x.parent, b: x.child, kind: "spawn" as const })), ...(s.links?.pipes ?? []).map((x) => ({ a: x.src, b: x.dst, kind: "pipe" as const }))];
  for (const t of tiles) {
    names.set(t.id, names.get(t.id) ?? t.name);
    if (!t.agent || watching.has(t.id)) continue;
    watching.set(t.id, hm.subscribeStatus(t.id, (st, info) => {
      const before = live.get(t.id);
      const mood = setLive(t.id, st, info?.agent, info?.since);
      scene.setSubagents(t.id, info?.agent?.subagents ?? 0);
      if (mood === "calling" && before && before.mood !== "calling") calledNow(t.id);
      refresh();
      wake();
    }));
    if (hm.supports("activity")) busy.set(t.id, hm.activity(t.id, (level) => { scene.setActivity(t.id, level); }));
  }
  for (const [id, stop] of watching) if (!tiles.some((t) => t.id === id)) { stop(); watching.delete(id); busy.get(id)?.(); busy.delete(id); live.delete(id); }
  // Falling asleep and waking come with the tiles, over whatever the status last said.
  for (const [id, s] of live) if ((s.mood === "asleep") !== !!asleepOf(id)) setLive(id, s.status, s.agent);
  if (docked && !tiles.some((t) => t.id === docked)) dock(null);
  if (picked?.kind === "agent" && !tiles.some((t) => t.id === picked!.id)) pick(null);
  rebuild();
});
hm.on("names", ({ names: n }) => { for (const [id, v] of Object.entries(n)) names.set(id, v); buildLabels(); refresh(); });
// applyThemeVars, told first, has set the new theme's variables already; one more of it would add a listener each time.
hm.on("theme", () => { pal = palette(); scene.setPalette(pal); rebuild(); });
hm.on("settings", () => motion());
hm.on("resize", () => { if (docked) hm.setSurfaceRects([dockRect()]); wake(); });
hm.on("visibility", () => wake());
document.addEventListener("visibilitychange", wake);

// ── the turns each agent finished today: one step of its village each ──────
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function readTurns(): Promise<void> {
  if (!hm.supports("history")) return;
  const d = today();
  const h = await hm.history(d).catch(() => null);
  if (!h) return;
  const grow = day === d;
  if (!grow) turns.clear();
  day = d;
  // The day's record and the turns seen live can disagree for a moment; a village never shrinks.
  for (const t of h.tiles) if (t.turns.length > (turns.get(t.id) ?? 0)) turns.set(t.id, t.turns.length);
  scene.setTurns(turns, grow);
  wake();
}
void readTurns();
setInterval(() => void readTurns(), 5 * 60_000);
function turned(id: string): void {
  if (today() !== day) { void readTurns(); return; }
  turns.set(id, (turns.get(id) ?? 0) + 1);
  scene.setTurns(turns, true);
}

if (hm.supports("events")) {
  hm.onEvents(["turn", "needsInput", "tileOpened"], (e) => {
    if (e.kind === "turn" && (!e.outcome || e.outcome === "done")) { scene.burst(e.tileId); turned(e.tileId); playDone(); noteAway("turn"); }
    if (e.kind === "tileOpened" && e.agent) fresh.add(e.tileId);
  });
}

// ── while you were away ─────────────────────────────────────────────────────
function noteAway(what: "turn" | "call"): void { if (awaySince) what === "turn" ? awayTurns++ : awayCalls++; }
if (hm.supports("presence")) {
  hm.onPresence((p) => {
    if (p.state === "away" && !awaySince) { awaySince = p.since; awayTurns = awayCalls = 0; return; }
    if (p.state === "active" && awaySince) {
      const gone = Date.now() - awaySince;
      awaySince = 0;
      const waiting = callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 })));
      if (gone > 60_000 && (awayTurns || waiting.length)) {
        toast(`While you were away (${howLong(gone)}): ${awayTurns} turn${awayTurns === 1 ? "" : "s"} finished${waiting.length ? `, ${waiting.length} calling you. Press N to go to the first.` : "."}`);
      }
    }
  });
}
function toast(text: string): void {
  const t = $(".toast");
  t.textContent = text;
  t.hidden = false;
  t.classList.add("panel");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, 9000);
}

function calledNow(id: string): void {
  playCall();
  noteAway("call");
  $(".sr").textContent = `${nameOf(id)} ${callReason(live.get(id)?.agent)}.`;
}

// ── the header, the calls and the floating names ────────────────────────────
function refresh(): void {
  const list = agents();
  const c = census(list.map((t) => moodOfTile(t.id)));
  const isl = world ? world.islands.size : 0;
  $(".sum").innerHTML = "";
  $(".sum").append(`${isl} island${isl === 1 ? "" : "s"} · ${list.length} agent${list.length === 1 ? "" : "s"} · ${c.working} working`);
  if (c.calling) { $(".sum").append(" · "); $(".sum").append(el("b", undefined, `${c.calling} calling you`)); }
  if (c.failed) $(".sum").append(` · ${c.failed} stopped`);
  if (c.asleep) $(".sum").append(` · ${c.asleep} asleep`);
  // The calls, the one calling longest first.
  const order = callers(list.map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? Date.now() })));
  const box = $(".calls");
  box.hidden = order.length === 0;
  box.classList.add("panel");
  $(".calls-title").textContent = order.length === 1 ? "1 agent calling you" : `${order.length} agents calling you`;
  box.classList.toggle("open", trayOpen && order.length > 0);
  $(".calls-toggle").setAttribute("aria-expanded", String(trayOpen));
  const ol = $(".calls-list");
  const had = new Set([...ol.querySelectorAll<HTMLElement>("li")].map((li) => li.dataset.id));
  ol.replaceChildren(...order.map(({ tileId, since }) => {
    const li = el("li");
    li.dataset.id = tileId;
    if (!had.has(tileId)) li.classList.add("new");
    const b = el("button");
    b.type = "button";
    b.setAttribute("aria-current", String(docked === tileId));
    const icon = el("span", "icon");
    const svg = tileOf(tileId)?.icon;
    if (svg) icon.innerHTML = svg;
    const who = el("span", "who");
    who.append(el("b", undefined, nameOf(tileId)), el("span", undefined, callReason(live.get(tileId)?.agent)));
    const time = el("time", undefined, howLong(Date.now() - since));
    b.append(icon, who, time);
    b.onclick = () => go(tileId, true);
    li.append(b);
    return li;
  }));
  paintCard();
  placeCalls();
  labelsDirty = true;
}
setInterval(() => { if (!$(".calls").hidden) refresh(); }, 30_000);
$(".calls-toggle").addEventListener("click", () => { trayOpen = !trayOpen; refresh(); });

/** Where the calls sit: in the top right corner, or with a terminal docked at the top of the open space
 *  left of it. They stay on the header's row where it leaves room for the tray open, and go under the
 *  header where it does not (a narrow window, a long count, a terminal docked), so they never lie over its
 *  words and opening the tray never moves them; and they keep clear of the tools down the left and of the
 *  card below. Measured from the boxes as laid out (offsets), not as a move under way draws them. */
function placeCalls(): void {
  const box = $(".calls");
  if (box.hidden) return;
  // How wide the tray is open (`.calls` in island.css).
  const tray = 280;
  const head = $(".head"), tools = $(".tools"), card = $(".card");
  const corner = innerWidth - 16;
  const edge = docked ? $(".dock").getBoundingClientRect().left - 12 : corner;
  const room = edge - (tools.offsetLeft + tools.offsetWidth + 12);
  box.style.maxWidth = `${room}px`;
  const row = box.offsetTop;
  const top = edge - Math.min(tray, room) >= head.offsetLeft + head.offsetWidth + 12 ? row : head.offsetTop + head.offsetHeight + 10;
  // As far above the foot as it ever was, and above the card where the two share the width.
  let foot = innerHeight - 106;
  if (!card.hidden && card.offsetLeft < edge && card.offsetLeft + card.offsetWidth > edge - box.offsetWidth) foot = Math.min(foot, card.offsetTop - 10);
  box.style.maxHeight = `${Math.max(0, foot - top)}px`;
  box.style.transform = `translate(${edge - corner}px, ${top - row}px)`;
}
addEventListener("resize", placeCalls);

function buildLabels(): void {
  $(".labels").replaceChildren();
  labels = [];
  if (!world) return;
  for (const isl of world.islands.values()) {
    const e = el("div", "label island");
    const sw = el("i");
    sw.style.background = isl.color;
    e.append(sw, el("span", undefined, isl.title));
    e.append(el("small"));
    $(".labels").append(e);
    labels.push({ el: e, at: () => null, kind: "island", id: isl.id });
  }
  for (const t of agents()) {
    const e = el("div", "label agent");
    $(".labels").append(e);
    labels.push({ el: e, at: () => scene.agentAnchor(t.id), kind: "agent", id: t.id });
  }
  labelsDirty = true;
}
function placeLabels(): void {
  if (!world) return;
  const w = innerWidth, h = innerHeight;
  // One name per island; an agent's only when picked, pointed at, or first in line to be answered.
  const first = callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 })))[0]?.tileId;
  const edges: { id: string; x: number; y: number; a: number }[] = [];
  const right = docked ? w - Math.min(w * 0.46, 640) - 32 : w;
  const want: { l: Label; x: number; y: number; prio: number; flex: boolean }[] = [];
  // Names fade once the islands are too small to read them by.
  const fade = Math.max(0, Math.min(1, (260 - scene.view.dist) / 100));
  for (const l of labels) {
    const p = l.kind === "agent" ? l.at() : null;
    const s = l.kind === "agent" ? p && scene.screenOf(p, w, h, 24) : (() => { const a = scene.islandLabelAt(l.id, w, h); return a && { ...a, inside: a.x >= 24 && a.x <= w - 24 && a.y >= 24 && a.y <= h - 24 }; })();
    if (l.kind === "agent") {
      const m = moodOfTile(l.id);
      const show = picked?.id === l.id || hovered === l.id || l.id === first;
      if (labelsDirty) {
        l.el.className = `label agent${m === "calling" ? " calling" : ""}${picked?.id === l.id ? " picked" : ""}`;
        l.el.replaceChildren(nameOf(l.id));
        if (m === "calling") l.el.append(el("span", undefined, ` · ${callReason(live.get(l.id)?.agent)}`));
        l.size = undefined;
      }
      if (show && s && s.inside && s.x < right) {
        const prio = picked?.id === l.id ? 0 : hovered === l.id ? 1 : 1.2;
        want.push({ l, x: s.x, y: s.y, prio, flex: false });
      }
      if (m === "calling" && !(s && s.inside && s.x < right)) {
        // Out of sight: an arrow on the edge, pointing at it.
        const a = scene.agentAnchor(l.id)!;
        const dx = a.x - scene.view.x, dz = a.z - scene.view.z, yaw = scene.view.yaw;
        const sx = dx * Math.sin(yaw) - dz * Math.cos(yaw), sy = -dx * Math.cos(yaw) - dz * Math.sin(yaw);
        edges.push({ id: l.id, x: sx, y: sy, a: Math.atan2(sy, sx) });
      }
    } else {
      if (labelsDirty) {
        const small = l.el.querySelector("small")!;
        const on = world.spots;
        const here = [...on.values()].filter((sp) => sp.islandId === l.id && sp.agent).map((sp) => moodOfTile(sp.tileId));
        const c = census(here);
        small.replaceChildren(`${here.length} agent${here.length === 1 ? "" : "s"}${c.working ? ` · ${c.working} working` : ""}`);
        if (c.calling) { small.append(" · "); small.append(el("b", undefined, `${c.calling} calling`)); }
        const isl = world.islands.get(l.id);
        if (isl?.subtitle) small.append(` · ${isl.subtitle}`);
        l.size = undefined;
      }
      if (s && s.inside && s.x < right && fade > 0) want.push({ l, x: s.x, y: s.y, prio: 1.5, flex: true });
      if (l.el.style.opacity !== String(fade)) l.el.style.opacity = String(fade);
    }
  }
  // Most important first; a name that would cover another, or the panels, waits for room.
  want.sort((a, b) => a.prio - b.prio);
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const p of document.querySelectorAll<HTMLElement>(".head, .tools, .calls:not([hidden]), .card:not([hidden]), .dock[data-open]")) {
    const b = p.getBoundingClientRect();
    if (b.width) placed.push({ x0: b.left, x1: b.right, y0: b.top, y1: b.bottom });
  }
  const shown = new Set<Label>();
  for (const c of want) {
    if (!c.l.size) { c.l.el.style.display = c.flex ? "flex" : "block"; c.l.size = { w: c.l.el.offsetWidth, h: c.l.el.offsetHeight }; }
    c.x = Math.max(c.l.size.w / 2 + 4, Math.min(innerWidth - c.l.size.w / 2 - 4, c.x));
    const r = { x0: c.x - c.l.size.w / 2 - 3, x1: c.x + c.l.size.w / 2 + 3, y0: c.y - c.l.size.h - 2, y1: c.y + 2 };
    if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
    placed.push(r);
    shown.add(c.l);
    c.l.el.style.display = c.flex ? "flex" : "block";
    c.l.el.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -100%)`;
  }
  for (const l of labels) if (!shown.has(l)) l.el.style.display = "none";
  labelsDirty = false;
  stats.labels = shown.size;
  // Edge arrows.
  const box = $(".edges");
  const top = 96, bottom = h - 28, cx = right / 2, cy = (top + bottom) / 2, rx = right / 2 - 64, ry = (bottom - top) / 2;
  const ids = edges.map((e) => e.id).join(",");
  if (box.dataset.ids !== ids) {
    box.dataset.ids = ids;
    box.replaceChildren(...edges.map((e) => {
      const b = el("button", "edge");
      b.type = "button";
      b.dataset.id = e.id;
      b.innerHTML = ARROW;
      b.setAttribute("aria-label", `Go to ${nameOf(e.id)}, calling you`);
      b.title = `${nameOf(e.id)} · ${callReason(live.get(e.id)?.agent)}`;
      b.onclick = () => go(e.id, true);
      return b;
    }));
  }
  edges.forEach((e, i) => {
    const b = box.children[i] as HTMLElement | undefined;
    if (!b) return;
    const k = 1 / Math.max(Math.abs(Math.cos(e.a)) / rx, Math.abs(Math.sin(e.a)) / ry);
    b.style.transform = `translate(${cx + Math.cos(e.a) * k}px, ${cy - Math.sin(e.a) * k}px)`;
    (b.firstElementChild as HTMLElement).style.transform = `rotate(${-e.a}rad)`;
  });
}

// ── the card for what is picked ─────────────────────────────────────────────
function pick(p: { kind: "agent" | "island"; id: string } | null): void {
  picked = p;
  labelsDirty = true;
  paintCard();
  placeCalls();
  wake();
}
function paintCard(): void {
  const card = $(".card");
  const was = card.querySelector<HTMLInputElement>("form[data-tile] input");
  const caret = was && document.activeElement === was ? { tile: was.form?.dataset.tile, at: [was.selectionStart ?? 0, was.selectionEnd ?? 0] as const } : null;
  card.classList.add("panel");
  if (!picked || !world) { card.hidden = true; return; }
  if (picked.kind === "island") {
    const isl = world.islands.get(picked.id);
    if (!isl) { card.hidden = true; return; }
    const here = [...world.spots.values()].filter((s) => s.islandId === isl.id && s.agent).map((s) => moodOfTile(s.tileId));
    const c = census(here);
    const h3 = el("h3");
    const sw = el("i");
    sw.style.cssText = `width:10px;height:10px;border-radius:3px;background:${isl.color}`;
    h3.append(sw, isl.title);
    card.replaceChildren(h3, el("p", undefined, [`${here.length} agent${here.length === 1 ? "" : "s"}`, c.working && `${c.working} working`, c.calling && `${c.calling} calling you`, c.asleep && `${c.asleep} asleep`, isl.subtitle].filter(Boolean).join(" · ")));
    const row = el("div", "row");
    if (can("workspace:spawn") && isl.id !== LOOSE) {
      const b = el("button", "primary", "Start an agent here");
      b.type = "button";
      b.onclick = () => hm.commands.spawnAgent(null, isl.id);
      row.append(b);
    }
    if (isl.id !== LOOSE) { const f = el("button", undefined, "Select the frame"); f.type = "button"; f.onclick = () => hm.commands.selectFrame(isl.id); row.append(f); }
    card.append(row);
    card.hidden = false;
    return;
  }
  const id = picked.id, t = tileOf(id);
  if (!t) { card.hidden = true; return; }
  const m = moodOfTile(id), info = live.get(id);
  const h3 = el("h3");
  const icon = el("span", "icon");
  if (t.icon) icon.innerHTML = t.icon;
  h3.append(icon, nameOf(id));
  const mood = el("span", "mood");
  const dot = el("i");
  dot.style.background = css(`--hm-status-${TONE[m]}`, "#888");
  mood.append(dot, m === "calling" ? callReason(info?.agent) : m === "asleep" ? `Asleep · since ${new Date(info?.since ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : WORDS[m]);
  const p = el("p");
  p.append(mood, ` · ${t.agent}${info?.agent?.subagents ? ` · ${info.agent.subagents} helper${info.agent.subagents === 1 ? "" : "s"}` : ""}`);
  card.replaceChildren(h3, p);
  const row = el("div", "row");
  const open = el("button", m === "calling" ? "call" : "primary", docked === id ? "Close its terminal" : m === "calling" ? "Answer in its terminal" : "Open its terminal");
  open.type = "button";
  open.onclick = () => dock(docked === id ? null : id);
  const canvasBtn = el("button", undefined, "Show it on the canvas");
  canvasBtn.type = "button";
  canvasBtn.onclick = () => hm.commands.focusTile(id);
  if (m === "asleep" && can("workspace:spawn")) {
    const wakeBtn = el("button", "primary", "Wake it");
    wakeBtn.type = "button";
    wakeBtn.onclick = () => hm.commands.wakeAgent(id);
    open.className = "";
    row.append(wakeBtn);
  }
  row.append(open, canvasBtn);
  card.append(row);
  if (can("workspace:prompt") && hm.supports("prompt") && (m === "idle" || m === "done")) {
    const f = el("form");
    const input = el("input");
    input.placeholder = "Give it work…";
    input.setAttribute("aria-label", `Give ${nameOf(id)} work`);
    const send = el("button", undefined, "Send");
    send.type = "button";
    f.append(input, send);
    f.dataset.tile = id;
    input.value = drafts.get(id) ?? "";
    input.oninput = () => { if (input.value) drafts.set(id, input.value); else drafts.delete(id); };
    const give = async () => {
      const text = input.value.trim();
      if (!text) return;
      const out = await hm.prompt(id, text).catch((e: { code?: string }) => {
        // It fell asleep since the card was drawn: wake it, and keep the words for when it is up.
        if (e?.code === "ASLEEP" && can("workspace:spawn")) { hm.commands.wakeAgent(id); toast(`Waking ${nameOf(id)}. Send again once it is up.`); }
        return "cancelled" as const;
      });
      if (out !== "sent") return;
      drafts.delete(id);
      const now = $(".card").querySelector<HTMLInputElement>(`form[data-tile="${CSS.escape(id)}"] input`);
      if (now) now.value = "";
    };
    // The view's frame may not submit forms (no allow-forms in its sandbox), so Enter and Send are
    // heard directly; a submit that does happen is stopped, never sent twice.
    input.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); void give(); } };
    send.onclick = () => void give();
    f.onsubmit = (e) => e.preventDefault();
    card.append(f);
    if (caret?.tile === id) { input.focus(); input.setSelectionRange(caret.at[0], caret.at[1]); }
  }
  card.hidden = false;
}

// ── a live terminal beside the islands ──────────────────────────────────────
/** With a terminal docked: the open space left of it, as a share of the width, and how far left of
 *  the middle its centre is. */
function openShare(): number {
  const b = $(".dock").getBoundingClientRect();
  return b.width ? Math.max(0.2, (b.left - 16) / innerWidth) : 1;
}
const lead = () => (1 - openShare()) / 2;
function dockRect() {
  const b = $(".dock").getBoundingClientRect();
  return { tileId: docked!, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), chrome: "bar" as const, radius: 12 };
}
function dock(id: string | null): void {
  docked = id;
  $(".dock").toggleAttribute("data-open", !!id);
  document.body.classList.toggle("docked", !!id);
  if (id) hm.commands.selectTile(id);
  hm.setSurfaceRects(id && hm.supports("surfaces") ? [dockRect()] : []);
  refresh();
  wake();
}
/** Fly to an agent; `open` docks its terminal too. */
function go(id: string, open: boolean): void {
  if (!scene.hasAgent(id)) return;
  touched = performance.now();
  pick({ kind: "agent", id });
  // Docked, the agent's island goes in the open space beside the terminal.
  if (open) { dock(id); scene.flyToPlace(id, openShare()); } else scene.flyToAgent(id);
  saveCamera();
}
hm.on("undock", ({ tileId }) => { if (tileId === docked) { docked = null; $(".dock").removeAttribute("data-open"); document.body.classList.remove("docked"); refresh(); } });
hm.onReveal((tileId) => {
  if (!tileOf(tileId)?.agent) return null;
  go(tileId, true);
  const r = dockRect();
  return { x: r.x, y: r.y, w: r.w, h: r.h };
});
function nextCaller(): string | null {
  const order = callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 })));
  if (!order.length) return null;
  const at = order.findIndex((c) => c.tileId === docked);
  const next = order[(at + 1) % order.length]!.tileId;
  go(next, true);
  return next;
}

// ── sound ───────────────────────────────────────────────────────────────────
function toggleSound(on = !soundOn(), save = true): void {
  setSound(on);
  $(".sound").setAttribute("aria-pressed", String(on));
  if (save) saveCamera();
}
$(".sound").addEventListener("click", () => toggleSound());
$(".overview").addEventListener("click", () => { scene.overview(); pick(null); saveCamera(); wake(); });

function saveCamera(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const g = scene.goal;
    hm.setLayout({ camera: { x: +g.x.toFixed(2), z: +g.z.toFixed(2), dist: +g.dist.toFixed(2), yaw: +g.yaw.toFixed(3), pitch: +g.pitch.toFixed(3) }, sound: soundOn() });
  }, 400);
}

// ── pointer and keys: drag to move, right-drag or Shift-drag to turn, wheel to come closer ──
const ndc = (e: { clientX: number; clientY: number }) => [(e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1] as const;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  touched = performance.now();
  drag = { x: e.clientX, y: e.clientY, moved: false, turn: e.button === 2 || e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) { hover(e); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  drag.moved = true;
  canvas.classList.add("dragging");
  const g = scene.goal, v = scene.view;
  if (drag.turn) {
    g.yaw += dx * 0.006; g.pitch = Math.min(1.35, Math.max(0.35, g.pitch + dy * 0.004));
  } else {
    const k = (v.dist / innerHeight) * 1.1;
    const c = Math.cos(g.yaw), s = Math.sin(g.yaw);
    g.x += (-s * dx - c * dy) * k; g.z += (c * dx - s * dy) * k;
  }
  // The land follows the pointer at once; only flights glide.
  Object.assign(v, { x: g.x, z: g.z, yaw: g.yaw, pitch: g.pitch });
  drag.x = e.clientX; drag.y = e.clientY;
  wake();
});
canvas.addEventListener("pointerup", (e) => {
  const was = drag;
  drag = null;
  canvas.classList.remove("dragging");
  if (was && !was.moved) {
    const [nx, ny] = ndc(e);
    const hit = scene.pick(nx, ny);
    if (!hit) { pick(null); return; }
    if (hit.kind === "agent") { scene.flyToAgent(hit.id); pick(hit); if (docked) dock(hit.id); }
    else { scene.flyToIsland(hit.id); pick(hit); }
  }
  saveCamera();
  wake();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  touched = performance.now();
  scene.goal.dist = Math.min(Math.max(10, scene.bounds * 4 + 40), Math.max(9, scene.goal.dist * (1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016)));
  if (scene.reduced) scene.view.dist = scene.goal.dist;
  saveCamera();
  wake();
}, { passive: false });
function hover(e: PointerEvent): void {
  const [nx, ny] = ndc(e);
  const hit = scene.pick(nx, ny);
  const id = hit?.kind === "agent" ? hit.id : null;
  canvas.classList.toggle("over", !!hit);
  const tip = $(".tip");
  if (id !== hovered) { hovered = id; labelsDirty = true; wake(); }
  if (!id) { tip.hidden = true; return; }
  const t = tileOf(id);
  const m = moodOfTile(id);
  tip.textContent = `${nameOf(id)} · ${t?.agent ?? ""} · ${m === "calling" ? callReason(live.get(id)?.agent) : WORDS[m]}`;
  tip.hidden = false;
  tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
}
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea")) return;
  touched = performance.now();
  const g = scene.goal, step = g.dist * 0.08, fx = Math.cos(g.yaw), fz = Math.sin(g.yaw);
  switch (e.key) {
    case "n": case "N": nextCaller(); break;
    case "Escape": if (docked) dock(null); else pick(null); break;
    case "Home": case "0": scene.overview(); break;
    case "ArrowUp": g.x -= fx * step; g.z -= fz * step; break;
    case "ArrowDown": g.x += fx * step; g.z += fz * step; break;
    case "ArrowLeft": g.x -= fz * step; g.z += fx * step; break;
    case "ArrowRight": g.x += fz * step; g.z -= fx * step; break;
    case "+": case "=": g.dist = Math.max(9, g.dist * 0.85); break;
    case "-": g.dist = g.dist * 1.15; break;
    default: return;
  }
  if (scene.reduced) Object.assign(scene.view, scene.goal);
  saveCamera();
  wake();
});

// ── drawing: as often as the person set, and not at all while hidden ───────
(globalThis as unknown as { islandStats: typeof stats }).islandStats = stats;
/** Frames drawn since `slowAt`: when they come too slowly for a while, draw less. */
let slowAt = 0, slowFrames = 0;
function loop(now: number): void {
  running = false;
  if (document.hidden || !hm.visible) { slowAt = 0; return; }
  const cap = Number(hm.settings.frameRate ?? 60);
  if (now - last < 1000 / cap - 2) { wake(); return; }
  const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
  prev = now; last = now;
  const size = `${innerWidth}x${innerHeight}`;
  if (size !== sized) { sized = size; scene.resize(innerWidth, innerHeight); }
  const t0 = performance.now();
  if (!scene.reduced && !drag && !docked && t0 - touched > 20_000) scene.goal.yaw = scene.view.yaw + dt * 0.03;
  const moving = scene.frame(now / 1000, dt, docked ? lead() : 0);
  stats.lots = scene.lots;
  stats.turns = [...turns.values()].reduce((a, b) => a + b, 0);
  placeLabels();
  spent += performance.now() - t0;
  hm.reportFrame();
  frames60++;
  if (now - fpsAt > 1000) { stats.fps = Math.round((frames60 * 1000) / (now - fpsAt)); stats.frameMs = +(spent / Math.max(frames60, 1)).toFixed(2); spent = 0; frames60 = 0; fpsAt = now; stats.calls = scene.drawCalls; stats.quality = scene.quality; stats.triangles = scene.triangles; stats.agents = agents().length; }
  if (!slowAt) { slowAt = now; slowFrames = 0; }
  else if (++slowFrames && now - slowAt > 2500) {
    if ((slowFrames * 1000) / (now - slowAt) < cap * 0.7 && !scene.shedEdges() && scene.quality < 3) scene.setQuality(scene.quality + 1);
    slowAt = 0;
  }
  // With less motion, draw only while something moves.
  if (moving || !scene.reduced) wake(); else { prev = 0; slowAt = 0; }
}
function wake(): void { if (!running) { running = true; requestAnimationFrame(loop); } }

// ── what an agent can ask of it ─────────────────────────────────────────────
hm.onCommand("census", () => {
  const c = census(agents().map((t) => moodOfTile(t.id)));
  return { islands: world?.islands.size ?? 0, agents: agents().length, ...c, turnsToday: [...turns.values()].reduce((a, b) => a + b, 0), lots: scene.lots, callingYou: callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 }))).map((x) => nameOf(x.tileId)) };
});
hm.onCommand("next", () => {
  const id = nextCaller();
  return { docked: id ? nameOf(id) : null };
});
hm.onCommand("show", (a) => {
  const want = String((a as { name?: unknown } | null)?.name ?? "").toLowerCase();
  const t = agents().find((x) => nameOf(x.id).toLowerCase().includes(want));
  if (!want || !t) throw new Error(`no agent is called ${JSON.stringify(want)}`);
  go(t.id, true);
  return { docked: nameOf(t.id) };
});
hm.onCommand("release", () => { dock(null); return { docked: null }; });
hm.onCommand("overview", () => { scene.overview(); pick(null); wake(); return { islands: world?.islands.size ?? 0 }; });
hm.onCommand("island", (a) => {
  const want = String((a as { name?: unknown } | null)?.name ?? "").toLowerCase();
  const isl = [...(world?.islands.values() ?? [])].find((i) => i.title.toLowerCase().includes(want));
  if (!want || !isl) throw new Error(`no island is called ${JSON.stringify(want)}`);
  pick({ kind: "island", id: isl.id });
  scene.flyToIsland(isl.id);
  saveCamera();
  wake();
  const here = [...world!.spots.values()].filter((s) => s.islandId === isl.id && s.agent).map((s) => s.tileId);
  return { island: isl.title, agents: here.length, turns: here.reduce((n, id) => n + (turns.get(id) ?? 0), 0) };
});

motion();
wake();
