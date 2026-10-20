// Who needs you now, as a harbour: an agent calling you is a boat waiting at your dock, the one
// waiting longest first; an agent that finished a turn and is ready for its next task is back in
// port. Press one to go to it. It reads the agents and their status through hive.hm and needs no
// permission.
/** @type {Record<string, string>} */
const WHY = { permission: "wants permission", question: "asked you something", plan: "has a plan to review", approval: "wants approval", other: "needs you" };
/** @type {Map<string, { name: string }>} */
const tiles = new Map();
/** @type {Map<string, () => void>} */
const watching = new Map();
/** Calling you, by tile: since when and why. @type {Map<string, { since: number, reason: string }>} */
const calling = new Map();
/** Back in port after a finished turn, by tile: since when. @type {Map<string, { since: number }>} */
const port = new Map();

/** @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
/** @param {string} id */
const nameOf = (id) => tiles.get(id)?.name ?? "an agent";

/** @param {number} now */
function dock(now) {
  /** @template T @param {Map<string, T & { since: number }>} m */
  const byAge = (m) => [...m].sort((a, b) => a[1].since - b[1].since);
  return {
    calling: byAge(calling).map(([id, c]) => ({ id, name: nameOf(id), why: WHY[c.reason] ?? WHY.other, for: ago(now - c.since) })),
    inPort: byAge(port).map(([id, p]) => ({ id, name: nameOf(id), for: ago(now - p.since) })),
  };
}

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
    for (const r of d.calling.slice(0, most)) rows.push({ type: "button", label: `${r.name} ${r.why} · ${r.for}`, action: { focus: r.id } });
    if (d.calling.length > most) rows.push({ type: "text", text: `and ${d.calling.length - most} more at anchor`, muted: true });
  }
  const left = Math.max(0, most - Math.min(most, d.calling.length));
  if (d.inPort.length && left) {
    rows.push({ type: "row", children: [
      { type: "image", src: "boat-port.svg", w: 40, h: 32, label: "A boat back in port" },
      { type: "text", text: `${d.inPort.length} back in port, ready for a task`, muted: true },
    ] });
    for (const r of d.inPort.slice(0, left)) rows.push({ type: "button", label: `${r.name} · back ${r.for} ago`, action: { focus: r.id } });
  }
  if (!rows.length) {
    rows.push({ type: "row", children: [
      { type: "image", src: "harbour-calm.svg", w: 64, h: 40, label: "A calm harbour" },
      { type: "text", text: tiles.size ? `Calm harbour: all ${tiles.size} agents are out at work.` : "No agents yet. Start one and its boat sets sail.", muted: true, wrap: true },
    ] });
  }
  hive.render({ type: "stack", children: rows });
}

/** @param {string} id @param {string} status @param {any} info */
function seen(id, status, info) {
  const agent = info && info.agent;
  const asks = status === "blocked" || (agent && agent.state === "waiting");
  if (asks) {
    if (!calling.has(id)) calling.set(id, { since: (info && info.since) || Date.now(), reason: (agent && agent.waitingFor) || "other" });
    port.delete(id);
  } else {
    calling.delete(id);
    // Back in port once a turn is done and it waits for the next; out at sea again once it works.
    const done = agent && agent.state === "done";
    if (done && !port.has(id)) port.set(id, { since: (info && info.since) || Date.now() });
    else if (!done && status !== "idle") port.delete(id);
  }
  draw();
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ tiles: all }) => {
    tiles.clear();
    for (const t of all) if (t.agent) tiles.set(t.id, t);
    for (const [id, stop] of watching) if (!tiles.has(id)) { stop(); watching.delete(id); calling.delete(id); port.delete(id); }
    for (const id of tiles.keys()) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => seen(id, s, info)));
    draw();
  });
  // The "for 3m" beside each one keeps counting, only while there is one to count.
  setInterval(() => { if (calling.size || port.size) draw(); }, 15_000);
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("dock", () => dock(Date.now()));
