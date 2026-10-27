// Island: the workspace as an archipelago. Each frame is an island whose land follows its colour, a
// worktree an islet joined by a bridge, and each agent a worker with a workshop and a village: every
// turn it finishes raises its next house a step, so a busy day leaves a town. It works at the house
// it is building, rests by its fire when idle, and stands at its door under a thin light when it is
// calling you. The light follows the clock. Click a worker to open its live terminal beside it.
import { applyThemeVars, connect, type ViewAgent, type ViewAgentStatus, type ViewFrame, type ViewTile, type ViewWidgetBand } from "@hivemind/view-sdk";
import { loadAssets } from "./assets";
import { setupBar } from "./bar";
import { Scene, type Palette } from "./scene";
import { playCall, playDone, setSound, soundOn } from "./sound";
import { TALK, WHO, Walker } from "./walker";
import { LEVEL, POVS, povOf, type Pov } from "./eye";
import { islandInSight, placeNames } from "./names";
import type { Who } from "./assets";
import { LOOSE, TONE, callReason, callers, census, dayOf, daysBefore, howLong, inkOn, layout, moodOf, townTurns, type Mood } from "./world";
import { Starts, startChoices, startTarget, type Target } from "./start";
import { clearLeft } from "./band";

const hm = await connect();
applyThemeVars(hm);
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
/** The toolbar along the bottom (bar.ts), set up once the islands are. */
let bar: ReturnType<typeof setupBar> | null = null;
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
const live = new Map<string, { mood: Mood; since: number; agent?: ViewAgentStatus }>();
const watching = new Map<string, () => void>();
const busy = new Map<string, () => void>();
let world: ReturnType<typeof layout> | null = null;
let picked: { kind: "agent" | "island"; id: string } | null = null;
let docked: string | null = null;
const fresh = new Set<string>();
let first = true;
/** Whether the calls tray is open, or folded to a chip. */
let trayOpen = false;
/** The agents the view's own Start buttons asked for, and the one whose tile opened before the islands
 *  had its worker: the view goes to it once they do (`meet`). */
const starts = new Starts();
let arriving: string | null = null;
/** Each kind of agent's name as the person knows it ("Stand-in", not "standin"), by its id: from the
 *  agents this machine can start, read when the view opens and each time the start menu does. */
const kindLabel = new Map<string, string>();
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
/** You, walking the islands (null while you look from above), as which worker, and the agent beside you. */
let me: Who = "rogue";
let walker: Walker | null = null;
let near: string | null = null;
/** Until when, after you land or change how you see, the walking line says how to walk: until you
 *  first move, turn or drag, or for HOW_FOR. */
const HOW_FOR = 8000;
let howUntil = 0;
/** The walking line's words, and what they were last worked out from: worked out again only when one
 *  of these changes, or (`hintDirty`) an agent's status or name, how you see or whether you walk. */
let hinted = "", hintNear: string | null = null, hintIsland: string | null = null, hintHow = false, hintDirty = true;
/** With a terminal docked, how far left of the middle, as a share of the width, the open space's centre
 *  is: measured when a terminal docks or goes, the window changes size or the widget column comes or
 *  goes, not each frame, where reading the layout would make the browser lay the page out again. */
let lead = 0;
/** While you walk, the line at the bottom: what you can do where you stand, and the switch beside it
 *  between your own eyes and the view from behind. */
const walkRow = $(".walking"), walkLine = $(".walk-hint"), povSwitch = $<HTMLButtonElement>(".pov");
/** Turns each agent finished today, by tile. */
const turns = new Map<string, number>();
/** Turns each agent finished in the six days before today: its town stands on those too. */
let earlier = new Map<string, number>();
const town = () => townTurns(earlier, turns);
const stats = { quality: 0, fps: 0, calls: 0, triangles: 0, agents: 0, frameMs: 0, biomes: [] as string[], lots: [0, 0, 0, 0], hour: 0, turns: 0, gpu: scene.gpu, labels: 0 };


const nameOf = (id: string) => names.get(id) ?? tiles.find((t) => t.id === id)?.name ?? "agent";
const tileOf = (id: string) => tiles.find((t) => t.id === id);
const agents = () => tiles.filter((t) => t.agent);
const moodOfTile = (id: string): Mood => live.get(id)?.mood ?? "idle";
/** Which agent a tile runs, by the name the start menu gives it. */
const kindOf = (agent: string | undefined) => (agent && kindLabel.get(agent)) || agent || "";
const WORDS: Record<Mood, string> = { calling: "calling you", working: "working", failed: "stopped on an error", done: "finished its turn", idle: "ready for work", gone: "closed" };

