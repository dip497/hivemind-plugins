// The whole workspace at a glance, as the sky over Archipelago, and what to do about it. A storm
// when an agent stopped on an error, with a button to each; a squall when some are calling you, with
// one to the agent waiting longest; fair while they work; becalmed when every one is idle. It says
// how long the weather has held. It reads the agents' status through hive.hm and needs no permission.
/** Each agent's mood, and since when. @type {Map<string, { mood: string, since: number }>} */
const states = new Map();
/** @type {Map<string, string>} */
const names = new Map();
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

/** @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
/** The agents in this mood, longest first. @param {string} mood */
const longest = (mood) => [...states].filter(([, s]) => s.mood === mood).sort((a, b) => a[1].since - b[1].since).map(([id]) => id);

function forecast() {
  /** @type {Count & Record<string, number>} */
  const c = { working: 0, calling: 0, failed: 0, idle: 0 };
  for (const { mood } of states.values()) if (mood in c) c[mood] = (c[mood] ?? 0) + 1;
  const weather = c.failed ? "storm" : c.calling ? "squall" : c.working ? "fair" : "becalmed";
  // It has held since the first agent of the mood that makes it came to be in that mood.
  const mood = { storm: "failed", squall: "calling", fair: "working", becalmed: "idle" }[weather] ?? "idle";
  const since = Math.min(...[...states.values()].filter((x) => x.mood === mood).map((x) => x.since), Date.now());
  return { weather, for: ago(Date.now() - since), ...c, stopped: longest("failed").map((id) => names.get(id) ?? id), waitingLongest: names.get(longest("calling")[0] ?? "") ?? null };
}

function draw() {
  const f = forecast(), sky = /** @type {{ says: string, line: (c: Count) => string }} */ (SKY[f.weather]);
  /** @type {any[]} */
  const act = [];
  for (const id of longest("failed").slice(0, 2)) act.push({ type: "button", label: `Go to ${names.get(id) ?? "it"}, stopped`, action: { focus: id } });
  const first = longest("calling")[0];
  if (first) act.push({ type: "button", label: `Go to ${names.get(first) ?? "it"}, waiting longest`, action: { focus: first } });
  hive.render({
    type: "stack",
    children: [
      { type: "row", children: [
        { type: "image", src: `${f.weather}.svg`, w: 56, h: 56, label: sky.says },
        { type: "stack", children: [
          { type: "text", text: `${sky.says} for ${f.for}`, size: "large" },
          { type: "text", text: sky.line(f), muted: true, wrap: true },
        ] },
      ] },
      ...act,
    ],
  });
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ tiles }) => {
    const agents = new Map(tiles.filter((/** @type {{ id: string, agent?: string, name: string }} */ t) => t.agent).map((/** @type {{ id: string, name: string }} */ t) => [t.id, t.name]));
    for (const [id, stop] of watching) if (!agents.has(id)) { stop(); watching.delete(id); states.delete(id); }
    for (const [id, name] of agents) {
      names.set(id, name);
      if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => {
        const mood = moodOf(s, info), was = states.get(id);
        if (!was || was.mood !== mood) states.set(id, { mood, since: (info && info.since) || Date.now() });
        draw();
      }));
    }
    draw();
  });
  // "Fair for 12m" keeps counting.
  setInterval(() => draw(), 30_000);
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("forecast", () => forecast());
