// Current: the workspace as water. Each agent is a spring; while it works, its work runs down a
// stream, as much as its terminal is busy, meets the others of its frame and reaches you, the lake at
// the bottom. A finished turn sends a bright wave down. An agent calling you dams its stream: the
// water backs up into a pool that grows the longer it waits. Click a spring to open its live terminal.
import { applyThemeVars, connect, type ViewAgentStatus, type ViewFrame, type ViewTile } from "@hivemind/view-sdk";
import { playCall, playDone, setSound, soundOn } from "./sound";
import { LOOSE, TONE, along, callReason, callers, census, howLong, landscape, moodOf, poolRadius, type Mood, type Pt } from "./flow";

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
const canvas = $<HTMLCanvasElement>("canvas.water");
const g = canvas.getContext("2d")!;
const still = document.createElement("canvas");
const sg = still.getContext("2d")!;

// ── settings and colours ────────────────────────────────────────────────────
const systemCalm = matchMedia("(prefers-reduced-motion: reduce)");
let calm = false;
function motion(): void {
  const m = String(hm.settings.motion ?? "system");
  calm = m === "less" || (m === "system" && systemCalm.matches);
  document.documentElement.dataset.motion = calm ? "less" : "full";
  if (calm) clearParticles();
  dirty = true;
  wake();
}
systemCalm.addEventListener("change", motion);
let dark = true;
const ink: Record<string, string> = {};
function colours(): void {
  const mode = hm.hello.theme.mode ?? (css("--hm-mode", "dark") === "light" ? "light" : "dark");
  dark = mode !== "light";
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  for (const t of ["working", "attention", "idle", "exited", "failed", "done"]) ink[t] = css(`--hm-status-${t}`, "#888888");
  ink.accent = css("--hm-accent", "#6366f1");
  ink.fg = css("--hm-color-fg", dark ? "#e6e9ef" : "#1d2430");
  ink.water = dark ? "#5ec8ff" : "#1f8fd1";
}
colours();

// ── the workspace ───────────────────────────────────────────────────────────
let frames: ViewFrame[] = [], tiles: ViewTile[] = [];
let links: { a: string; b: string; kind: "spawn" | "pipe" }[] = [];
const names = new Map<string, string>();
const live = new Map<string, { mood: Mood; since: number; agent?: ViewAgentStatus }>();
const level = new Map<string, number>();
const flow = new Map<string, number>();
const watching = new Map<string, () => void>();
const busy = new Map<string, () => void>();
let land: ReturnType<typeof landscape> | null = null;
let picked: string | null = null, docked: string | null = null, hovered: string | null = null;
let dirty = true, turnsToday = 0, lakeGlow = 0;
const stats = { fps: 0, agents: 0, particles: 0, frameMs: 0 };
(globalThis as unknown as { currentStats: typeof stats }).currentStats = stats;

const nameOf = (id: string) => names.get(id) ?? tiles.find((t) => t.id === id)?.name ?? "agent";
const tileOf = (id: string) => tiles.find((t) => t.id === id);
const agents = () => tiles.filter((t) => t.agent);
const moodOfTile = (id: string): Mood => live.get(id)?.mood ?? "idle";
const WORDS: Record<Mood, string> = { calling: "calling you", working: "working", failed: "stopped on an error", done: "finished its turn", idle: "ready for work", gone: "closed" };
const TOP = 96;