function rebuild(): void {
  world = layout(frames, tiles);
  const kinds = new Map(tiles.map((t) => [t.id, t.agent]));
  scene.build(world.islands, world.spots, kinds, links);
  stats.biomes = [...world.islands.values()].map((i) => `${i.title} ${i.color} ${i.biome}`);
  for (const [id, s] of live) scene.setMood(id, s.mood), scene.setSubagents(id, s.agent?.subagents ?? 0);
  scene.setTurns(town(), false);
  for (const id of fresh) scene.arrive(id);
  fresh.clear();
  if (first) {
    first = false;
    const saved = hm.hello.layout as { camera?: Partial<typeof scene.goal>; sound?: boolean; walker?: Who; pov?: Pov } | null;
    if (saved?.walker && WHO.includes(saved.walker)) me = saved.walker;
    // Through your own eyes or from behind, as you last walked.
    scene.eye.pov = povOf(saved?.pov);
    showPov();
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
  meet();
  wake();
}

hm.on("structure", (s) => {
  frames = s.frames; tiles = s.tiles;
  links = [...(s.links?.spawns ?? []).map((x) => ({ a: x.parent, b: x.child, kind: "spawn" as const })), ...(s.links?.pipes ?? []).map((x) => ({ a: x.src, b: x.dst, kind: "pipe" as const }))];
  for (const t of tiles) {
    names.set(t.id, names.get(t.id) ?? t.name);
    if (!t.agent || watching.has(t.id)) continue;
    watching.set(t.id, hm.subscribeStatus(t.id, (st, info) => {
      const mood = moodOf(st, info?.agent);
      const before = live.get(t.id);
      live.set(t.id, { mood, since: info?.since ?? (before?.mood === mood ? before.since : Date.now()), agent: info?.agent });
      scene.setMood(t.id, mood);
      scene.setSubagents(t.id, info?.agent?.subagents ?? 0);
      if (mood === "calling" && before && before.mood !== "calling") calledNow(t.id);
      refresh();
      wake();
    }));
    if (hm.supports("activity")) busy.set(t.id, hm.activity(t.id, (level) => { scene.setActivity(t.id, level); }));
  }
  for (const [id, stop] of watching) if (!tiles.some((t) => t.id === id)) { stop(); watching.delete(id); busy.get(id)?.(); busy.delete(id); live.delete(id); }
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

// ── the turns each agent finished this week: one step of its village each ───
const today = () => dayOf(new Date());
/** The six days before today, read once a day: they do not change. */
async function readEarlier(): Promise<Map<string, number>> {
  const days = await Promise.all(daysBefore(new Date()).map((d) => hm.history(d).catch(() => null)));
  const out = new Map<string, number>();
  for (const h of days) for (const t of h?.tiles ?? []) if (t.turns.length) out.set(t.id, (out.get(t.id) ?? 0) + t.turns.length);
  return out;
}
async function readTurns(): Promise<void> {
  if (!hm.supports("history")) return;
  const d = today();
  const h = await hm.history(d).catch(() => null);
  if (!h) return;
  const grow = day === d;
  if (!grow) { turns.clear(); earlier = await readEarlier(); }
  day = d;
  // The day's record and the turns seen live can disagree for a moment; a village never shrinks.
  for (const t of h.tiles) if (t.turns.length > (turns.get(t.id) ?? 0)) turns.set(t.id, t.turns.length);
  countTurns();
  scene.setTurns(town(), grow);
  wake();
}
void readTurns();
setInterval(() => void readTurns(), 5 * 60_000);
function turned(id: string): void {
  if (today() !== day) { void readTurns(); return; }
  turns.set(id, (turns.get(id) ?? 0) + 1);
  countTurns();
  scene.setTurns(town(), true);
}
/** Today's turns over every agent, for the checks: counted when they change, not each frame. */
function countTurns(): void { let n = 0; for (const v of turns.values()) n += v; stats.turns = n; }

if (hm.supports("events")) {
  hm.onEvents(["turn", "needsInput", "tileOpened"], (e) => {
    if (e.kind === "turn" && (!e.outcome || e.outcome === "done")) { scene.burst(e.tileId); turned(e.tileId); playDone(); noteAway("turn"); }
    if (e.kind === "tileOpened" && e.agent) {
      fresh.add(e.tileId);
      if (starts.opened(e)) { arriving = e.tileId; meet(); }
    }
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
  // The calls, the one calling longest first.
  const order = callers(list.map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? Date.now() })));
  bar?.calling(order.length);
  const box = $(".calls");
  box.hidden = order.length === 0;
  box.classList.add("panel");
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
  hintDirty = true;
}
setInterval(() => { if (!$(".calls").hidden) refresh(); }, 30_000);
$(".calls-toggle").addEventListener("click", () => {
  // Folded, there is no room to open them: the count goes to the next one calling, as N does.
  if ($(".calls").classList.contains("folded")) { nextCaller(); return; }
  trayOpen = !trayOpen;
  refresh();
});

/** How wide the calls tray opens, and the least it opens to: `--tray` and `--tray-least` in archipelago.css. */
const TRAY = parseFloat(css("--tray", "")), TRAY_LEAST = parseFloat(css("--tray-least", ""));

/** Where the calls sit: at the top right, clear of the app's buttons in the corner, or with a terminal
 *  docked at the top of the open space left of it. They stay on the header's row where it leaves room for
 *  the tray open, and go under the header where it does not (a narrow window, a long count, a terminal
 *  docked, the widget column pushing the header aside), so they never lie over its words and opening the
 *  tray never moves them; and they keep clear of the widget column and of the card below. Where the room
 *  between the widget column (or the window's edge) and the corner or the terminal is narrower than the
 *  least the tray opens to, they fold to how many are calling, which goes to the next one, and open again
 *  once there is room; where even the count has no room, they go, and the header's count and the
 *  toolbar's bell say it. Measured from the boxes as laid out (offsets, with the widget column's shift
 *  added), not as a move under way draws them. */
function placeCalls(): void {
  const box = $(".calls");
  if (box.hidden) return;
  // With the widget cards down the left, the header and the card move to start where they end (at
  // `clearLeft`, 16px in without them: archipelago.css).
  const head = $(".head"), card = $(".card"), toggle = $(".calls-toggle"), shift = Math.max(0, scene.clearLeft - 16);
  const corner = innerWidth - 60;
  const edge = docked ? $(".dock").getBoundingClientRect().left - 12 : corner;
  const room = edge - (16 + shift);
  const folded = room < TRAY_LEAST;
  const n = $(".calls-list").childElementCount, said = n === 1 ? "1 agent calling you" : `${n} agents calling you`;
  box.classList.remove("away");
  box.classList.toggle("folded", folded);
  box.classList.toggle("open", trayOpen && !folded);
  $(".calls-title").textContent = folded ? String(n) : said;
  // Folded, the count is a button to the next one calling, and the list it would open is not there.
  if (folded) {
    toggle.removeAttribute("aria-expanded");
    toggle.removeAttribute("aria-controls");
    toggle.setAttribute("aria-label", `${said}: go to the next one`);
    toggle.title = `${said}: go to the next one (N)`;
  } else {
    toggle.setAttribute("aria-expanded", String(trayOpen));
    toggle.setAttribute("aria-controls", "calls-list");
    toggle.removeAttribute("aria-label");
    toggle.removeAttribute("title");
  }
  box.style.maxWidth = folded ? "" : `${room}px`;
  const row = box.offsetTop, w = box.offsetWidth;
  if (folded && room < w) { box.classList.add("away"); return; }
  const top = edge - (folded ? w : Math.min(TRAY, room)) >= shift + head.offsetLeft + head.offsetWidth + 12 ? row : head.offsetTop + head.offsetHeight + 10;
  // As far above the foot as it ever was, and above the card where the two share the width.
  let foot = innerHeight - 106;
  const cardLeft = shift + card.offsetLeft;
  if (!card.hidden && cardLeft < edge && cardLeft + card.offsetWidth > edge - w) foot = Math.min(foot, card.offsetTop - 10);
  box.style.maxHeight = `${Math.max(0, foot - top)}px`;
  box.style.transform = `translate(${edge - corner}px, ${top - row}px)`;
}
addEventListener("resize", placeCalls);

function buildLabels(): void {
  // The island name the keyboard is on, to put it back on that island's new name.
  const had = $(".islands").contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : undefined;
  $(".labels").replaceChildren();
  $(".islands").replaceChildren();
  labels = [];
  if (!world) return;
  for (const isl of world.islands.values()) {
    // A button, in the Tab order and read by a screen reader (the agents' names are in a layer hidden
    // from both): it flies to the island and opens its card, as a click on the island does. Hidden from
    // sight until placeLabels finds it room.
    const e = el("button", "label island away");
    e.type = "button";
    e.dataset.id = isl.id;
    const sw = el("i");
    sw.style.background = isl.color;
    e.append(sw, el("span", undefined, isl.title));
    e.append(el("small"));
    e.onclick = () => { touched = performance.now(); scene.flyToIsland(isl.id); pick({ kind: "island", id: isl.id }); saveCamera(); };
    $(".islands").append(e);
    if (isl.id === had) e.focus({ preventScroll: true });
    labels.push({ el: e, at: () => null, kind: "island", id: isl.id });
  }
  for (const t of agents()) {
    const e = el("div", "label agent");
    $(".labels").append(e);
    labels.push({ el: e, at: () => scene.agentAnchor(t.id), kind: "agent", id: t.id });
  }
  labelsDirty = true;
}
/** Where the panels are, for names to keep clear of. Measured when the labels change or the
 *  window does, and at most four times a second otherwise: measuring every frame makes the browser
 *  lay the page out again each time. */
let panels: { x0: number; y0: number; x1: number; y1: number }[] = [];
let panelsAt = -Infinity, panelsFor = "";
/** The top of what stands along the foot of the view: the toolbar, and the walking line over it. */
let foot = Infinity;
function panelRects(): readonly { x0: number; y0: number; x1: number; y1: number }[] {
  const now = performance.now(), size = `${innerWidth}x${innerHeight}`;
  if (!labelsDirty && size === panelsFor && now - panelsAt < 250) return panels;
  panelsAt = now; panelsFor = size;
  panels = [];
  foot = innerHeight;
  for (const p of document.querySelectorAll<HTMLElement>(".head, .bar, .walking:not([hidden]), .calls:not([hidden]), .card:not([hidden]), .dock[data-open]")) {
    const b = p.getBoundingClientRect();
    if (!b.width) continue;
    panels.push({ x0: b.left, x1: b.right, y0: b.top, y1: b.bottom });
    if (p.matches(".bar, .walking")) foot = Math.min(foot, b.top);
  }
  // The widget cards the app floats down the left, as wide as it says they are: a name there would be under them.
  if (scene.clearLeft) panels.push({ x0: 0, x1: scene.clearLeft, y0: 0, y1: innerHeight });
  return panels;
}
// Tabbing onto an island's name shows it, drawing a frame even with less motion.
$(".islands").addEventListener("focusin", () => wake());
$(".islands").addEventListener("focusout", () => wake());
function placeLabels(): void {
  if (!world) return;
  const w = innerWidth, h = innerHeight;
  // One name per island; an agent's only when picked, pointed at, or first in line to be answered.
  const first = callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 })))[0]?.tileId;
  const edges: { id: string; x: number; y: number; a: number; low?: boolean }[] = [];
  const right = docked ? w - Math.min(w * 0.46, 640) - 32 : w;
  const want: { l: Label; x: number; y: number; prio: number; keep?: boolean }[] = [];
  // Through your own eyes, the way you would turn your head, not the map's.
  const eyes = !!walker && scene.eye.inside;
  // Names fade once the islands are too small to read them by. The name of the island you stand on
  // fades as you go into your eyes: from there it would hang in the sky over you, and the header and
  // the walking line say where you are (`hintIsland`, worked out for the walking line this frame).
  const fade = Math.max(0, Math.min(1, (260 - scene.view.dist) / 100));
  const under = walker ? hintIsland : null, mine = fade * (1 - scene.eye.blend);
  // The window and the widget column the app floats down its left edge; the island name the keyboard is on.
  const room = { w, h, left: scene.clearLeft }, focus = document.activeElement;
  for (const l of labels) {
    const p = l.kind === "agent" ? l.at() : null;
    const s = l.kind === "agent" ? p && scene.screenOf(p, w, h, 24) : (() => { const a = scene.islandLabelAt(l.id, w, h); return a && { ...a, inside: islandInSight(a, room) }; })();
    if (l.kind === "agent") {
      const m = moodOfTile(l.id);
      const show = picked?.id === l.id || hovered === l.id || l.id === first;
      if (labelsDirty) {
        l.el.className = `label agent${m === "calling" ? " calling" : ""}${picked?.id === l.id ? " picked" : ""}`;
        l.el.replaceChildren(nameOf(l.id));
        if (m === "calling") l.el.append(el("span", undefined, ` · ${callReason(live.get(l.id)?.agent)}`));
        l.size = undefined;
      }
      const inView = !!s && s.inside && s.x < right;
      // Through your eyes, its worker in the picture: close up, its name can stand above the top of
      // the picture; it stays, at the top.
      const seen = eyes && !inView && (show || m === "calling") && scene.inSight(l.id);
      const above = seen && !!s && s.y < 24 && s.x >= 24 && s.x <= Math.min(right, w - 24);
      if (show && s && (inView || above)) {
        const prio = picked?.id === l.id ? 0 : hovered === l.id ? 1 : 1.2;
        // From afar, above its pin, not over it.
        want.push({ l, x: s.x, y: scene.nameOverPin(l.id, s.y, h), prio });
      }
      // Through your eyes, no arrow for an agent you can see or one beside you.
      const there = seen || (eyes && !!walker && !!p && Math.hypot(p.x - walker.x, p.z - walker.z) < TALK);
      if (m === "calling" && !inView && !above && !there) {
        // Out of sight: an arrow on the edge, pointing at it.
        const a = scene.agentAnchor(l.id)!;
        if (eyes) {
          // Ahead, the way it lies on screen; behind you, on the left or right edge, low down, the
          // short way round.
          const b = scene.bearing(a);
          if (Number.isNaN(b)) {
            const dx = a.x - walker!.x, dz = a.z - walker!.z, yaw = scene.view.yaw;
            edges.push({ id: l.id, x: 0, y: 0, a: dx * Math.sin(yaw) - dz * Math.cos(yaw) >= 0 ? 0 : Math.PI, low: true });
          } else edges.push({ id: l.id, x: 0, y: 0, a: b });
        } else {
          const dx = a.x - scene.view.x, dz = a.z - scene.view.z, yaw = scene.view.yaw;
          const sx = dx * Math.sin(yaw) - dz * Math.cos(yaw), sy = -dx * Math.cos(yaw) - dz * Math.sin(yaw);
          edges.push({ id: l.id, x: sx, y: sy, a: Math.atan2(sy, sx) });
        }
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
        l.el.setAttribute("aria-label", `${isl?.title ?? ""}, ${small.textContent}`);
        l.size = undefined;
      }
      // The name the keyboard is on shows, whole, wherever its island is, and over another name where it
      // has no room: where it stands while it has no focus, so focus does not move it.
      const keep = l.el === focus, f = keep ? 1 : l.id === under ? mine : fade;
      if (keep || (s && s.inside && s.x < right && f > 0)) want.push({ l, x: s?.x ?? w / 2, y: s?.y ?? 0, prio: 1.5, keep });
      if (l.el.style.opacity !== String(f)) l.el.style.opacity = String(f);
    }
  }
  // Most important first; a name that would cover another, or the panels, waits for room (names.ts).
  want.sort((a, b) => a.prio - b.prio);
  for (const c of want) if (!c.l.size) { if (c.l.kind === "agent") c.l.el.style.display = "block"; c.l.size = { w: c.l.el.offsetWidth, h: c.l.el.offsetHeight }; }
  const at = placeNames(want.map((c) => ({ x: c.x, y: c.y, w: c.l.size!.w, h: c.l.size!.h, island: c.l.kind === "island", keep: c.keep })), panelRects(), { ...room, w: right });
  const shown = new Set<Label>();
  want.forEach((c, i) => {
    const to = at[i];
    if (!to) return;
    shown.add(c.l);
    if (c.l.kind === "agent") c.l.el.style.display = "block";
    c.l.el.style.transform = `translate(${to.x}px, ${to.y}px) translate(-50%, -100%)`;
  });
  // An island's name with no room is only hidden from sight: it stays a button in the Tab order and for
  // a screen reader, and shows once the keyboard is on it.
  for (const l of labels) if (l.kind === "island") l.el.classList.toggle("away", !shown.has(l)); else if (!shown.has(l)) l.el.style.display = "none";
  labelsDirty = false;
  stats.labels = shown.size;
  // Edge arrows, clear of the header and calls at the top, of the walking line and the toolbar at the
  // foot, and of the widget cards down the left (an arrow is 34 across).
  const box = $(".edges"), left = scene.clearLeft;
  const top = 96, bottom = Math.min(h - 28, foot - 12 - 17), cx = (left + right) / 2, cy = (top + bottom) / 2, rx = Math.max(0, (right - left) / 2 - 64), ry = Math.max(0, (bottom - top) / 2);
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
    if (e.low) b.style.transform = `translate(${cx + Math.cos(e.a) * rx}px, ${bottom - (bottom - top) / 6}px)`;
    else b.style.transform = `translate(${cx + Math.cos(e.a) * k}px, ${cy - Math.sin(e.a) * k}px)`;
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
  // The button the keyboard is on: every status change draws the card again, and focus goes back to
  // the same button on the new card rather than out of the view.
  const key = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
  const refocus = () => { if (key) card.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }); };
  card.classList.add("panel");
  if (!picked || !world) { card.hidden = true; return; }
  if (picked.kind === "island") {
    const isl = world.islands.get(picked.id);
    if (!isl) { card.hidden = true; return; }
    const crew = [...world.spots.values()].filter((s) => s.islandId === isl.id && s.agent);
    const here = crew.map((s) => moodOfTile(s.tileId));
    const c = census(here);
    const h3 = el("h3");
    const sw = el("i");
    sw.style.cssText = `width:10px;height:10px;border-radius:3px;background:${isl.color}`;
    h3.append(sw, isl.title);
    card.replaceChildren(h3, el("p", undefined, [`${here.length} agent${here.length === 1 ? "" : "s"}`, c.working && `${c.working} working`, c.calling && `${c.calling} calling you`, isl.subtitle].filter(Boolean).join(" · ")));
    // Its agents, each a button that flies to it and opens its card, as a click on its worker does: the
    // keyboard's way to an agent that is not calling. Their changes are not read out each time.
    if (crew.length) {
      const list = el("ul", "agents");
      list.setAttribute("aria-label", `Agents on ${isl.title}`);
      list.setAttribute("aria-live", "off");
      for (const { tileId } of crew) {
        const m = moodOfTile(tileId), b = el("button"), dot = el("i");
        b.type = "button";
        b.dataset.key = `agent:${tileId}`;
        dot.style.background = css(`--hm-status-${TONE[m]}`, "#888");
        b.append(dot, el("b", undefined, nameOf(tileId)), el("span", undefined, m === "calling" ? callReason(live.get(tileId)?.agent) : WORDS[m]));
        // Its card takes this one's place: the keyboard goes on to its first button.
        b.onclick = () => { go(tileId, false); if (picked?.id === tileId) card.querySelector<HTMLElement>(".row button")?.focus({ preventScroll: true }); };
        const li = el("li");
        li.append(b);
        list.append(li);
      }
      card.append(list);
    }
    const row = el("div", "row");
    if (can("workspace:spawn") && isl.id !== LOOSE) {
      const b = el("button", "primary", "Start an agent here");
      b.type = "button";
      b.dataset.key = "start";
      b.onclick = () => startAgent(null, isl.id);
      row.append(b);
    }
    if (isl.id !== LOOSE) { const f = el("button", undefined, "Select the frame"); f.type = "button"; f.dataset.key = "frame"; f.onclick = () => hm.commands.selectFrame(isl.id); row.append(f); }
    card.append(row);
    card.hidden = false;
    refocus();
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
  mood.append(dot, m === "calling" ? callReason(info?.agent) : WORDS[m]);
  const p = el("p");
  p.append(mood, ` · ${kindOf(t.agent)}${info?.agent?.subagents ? ` · ${info.agent.subagents} helper${info.agent.subagents === 1 ? "" : "s"}` : ""}`);
  card.replaceChildren(h3, p);
  const row = el("div", "row");
  const open = el("button", m === "calling" ? "call" : "primary", docked === id ? "Close its terminal" : m === "calling" ? "Answer in its terminal" : "Open its terminal");
  open.type = "button";
  open.dataset.key = "open";
  open.onclick = () => dock(docked === id ? null : id);
  const canvasBtn = el("button", undefined, "Show it on the canvas");
  canvasBtn.type = "button";
  canvasBtn.dataset.key = "canvas";
  canvasBtn.onclick = () => hm.commands.focusTile(id);
  row.append(open, canvasBtn);
  card.append(row);
  if (can("workspace:prompt") && hm.supports("prompt") && (m === "idle" || m === "done")) {
    const f = el("form");
    const input = el("input");
    input.placeholder = "Give it work…";
    input.setAttribute("aria-label", `Give ${nameOf(id)} work`);
    const send = el("button", undefined, "Send");
    send.type = "button";
    send.dataset.key = "send";
    f.append(input, send);
    f.dataset.tile = id;
    input.value = drafts.get(id) ?? "";
    input.oninput = () => { if (input.value) drafts.set(id, input.value); else drafts.delete(id); };
    const give = async () => {
      const text = input.value.trim();
      if (!text) return;
      const out = await hm.prompt(id, text).catch(() => "cancelled" as const);
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
  refocus();
}

// ── a live terminal beside the islands ──────────────────────────────────────
/** With a terminal docked: the open space left of it, clear of the widget cards the app stacks
 *  down the left edge, as shares of the width from the left. */
function openSpace(): { from: number; to: number } {
  const b = $(".dock").getBoundingClientRect(), from = scene.clearLeft / Math.max(1, innerWidth);
  return b.width ? { from, to: (b.left - 16) / innerWidth } : { from, to: 1 };
}
const openShare = () => { const o = openSpace(); return Math.max(0.2, o.to - o.from); };
/** Measures how far left of the middle the open space's centre is (`lead`). */
function measureLead(): void { if (docked) { const o = openSpace(); lead = 0.5 - (o.from + o.to) / 2; } else lead = 0; }
addEventListener("resize", measureLead);
function dockRect() {
  const b = $(".dock").getBoundingClientRect();
  return { tileId: docked!, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), chrome: "bar" as const, radius: 12 };
}
function dock(id: string | null): void {
  docked = id;
  $(".dock").toggleAttribute("data-open", !!id);
  document.body.classList.toggle("docked", !!id);
  measureLead();
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
hm.on("undock", ({ tileId }) => { if (tileId === docked) { docked = null; $(".dock").removeAttribute("data-open"); document.body.classList.remove("docked"); measureLead(); refresh(); } });
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

// ── starting an agent ───────────────────────────────────────────────────────
/** Starts `agent` (null: the person's default) on the island `frameId` (null: where the app chooses),
 *  from the toolbar's menu or an island's card, and remembers it: a new worker is a few pixels among
 *  the houses, so the view goes to it once its tile opens. */
function startAgent(agent: string | null, frameId: string | null): void {
  starts.ask(agent, frameId);
  hm.commands.spawnAgent(agent, frameId);
}
/** Goes to the agent just started, once its worker is on the islands: flies to it with its card open,
 *  where Open its terminal is; walking, opens its card where you are. */
function meet(): void {
  if (!arriving || !scene.hasAgent(arriving)) return;
  const id = arriving;
  arriving = null;
  if (walker) pick({ kind: "agent", id });
  else go(id, false);
}
/** The agents this machine can start, and each one's name kept for the cards (`kindLabel`). */
async function agentList(): Promise<ViewAgent[]> {
  const list = hm.supports("agents") ? await hm.agents().catch(() => []) : [];
  if (list.some((a) => kindLabel.get(a.id) !== a.label)) {
    for (const a of list) kindLabel.set(a.id, a.label);
    refresh();
  }
  return list;
}

// ── sound ───────────────────────────────────────────────────────────────────
function toggleSound(on = !soundOn(), save = true): void {
  setSound(on);
  $(".sound").setAttribute("aria-pressed", String(on));
  if (save) saveCamera();
}
$(".sound").addEventListener("click", () => toggleSound());
/** Every island in sight: walking, that is flying back up, as Esc and Home do. */
function seeAll(): void {
  if (walker) { walk(false); return; }
  scene.overview(); pick(null); saveCamera(); wake();
}
$(".overview").addEventListener("click", seeAll);

function saveCamera(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const g = scene.goal;
    hm.setLayout({ camera: { x: +g.x.toFixed(2), z: +g.z.toFixed(2), dist: +g.dist.toFixed(2), yaw: +g.yaw.toFixed(3), pitch: +g.pitch.toFixed(3) }, sound: soundOn(), walker: me, pov: scene.eye.pov });
  }, 400);
}

