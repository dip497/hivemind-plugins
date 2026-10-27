// The whole workspace at a glance, as the sky over Archipelago, and what to do about it. A storm
// when an agent stopped on an error, with a button to each; a squall when some are calling you, with
// one to the agent waiting longest; fair while they work; becalmed when every one is idle. Once the
// weather has held a minute it says for how long, from when it last changed. It reads the agents'
// status through hive.hm and needs no permission.
/** Each agent's mood, and since when. @type {Map<string, { mood: string, since: number }>} */
const states = new Map();
/** @type {Map<string, string>} */
const names = new Map();
/** @type {Map<string, () => void>} */
const watching = new Map();
/** The weather last worked out, and since when: the moment it was seen to change, or 0 where it was
 *  only learned, as each agent's status came in after opening. @type {{ weather: string, since: number }} */
let held = { weather: "becalmed", since: 0 };

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
  becalmed: { says: "Becalmed", line: (c) => (c.idle === 1 ? "1 agent idle, ready for work" : c.idle ? `All ${c.idle} agents idle, ready for work` : "No agents out yet") },
};
/** The mood that makes each weather. @type {Record<string, string>} */
const MOOD = { storm: "failed", squall: "calling", fair: "working", becalmed: "idle" };

/** @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
/** The agents in this mood, longest first. @param {string} mood */
const longest = (mood) => [...states].filter(([, s]) => s.mood === mood).sort((a, b) => a[1].since - b[1].since).map(([id]) => id);

/** How many agents are in each mood, and the weather they make. */
function sky() {
  /** @type {Count & Record<string, number>} */
  const c = { working: 0, calling: 0, failed: 0, idle: 0 };
  for (const { mood } of states.values()) if (mood in c) c[mood] = (c[mood] ?? 0) + 1;
  return { c, weather: c.failed ? "storm" : c.calling ? "squall" : c.working ? "fair" : "becalmed" };
}

/** Remembers the weather changing at `at` (0: learned, not seen), if it did. @param {number} at */
function settle(at) {
  const { weather } = sky();
  if (weather !== held.weather) held = { weather, since: at };
}

/** The weather at `now`, and how long it has held: since it last changed, and not before the agent
 *  longest in the mood that makes it, which is all there is to go on for weather only learned.
 *  @param {number} now */
function weatherAt(now) {
  const { c, weather } = sky();
  const first = Math.min(...[...states.values()].filter((x) => x.mood === MOOD[weather]).map((x) => x.since), now);
  return { c, weather, held: now - Math.max(held.since, first), agents: c.working + c.calling + c.failed + c.idle };
}

function forecast() {
  const w = weatherAt(Date.now());
  return { weather: w.weather, for: ago(w.held), ...w.c, stopped: longest("failed").map((id) => names.get(id) ?? id), waitingLongest: names.get(longest("calling")[0] ?? "") ?? null };
}

let tick = 0;
/** Draws again when the time shown next moves: on the second of the clock the weather turns a minute
 *  old (it shows no time before), then on the clock's half minutes; not at all with no agents.
 *  @param {number | null} age */
function again(age) {
  clearTimeout(tick);
  if (age === null) return;
  const now = Date.now();
  tick = setTimeout(draw, age < 60_000 ? Math.ceil((now + 60_000 - age) / 1000) * 1000 - now : 30_000 - (now % 30_000));
}

function draw() {
  const now = Date.now(), w = weatherAt(now), sky = /** @type {{ says: string, line: (c: Count) => string }} */ (SKY[w.weather]);
  /** @type {any[]} */
  const act = [];
  // What happened before whose it is: a button cut short at the card's edge keeps it.
  for (const id of longest("failed").slice(0, 2)) act.push({ type: "button", label: `Stopped: ${names.get(id) ?? "an agent"}`, action: { focus: id } });
  const first = longest("calling")[0];
  if (first) act.push({ type: "button", label: `Waiting longest: ${names.get(first) ?? "an agent"}`, action: { focus: first } });
  // "Fair for 0s" says nothing: the time shows once the weather has held a minute.
  const says = w.agents && w.held >= 60_000 ? `${sky.says} for ${ago(w.held)}` : sky.says;
  hive.render({
    type: "stack",
    children: [
      { type: "row", children: [
        { type: "image", src: `${w.weather}.svg`, w: 36, h: 36, label: sky.says },
        { type: "stack", children: [
          { type: "text", text: says, wrap: true },
          { type: "text", text: sky.line(w.c), muted: true, wrap: true },
        ] },
      ] },
      ...act,
    ],
  });
  again(w.agents ? w.held : null);
}

hive.on("start", () => {
  draw();
  hive.hm.on("structure", ({ tiles }) => {
    const agents = new Map(tiles.filter((/** @type {{ id: string, agent?: string, name: string }} */ t) => t.agent).map((/** @type {{ id: string, name: string }} */ t) => [t.id, t.name]));
    for (const [id, stop] of watching) if (!agents.has(id)) { stop(); watching.delete(id); states.delete(id); }
    settle(Date.now());
    for (const [id, name] of agents) {
      names.set(id, name);
      if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => {
        const mood = moodOf(s, info), was = states.get(id), at = (info && info.since) || Date.now();
        if (!was || was.mood !== mood) states.set(id, { mood, since: at });
        // An agent seen to change its mood changes the weather then; its first status, as the widget
        // opens or the agent arrives, says what the weather is, not when it changed.
        settle(was ? at : 0);
        draw();
      }));
    }
    draw();
  });
});

hive.on("action", (a) => { if (a && typeof a.focus === "string") hive.hm.commands.focusTile(a.focus); });

hive.hm.onCommand("forecast", () => forecast());