function relayout(): void {
  land = landscape(frames, tiles, links, innerWidth, innerHeight, TOP);
  paintStill();
  buildLabels();
  refresh();
  dirty = true;
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
      if (mood === "calling" && before && before.mood !== "calling") { playCall(); $(".sr").textContent = `${nameOf(t.id)} ${callReason(info?.agent)}.`; }
      if (mood === "done" && before?.mood === "working") wave(t.id);
      refresh();
      dirty = true;
      wake();
    }));
    if (hm.supports("activity")) busy.set(t.id, hm.activity(t.id, (l) => { level.set(t.id, l); dirty = true; }));
  }
  for (const [id, stop] of watching) if (!tiles.some((t) => t.id === id)) { stop(); watching.delete(id); busy.get(id)?.(); busy.delete(id); live.delete(id); level.delete(id); }
  if (docked && !tiles.some((t) => t.id === docked)) dock(null);
  relayout();
});
hm.on("names", ({ names: n }) => { for (const [id, v] of Object.entries(n)) names.set(id, v); buildLabels(); refresh(); });
hm.on("theme", () => { applyThemeVars(hm); colours(); paintStill(); dirty = true; wake(); });
hm.on("settings", () => motion());
hm.on("resize", () => { if (docked) hm.setSurfaceRects([dockRect()]); relayout(); });
hm.on("visibility", () => wake());
document.addEventListener("visibilitychange", wake);
if (hm.supports("events")) hm.onEvents(["turn"], (e) => { if (e.kind === "turn" && (!e.outcome || e.outcome === "done")) { turnsToday++; wave(e.tileId); playDone(); refresh(); } });
if (hm.supports("history")) {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  hm.history(day).then((h) => { turnsToday += h.tiles.reduce((n, t) => n + t.turns.length, 0); refresh(); }).catch(() => undefined);
}

// ── water ───────────────────────────────────────────────────────────────────
const CAP = 5000;
const P = { route: new Int32Array(CAP), t: new Float32Array(CAP), speed: new Float32Array(CAP), size: new Float32Array(CAP), bright: new Float32Array(CAP), off: new Float32Array(CAP), live: new Uint8Array(CAP) };
/** Each route a path water runs along: a spring's stream (`s:<tile>`) or a canal (`c:<n>`). */
let routes: { key: string; path: Pt[]; length: number; colour: string }[] = [];
let routeIndex = new Map<string, number>();
let next = 0;
function clearParticles(): void { P.live.fill(0); }
function emit(route: number, speed: number, size: number, bright: number, t = 0): void {
  const i = next;
  next = (next + 1) % CAP;
  P.route[i] = route; P.t[i] = t; P.speed[i] = speed; P.size[i] = size; P.bright[i] = bright; P.off[i] = (Math.random() - 0.5) * 2; P.live[i] = 1;
}
/** A finished turn: a bright wave down its stream. */
function wave(id: string): void {
  if (calm) return;
  const r = routeIndex.get(`s:${id}`);
  if (r === undefined) return;
  for (let k = 0; k < 36; k++) emit(r, 160 + Math.random() * 40, 2.6, 1, -k * 0.006);
}