// ── pointer and keys: drag to move, right-drag or Shift-drag to turn, wheel to come closer ──
const ndc = (e: { clientX: number; clientY: number }) => [(e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1] as const;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  touched = performance.now();
  // Walking, you are where the camera looks: a drag turns it round you, or turns your head.
  drag = { x: e.clientX, y: e.clientY, moved: false, turn: e.button === 2 || e.shiftKey || !!walker };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) { hover(e); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    // The world turns under the pointer: the tip for what it was over goes until it moves on its own.
    drag.moved = true;
    canvas.classList.add("dragging");
    $(".tip").hidden = true;
    howUntil = 0;
  }
  const g = scene.goal, v = scene.view;
  if (drag.turn && walker && scene.eye.pov === "first") {
    // Through your eyes: left and right turn you, up and down look up and down (a drag down looks
    // down, as from behind it looks down more steeply). A drag mostly sideways only turns you: its
    // wobble does not tip your look.
    g.yaw += dx * 0.006;
    if (Math.abs(dy) > Math.abs(dx) / 2) scene.eye.look(-dy * 0.004);
  } else if (drag.turn) {
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
  // Through your own eyes there is no distance to change.
  if (walker && scene.eye.pov === "first") return;
  const d = scene.goal.dist * (1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016);
  scene.goal.dist = walker ? Math.min(22, Math.max(5, d)) : Math.min(Math.max(10, scene.bounds * 4 + 40), Math.max(9, d));
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
  tip.textContent = `${nameOf(id)} · ${kindOf(t?.agent)} · ${m === "calling" ? callReason(live.get(id)?.agent) : WORDS[m]}`;
  tip.hidden = false;
  tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
}
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea")) return;
  touched = performance.now();
  if (walker && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (walker.press(e.key, true, e.shiftKey)) { e.preventDefault(); wake(); return; }
    switch (e.key) {
      case "e": case "E": talk(); return;
      // On a button (the toolbar's, the switch by the walking line) Enter presses it, and only that.
      case "Enter": if (!(e.target as HTMLElement).closest("button")) talk(); return;
      // Once a press: a key held past the repeat delay changes nothing more.
      case "v": case "V": if (!e.repeat) see(); return;
      case "c": case "C": if (!e.repeat) walk(true, WHO[(WHO.indexOf(walker.who) + 1) % WHO.length]); return;
      // Closer or further from behind you, as the wheel does, within the same bounds; through your
      // eyes there is no distance to change.
      case "+": case "=": case "-": {
        if (scene.eye.pov === "first") return;
        const g = scene.goal;
        g.dist = Math.min(22, Math.max(5, g.dist * (e.key === "-" ? 1.15 : 0.85)));
        if (scene.reduced) scene.view.dist = g.dist;
        saveCamera();
        wake();
        return;
      }
      case "Escape": if (docked) dock(null); else walk(false); return;
      case "Home": case "0": walk(false); return;
    }
  }
  const g = scene.goal, step = g.dist * 0.08, fx = Math.cos(g.yaw), fz = Math.sin(g.yaw);
  switch (e.key) {
    case "n": case "N": nextCaller(); break;
    case "j": case "J": walk(true); break;
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
(globalThis as unknown as { archipelagoStats: typeof stats }).archipelagoStats = stats;
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
  if (walker) {
    // ← and → through your eyes: you and the view turn together.
    const turn = walker.turn(dt);
    if (turn) { scene.goal.yaw += turn; scene.view.yaw += turn; howUntil = 0; }
    walker.step(dt, scene.view.yaw, scene);
    if (scene.eye.inside) {
      // Your body turns with your head, as it will be when you step back out of your eyes; walking on
      // with no drag, your look comes back toward level.
      walker.face(scene.view.yaw);
      if (walker.moving && !drag) scene.eye.settle(dt);
    }
    walkHint();
  }
  else if (!scene.reduced && !drag && !docked && t0 - touched > 20_000) scene.goal.yaw = scene.view.yaw + dt * 0.03;
  const moving = scene.frame(now / 1000, dt, lead);
  stats.lots = scene.lots;
  placeLabels();
  spent += performance.now() - t0;
  hm.reportFrame();
  frames60++;
  if (now - fpsAt > 1000) { stats.fps = Math.round((frames60 * 1000) / (now - fpsAt)); stats.frameMs = +(spent / Math.max(frames60, 1)).toFixed(2); spent = 0; frames60 = 0; fpsAt = now; stats.calls = scene.drawCalls; stats.quality = scene.quality; stats.triangles = scene.triangles; stats.agents = agents().length; }
  if (!slowAt) { slowAt = now; slowFrames = 0; }
  else if (++slowFrames && now - slowAt > 2500) {
    if ((slowFrames * 1000) / (now - slowAt) < cap * 0.7 && scene.quality < 3) scene.setQuality(scene.quality + 1);
    slowAt = 0;
  }
  // With less motion, draw only while something moves.
  if (moving || !scene.reduced || walker?.active) wake(); else { prev = 0; slowAt = 0; }
}
function wake(): void { if (!running) { running = true; requestAnimationFrame(loop); } }

