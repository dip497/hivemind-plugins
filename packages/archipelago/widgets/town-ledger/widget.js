// What each project got done this week, as the towns of Archipelago: every turn its agents finished
// in the last seven days counts (today's shown on its own), its town grows from a well to a
// windmill, a church and a castle at the counts the view raises its keep, and a project that has
// gone quiet says for how long. It reads the workspace's history, its live turns and which agents
// are at work or calling you through hive.hm, and needs no permission.
const TOWNS = [
  { at: 24, name: "castle" },
  { at: 12, name: "church" },
  { at: 4, name: "windmill" },
  { at: 0, name: "well" },
];
const DAYS = 7;
/** Quiet this many days or more, a project says so. */
const QUIET = 2;
/** Each frame's title, and which frame each agent tile is in. @type {Map<string, { id: string, title: string, parentId?: string }>} */
const frames = new Map();
/** @type {Map<string, string | null>} */
const frameOf = new Map();
/** Turns by frame for each of the last seven days, today first: today's counted live as well.
 *  @type {Map<string, number>[]} */
let perDay = Array.from({ length: DAYS }, () => new Map());
/** Whether the app watched each of those days, today first: a day it never ran is not a quiet one.
 *  Today is watched, as it runs now. @type {boolean[]} */
let watched = Array.from({ length: DAYS }, (_, i) => i === 0);
let day = "";
/** Agents at work or calling you now, from their status. @type {Set<string>} */
const busy = new Set();
/** Each agent's status subscription, by tile. @type {Map<string, () => void>} */
const watching = new Map();

/** @param {Date} d */
const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** @param {number} turns */
const townOf = (turns) => /** @type {{ at: number, name: string }} */ (TOWNS.find((t) => turns >= t.at));
/** @param {number} turns */
const nextOf = (turns) => [...TOWNS].reverse().find((t) => t.at > turns);
/** A worktree counts for the project it was made from, as its islet is joined to it. @param {string} frameId */
const projectOf = (frameId) => {
  let f = frames.get(frameId);
  while (f && f.parentId && frames.has(f.parentId)) f = frames.get(f.parentId);
  return f ? f.id : frameId;
};

function ledger() {
  /** Per project: turns each day, today first. @type {Map<string, number[]>} */
  const sum = new Map();
  for (const f of frames.values()) if (!f.parentId) sum.set(f.id, Array(DAYS).fill(0));
  perDay.forEach((m, i) => { for (const [f, n] of m) { const p = projectOf(f); const row = sum.get(p); if (row) row[i] += n; } });
  const stirring = new Set([...busy].map((id) => projectOf(frameOf.get(id) ?? "")));
  return [...sum]
    .map(([f, days]) => {
      const turns = days.reduce((a, b) => a + b, 0), town = townOf(turns), next = nextOf(turns);
      const last = days.findIndex((n) => n > 0);
      return {
        project: /** @type {{ title: string }} */ (frames.get(f)).title, turns, today: days[0] ?? 0, town: town.name,
        next: next ? { town: next.name, turnsToGo: next.at - turns } : null,
        // The days since its last finished turn that the app watched. Not quiet while one of its
        // agents works or calls you; with no turn on record this week, it cannot say (null).
        quietDays: stirring.has(f) ? 0 : last < 0 ? null : watched.slice(0, last).filter(Boolean).length,
      };
    })
    .sort((a, b) => b.turns - a.turns || a.project.localeCompare(b.project));
}

/** How a town grows, in the turns each step takes: "a windmill at 4, a church at 12, a castle at 24". */
const STEPS = TOWNS.filter((t) => t.at).reverse().map((t) => `a ${t.name} at ${t.at}`).join(", ");

