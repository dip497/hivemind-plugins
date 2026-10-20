// The whole workspace at a glance, as the sky over Archipelago. A storm when an agent stopped on an
// error, a squall when some are calling you, fair while they work, becalmed when every one is idle.
// It reads the agents' status through hive.hm and needs no permission.
/** @type {Map<string, string>} */
const states = new Map();
/** @type {Map<string, () => void>} */
const watching = new Map();

/** @param {string} status @param {any} info */
function moodOf(status, info) {
  const s = info && info.agent && info.agent.state;
  if (status === "blocked" || s === "waiting") return "calling";
  if (s === "failed" || s === "limited") return "failed";
  if (status === "exited" || s === "exited") return "gone";
  if (status === "working" || s === "working") return "working";
  return "idle";
}

/** @typedef {{ working: number, calling: number, failed: number, idle: number }} Count */
/** @type {Record<string, { says: string, line: (c: Count) => string }>} */
const SKY = {
  storm: { says: "Storm", line: (c) => `${c.failed} stopped on an error${c.calling ? `, ${c.calling} calling you` : ""}` },
  squall: { says: "Squall", line: (c) => `${c.calling} calling you · ${c.working} at work` },
  fair: { says: "Fair", line: (c) => `${c.working} at work, none waiting on you` },
  becalmed: { says: "Becalmed", line: (c) => (c.idle ? `All ${c.idle} agents idle, ready for work` : "No agents out yet") },
};

function forecast() {
  /** @type {Count & Record<string, number>} */
  const c = { working: 0, calling: 0, failed: 0, idle: 0 };
  for (const m of states.values()) if (m in c) c[m] = (c[m] ?? 0) + 1;
  const weather = c.failed ? "storm" : c.calling ? "squall" : c.working ? "fair" : "becalmed";
  return { weather, ...c };
}

function draw() {
  const f = forecast(), sky = SKY[f.weather];
  hive.render({
    type: "row",
    children: [
      { type: "image", src: `${f.weather}.svg`, w: 64, h: 64, label: sky.says },
      { type: "stack", children: [
        { type: "text", text: sky.says, size: "large" },
        { type: "text", text: sky.line(f), muted: true, wrap: true },
      ] },
    ],
  });
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ tiles }) => {
    const agents = new Set(tiles.filter((/** @type {{ id: string, agent?: string }} */ t) => t.agent).map((/** @type {{ id: string }} */ t) => t.id));
    for (const [id, stop] of watching) if (!agents.has(id)) { stop(); watching.delete(id); states.delete(id); }
    for (const id of agents) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => { states.set(id, moodOf(s, info)); draw(); }));
    draw();
  });
});

hive.hm.onCommand("forecast", () => forecast());