// ── walking the islands yourself ────────────────────────────────────────────
document.addEventListener("keyup", (e) => { if (walker?.press(e.key, false, e.shiftKey)) wake(); });
addEventListener("blur", () => walker?.release());
/** Lands you on the islands, in front of the agent picked (clicked, or the next calling you) or on the
 *  island in the middle of the view, or (false) takes you back up above them; `pov` says whether you
 *  see through your own eyes or from behind. */
function walk(on: boolean, who?: Who, pov?: Pov): { walking: boolean; who: Who; island: string | null; pov: Pov } {
  if (who) me = who;
  if (pov) see(pov, false);
  if (on && !walker) {
    // With an agent picked (clicked, or the next calling you), in front of it; else on the island in view.
    const by = picked?.kind === "agent" ? scene.landingBy(picked.id) : null;
    const at = by ?? scene.landing(scene.goal.x, scene.goal.z);
    if (at) {
      walker = new Walker(me); walker.place(at.x, at.z); pick(null);
      scene.eye.pitch = LEVEL;
      howUntil = performance.now() + HOW_FOR;
      if (by) {
        // Facing it, near enough to talk.
        const to = Math.atan2(at.z - by.to.z, at.x - by.to.x);
        scene.goal.yaw += Math.atan2(Math.sin(to - scene.goal.yaw), Math.cos(to - scene.goal.yaw));
        if (scene.reduced) scene.view.yaw = scene.goal.yaw;
      } else if (scene.eye.pov === "first") {
        // Through your own eyes, facing the agent first in line to be answered, or with none calling
        // the nearest, turned aside only as far as open ground asks.
        const first = callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 })))[0]?.tileId;
        let to: { x: number; z: number } | undefined, d = Infinity;
        for (const a of scene.workersAt()) {
          const e = a.tileId === first ? -1 : Math.hypot(a.x - at.x, a.z - at.z);
          if (e < d) { d = e; to = { x: a.x, z: a.z }; }
        }
        scene.goal.yaw = scene.lookout(at.x, at.z, scene.goal.yaw, to);
        if (scene.reduced) scene.view.yaw = scene.goal.yaw;
      }
    }
  } else if (!on && walker) {
    walker = null;
    near = null;
    hovered = null;
    scene.walk(null);
    scene.overview();
  }
  if (walker) { walker.who = me; walker.eyes = scene.eye.pov === "first"; scene.walk(walker); }
  document.documentElement.dataset.walk = walker ? "on" : "";
  const walkButton = $(".walk");
  walkButton.setAttribute("aria-pressed", String(!!walker));
  // Pressed, it is the way back up.
  walkButton.title = walker ? "Fly back up (Esc)" : "Walk the islands yourself (J)";
  hintDirty = true;
  walkHint();
  labelsDirty = true;
  saveCamera();
  wake();
  const island = walker ? scene.islandAt(walker.x, walker.z) : null;
  return { walking: !!walker, who: me, island: island ? world?.islands.get(island)?.title ?? null : null, pov: scene.eye.pov };
}
/** Through your own eyes (first person) or from behind (third): `pov`, or the other one than now. Kept
 *  for the next time you walk. */