function paintStill(): void {
  if (!land) return;
  const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  for (const c of [canvas, still]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  sg.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The ground.
  const bg = sg.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, dark ? "#0e1626" : "#f6f2e9");
  bg.addColorStop(1, dark ? "#091019" : "#ece5d6");
  sg.fillStyle = bg;
  sg.fillRect(0, 0, w, h);
  // Each basin, tinted its frame's colour, with contour lines like a map.
  for (const b of land.basins.values()) {
    const cx = b.x + b.w / 2, cy = TOP + (h - TOP) * 0.22;
    const tint = sg.createRadialGradient(cx, cy, 10, cx, cy, Math.max(b.w * 0.75, 160));
    tint.addColorStop(0, hexA(b.color, dark ? 0.16 : 0.18));
    tint.addColorStop(1, hexA(b.color, 0));
    sg.fillStyle = tint;
    sg.fillRect(b.x - 80, TOP - 40, b.w + 160, (h - TOP) * 0.7);
    sg.strokeStyle = hexA(b.color, dark ? 0.16 : 0.22);
    sg.lineWidth = 1;
    const seed = hashOf(b.frameId);
    for (let ring = 1; ring <= 6; ring++) {
      sg.beginPath();
      const rx = Math.min(b.w * 0.48, 60 + ring * b.w * 0.075), ry = 26 + ring * (h - TOP) * 0.045;
      for (let k = 0; k <= 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const wob = 1 + 0.08 * Math.sin(a * 3 + seed + ring) + 0.05 * Math.sin(a * 5 - seed * 0.7 + ring * 2);
        const x = cx + Math.cos(a) * rx * wob, y = cy + Math.sin(a) * ry * wob;
        k ? sg.lineTo(x, y) : sg.moveTo(x, y);
      }
      sg.stroke();
    }
  }
  // Riverbeds: every stream's bed, then the lake.
  sg.lineCap = "round"; sg.lineJoin = "round";
  for (const s of land.springs.values()) {
    sg.strokeStyle = dark ? "rgba(120,160,200,0.10)" : "rgba(60,110,150,0.12)";
    sg.lineWidth = 7;
    stroke(sg, s.path);
  }
  const L = land.lake;
  const lake = sg.createRadialGradient(L.x, L.y, 10, L.x, L.y, 260);
  lake.addColorStop(0, dark ? "rgba(40,110,170,0.55)" : "rgba(70,160,215,0.45)");
  lake.addColorStop(1, dark ? "rgba(40,110,170,0)" : "rgba(70,160,215,0)");
  sg.fillStyle = lake;
  sg.beginPath();
  sg.ellipse(L.x, L.y + 10, 300, 70, 0, 0, Math.PI * 2);
  sg.fill();
  sg.strokeStyle = dark ? "rgba(120,190,240,0.35)" : "rgba(40,120,180,0.35)";
  sg.lineWidth = 1.2;
  sg.beginPath();
  sg.ellipse(L.x, L.y + 10, 220, 46, 0, 0, Math.PI * 2);
  sg.stroke();
  // Routes the water runs along.
  routes = [];
  routeIndex = new Map();
  for (const s of land.springs.values()) { routeIndex.set(`s:${s.tileId}`, routes.length); routes.push({ key: `s:${s.tileId}`, path: s.path, length: s.length, colour: ink.water! }); }
  land.canals.forEach((c, i) => { routeIndex.set(`c:${i}`, routes.length); routes.push({ key: `c:${i}`, path: c.path, length: c.length, colour: c.kind === "pipe" ? ink.accent! : ink.working! }); });
  clearParticles();
}
function stroke(c: CanvasRenderingContext2D, path: Pt[]): void {
  c.beginPath();
  path.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.stroke();
}
function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x888888;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function hashOf(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h % 1000) / 100; }

