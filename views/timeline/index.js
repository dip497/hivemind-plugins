// Today as a timeline: one row per tile, grouped by frame, a bar for each stretch it spent working,
// waiting on you or idle, and a tick for each turn an agent finished. The past comes from the app's
// history (hm.history), so it is there even for hours this view was not open; the present is kept
// live from each tile's status.
import { applyThemeVars, connect } from "@hivemind/view-sdk";
import { extend, minutesIn, span, ticks } from "./lib.js";

const hm = await connect();
applyThemeVars(hm);

const style = document.createElement("style");
// Inks worked out from the theme, each measured over every preset, Harbour and a wallpaper under the
// panels at its brightest: --sub, the second words, reads at 4.5:1 on a panel and on a row under the
// pointer (fg3 alone is 3.4:1 in Solarized Dark); --now, the accent for the now line and its label,
// at 4.5:1 on the axis (the accent alone is 3:1 in Harbour and Signal); the time waiting on you in
// the attention colour drawn a little toward the words' own, at 4.5:1 on the header (Solarized Dark's
// is 4.2:1 there). The panels are the theme's ground at 96%: a theme's wallpaper is drawn behind a
// view with glass off too.
style.textContent = `
  :root { --sub: color-mix(in oklab, var(--hm-color-fg3) 55%, var(--hm-color-fg)); --now: color-mix(in oklab, var(--hm-accent, #8af) 60%, var(--hm-color-fg));
    --paper: color-mix(in srgb, var(--hm-color-bg2) 96%, transparent); }
  html, body { margin: 0; height: 100%; background: transparent; color: var(--hm-color-fg); font: 13px var(--hm-font-ui, system-ui); }
  main { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 18px 22px 76px; box-sizing: border-box; }
  header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 10px; padding: 10px 14px; border-radius: 12px; background: var(--paper); border: 1px solid var(--hm-color-line); }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  .sum { color: var(--sub); font-size: 12px; font-variant-numeric: tabular-nums; }
  .sum b { color: var(--hm-color-fg); font-weight: 600; }
  .sum b.wait { color: color-mix(in oklab, var(--hm-status-attention) 85%, var(--hm-color-fg)); }
  .legend { margin-left: auto; display: flex; gap: 14px; font-size: 11.5px; color: var(--hm-color-fg2); }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; box-sizing: border-box; }
  .chart { position: relative; flex: 1; min-height: 0; overflow-y: auto; border-radius: 12px; background: var(--paper); border: 1px solid var(--hm-color-line); }
  .axis { position: sticky; top: 0; z-index: 2; height: 28px; margin-left: 220px; border-bottom: 1px solid var(--hm-color-line); background: color-mix(in srgb, var(--hm-color-bg2) 96%, transparent); }
  .axis span { position: absolute; top: 8px; transform: translateX(-50%); font-size: 10.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .axis .now-label { top: 7px; transform: none; font-size: 10px; color: var(--now); }
  .group { padding: 6px 0 4px; }
  .group h2 { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px 14px; font-size: 11.5px; font-weight: 600; color: var(--hm-color-fg2); }
  .group h2 i { width: 8px; height: 8px; border-radius: 2px; }
  .row { display: grid; grid-template-columns: 220px 1fr; align-items: center; height: 30px; }
  .row:hover { background: color-mix(in srgb, var(--hm-color-fg) 5%, transparent); }
  .name { display: flex; align-items: center; gap: 8px; padding: 0 14px 0 26px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; font-size: 12.5px; }
  .name svg { width: 14px; height: 14px; flex: none; opacity: .85; }
  .name small { color: var(--sub); font-size: 11px; }
  .track { position: relative; height: 16px; margin-right: 18px; border-radius: 5px; background: color-mix(in srgb, var(--hm-color-fg) 4%, transparent); }
  .seg { position: absolute; top: 0; bottom: 0; border-radius: 4px; min-width: 2px; }
  .seg[data-s="working"] { background: var(--hm-status-working); }
  .seg[data-s="blocked"] { background: var(--hm-status-attention); }
  /* Idle is an empty box and exited a hatched one, each in its tone made to read at 3:1 on the track
     (the tone faded to a third came to 1.6:1): told from working and from each other by their mark. */
  .seg[data-s="idle"], .legend i.idle { box-shadow: inset 0 0 0 2px var(--idle); }
  .seg[data-s="exited"], .legend i.exited { background: repeating-linear-gradient(135deg, var(--exited) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--exited); }
  .seg, .legend i { --idle: color-mix(in oklab, var(--hm-status-idle) 55%, var(--hm-color-fg)); --exited: color-mix(in oklab, var(--hm-status-exited) 55%, var(--hm-color-fg)); }
  .turn { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 1px; background: var(--hm-color-fg); opacity: .8; }
  .now { position: absolute; top: 28px; bottom: 0; width: 1px; background: var(--now); z-index: 1; pointer-events: none; }
  .tip { position: fixed; padding: 4px 8px; border-radius: 6px; background: var(--hm-color-bg3); font-size: 11.5px; pointer-events: none; display: none; z-index: 5; }
  .empty { padding: 40px; color: var(--sub); }
`;
document.head.append(style);
document.body.innerHTML = `<main><header><h1>Today</h1><span class="sum"></span><span class="legend">
  <span><i style="background:var(--hm-status-working)"></i>working</span>
  <span><i style="background:var(--hm-status-attention)"></i>waiting on you</span>
  <span><i class="idle"></i>idle</span>
  <span><i class="exited"></i>exited</span>
  <span><i style="background:var(--hm-color-fg);width:2px"></i>turn finished</span></span></header>
  <div class="chart"><div class="axis"></div><div class="rows"></div><div class="now"></div></div></main><div class="tip"></div>`;