function draw() {
  const rows = ledger();
  const most = Number(hive.options.shown ?? 4);
  /** The card's picture, the castle a town grows to (its icon's, drawn to read on a card), and what
   *  it counts, with a line under that when there is one. @param {string} [line] */
  const head = (line) => ({ type: "row", children: [
    { type: "image", src: "castle.svg", w: 36, h: 36, label: "Town ledger" },
    { type: "stack", children: [
      { type: "text", text: "Turns finished this week", wrap: true },
      ...(line ? [{ type: "text", text: line, muted: true, wrap: true }] : []),
    ] },
  ] });
  if (!rows.length) {
    hive.render({ type: "stack", children: [head("No projects yet. Open a folder and its town is founded.")] });
    return;
  }
  // Every project at none would be rows of wells that all read the same: one line says how they grow.
  if (rows.every((r) => !r.turns)) {
    hive.render({ type: "stack", children: [head(`None yet. Each turn an agent finishes builds its project's town up from a well: ${STEPS}.`)] });
    return;
  }
  /** @type {any[]} */
  const children = [head()];
  for (const r of rows.slice(0, most)) {
    // The name has its line to itself; the rest goes on the label under it, which wraps.
    const week = `${r.turns} ${r.turns === 1 ? "turn" : "turns"}`;
    const quiet = r.quietDays !== null && r.quietDays >= QUIET ? ` · quiet for ${r.quietDays} days` : "";
    children.push({ type: "row", children: [
      { type: "image", src: `${r.town}.svg`, w: 36, h: 36, label: `A ${r.town}` },
      { type: "stack", children: [
        { type: "text", text: r.today ? `${r.project} · +${r.today} today` : r.project },
        r.next
          ? { type: "meter", value: r.turns, max: r.turns + r.next.turnsToGo, label: `${week} · ${r.next.turnsToGo} more to a ${r.next.town}${quiet}` }
          : { type: "text", text: `${week} · a castle${quiet}`, muted: true, wrap: true },
      ] },
    ] });
  }
  const more = rows.length - most;
  if (more > 0) children.push({ type: "text", text: `and ${more} more ${more === 1 ? "town" : "towns"}`, muted: true });
  hive.render({ type: "stack", children });
}

/** Turns by frame in one day's history. @param {{ tiles: { frameId: string | null, turns: number[] }[] }} history */
function count(history) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const t of history.tiles) if (t.turns.length && t.frameId) out.set(t.frameId, (out.get(t.frameId) ?? 0) + t.turns.length);
  return out;
}

/** Whether the app watched any of a day: some of it lies outside the spans its history says it did
 *  not (`gaps`; one with a `tileId` is that tile's machine offline, not the app). A history that
 *  gives no spans is taken as watched.
 *  @param {{ from?: number, to?: number, gaps?: { from: number, to: number, tileId?: string }[] }} history */
function watchedOn(history) {
  const { from, to, gaps } = history;
  if (!Array.isArray(gaps) || typeof from !== "number" || typeof to !== "number") return true;
  let at = from;
  for (const g of gaps.filter((x) => !x.tileId).sort((a, b) => a.from - b.from)) { if (g.from > at) break; at = Math.max(at, g.to); }
  return at < Math.min(to, Date.now());
}

/** Reads the days of the week again. A count never goes down: the history can trail the turns seen
 *  live by a little, so the larger of the two stands. @param {boolean} all the six days before too */
async function read(all) {
  const now = new Date(), d = dayOf(now);
  if (d !== day) { day = d; perDay = Array.from({ length: DAYS }, () => new Map()); watched = Array.from({ length: DAYS }, (_, i) => i === 0); all = true; }
  const names = Array.from({ length: all ? DAYS : 1 }, (_, i) => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  /** @param {string} x @returns {Promise<{ turns: Map<string, number>, watched: boolean }>} */
  const one = async (x) => { try { const h = await hive.hm.history(x); return { turns: count(h), watched: watchedOn(h) }; } catch { return { turns: new Map(), watched: false }; } };
  const got = await Promise.all(names.map(one));
  if (day !== d) return;
  got.forEach(({ turns, watched: w }, i) => {
    const into = /** @type {Map<string, number>} */ (perDay[i]);
    for (const [f, n] of turns) if (n > (into.get(f) ?? 0)) into.set(f, n);
    if (i) watched[i] = w;
  });
  draw();
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ frames: fs, tiles }) => {
    frames.clear();
    for (const f of fs) frames.set(f.id, f);
    frameOf.clear();
    for (const t of tiles) if (t.agent) frameOf.set(t.id, t.frameId);
    for (const [id, stop] of watching) if (!frameOf.has(id)) { stop(); watching.delete(id); busy.delete(id); }
    for (const id of frameOf.keys()) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (/** @type {string} */ s, /** @type {any} */ info) => {
      const state = info && info.agent && info.agent.state;
      const now = s === "working" || s === "blocked" || state === "working" || state === "waiting";
      if (now === busy.has(id)) return;
      if (now) busy.add(id); else busy.delete(id);
      draw();
    }));
    draw();
  });
  hive.hm.onEvents(["turn"], (e) => {
    if (e.outcome && e.outcome !== "done") return;
    if (dayOf(new Date()) !== day) void read(true);
    const f = frameOf.get(e.tileId), today = /** @type {Map<string, number>} */ (perDay[0]);
    if (f) { today.set(f, (today.get(f) ?? 0) + 1); draw(); }
  });
  void read(true);
  // Today's again shortly after opening, where the history trailed, then every few minutes.
  setTimeout(() => void read(false), 15_000);
  setInterval(() => void read(false), 5 * 60_000);
});

hive.hm.onCommand("ledger", () => ledger());
