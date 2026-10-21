// Who needs you now, as a harbour: an agent calling you is a boat waiting at your dock, the one
// waiting longest first, with its project and why; an agent that finished a turn and is ready for
// its next task waits in port. Press one to go to it. With "Ring the bell" on, a boat arriving
// notifies you. It reads the agents and their status through hive.hm and needs no permission.
/** @type {Record<string, string>} */
const WHY = { permission: "wants permission", question: "asked you something", plan: "has a plan to review", approval: "wants approval", other: "needs you" };
/** Agent tiles by id, and each frame's title. @type {Map<string, { name: string, frameId?: string | null }>} */
const tiles = new Map();
/** @type {Map<string, string>} */
const frames = new Map();
/** @type {Map<string, () => void>} */
const watching = new Map();
/** Calling you, by tile: since when and why. @type {Map<string, { since: number, reason: string }>} */
const calling = new Map();
/** Back in port after a finished turn, by tile: since when. @type {Map<string, { since: number }>} */
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

/** @param {number} now */
function dock(now) {
  /** @template T @param {Map<string, T & { since: number }>} m */
  const byAge = (m) => [...m].sort((a, b) => a[1].since - b[1].since);
  return {
    calling: byAge(calling).map(([id, c]) => ({ id, name: nameOf(id), project: projectOf(id), why: WHY[c.reason] ?? WHY.other, for: ago(now - c.since) })),
    inPort: byAge(port).map(([id, p]) => ({ id, name: nameOf(id), project: projectOf(id), for: ago(now - p.since) })),
    atWork: working.size,
  };
}

/** @param {string} name @param {string | null} project */
const who = (name, project) => (project ? `${name} · ${project}` : name);

function draw() {
  const d = dock(Date.now());
  const most = Number(hive.options.shown ?? 4);
  /** @type {any[]} */
  const rows = [];
  if (d.calling.length) {
    rows.push({ type: "row", children: [
      { type: "image", src: "boat-calling.svg", w: 40, h: 32, label: "A boat waiting at the dock" },
      { type: "number", value: d.calling.length, label: d.calling.length === 1 ? "boat calling you" : "boats calling you" },
    ] });
    for (const r of d.calling.slice(0, most)) rows.push({ type: "button", label: `${who(r.name, r.project)} ${r.why} · ${r.for}`, action: { focus: r.id } });
    if (d.calling.length > most) rows.push({ type: "text", text: `and ${d.calling.length - most} more at anchor`, muted: true });
  }
  const left = Math.max(0, most - Math.min(most, d.calling.length));
  if (d.inPort.length && left) {
    rows.push({ type: "row", children: [
      { type: "image", src: "boat-port.svg", w: 40, h: 32, label: "A boat back in port" },
      { type: "text", text: `${d.inPort.length} in port, ready for a task`, muted: true },
    ] });
    for (const r of d.inPort.slice(0, left)) rows.push({ type: "button", label: `${who(r.name, r.project)} · back ${r.for} ago`, action: { focus: r.id } });
  }
  if (!rows.length) {
    rows.push({ type: "row", children: [
      { type: "image", src: "harbour-calm.svg", w: 64, h: 40, label: "A calm harbour" },
      { type: "text", text: tiles.size ? `Calm harbour: ${d.atWork} of ${tiles.size} agents out at work, none waiting on you.` : "No agents yet. Start one and its boat sets sail.", muted: true, wrap: true },
    ] });
  } else if (d.atWork) {
    rows.push({ type: "text", text: `${d.atWork} more out at work`, muted: true });
  }
  hive.render({ type: "stack", children: rows });
}

/** @param {string} id @param {string} status @param {any} info */
function seen(id, status, info) {
  const agent = info && info.agent;
  const asks = status === "blocked" || (agent && agent.state === "waiting");
  if (asks) {
    if (!calling.has(id)) {
      const reason = (agent && agent.waitingFor) || "other";
      calling.set(id, { since: (info && info.since) || Date.now(), reason });
      if (hive.options.bell) hive.notify(`${who(nameOf(id), projectOf(id))} ${WHY[reason] ?? WHY.other}`);
    }
    port.delete(id);
    working.delete(id);
  } else {
    calling.delete(id);
    const wasWorking = working.has(id);
    const works = status === "working" || (agent && agent.state === "working");
    if (works) working.add(id); else working.delete(id);
    // Back in port once a turn is done and it waits for the next: an agent that says so ("done"), or
    // one seen go from working to idle, as an agent without hooks does; out at sea again once it works.
    const rests = status === "idle" || (agent && (agent.state === "done" || agent.state === "idle"));
    const back = (agent && agent.state === "done") || (wasWorking && rests);
    if (back && !port.has(id)) port.set(id, { since: (info && info.since) || Date.now() });
    else if (!rests) port.delete(id);
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
  // The "for 3m" beside each one keeps counting, only while there is one to count.
  setInterval(() => { if (calling.size || port.size) draw(); }, 15_000);
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("dock", () => dock(Date.now()));