const $ = (s) => document.querySelector(s);

let frames = [], tiles = [];
const names = new Map();
/** Per tile: { name, frameId, agent, icon, intervals, turns } */
const days = new Map();
const watching = new Map();
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} m` : `${Math.round(min)} m`);
const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function entry(id) {
  let e = days.get(id);
  if (!e) days.set(id, (e = { intervals: [], turns: [] }));
  return e;
}

function draw() {
  const now = Date.now();
  const shown = [...days.entries()].filter(([id, d]) => (hm.settings?.everyTile ?? false) || d.agent || tiles.find((t) => t.id === id)?.agent);
  const rows = $(".rows");
  rows.replaceChildren();
  if (!shown.length) { rows.innerHTML = `<p class="empty">No agent has run today yet.</p>`; return; }
  const { from, to } = span(shown.map(([, d]) => d), now);
  const x = (t) => `${((t - from) / (to - from)) * 100}%`;
  const axis = $(".axis");
  axis.replaceChildren(...ticks(from, to).map((t) => { const s = document.createElement("span"); s.style.left = x(t); s.textContent = clock(t); return s; }));
  // The now line's name, on the axis, which stays over the rows as they scroll: a time it would lie on gives way.
  const label = document.createElement("span");
  label.className = "now-label";
  label.textContent = "now";
  label.style.left = `calc((100% - 18px) * ${(now - from) / (to - from)} + 4px)`;
  axis.append(label);
  const at = label.getBoundingClientRect();
  const times = [...axis.children].filter((t) => t !== label);
  const under = times.map((t) => { const b = t.getBoundingClientRect(); return b.right > at.left - 4 && b.left < at.right + 4; });
  times.forEach((t, i) => { t.hidden = under[i]; });
  const byFrame = new Map();
  for (const [id, d] of shown) {
    const live = tiles.find((t) => t.id === id);
    const f = live?.frameId ?? d.frameId ?? null;
    byFrame.set(f, [...(byFrame.get(f) ?? []), [id, d, live]]);
  }
  let working = 0, waiting = 0, turns = 0;
  for (const [frameId, list] of byFrame) {
    const g = document.createElement("section");
    g.className = "group";
    const frame = frames.find((f) => f.id === frameId);
    const h = document.createElement("h2");
    h.innerHTML = `<i></i><span></span>`;
    h.firstChild.style.background = frame?.color ?? "var(--hm-color-fg3)";
    h.lastChild.textContent = frame?.title ?? days.frameTitles?.[frameId] ?? "No frame";
    g.append(h);
    for (const [id, d, live] of list) {
      const m = minutesIn(d.intervals, from, to);
      working += m.working; waiting += m.blocked; turns += d.turns.length;
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("div");
      name.className = "name";
      name.innerHTML = live?.icon ?? "";
      const label = document.createElement("span");
      label.textContent = names.get(id) ?? d.name ?? id;
      const small = document.createElement("small");
      small.textContent = live ? `${fmt(m.working)} working` : "closed";
      name.append(label, small);
      name.onclick = () => hm.commands.selectTile(id);
      const track = document.createElement("div");
      track.className = "track";
      for (const [a, b, s] of d.intervals) {
        if (b < from || s === "unknown") continue;
        const seg = document.createElement("div");
        seg.className = "seg";
        seg.dataset.s = s;
        seg.style.left = x(Math.max(a, from));
        seg.style.width = `calc(${x(b)} - ${x(Math.max(a, from))})`;
        seg.dataset.tip = `${label.textContent}: ${s === "blocked" ? "waiting on you" : s} ${clock(a)}–${clock(b)} (${fmt((b - a) / 60_000)})`;
        track.append(seg);
      }
      for (const t of d.turns) {
        if (t < from) continue;
        const k = document.createElement("div");
        k.className = "turn";
        k.style.left = x(t);
        k.dataset.tip = `${label.textContent} finished a turn at ${clock(t)}`;
        track.append(k);
      }
      row.append(name, track);
      g.append(row);
    }
    rows.append(g);
  }
  const now$ = $(".now");
  now$.style.left = `calc(220px + (100% - 238px) * ${(now - from) / (to - from)})`;
  $(".sum").innerHTML = `<b></b> working · <b class="wait"></b> waiting on you · <b></b> turns finished`;
  const b = $(".sum").querySelectorAll("b");
  b[0].textContent = fmt(working); b[1].textContent = fmt(waiting); b[2].textContent = String(turns);
}

document.addEventListener("pointermove", (e) => {
  const tip = $(".tip");
  const t = e.target.closest?.("[data-tip]");
  if (!t) { tip.style.display = "none"; return; }
  tip.textContent = t.dataset.tip;
  tip.style.display = "block";
  tip.style.left = `${Math.min(e.clientX + 12, innerWidth - 260)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});

