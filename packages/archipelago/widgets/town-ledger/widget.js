// What each project got done this week, as the towns of Archipelago: every turn its agents finished
// in the last seven days counts (today's shown on its own), its town grows from a well to a
// windmill, a church and a castle at the counts the view raises its keep, and a project that has
// gone quiet says for how long. It reads the workspace's history and its live turns through hive.hm
// and needs no permission.
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
let day = "";

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
  return [...sum]
    .map(([f, days]) => {
      const turns = days.reduce((a, b) => a + b, 0), town = townOf(turns), next = nextOf(turns);
      const last = days.findIndex((n) => n > 0);
      return {
        project: /** @type {{ title: string }} */ (frames.get(f)).title, turns, today: days[0] ?? 0, town: town.name,
        next: next ? { town: next.name, turnsToGo: next.at - turns } : null,
        quietDays: last < 0 ? DAYS : last,
      };
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
  const children = rows.slice(0, most).map((r) => {
    // One line under the name, so four towns fit a card beside the others down the screen's edge.
    const week = `${r.turns} this week`;
    const quiet = r.quietDays >= QUIET ? (r.quietDays >= DAYS ? "Quiet all week" : `Quiet for ${r.quietDays} days`) : null;
    return { type: "row", children: [
      { type: "image", src: `${r.town}.svg`, w: 36, h: 36, label: `A ${r.town}` },
      { type: "stack", children: [
        { type: "text", text: quiet ? `${r.project} · ${quiet.toLowerCase()}` : r.today ? `${r.project} · +${r.today} today` : r.project },
        r.next
          ? { type: "meter", value: r.turns, max: r.turns + r.next.turnsToGo, label: `${week} · ${r.next.turnsToGo} to a ${r.next.town}` }
          : { type: "text", text: `${week} · a castle`, muted: true },
      ] },
    ] };
  });
  if (rows.length > most) children.push({ type: "text", text: `and ${rows.length - most} more towns`, muted: true });
  hive.render({ type: "stack", children });
}

/** Turns by frame in one day's history. @param {{ tiles: { frameId: string | null, turns: number[] }[] }} history */
function count(history) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const t of history.tiles) if (t.turns.length && t.frameId) out.set(t.frameId, (out.get(t.frameId) ?? 0) + t.turns.length);
  return out;
}

/** Reads the days of the week again. A count never goes down: the history can trail the turns seen
 *  live by a little, so the larger of the two stands. @param {boolean} all the six days before too */
async function read(all) {
  const now = new Date(), d = dayOf(now);
  if (d !== day) { day = d; perDay = Array.from({ length: DAYS }, () => new Map()); all = true; }
  const names = Array.from({ length: all ? DAYS : 1 }, (_, i) => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  /** @param {string} x @returns {Promise<Map<string, number>>} */
  const one = async (x) => { try { return count(await hive.hm.history(x)); } catch { return new Map(); } };
  const got = await Promise.all(names.map(one));
  if (day !== d) return;
  got.forEach((m, i) => { const into = /** @type {Map<string, number>} */ (perDay[i]); for (const [f, n] of m) if (n > (into.get(f) ?? 0)) into.set(f, n); });
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