function see(pov?: Pov, save = true): Pov {
  if (pov) scene.eye.pov = pov; else scene.eye.toggle();
  if (walker) { walker.eyes = scene.eye.pov === "first"; howUntil = performance.now() + HOW_FOR; }
  showPov();
  labelsDirty = true;
  hintDirty = true;
  walkHint();
  if (save) saveCamera();
  wake();
  return scene.eye.pov;
}
function showPov(): void {
  povSwitch.setAttribute("aria-checked", String(scene.eye.pov === "first"));
  // For the pointer: through your eyes a drag turns your head, not the world under a hand.
  document.documentElement.dataset.pov = scene.eye.pov;
}
povSwitch.addEventListener("click", () => see());
/** Talks to the agent beside you (its live terminal opens), or, where none is, opens the island you stand on. */
function talk(): void {
  if (!walker) return;
  if (near) {
    // Through your eyes, you turn to face it: beside its terminal, you see who you answer.
    const a = scene.agentAnchor(near);
    if (a && scene.eye.pov === "first") {
      const g = scene.goal, to = Math.atan2(walker.z - a.z, walker.x - a.x);
      g.yaw += Math.atan2(Math.sin(to - g.yaw), Math.cos(to - g.yaw));
      if (scene.reduced) scene.view.yaw = g.yaw;
    }
    pick({ kind: "agent", id: near });
    dock(near);
    return;
  }
  const isl = scene.islandAt(walker.x, walker.z);
  if (isl) pick({ kind: "island", id: isl });
}
/** How to walk, through your eyes and from behind: the keys and the drag, and how to stop walking
 *  (V is on the switch beside it). */
