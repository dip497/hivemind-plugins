// A butterfly that flutters over the screen on a wandering path, lands now and then to rest with its
// wings opening and closing, and scatters when an agent gets to work or finishes a turn. Place a few
// for a few butterflies: each one placed picks its own colour. It asks for no permission.
const COLOURS = ["orange", "blue", "yellow", "pink", "green"];
const LEG = 320;          // ms per stretch of flight: the app draws a widget at most 4 times a second
const CRUISE = 0.034;     // share of the screen's width flown each stretch: about 9 s to cross it
const DASH = 2.6;         // how much faster it flies while it scatters
const SCATTER_LEGS = 7;

const watching = new Map();
const working = new Map(); // tile id -> working at its last report
let phase = "flying";      // flying | landing | perched | scattering
let heading = Math.random() * Math.PI * 2;
let turn = 0;
let goal = null;
let legsLeft = 0;          // stretches until it looks for a place to land, or until a scatter ends
let timer = null;
let drawn = "";

const still = () => hive.reducedMotion === true;
const colour = () => {
  const chosen = String(hive.options.colour || "any");
  if (COLOURS.includes(chosen)) return chosen;
  return COLOURS.includes(hive.state?.colour) ? hive.state.colour : COLOURS[0];
};
const aspect = () => { const v = hive.hm.viewport; return v && v.w > 0 && v.h > 0 ? v.w / v.h : 16 / 9; };
const between = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const later = (ms, f) => { clearTimeout(timer); timer = setTimeout(f, ms); };
const flightLegs = () => Math.round(between(22, 50));

function doing() {
  if (still() || phase === "perched") return "resting";
  return phase === "scattering" ? "scattering" : "fluttering";
}

function draw() {
  const how = still() ? "still" : phase === "perched" ? "perched" : "flying";
  if (how + colour() === drawn) return;
  drawn = how + colour();
  const row = COLOURS.indexOf(colour()) * 2 + (how === "perched" ? 1 : 0);
  const frames = how === "still" ? 1 : 8;
  hive.render({ type: "sprite", src: "butterflies.svg", frameW: 64, frameH: 64, row, frames, fps: how === "perched" ? 3 : 22,
    pixelated: false, label: `${colour() === "orange" ? "An" : "A"} ${colour()} butterfly, ${doing()}` });
}

function newGoal() {
  goal = { x: between(0.08, 0.92), y: between(0.08, 0.85) };
}

/** One stretch of flight: the heading wanders, leans toward where it is going, and the wings bob it up and down. */
function leg(speed) {
  const { x, y } = hive.spot;
  const a = aspect();
  if (goal) {
    let d = Math.atan2((goal.y - y) / a, goal.x - x) - heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    heading += d * (phase === "landing" ? 0.5 : 0.18);
  }
  turn = clamp(turn * 0.7 + between(-0.45, 0.45), -0.7, 0.7);
  heading += turn;
  let nx = x + Math.cos(heading) * speed;
  let ny = y + Math.sin(heading) * speed * a + between(-0.6, 0.6) * speed;
  if (nx < 0.02 || nx > 0.98) { heading = Math.PI - heading; nx = clamp(nx, 0.02, 0.98); }
  if (ny < 0.03 || ny > 0.93) { heading = -heading; ny = clamp(ny, 0.03, 0.93); }
  // A little longer than the stretch, so the next one starts before this one stops.
  hive.moveTo({ x: nx, y: ny }, { over: LEG + 40 });
}

function fly() {
  if (phase === "scattering") {
    leg(CRUISE * DASH);
    if (--legsLeft <= 0) { phase = "flying"; legsLeft = flightLegs(); newGoal(); draw(); }
    return later(LEG, fly);
  }
  if (phase === "flying" && --legsLeft <= 0) { phase = "landing"; newGoal(); }
  if (!goal) newGoal();
  const { x, y } = hive.spot;
  const near = Math.hypot(goal.x - x, (goal.y - y) / aspect()) < CRUISE * 1.2;
  if (near && phase === "landing") {
    hive.moveTo(goal, { over: LEG });
    phase = "perched";
    draw();
    return later(between(5000, 11000), takeOff);
  }
  if (near) newGoal();
  leg(phase === "landing" ? CRUISE * 0.8 : CRUISE);
  later(LEG, fly);
}

function takeOff() {
  phase = "flying";
  legsLeft = flightLegs();
  newGoal();
  draw();
  fly();
}

/** Off it goes, fast and upward, from wherever it was. */
function scatter() {
  if (still()) return;
  phase = "scattering";
  legsLeft = SCATTER_LEGS;
  heading = -Math.PI / 2 + between(-1.2, 1.2);
  turn = 0;
  draw();
  fly();
}

/** Start again as reduced motion now says: resting where it is, or on the wing. */
function settle() {
  clearTimeout(timer);
  drawn = "";
  if (still()) { phase = "perched"; draw(); return; }
  takeOff();
}

hive.on("start", () => {
  if (!COLOURS.includes(hive.state?.colour)) hive.setState({ colour: COLOURS[Math.floor(Math.random() * COLOURS.length)] });
  if (!still()) hive.moveTo({ x: between(0.1, 0.9), y: between(0.1, 0.7) }, { over: 0 });
  settle();
  hive.hm.on("structure", ({ tiles }) => {
    const agents = new Set(tiles.filter((t) => t.agent).map((t) => t.id));
    for (const [id, stop] of watching) if (!agents.has(id)) { stop(); watching.delete(id); working.delete(id); }
    for (const id of agents) {
      if (watching.has(id)) continue;
      watching.set(id, hive.hm.subscribeStatus(id, (status, info) => {
        const now = status === "working" || info?.agent?.state === "working";
        const was = working.get(id);
        working.set(id, now);
        if (now && was === false) scatter();
      }));
    }
  });
  hive.hm.onEvents(["turn"], scatter);
});

hive.on("motion", settle);
hive.on("options", () => { drawn = ""; draw(); });
hive.on("click", scatter);

hive.hm.onCommand("scatter", () => {
  scatter();
  return { colour: colour(), doing: doing() };
});
