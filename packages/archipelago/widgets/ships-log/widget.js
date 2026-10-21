// What happened while you were away, as a ship's log: which agent finished a turn, asked for you,
// started or stopped, how long ago and in which project, newest first. Press an entry to go to that
// agent. The log keeps its last entries in the widget's state, so a restart does not wipe it. It
// reads the workspace's events and agents through hive.hm and needs no permission.
const KEEP = 30;
/** @type {Record<string, string>} */
const ASKED = { permission: "wants permission", question: "asked a question", review: "wants a review", approval: "wants approval", input: "needs input" };
/** @type {Record<string, string>} */
const TURNED = { done: "finished", failed: "turn failed", interrupted: "interrupted", limited: "hit a limit" };
/** Names and projects of agents seen, kept after they close so their entries still read.
 *  @type {Map<string, { name: string, project: string | null }>} */
const known = new Map();
/** Agents open now. @type {Set<string>} */
const open = new Set();
/** @typedef {{ seq: number, at: number, tileId: string, what: string, needsYou?: boolean }} Entry */
/** Newest first. @type {Entry[]} */
let log = [];

/** @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
/** @param {string} id */
const who = (id) => { const k = known.get(id); return k ? (k.project ? `${k.name} · ${k.project}` : k.name) : "an agent"; };

/** The entry an event writes, or null for one the log does not keep. @param {any} e */
function entryOf(e) {
  if (e.kind === "turn") return { what: TURNED[e.outcome ?? "done"] ?? TURNED.done };
  if (e.kind === "needsInput") return { what: ASKED[e.reason] ?? ASKED.input, needsYou: true };
  if (!hive.options.comings) return null;
  if (e.kind === "tileOpened" && e.agent) return { what: e.spawnedBy ? `started, by ${who(e.spawnedBy)}` : "started" };
  if (e.kind === "tileClosed" && known.has(e.tileId)) return { what: e.failed ? "stopped, error" : "closed" };
  return null;
}

/** @param {any} e */
function note(e) {
  if (log.some((x) => x.seq === e.seq)) return;
  const n = entryOf(e);
  if (!n) return;
  log = [{ seq: e.seq, at: e.at, tileId: e.tileId, ...n }, ...log].sort((a, b) => b.at - a.at || b.seq - a.seq).slice(0, KEEP);
  hive.setState({ log });
  draw();
}

function entries() {
  const now = Date.now();
  return log.map((x) => ({ when: ago(now - x.at), agent: who(x.tileId), what: x.what, needsYou: !!x.needsYou, open: open.has(x.tileId), tileId: x.tileId }));
}

function draw() {
  const most = Number(hive.options.shown ?? 6);
  const list = entries().slice(0, most);
  /** @type {any[]} */
  const children = [{ type: "row", children: [
    { type: "image", src: "icon.svg", w: 28, h: 28, label: "A ship's log" },
    { type: "text", text: log.length ? "Ship's log" : "Ship's log: nothing yet. Turns, calls and arrivals land here.", muted: !log.length, wrap: true },
  ] }];
  for (const x of list) {
    const label = `${x.when} · ${x.agent} ${x.what}`;
    children.push(x.open ? { type: "button", label, action: { focus: x.tileId } } : { type: "text", text: label, muted: true });
  }
  hive.render({ type: "stack", children });
}

hive.on("start", () => {
  const saved = /** @type {{ log?: Entry[] } | null} */ (hive.state);
  if (saved && Array.isArray(saved.log)) log = saved.log.slice(0, KEEP);
  draw();
  hive.hm.on("structure", ({ frames, tiles }) => {
    const title = new Map((frames ?? []).map((/** @type {{ id: string, title: string }} */ f) => [f.id, f.title]));
    open.clear();
    for (const t of tiles) if (t.agent) { open.add(t.id); known.set(t.id, { name: t.name, project: title.get(t.frameId ?? "") ?? null }); }
    draw();
  });
  hive.hm.onEvents(["turn", "needsInput", "tileOpened", "tileClosed"], (e) => note(e));
  // "2m ago" keeps counting.
  setInterval(() => { if (log.length) draw(); }, 30_000);
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("log", () => entries().map(({ tileId, ...x }) => x));