const HOW: Record<Pov, string> = {
  first: "WASD to walk · drag or ←→ to look round · Shift to run · Esc to fly up",
  third: "WASD or arrows to walk · drag to look round · Shift to run · Esc to fly up",
};
/** The line at the bottom: how to walk, just after you land or change how you see; then who you can
 *  talk to here, or what E does where you stand. */
function walkHint(): void {
  if (!walker) { walkRow.hidden = true; hinted = ""; return; }
  const was = near;
  near = walker.nearest(scene.workersAt());
  if (near !== was) { hovered = near; labelsDirty = true; }
  if (walker.moving) howUntil = 0;
  const how = performance.now() < howUntil, isl = scene.islandAt(walker.x, walker.z);
  if (hintDirty || near !== hintNear || isl !== hintIsland || how !== hintHow) {
    hintDirty = false; hintNear = near; hintIsland = isl; hintHow = how;
    const text = how ? HOW[scene.eye.pov]
      : near ? `E · talk to ${nameOf(near)}, ${moodOfTile(near) === "calling" ? callReason(live.get(near)?.agent) : WORDS[moodOfTile(near)]}`
      : isl && can("workspace:spawn") ? `E · start an agent on ${world?.islands.get(isl)?.title ?? "this island"}`
      : HOW[scene.eye.pov];
    if (text !== hinted) { walkLine.textContent = text; hinted = text; }
  }
  if (walkRow.hidden) walkRow.hidden = false;
}
$(".walk").addEventListener("click", () => walk(!walker));

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
hm.onCommand("overview", () => { seeAll(); return { islands: world?.islands.size ?? 0 }; });
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

