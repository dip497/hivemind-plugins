// What happened while you were away, as a ship's log: which agent finished a turn, asked for you,
// started or stopped, how long ago and in which project, newest first. Press an entry to go to that
// agent. The log keeps its last entries in the widget's state, so a restart does not wipe it. It
// reads the workspace's events and agents, and which agents are calling you now, through hive.hm
// and needs no permission.
const KEEP = 30;
/** Why an agent asked for you, by the event's reason: in the view's words (world.ts, callReason)
 *  while it still waits, so one call goes by one name, and in the past tense once it is answered.
 *  @type {Record<string, string>} */
const ASKS = { permission: "needs your permission", question: "has a question", review: "has a plan for you", approval: "wants your approval", input: "needs you" };
/** @type {Record<string, string>} */
const ASKED = { permission: "asked for your permission", question: "had a question", review: "had a plan for you", approval: "wanted your approval", input: "needed you" };
/** The reason of each ask an earlier version kept in a saved log, which has only its words.
 *  @type {Record<string, string>} */
const ASKED_BEFORE = { "needs your OK": "permission", "asked a question": "question", "wants a review": "review", "wants approval": "approval", "needs input": "input" };
/** @type {Record<string, string>} */
const TURNED = { done: "finished", failed: "turn failed", interrupted: "interrupted", limited: "hit a limit" };
/** Names and projects of agents seen, kept after they close so their entries still read.
 *  @type {Map<string, { name: string, project: string | null }>} */
const known = new Map();
/** Agents open now. @type {Set<string>} */
const open = new Set();
/** Agents calling you now, from their status. @type {Set<string>} */
const calling = new Set();
/** Each agent's status subscription, by tile. @type {Map<string, () => void>} */
const watching = new Map();
/** An entry; an ask's says so (`needsYou`) and why (`reason`).
 *  @typedef {{ seq: number, at: number, tileId: string, what: string, needsYou?: boolean, reason?: string }} Entry */
/** Newest first. @type {Entry[]} */
let log = [];
/** The next redraw, for the ages shown. @type {ReturnType<typeof setTimeout> | undefined} */
let tick;

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
  if (e.kind === "needsInput") { const reason = Object.hasOwn(ASKED, e.reason) ? e.reason : "input"; return { what: ASKED[reason], needsYou: true, reason }; }
  if (!hive.options.comings) return null;
  if (e.kind === "tileOpened" && e.agent) return { what: e.spawnedBy ? `started by ${known.get(e.spawnedBy)?.name ?? "an agent"}` : "started" };
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

/** The log as it reads, newest first. An ask is waiting on you only while its agent is calling you
 *  and nothing newer has happened to that agent: an earlier ask of it was answered. */
function entries() {
  const now = Date.now();
  /** @type {Set<string>} */
  const later = new Set();
  return log.map((x) => {
    const waiting = !!x.needsYou && calling.has(x.tileId) && !later.has(x.tileId);
    later.add(x.tileId);
    return { when: ago(now - x.at), what: waiting ? ASKS[x.reason ?? "input"] ?? x.what : x.what, agent: who(x.tileId), needsYou: waiting, open: open.has(x.tileId), tileId: x.tileId };
  });
}

function draw() {
  const most = Number(hive.options.shown ?? 5);
  const list = entries().slice(0, most);
  /** @type {any[]} */
  const children = [{ type: "row", children: [
    { type: "image", src: "icon.svg", w: 36, h: 36, label: "A ship's log" },
    { type: "stack", children: [
      { type: "text", text: "Ship's log" },
      ...(log.length ? [] : [{ type: "text", text: hive.options.comings ? "Nothing yet. Turns, calls, arrivals and departures land here." : "Nothing yet. Turns and calls land here.", muted: true, wrap: true }]),
    ] },
  ] }];
  for (const x of list) {
    // The short facts first and the name last: a label longer than the card is cut at its end.
    const label = `${x.when} · ${x.what} · ${x.agent}`;
    const entry = x.open ? { type: "button", label, action: { focus: x.tileId } } : { type: "text", text: label, muted: true };
    children.push(x.needsYou ? { type: "row", children: [{ type: "image", src: "calling.svg", w: 16, h: 16, label: "Calling you" }, entry] } : entry);
  }
  hive.render({ type: "stack", children });
  // The ages keep counting: each second while the newest shown is under a minute old, each half
  // minute after, on the clock's own seconds as the other cards count theirs; with none, no timer.
  clearTimeout(tick);
  const newest = list.length ? log[0] : undefined;
  if (newest) {
    const every = Date.now() - newest.at < 60_000 ? 1000 : 30_000;
    tick = setTimeout(draw, every - (Date.now() % every));
  }
}

hive.on("start", () => {
  const saved = /** @type {{ log?: Entry[] } | null} */ (hive.state);
  if (saved && Array.isArray(saved.log)) {
    log = saved.log.slice(0, KEEP).map((x) => { const reason = x.needsYou && !x.reason ? ASKED_BEFORE[x.what] : undefined; return reason ? { ...x, what: ASKED[reason], reason } : x; });
  }
  draw();
  hive.hm.on("structure", ({ frames, tiles }) => {
    const title = new Map((frames ?? []).map((/** @type {{ id: string, title: string }} */ f) => [f.id, f.title]));
    open.clear();
    for (const t of tiles) if (t.agent) { open.add(t.id); known.set(t.id, { name: t.name, project: title.get(t.frameId ?? "") ?? null }); }
    for (const [id, stop] of watching) if (!open.has(id)) { stop(); watching.delete(id); calling.delete(id); }
    for (const id of open) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (/** @type {string} */ s, /** @type {any} */ info) => {
      const now = s === "blocked" || (info && info.agent && info.agent.state) === "waiting";
      if (now === calling.has(id)) return;
      if (now) calling.add(id); else calling.delete(id);
      draw();
    }));
    draw();
  });
  hive.hm.onEvents(["turn", "needsInput", "tileOpened", "tileClosed"], (e) => note(e));
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("log", () => entries().map(({ tileId, ...x }) => x));
