// The Den pup: a wolf pup that lives along the bottom of your screen, keeps an eye on your agents,
// and plays with you.
//
// Your agents first: it yips and begs when one starts waiting on you and sits by the right edge
// until you answer (a click then takes you to that agent), leaps when a turn finishes, and curls
// up asleep once every agent has been idle a while.
//
// Play, by clicking it: a boop on the nose and it shakes, hops, chases its tail or rolls over, and
// every third boop it fetches its ball. While it holds the ball, a click throws it: it gallops
// after it across the screen, pounces and trots back with it. Click it asleep and it rolls over
// for a belly rub without waking. Left alone a long while, it brings you its ball.
// It reads the agents through hive.hm and asks for no permission.
//
// Two looks, one sheet each, a row a pose and eight frames a row: Cartoon (pup.webp, drawn in 2D by
// ../../pup2d/draw.js) and Fluffy (pup-fluffy.webp, rendered from the Den pup's 3D model).
const LOOKS = {
  cartoon: { src: "pup.webp", w: 160, h: 144, scale: 0.78 },
  fluffy: { src: "pup-fluffy.webp", w: 160, h: 128, scale: 0.72 },
};
const ROWS = {
  walk: [0, 12], sit: [1, 10], sleep: [2, 4], beg: [3, 10], jump: [4, 12], run: [5, 16],
  shake: [6, 14], roll: [7, 10], spin: [8, 12], carry: [9, 14], ball: [10, 10],
}; // row, frames a second
const SCREEN_AT_A_TROT = 12000; // ms to cross the whole screen on its own: never faster
const SCREEN_AT_A_RUN = 3500; // after its ball
const SCREEN_CARRYING = 6000; // bringing it back
const NAP_AFTER = 90_000;
const BY_THE_EDGE = 0.93;
const HOLDS_THE_BALL = 20_000; // it waits this long for a throw, then drops it
const WANTS_TO_PLAY = 20 * 60_000; // awake and left alone this long, it brings its ball
const BOOPS = ["shake", "jump", "spin", "roll"];
const SAYS = {
  walk: "trotting", sit: "sitting", sleep: "asleep", beg: "yipping", jump: "jumping", run: "running after its ball",
  shake: "shaking off a boop", roll: "rolling over", spin: "chasing its tail", carry: "bringing its ball back",
  ball: "holding its ball: click to throw it",
};

const states = new Map(); // tile id -> working | waiting | idle | stuck | exited
const watching = new Map();
const names = new Map();
const waitingSince = new Map(); // in the order they started waiting
let pose = "sit";
let says = null; // what it is doing, when the pose alone does not say it
let facing = 1;
let next = null;
let napClock = null;
let playClock = null;
let boops = 0;
let holding = false; // it has its ball and waits for a throw

const name = () => String(hive.options.name || "Pip");
const busy = () => [...states.values()].some((s) => s === "working" || s === "waiting");
const playing = () => holding || ["run", "carry", "shake", "spin", "roll"].includes(pose);

function draw() {
  const [row, fps] = ROWS[pose];
  const look = LOOKS[hive.options.look] || LOOKS.cartoon;
  hive.render({
    type: "sprite", src: look.src, frameW: look.w, frameH: look.h, row, frames: 8, fps,
    scale: look.scale, flip: facing < 0, pixelated: false, label: `${name()} is ${doing()}`,
  });
}

function doing() {
  if (says) return says;
  if (pose === "sit" && waitingSince.size) return "waiting with you";
  return SAYS[pose];
}

const later = (ms, f) => { clearTimeout(next); next = setTimeout(f, ms); };
const be = (p, what = null) => { pose = p; says = what; draw(); };

/** Go to x along the bottom over `screen` ms a screen's width, in `p`, then `then`. Asked for less
 *  motion, its card stays where it is and only its pose changes. */
function go(x, screen, p, then) {
  const from = hive.spot.x;
  if (Math.abs(x - from) < 0.01) return then();
  facing = x >= from ? 1 : -1;
  if (hive.reducedMotion) { be(p); later(600, then); return; }
  const over = Math.max(700, Math.abs(x - from) * screen);
  be(p);
  hive.moveTo({ x, y: "bottom" }, { over });
  later(over, then);
}
const trotTo = (x, then) => go(x, SCREEN_AT_A_TROT, "walk", then);

/** What it does when nothing calls it: keep someone who waits company, sleep, or potter about. */
function carryOn() {
  if (waitingSince.size) return trotTo(BY_THE_EDGE, () => { be("sit"); later(4000, carryOn); });
  if (pose === "sleep") return;
  const from = hive.spot.x;
  const to = Math.min(0.9, Math.max(0.05, from + (Math.random() - 0.5) * 0.5));
  trotTo(to, () => { be("sit"); later(2500 + Math.random() * 5000, carryOn); });
}

function restartNapClock() {
  clearTimeout(napClock);
  napClock = setTimeout(() => (busy() || playing() ? restartNapClock() : nap()), NAP_AFTER);
}

function nap() {
  if (pose === "walk") { napClock = setTimeout(nap, 1000); return; }
  clearTimeout(next);
  be("sleep");
}

