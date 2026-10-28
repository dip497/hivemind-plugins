// Who needs you now, as a harbour: an agent calling you is a boat waiting at your dock, the one
// waiting longest first, with why and its project; an agent ready for its next task, neither calling
// you nor at work, waits in port. Press one to go to it. With "Ring the bell" on, a boat arriving
// notifies you. It reads the agents and their status through hive.hm and needs no permission.
/** Why a calling agent wants you, in the view's own words (callReason in
 *  views/archipelago/src/world.ts), so a call has one name wherever the package has room for it:
 *  the bell's note and `dock`. @type {Record<string, string>} */
const WHY = { permission: "needs your permission", question: "has a question", plan: "has a plan for you", approval: "wants your approval", other: "needs you" };
/** The same in a word, for a row under "calling you": the view's words fill a row on the 240px card
 *  and cut the agent's name. Ship's log says a call in these words too. @type {Record<string, string>} */
const SHORT = { permission: "permission", question: "question", plan: "plan", approval: "approval", other: "needs you" };
/** Agent tiles by id, and each frame's title. @type {Map<string, { name: string, frameId?: string | null }>} */
const tiles = new Map();
/** @type {Map<string, string>} */
const frames = new Map();
/** @type {Map<string, () => void>} */
const watching = new Map();
/** Calling you, by tile: since when and why. @type {Map<string, { since: number, reason: string }>} */
const calling = new Map();
/** In port, ready for a task, by tile: idle since when. @type {Map<string, { since: number }>} */
const port = new Map();
/** Out at work now. @type {Set<string>} */
const working = new Set();

/** @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
/** @param {string} id */
const nameOf = (id) => tiles.get(id)?.name ?? "an agent";
/** @param {string} id */
const projectOf = (id) => frames.get(tiles.get(id)?.frameId ?? "") ?? null;
/** @template T @param {Map<string, T & { since: number }>} m */
const byAge = (m) => [...m].sort((a, b) => a[1].since - b[1].since);

/** @param {number} now */
function dock(now) {
  return {
    calling: byAge(calling).map(([id, c]) => ({ id, name: nameOf(id), project: projectOf(id), why: WHY[c.reason] ?? WHY.other, for: ago(now - c.since) })),
    inPort: byAge(port).map(([id, p]) => ({ id, name: nameOf(id), project: projectOf(id), for: ago(now - p.since) })),
    atWork: working.size,
  };
}

/** @param {string} name @param {string | null} project */
const who = (name, project) => (project ? `${name} · ${project}` : name);
/** A section's head: its picture and how many, as the other cards start with theirs.
 *  @param {string} src @param {string} label @param {number} n @param {string} what */
const head = (src, label, n, what) => ({ type: "row", children: [
  { type: "image", src, w: 36, h: 36, label },
  { type: "number", value: n, label: what },
] });

let tick = 0;
/** Draws again when the ages shown next move: on the next second of the clock while the youngest is
 *  under a minute, so it counts with the clock and with the cards beside it; on the clock's next
 *  half minute after that; not at all while none is shown. @param {number | null} youngest */
function again(youngest) {
  clearTimeout(tick);
  if (youngest === null) return;
  const step = youngest < 60_000 ? 1000 : 30_000;
  tick = setTimeout(draw, step - (Date.now() % step));
}

function draw() {
  const now = Date.now(), d = dock(now);
  const most = Number(hive.options.shown ?? 4);
  /** @type {any[]} */
  const rows = [];
  /** When each row shown began. @type {number[]} */
  const shown = [];
  if (d.calling.length) {
    rows.push(head("boat-calling.svg", "A boat waiting at the dock", d.calling.length, d.calling.length === 1 ? "agent calling you" : "agents calling you"));
    // What it wants, in a word, and for how long before whose it is: a row cut short at the card's
    // edge keeps them and the start of the name.
    for (const r of d.calling.slice(0, most)) {
      const c = calling.get(r.id);
      rows.push({ type: "button", label: `${SHORT[c?.reason ?? "other"] ?? SHORT.other} · ${r.for} · ${who(r.name, r.project)}`, action: { focus: r.id } });
      shown.push(c?.since ?? now);
    }
    if (d.calling.length > most) rows.push({ type: "text", text: `and ${d.calling.length - most} more at anchor`, muted: true });
  }
  const listed = Math.min(d.inPort.length, Math.max(0, most - d.calling.length));
  if (listed) {
    rows.push(head("boat-port.svg", "A boat back in port", d.inPort.length, d.inPort.length === 1 ? "agent in port, ready for a task" : "agents in port, ready for a task"));
    for (const r of d.inPort.slice(0, listed)) {
      rows.push({ type: "button", label: `in port · ${r.for} · ${who(r.name, r.project)}`, action: { focus: r.id } });
      shown.push(port.get(r.id)?.since ?? now);
    }
  }
  if (!rows.length) {
    const n = tiles.size;
    const out = d.atWork === n ? (n === 1 ? "your one agent is" : `all ${n} agents are`) : `${d.atWork} of ${n} ${n === 1 ? "agent" : "agents"}`;
    rows.push({ type: "row", children: [
      { type: "image", src: "harbour-calm.svg", w: 36, h: 36, label: "A calm harbour" },
      { type: "text", text: n ? `Calm harbour: ${out} out at work, none waiting on you.` : "No agents yet. Start one and its boat sets sail.", wrap: true },
    ] });
  } else {
    // The rest, so the boats calling, in port and out at work add up to every agent there is.
    /** @type {string[]} */
    const rest = [];
    if (d.inPort.length > listed) rest.push(listed ? `${d.inPort.length - listed} more in port` : `${d.inPort.length} in port`);
    if (d.atWork) rest.push(`${d.atWork} out at work`);
    if (rest.length) rows.push({ type: "text", text: `and ${rest.join(", ")}`, muted: true });
  }
  hive.render({ type: "stack", children: rows });
  again(shown.length ? Math.max(0, now - Math.max(...shown)) : null);
}

/** @param {string} id @param {string} status @param {any} info */
function seen(id, status, info) {
  const agent = info && info.agent;
  const since = (info && info.since) || 0;
  // The app tells of a call ("blocked") a moment before the agent's own state says why, so that
  // state decides when there is one: a call is taken with its reason, which is kept up to date.
  const asks = agent ? agent.state === "waiting" : status === "blocked";
  if (asks) {
    const reason = (agent && agent.waitingFor) || "other", was = calling.get(id);
    calling.set(id, { since: since || was?.since || Date.now(), reason });
    if (!was && hive.options.bell) {
      const project = projectOf(id);
      hive.notify(`${nameOf(id)} ${WHY[reason] ?? WHY.other}${project ? ` · ${project}` : ""}`);
    }
    port.delete(id);
    working.delete(id);
  } else {
    calling.delete(id);
    const works = status === "working" || (agent && agent.state === "working");
    if (works) working.add(id); else working.delete(id);
    // In port: idle, whether back from a turn or not yet sent on one, for as long as it has been.
    if (!works && status === "idle") port.set(id, { since: since || port.get(id)?.since || Date.now() });
    else port.delete(id);
  }
  draw();
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ frames: fs, tiles: all }) => {
    frames.clear();
    for (const f of fs ?? []) frames.set(f.id, f.title);
    tiles.clear();
    for (const t of all) if (t.agent) tiles.set(t.id, t);
    for (const [id, stop] of watching) if (!tiles.has(id)) { stop(); watching.delete(id); calling.delete(id); port.delete(id); working.delete(id); }
    for (const id of tiles.keys()) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => seen(id, s, info)));
    draw();
  });
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("dock", () => dock(Date.now()));