// ── each frame ──────────────────────────────────────────────────────────────
function draw(now: number, dt: number): boolean {
  if (!land) return false;
  const t = now / 1000, w = innerWidth, h = innerHeight;
  g.clearRect(0, 0, w, h);
  g.drawImage(still, 0, 0, w, h);
  g.lineCap = "round"; g.lineJoin = "round";
  let moving = false;
  // How much water runs in each stream eases toward how busy its agent is.
  for (const s of land.springs.values()) {
    const m = moodOfTile(s.tileId);
    const want = m === "working" ? 0.35 + (level.get(s.tileId) ?? 1) * 0.22 : 0;
    const f = flow.get(s.tileId) ?? 0;
    const nf = calm ? want : f + (want - f) * Math.min(1, dt * 2);
    flow.set(s.tileId, nf);
    if (Math.abs(nf - want) > 0.01) moving = true;
    if (nf > 0.02) {
      g.strokeStyle = hexA(ink.water!, (dark ? 0.22 : 0.28) * nf + 0.05);
      g.lineWidth = 2 + nf * 5;
      stroke(g, s.path);
    }
    // Water leaves a working spring, as fast as its terminal is busy.
    if (!calm && m === "working" && Math.random() < (2 + (level.get(s.tileId) ?? 1) * 5) * dt) emit(routeIndex.get(`s:${s.tileId}`)!, 70 + Math.random() * 50, 1.4 + Math.random() * 1.2, 0.55);
  }
  // Canals between agents: dashed, with what flows along them.
  g.setLineDash([5, 6]);
  for (const c of land.canals) {
    g.strokeStyle = hexA(c.kind === "pipe" ? ink.accent! : ink.working!, 0.5);
    g.lineWidth = 1.4;
    g.lineDashOffset = calm ? 0 : -t * 18;
    stroke(g, c.path);
  }
  g.setLineDash([]);
  if (!calm) land.canals.forEach((c, i) => { if (Math.random() < 0.9 * dt) emit(routeIndex.get(`c:${i}`)!, 90, 2.2, 0.8); });
  // The water itself.
  let count = 0;
  g.globalCompositeOperation = dark ? "lighter" : "source-over";
  for (let i = 0; i < CAP; i++) {
    if (!P.live[i]) continue;
    const r = routes[P.route[i]!];
    if (!r) { P.live[i] = 0; continue; }
    P.t[i]! += (P.speed[i]! * dt) / r.length;
    if (P.t[i]! >= 1) { P.live[i] = 0; if (r.key.startsWith("s:")) lakeGlow = Math.min(1, lakeGlow + 0.012 * P.bright[i]!); continue; }
    if (P.t[i]! < 0) continue;
    count++;
    const p = along(r.path, r.length, P.t[i]!);
    const spread = 2.2 * Math.sin(P.t[i]! * 40 + P.off[i]! * 3) * P.off[i]!;
    g.fillStyle = P.bright[i]! >= 1 ? (dark ? "#fff6c8" : "#e0a400") : r.colour;
    g.globalAlpha = 0.35 + P.bright[i]! * 0.6;
    const s = P.size[i]!;
    g.fillRect(p.x + spread - s / 2, p.y - s / 2, s, s);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  stats.particles = count;
  if (count) moving = true;
  // The lake: you.
  lakeGlow *= Math.exp(-dt * 0.6);
  if (lakeGlow > 0.01) {
    const L = land.lake;
    const glow = g.createRadialGradient(L.x, L.y, 4, L.x, L.y, 180);
    glow.addColorStop(0, hexA(ink.water!, 0.35 * lakeGlow));
    glow.addColorStop(1, hexA(ink.water!, 0));
    g.fillStyle = glow;
    g.beginPath(); g.ellipse(L.x, L.y + 10, 240, 60, 0, 0, Math.PI * 2); g.fill();
    moving = true;
  }
  // Springs, and the pools of those calling you.
  for (const s of land.springs.values()) {
    const m = moodOfTile(s.tileId), c = ink[TONE[m]] ?? "#888";
    const { x, y } = s.at;
    if (m === "calling") {
      const since = live.get(s.tileId)?.since ?? Date.now();
      const r = poolRadius(Date.now() - since);
      const pool = g.createRadialGradient(x, y, 2, x, y, r);
      pool.addColorStop(0, hexA(c, 0.55));
      pool.addColorStop(0.7, hexA(c, 0.22));
      pool.addColorStop(1, hexA(c, 0));
      g.fillStyle = pool;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      // Pressure: rings pushing out against the dam.
      for (let k = 0; k < (calm ? 1 : 2); k++) {
        const ph = calm ? 0.6 : ((t * 0.7 + k * 0.5) % 1);
        g.strokeStyle = hexA(c, (1 - ph) * 0.8);
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 9 + ph * r, 0, Math.PI * 2); g.stroke();
      }
      // The dam, just below.
      g.strokeStyle = c; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x - 9, y + r * 0.55 + 6); g.lineTo(x + 9, y + r * 0.55 + 6); g.stroke();
      moving = true;
    } else if (m === "working" && !calm) {
      const ph = (t * 1.1 + hashOf(s.tileId)) % 1;
      g.strokeStyle = hexA(c, (1 - ph) * 0.6); g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 7 + ph * 16, 0, Math.PI * 2); g.stroke();
    } else if ((m === "idle" || m === "done") && !calm) {
      const ph = ((t + hashOf(s.tileId)) / 3) % 1;
      g.strokeStyle = hexA(c, (1 - ph) * 0.35); g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 7 + ph * 10, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = m === "gone" ? "transparent" : c;
    g.strokeStyle = m === "gone" ? hexA(ink.fg!, 0.4) : dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.9)";
    g.lineWidth = 2;
    if (m === "gone") g.setLineDash([3, 3]);
    g.beginPath(); g.arc(x, y, s.tileId === picked || s.tileId === hovered ? 8.5 : 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.setLineDash([]);
    if (s.tileId === picked) { g.strokeStyle = ink.accent!; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.stroke(); }
  }
  placeLabels();
  return moving || !calm;
}