function wake() {
  restartNapClock();
  if (pose === "sleep") be("sit");
}

function restartPlayClock() {
  clearTimeout(playClock);
  playClock = setTimeout(() => {
    if (pose === "sleep" || waitingSince.size || playing()) return restartPlayClock();
    bringBall("bringing you its ball");
  }, WANTS_TO_PLAY);
}

// ── play ───────────────────────────────────────────────────────────────────

/** A boop on the nose: the next of its reactions, never the same twice running; every third, it
 *  goes and gets its ball. */
function boop() {
  const reaction = BOOPS[boops % BOOPS.length];
  boops++;
  be(reaction);
  later(reaction === "roll" ? 2600 : 1600, () => (boops % 3 === 0 ? bringBall() : carryOn()));
}

/** Off for its ball and back with it, then it sits holding it for you to throw. */
function bringBall(what = null) {
  restartPlayClock();
  const from = hive.spot.x;
  const there = from < 0.5 ? Math.min(0.95, from + 0.3) : Math.max(0.05, from - 0.3);
  go(there, SCREEN_AT_A_RUN, "run", () => go(from, SCREEN_CARRYING, "carry", () => hold(what)));
}

function hold(what = null) {
  holding = true;
  be("ball", what);
  later(HOLDS_THE_BALL, () => { holding = false; be("sit"); later(1500, carryOn); });
}

/** You threw the ball: it gallops after it across the screen, pounces, and trots back with it. */
function fetch() {
  holding = false;
  restartPlayClock();
  const from = hive.spot.x;
  const far = from < 0.5 ? 0.82 + Math.random() * 0.13 : 0.05 + Math.random() * 0.13;
  go(far, SCREEN_AT_A_RUN, "run", () => {
    be("jump", "pouncing on its ball");
    later(700, () => go(from, SCREEN_CARRYING, "carry", () => hold()));
  });
}

/** Asleep, a click is a belly rub: it rolls over for it, and dozes off again. */
function bellyRub() {
  clearTimeout(next);
  be("roll", "having a belly rub");
  later(3500, () => be("sleep"));
}

// ── your agents ────────────────────────────────────────────────────────────

function yip(id) {
  wake();
  holding = false;
  if (!hive.options.quiet) hive.notify(`${name()} yips: ${names.get(id) || "an agent"} is waiting on you`);
  be("beg");
  later(2600, carryOn);
}

function stateOf(status, info) {
  const s = info && info.agent && info.agent.state;
  if (s === "waiting" || status === "blocked") return "waiting";
  if (s === "working" || status === "working") return "working";
  if (s === "failed" || s === "limited") return "stuck";
  if (status === "exited" || s === "exited") return "exited";
  return "idle";
}

function heard(id, status, info) {
  const was = states.get(id);
  const now = stateOf(status, info);
  states.set(id, now);
  restartNapClock();
  if (now !== "waiting") waitingSince.delete(id);
  if (now === "waiting" && was !== "waiting") {
    waitingSince.set(id, true);
    return yip(id);
  }
  if (now === "working" && pose === "sleep") { be("sit"); later(1200, carryOn); }
  if (!waitingSince.size && pose === "sit" && was === "waiting") carryOn();
}

hive.on("start", () => {
  hive.moveTo({ x: 0.66, y: "bottom" }, { over: 0 });
  draw();
  // Placed before its picture has loaded, its card is short, and the picture runs off the bottom
  // edge once it shows: placed again once it is drawn, it stands on the edge.
  setTimeout(() => { if (pose === "sit") hive.moveTo({ x: hive.spot.x, y: "bottom" }, { over: 0 }); }, 400);
  restartNapClock();
  restartPlayClock();
  later(1500, carryOn);
  hive.hm.on("structure", ({ tiles }) => {
    const agents = new Set(tiles.filter((t) => t.agent).map((t) => t.id));
    for (const t of tiles) names.set(t.id, t.name);
    for (const [id, stop] of watching) if (!agents.has(id)) { stop(); watching.delete(id); states.delete(id); waitingSince.delete(id); }
    for (const id of agents) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => heard(id, s, info)));
  });
  hive.hm.onEvents(["turn"], () => {
    restartNapClock();
    // A turn done is a leap for joy, unless it is calling you or busy playing with you.
    if (pose === "beg" || pose === "sleep" || playing()) return;
    be("jump");
    later(1600, carryOn);
  });
});

hive.on("click", () => {
  const first = waitingSince.keys().next().value;
  if (first) {
    wake();
    hive.hm.commands.focusTile(first);
    be("sit");
    later(4000, carryOn);
    return;
  }
  if (pose === "sleep") return bellyRub();
  restartNapClock();
  if (holding) return fetch();
  // Mid-fetch, a click does not stop it: it is busy with its ball.
  if (pose === "run" || pose === "carry") return;
  boop();
});

hive.on("options", draw);
hive.on("motion", draw);

hive.hm.onCommand("status", () => ({
  name: name(),
  doing: doing(),
  waitingOn: [...waitingSince.keys()].map((id) => names.get(id) || id),
}));
