// What each project got done this week, as the towns of Archipelago: every turn its agents finished
// in the last seven days counts, and its town grows from a well to a windmill, a church and a castle
// at the same counts the view raises its keep. It reads the workspace's history and its live turns
// through hive.hm and needs no permission.
const TOWNS = [
  { at: 24, name: "castle" },
  { at: 12, name: "church" },
  { at: 4, name: "windmill" },
  { at: 0, name: "well" },
];
const DAYS = 7;
/** Each frame's title, and which frame each agent tile is in. */
/** @type {Map<string, { id: string, title: string, parentId?: string }>} */
const frames = new Map();
/** @type {Map<string, string | null>} */
const frameOf = new Map();
/** Turns by frame: the six days before today, read once a day, and today's, counted live. */
/** @type {Map<string, number>} */
let earlier = new Map();
/** @type {Map<string, number>} */
let today = new Map();
let day = "";

/** @param {Date} d */
const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** @param {number} turns */
const townOf = (turns) => /** @type {{ at: number, name: string }} */ (TOWNS.find((t) => turns >= t.at));
/** @param {number} turns */
const nextOf = (turns) => [...TOWNS].reverse().find((t) => t.at > turns);
/** A worktree counts for the project it was made from, as its islet is joined to it. */
/** @param {string} frameId */
const projectOf = (frameId) => {
  let f = frames.get(frameId);
  while (f && f.parentId && frames.has(f.parentId)) f = frames.get(f.parentId);
  return f ? f.id : frameId;
};

function ledger() {
  /** @type {Map<string, number>} */
  const sum = new Map();
  for (const m of [earlier, today]) for (const [f, n] of m) { const p = projectOf(f); sum.set(p, (sum.get(p) ?? 0) + n); }
  for (const f of frames.values()) if (!f.parentId && !sum.has(f.id)) sum.set(f.id, 0);
  return [...sum]
    .filter(([f]) => frames.has(f))
    .map(([f, turns]) => {
      const town = townOf(turns), next = nextOf(turns);
      return { project: /** @type {{ title: string }} */ (frames.get(f)).title, turns, town: town.name, next: next ? { town: next.name, turnsToGo: next.at - turns } : null };
    })
    .sort((a, b) => b.turns - a.turns || a.project.localeCompare(b.project));
}

function draw() {
  const rows = ledger();
  const most = Number(hive.options.shown ?? 4);
  if (!rows.length) {
    hive.render({ type: "stack", children: [{ type: "text", text: "No projects yet. Open a folder and its town is founded.", muted: true, wrap: true }] });
    return;
  }
  /** @type {any[]} */
  const children = rows.slice(0, most).flatMap((r) => [
      { type: "row", children: [
        { type: "image", src: `${r.town}.svg`, w: 36, h: 36, label: `A ${r.town}` },
        { type: "stack", children: [
          { type: "text", text: r.project },
          r.next
            ? { type: "meter", value: r.turns, max: r.turns + r.next.turnsToGo, label: `${r.turns} turns this week · ${r.next.turnsToGo} more to a ${r.next.town}` }
            : { type: "text", text: `${r.turns} turns this week · a castle`, muted: true },
        ] },
      ] },
    ]);
  if (rows.length > most) children.push({ type: "text", text: `and ${rows.length - most} more towns`, muted: true });
  hive.render({ type: "stack", children });
}

/** Turns by frame in one day's history. */
/** @param {{ tiles: { frameId: string | null, turns: number[] }[] }} history */
function count(history) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const t of history.tiles) if (t.turns.length && t.frameId) out.set(t.frameId, (out.get(t.frameId) ?? 0) + t.turns.length);
  return out;
}

/** Reads the week again: on start, and when the day turns over. */
async function readWeek() {
  const now = new Date();
  const d = dayOf(now);
  day = d;
  const before = Array.from({ length: DAYS - 1 }, (_, i) => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i - 1)));
  /** @param {string} x @returns {Promise<Map<string, number>>} */
  const read = async (x) => { try { return count(await hive.hm.history(x)); } catch { return new Map(); } };
  const [mine, ...rest] = await Promise.all([read(d), ...before.map(read)]);
  if (day !== d) return;
  const e = new Map();
  for (const m of rest) for (const [f, n] of m) e.set(f, (e.get(f) ?? 0) + n);
  earlier = e;
  // Turns seen live while the week was being read are not counted twice: the larger count wins.
  for (const [f, n] of mine) if (n > (today.get(f) ?? 0)) today.set(f, n);
  draw();
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ frames: fs, tiles }) => {
    frames.clear();
    for (const f of fs) frames.set(f.id, f);
    frameOf.clear();
    for (const t of tiles) if (t.agent) frameOf.set(t.id, t.frameId);
    draw();
  });
  hive.hm.onEvents(["turn"], (e) => {
    if (e.outcome && e.outcome !== "done") return;
    if (dayOf(new Date()) !== day) { today = new Map(); void readWeek(); }
    const f = frameOf.get(e.tileId);
    if (f) { today.set(f, (today.get(f) ?? 0) + 1); draw(); }
  });
  void readWeek();
});

hive.hm.onCommand("ledger", () => ledger());