// ── the header, calls, names ────────────────────────────────────────────────
function refresh(): void {
  const list = agents();
  const c = census(list.map((t) => moodOfTile(t.id)));
  const sum = $(".sum");
  sum.replaceChildren(`${list.length} agent${list.length === 1 ? "" : "s"} · ${c.working} working`);
  if (c.calling) { sum.append(" · "); sum.append(el("b", undefined, `${c.calling} calling you`)); }
  if (c.failed) sum.append(` · ${c.failed} stopped`);
  $(".lake-label small").textContent = `${turnsToday} turn${turnsToday === 1 ? "" : "s"} reached you today`;
  const order = callers(list.map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? Date.now() })));
  const box = $(".calls");
  box.hidden = order.length === 0;
  $(".calls-title").textContent = order.length === 1 ? "1 agent calling you" : `${order.length} agents calling you`;
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
    b.append(icon, who, el("time", undefined, howLong(Date.now() - since)));
    b.onclick = () => { pick(tileId); dock(tileId); };
    li.append(b);
    return li;
  }));
  paintCard();
  labelsDirty = true;
}
setInterval(() => { if (!$(".calls").hidden) refresh(); }, 30_000);

let labels: { el: HTMLElement; id: string; kind: "basin" | "agent"; size?: { w: number; h: number } }[] = [];
let labelsDirty = true;
function buildLabels(): void {
  $(".labels").replaceChildren();
  labels = [];
  if (!land) return;
  for (const b of land.basins.values()) {
    const e = el("div", "label basin");
    const sw = el("i");
    sw.style.background = b.color;
    e.append(sw, el("span", undefined, b.title));
    if (b.subtitle) e.append(el("small", undefined, b.subtitle));
    e.style.transform = `translate(${b.x + b.w / 2}px, ${TOP + 8}px) translate(-50%, -100%)`;
    $(".labels").append(e);
    labels.push({ el: e, id: b.frameId, kind: "basin" });
  }
  for (const t of agents()) {
    const e = el("div", "label agent");
    $(".labels").append(e);
    labels.push({ el: e, id: t.id, kind: "agent" });
  }
  labelsDirty = true;
}
function placeLabels(): void {
  if (!land) return;
  const few = agents().length <= 30;
  const want: { l: (typeof labels)[number]; x: number; y: number; prio: number }[] = [];
  for (const l of labels) {
    if (l.kind !== "agent") continue;
    const s = land.springs.get(l.id);
    if (!s) continue;
    const m = moodOfTile(l.id);
    if (labelsDirty) {
      l.el.className = `label agent${m === "calling" ? " calling" : ""}${l.id === picked ? " picked" : ""}`;
      l.el.replaceChildren(nameOf(l.id));
      if (m === "calling") l.el.append(el("span", undefined, ` · ${callReason(live.get(l.id)?.agent)}`));
      l.size = undefined;
    }
    if (!(m === "calling" || l.id === picked || l.id === hovered || few)) continue;
    const lift = m === "calling" ? poolRadius(Date.now() - (live.get(l.id)?.since ?? Date.now())) * 0.6 + 12 : 14;
    const prio = l.id === picked ? 0 : l.id === hovered ? 1 : m === "calling" ? 2 + (live.get(l.id)?.since ?? 0) / 1e13 : 4;
    want.push({ l, x: s.at.x, y: s.at.y - lift, prio });
  }
  labelsDirty = false;
  // Most important first; a name that would cover one already placed waits for room.
  want.sort((a, b) => a.prio - b.prio);
  const placed = labels.filter((l) => l.kind === "basin").map((l) => l.el.getBoundingClientRect()).map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }));
  const shown = new Set<HTMLElement>();
  for (const c of want) {
    if (!c.l.size) { c.l.el.style.display = "block"; c.l.size = { w: c.l.el.offsetWidth, h: c.l.el.offsetHeight }; }
    const r = { x0: c.x - c.l.size.w / 2 - 3, x1: c.x + c.l.size.w / 2 + 3, y0: c.y - c.l.size.h - 2, y1: c.y + 2 };
    if (c.prio > 0 && placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
    placed.push(r);
    shown.add(c.l.el);
    c.l.el.style.display = "block";
    c.l.el.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -100%)`;
  }
  for (const l of labels) if (l.kind === "agent" && !shown.has(l.el)) l.el.style.display = "none";
}

// ── the card ────────────────────────────────────────────────────────────────
function pick(id: string | null): void { picked = id; labelsDirty = true; paintCard(); dirty = true; wake(); }
function paintCard(): void {
  const card = $(".card");
  const t = picked ? tileOf(picked) : undefined;
  if (!picked || !t) { card.hidden = true; return; }
  const id = picked, m = moodOfTile(id), info = live.get(id);
  const h3 = el("h3");
  const icon = el("span", "icon");
  if (t.icon) icon.innerHTML = t.icon;
  h3.append(icon, nameOf(id));
  const mood = el("span", "mood");
  const dot = el("i");
  dot.style.background = ink[TONE[m]] ?? "#888";
  mood.append(dot, m === "calling" ? `${callReason(info?.agent)} · ${howLong(Date.now() - (info?.since ?? Date.now()))}` : WORDS[m]);
  const p = el("p");
  const basin = land?.springs.get(id)?.frameId;
  p.append(mood, ` · ${t.agent}${basin && basin !== LOOSE ? ` · ${frames.find((f) => f.id === basin)?.title ?? ""}` : ""}`);
  card.replaceChildren(h3, p);
  const row = el("div", "row");
  const open = el("button", m === "calling" ? "call" : "primary", docked === id ? "Close its terminal" : m === "calling" ? "Answer in its terminal" : "Open its terminal");
  open.type = "button";
  open.onclick = () => dock(docked === id ? null : id);
  const onCanvas = el("button", undefined, "Show it on the canvas");
  onCanvas.type = "button";
  onCanvas.onclick = () => hm.commands.focusTile(id);
  row.append(open, onCanvas);
  card.append(row);
  if (can("workspace:prompt") && hm.supports("prompt") && (m === "idle" || m === "done")) {
    const f = el("form");
    const input = el("input");
    input.placeholder = "Give it work…";
    input.setAttribute("aria-label", `Give ${nameOf(id)} work`);
    const send = el("button", undefined, "Send");
    send.type = "submit";
    f.append(input, send);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const out = await hm.prompt(id, text).catch(() => "cancelled" as const);
      if (out === "sent") input.value = "";
    };
    card.append(f);
  }
  card.hidden = false;
}

// ── a live terminal beside the water ────────────────────────────────────────
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
}
hm.on("undock", ({ tileId }) => { if (tileId === docked) { docked = null; $(".dock").removeAttribute("data-open"); document.body.classList.remove("docked"); refresh(); } });
hm.onReveal((tileId) => {
  if (!tileOf(tileId)?.agent) return null;
  pick(tileId);
  dock(tileId);
  const r = dockRect();
  return { x: r.x, y: r.y, w: r.w, h: r.h };
});
function nextCaller(): string | null {
  const order = callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 })));
  if (!order.length) return null;
  const at = order.findIndex((c) => c.tileId === docked);
  const id = order[(at + 1) % order.length]!.tileId;
  pick(id);
  dock(id);
  return id;
}

// ── sound, pointer, keys ────────────────────────────────────────────────────
function toggleSound(on = !soundOn(), save = true): void {
  setSound(on);
  $(".sound").setAttribute("aria-pressed", String(on));
  if (save) hm.setLayout({ sound: on }, { now: true });
}
$(".sound").addEventListener("click", () => toggleSound());
if ((hm.hello.layout as { sound?: boolean } | null)?.sound) toggleSound(true, false);
function springAt(x: number, y: number): string | null {
  if (!land) return null;
  let best: string | null = null, bd = 18;
  for (const s of land.springs.values()) { const d = Math.hypot(s.at.x - x, s.at.y - y); if (d < bd) { bd = d; best = s.tileId; } }
  return best;
}
canvas.addEventListener("pointermove", (e) => {
  const id = springAt(e.clientX, e.clientY);
  canvas.classList.toggle("over", !!id);
  const tip = $(".tip");
  if (id !== hovered) { hovered = id; labelsDirty = true; dirty = true; wake(); }
  if (!id) { tip.hidden = true; return; }
  const m = moodOfTile(id);
  tip.textContent = `${nameOf(id)} · ${tileOf(id)?.agent ?? ""} · ${m === "calling" ? callReason(live.get(id)?.agent) : WORDS[m]}`;
  tip.hidden = false;
  tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
});
canvas.addEventListener("click", (e) => {
  const id = springAt(e.clientX, e.clientY);
  pick(id);
  if (id && docked) dock(id);
});
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea")) return;
  if (e.key === "n" || e.key === "N") nextCaller();
  else if (e.key === "Escape") { if (docked) dock(null); else pick(null); }
});

// ── drawing ─────────────────────────────────────────────────────────────────
let running = false, prev = 0, last = 0, count = 0, at = 0, spent = 0;
function loop(now: number): void {
  running = false;
  if (document.hidden || !hm.visible) return;
  const cap = Number(hm.settings.frameRate ?? 60);
  if (now - last < 1000 / cap - 2) { wake(); return; }
  const dt = Math.min(0.1, prev ? (now - prev) / 1000 : 0.016);
  prev = now; last = now;
  const t0 = performance.now();
  const moving = draw(now, dt);
  spent += performance.now() - t0;
  dirty = false;
  hm.reportFrame();
  count++;
  if (now - at > 1000) { stats.fps = Math.round((count * 1000) / (now - at)); stats.frameMs = +(spent / Math.max(count, 1)).toFixed(2); stats.agents = agents().length; count = 0; spent = 0; at = now; }
  if (moving || dirty) wake(); else prev = 0;
}
function wake(): void { if (!running) { running = true; requestAnimationFrame(loop); } }
setInterval(() => { if (calm) { dirty = true; wake(); } }, 5000);

// ── what an agent can ask of it ─────────────────────────────────────────────
hm.onCommand("census", () => {
  const c = census(agents().map((t) => moodOfTile(t.id)));
  return { agents: agents().length, ...c, turnsToday, callingYou: callers(agents().map((t) => ({ tileId: t.id, mood: moodOfTile(t.id), since: live.get(t.id)?.since ?? 0 }))).map((x) => ({ name: nameOf(x.tileId), waiting: howLong(Date.now() - x.since) })) };
});
hm.onCommand("next", () => { const id = nextCaller(); return { docked: id ? nameOf(id) : null }; });
hm.onCommand("show", (a) => {
  const want = String((a as { name?: unknown } | null)?.name ?? "").toLowerCase();
  const t = agents().find((x) => nameOf(x.id).toLowerCase().includes(want));
  if (!want || !t) throw new Error(`no agent is called ${JSON.stringify(want)}`);
  pick(t.id);
  dock(t.id);
  return { docked: nameOf(t.id) };
});
hm.onCommand("release", () => { dock(null); return { docked: null }; });

motion();
wake();