// Widgets the app shows over the view sit in a column down the left edge (`"widgets": "left"` in
// hivemind-view.json), so the terminal docks on the right clear of them. The header and the agent's
// card move beside them, and the overview, the names and the walking line keep clear of them: of as
// wide a strip as the app says they take (`widgetBand`, protocol 1.18), however many columns they
// stack into, or of one column wherever a widget sits on a card, from an app that does not say.
let band: ViewWidgetBand | null = null, cards = false;
function widgetsMoved(): void {
  const clear = clearLeft(band, cards);
  if (clear === scene.clearLeft) return;
  scene.clearLeft = clear;
  document.documentElement.style.setProperty("--clear-left", `${clear}px`);
  document.body.classList.toggle("widgets", clear > 0);
  labelsDirty = true;
  measureLead();
  placeCalls();
  if (docked) scene.flyToPlace(docked, openShare());
  // Reframed only while looking at every island, not while walking or flown in close.
  else if (!walker && !picked) { scene.overview(); saveCamera(); }
  wake();
}
if (hm.supports("widgetBand")) hm.onWidgetBand((b) => { band = b; widgetsMoved(); });
else if (hm.supports("widgets")) hm.onWidgets((ws) => { cards = ws.some((w) => w.card); widgetsMoved(); });

/** The island a new agent goes on: the one picked, the picked agent's, the one you walk on, else, a
 *  guess, the one in view. */
