// How busy this computer is: processor over the last minute, memory, and the busiest programs.
// It reads them itself where the app can (hm.machineUsage, the permission machine:usage);
// elsewhere its `usage` command takes readings from the feeder (feeders/system-monitor/feed.mjs in hivemind-plugins).
// The history lives only here, never in hive.state: a reading a second would fill the workspace.
/** A reading of this computer, as hm.machineUsage and the feeder give it.
 *  @typedef {{ cpu: number, cores: number, memory: { used: number, total: number }, programs: { name: string, processes: number, cpu: number, memory: number }[] }} Reading */
const HISTORY = 60;
/** The bars of a processor line drawn as text, lowest to highest. */
const BARS = "▁▂▃▄▅▆▇█";
const TEXT_BARS = 28;
/** @type {number[]} */
const cpu = [];
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** @type {Reading | null} */
let last = null;
/** Whether the app reads the computer for it, and so draws charts and tables. */
let reads = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let quiet = null;

// Decimal units, as the system's own monitor shows memory (1 GB = 10^9 bytes).
const GB = 1e9;
/** @param {number} n */
const bytes = (n) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
/** @param {number} n */
const percent = (n) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
/** @param {number} share @param {number} warn @param {number} err @returns {"warn" | "err" | undefined} */
const tone = (share, warn, err) => (share >= err ? "err" : share >= warn ? "warn" : undefined);
/** @param {{ name: string, processes: number }} p */
const named = (p) => (p.processes > 1 ? `${p.name} ×${p.processes}` : p.name);

function draw() {
  if (!last) {
    hive.render({ type: "stack", children: [
      { type: "text", text: "This computer" },
      { type: "text", text: reads ? "Reading this computer…" : "Waiting for readings: start its feeder (see its README).", muted: true, wrap: true },
    ] });
    return;
  }
  const { memory, cores, programs } = last;
  const used = (memory.used / memory.total) * 100;
  const list = programs.slice(0, Number(hive.options.count ?? 5));
  // Charts, tables and tones are drawn by apps that read the computer; typed loosely so it checks on any app.
  /** @type {any[]} */
  const busiest = !list.length ? [] : reads
    ? [{
      type: "table",
      columns: [{ label: "Program" }, { label: "CPU", align: "end" }, { label: "Memory", align: "end" }],
      rows: list.map((p) => [named(p), percent(p.cpu), bytes(p.memory)]),
    }]
    : [
      { type: "text", text: "Busiest programs", muted: true },
      ...list.map((p) => /** @type {Node} */ ({ type: "meter", value: p.cpu, max: Math.max(list[0]?.cpu ?? 0, 1), label: `${named(p)} · ${percent(p.cpu)} · ${bytes(p.memory)}` })),
    ];
  /** @type {any} */
  const line = reads
    ? { type: "chart", values: cpu, max: 100, span: HISTORY, label: "Processor, last minute", tone: tone(last.cpu, 75, 90) }
    : { type: "text", text: cpu.slice(-TEXT_BARS).map((v) => BARS[Math.min(BARS.length - 1, Math.floor((v / 100) * BARS.length))]).join("") };
  hive.render({ type: "stack", children: [
    { type: "row", children: [
      { type: "number", value: percent(last.cpu), label: `processor, ${cores} cores` },
      { type: "number", value: bytes(memory.used), label: `memory of ${bytes(memory.total)}` },
    ] },
    line,
    /** @type {any} */ ({ type: "meter", value: memory.used, max: memory.total, label: `Memory ${Math.round(used)}% used`, tone: tone(used, 85, 95) }),
    ...busiest,
  ] });
}

/** @param {Reading} u */
function take(u) {
  last = u;
  cpu.push(u.cpu);
  if (cpu.length > HISTORY) cpu.shift();
  draw();
}

async function read() {
  try {
    const u = await hive.hm.machineUsage({ by: hive.options.sort === "memory" ? "memory" : "cpu", count: Number(hive.options.count ?? 5) });
    if (!u || typeof u.cpu !== "number") throw new Error("no reading");
    take(u);
  } catch {
    // This app cannot read the computer: the feeder's readings are drawn instead.
    if (timer) clearInterval(timer);
    timer = null;
    reads = false;
    draw();
  }
}

function start() {
  if (timer) clearInterval(timer);
  reads = true;
  const every = Math.min(10, Math.max(1, Number(hive.options.every ?? 1)));
  timer = setInterval(read, every * 1000);
  read();
}

/** What the feeder should send: how often, sorted how, and how many programs (its options). */
const wanted = () => ({
  every: Math.min(10, Math.max(1, Number(hive.options.every ?? 1))),
  by: hive.options.sort === "memory" ? "memory" : "cpu",
  count: Math.min(10, Math.max(0, Number(hive.options.count ?? 5))),
});

hive.hm.onCommand("usage", (/** @type {Reading} */ u) => {
  if (reads || !u || typeof u.cpu !== "number" || !u.memory) return { taken: false, ...wanted() };
  take(u);
  // No reading for a while: the feeder stopped, so say so instead of showing old figures.
  if (quiet) clearTimeout(quiet);
  quiet = setTimeout(() => { last = null; draw(); }, 10_000 + wanted().every * 2000);
  return { taken: true, ...wanted() };
});

hive.on("start", start);
hive.on("options", () => { if (reads) start(); else draw(); });