function seen(id, status, info) {
  const s = info?.agent?.state === "waiting" ? "blocked" : status;
  const e = entry(id);
  e.intervals = extend(e.intervals, s, info?.since ?? Date.now(), Date.now());
  draw();
}

hm.on("structure", (s) => {
  frames = s.frames; tiles = s.tiles;
  for (const t of tiles) {
    names.set(t.id, t.name);
    Object.assign(entry(t.id), { name: t.name, frameId: t.frameId, agent: t.agent });
    if (!watching.has(t.id)) watching.set(t.id, hm.subscribeStatus(t.id, (st, info) => seen(t.id, st, info)));
  }
  for (const [id, stop] of watching) if (!tiles.some((t) => t.id === id)) { stop(); watching.delete(id); }
  draw();
});
hm.on("names", ({ names: n }) => { for (const [id, v] of Object.entries(n)) names.set(id, v); draw(); });
hm.onEvents(["turn"], (e) => { entry(e.tileId).turns.push(e.at); draw(); });
hm.on("settings", draw);

if (hm.supports("history")) {
  const day = await hm.history(dayKey()).catch(() => null);
  if (day) {
    days.frameTitles = day.frames;
    for (const t of day.tiles) {
      const e = entry(t.id);
      // What happened before this view opened, joined to what it has seen since.
      const live = e.intervals;
      e.intervals = [...t.intervals.map((i) => [...i]), ...live.filter(([a]) => !t.intervals.some(([x, y]) => a >= x && a < y))];
      e.turns = [...new Set([...t.turns, ...e.turns])];
      Object.assign(e, { name: e.name ?? t.name, frameId: e.frameId ?? t.frameId, agent: e.agent ?? t.agent });
    }
    draw();
  }
}
setInterval(() => { if (hm.visible && !document.hidden) draw(); }, 5000);

hm.onCommand("summary", () => [...days.entries()].filter(([, d]) => d.agent).map(([id, d]) => ({
  name: names.get(id) ?? d.name, open: tiles.some((t) => t.id === id), turns: d.turns.length, minutes: minutesIn(d.intervals),
})));