function islandForNew(): Target | null {
  if (!world) return null;
  const chosen = picked?.kind === "island" ? picked.id
    : picked?.kind === "agent" ? [...world.spots.values()].find((sp) => sp.tileId === picked!.id)?.islandId
    : walker ? scene.islandAt(walker.x, walker.z) : null;
  return startTarget(world.islands, chosen, scene.islandInView());
}
bar = setupBar({
  hm, nextCaller: () => { nextCaller(); },
  where: () => { const target = islandForNew(); return { target, choices: startChoices(world?.islands.values() ?? [], target) }; },
  start: startAgent, agents: agentList,
  // The card, the terminal and the walking line moved with the plank's height: the calls keep above the
  // card, the app draws the terminal where the dock now is, and the names and the edge arrows measure
  // the panels again (`panelRects`, whose `foot` the arrows keep above) on the next frame.
  cleared: () => { placeCalls(); if (docked) hm.setSurfaceRects([dockRect()]); panelsAt = -Infinity; wake(); },
});
refresh();
// The names of the kinds of agent, for the cards, before anyone opens the start menu.
void agentList();

motion();
wake();
hm.onCommand("walk", (a) => {
  const o = (a ?? {}) as { on?: unknown; who?: unknown; pov?: unknown };
  const who = typeof o.who === "string" && WHO.includes(o.who as Who) ? (o.who as Who) : undefined;
  if (o.who !== undefined && !who) throw new Error(`who is one of ${WHO.join(", ")}`);
  const pov = POVS.find((p) => p === o.pov);
  if (o.pov !== undefined && !pov) throw new Error(`pov is one of ${POVS.join(", ")}`);
  // Asked as whom or how to see, you walk; asked nothing, it switches between walking and not.
  return walk(o.on !== undefined ? o.on !== false : who || pov ? true : !walker, who, pov);
});
