// The Den pup: a wolf pup that lives along the bottom of the screen and keeps an eye on your
// agents. It yips and begs when one starts waiting on you and sits by the right edge until you
// answer, leaps when a turn finishes, and curls up asleep once every agent has been idle a while.
// Click it to go to the agent that waits; click it when nobody waits and it jumps for joy.
// It reads the agents through hive.hm and asks for no permission.
//
// pup.webp is one sheet of frames 160 x 128, eight a row, rendered from the Den pup's 3D model:
// walk, sit (wagging), sleep (breathing), beg (play bow, yipping) and jump.
const ROWS = { walk: [0, 12], sit: [1, 10], sleep: [2, 4], beg: [3, 10], jump: [4, 12] }; // row, frames a second
const FRAME = { w: 160, h: 128, frames: 8, scale: 0.72 };
const SCREEN_AT_A_TROT = 12000; // ms to cross the whole screen: it never goes faster than this
const NAP_AFTER = 90_000;
const BY_THE_EDGE = 0.93;

const states = new Map(); // tile id -> working | waiting | idle | stuck | exited
const watching = new Map();
const names = new Map();
const waitingSince = new Map(); // in the order they started waiting
let pose = "sit";
let facing = 1;
let next = null;
let napClock = null;

const name = () => String(hive.options.name || "Pip");
const busy = () => [...states.values()].some((s) => s === "working" || s === "waiting");

function draw() {
  const [row, fps] = ROWS[pose];
  hive.render({
    type: "sprite", src: "pup.webp", frameW: FRAME.w, frameH: FRAME.h, row, frames: FRAME.frames, fps,
    scale: FRAME.scale, flip: facing < 0, pixelated: false, label: `${name()} is ${doing()}`,
  });
}

function doing() {
  if (pose === "sleep") return "asleep";
  if (pose === "beg") return "yipping";
  if (pose === "jump") return "jumping";
  if (pose === "walk") return "trotting";
  return waitingSince.size ? "waiting with you" : "sitting";
}

const later = (ms, f) => { clearTimeout(next); next = setTimeout(f, ms); };
const be = (p) => { pose = p; draw(); };

function trotTo(x, then) {
  const from = hive.spot.x;
  if (Math.abs(x - from) < 0.01) return then();
  facing = x >= from ? 1 : -1;
  const over = Math.max(700, Math.abs(x - from) * SCREEN_AT_A_TROT);
  be("walk");
  hive.moveTo({ x, y: "bottom" }, { over });
  later(over, then);
}

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
  napClock = setTimeout(() => (busy() ? restartNapClock() : nap()), NAP_AFTER);
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

function yip(id) {
  wake();
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
  restartNapClock();
  later(1500, carryOn);
  hive.hm.on("structure", ({ tiles }) => {
    const agents = new Set(tiles.filter((t) => t.agent).map((t) => t.id));
    for (const t of tiles) names.set(t.id, t.name);
    for (const [id, stop] of watching) if (!agents.has(id)) { stop(); watching.delete(id); states.delete(id); waitingSince.delete(id); }
    for (const id of agents) if (!watching.has(id)) watching.set(id, hive.hm.subscribeStatus(id, (s, info) => heard(id, s, info)));
  });
  hive.hm.onEvents(["turn"], () => {
    wake();
    if (pose === "beg") return;
    be("jump");
    later(1600, carryOn);
  });
});

hive.on("click", () => {
  wake();
  const first = waitingSince.keys().next().value;
  if (first) {
    hive.hm.commands.focusTile(first);
    be("sit");
    later(4000, carryOn);
  } else {
    // Nobody waits: a pat on the head, and it jumps for joy.
    be("jump");
    later(1600, carryOn);
  }
});

hive.on("options", draw);

hive.hm.onCommand("status", () => ({
  name: name(),
  doing: doing(),
  waitingOn: [...waitingSince.keys()].map((id) => names.get(id) || id),
}));
