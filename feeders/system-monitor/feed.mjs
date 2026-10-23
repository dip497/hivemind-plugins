// Feeds the System monitor widget (@dip497/system-monitor) on apps without hm.machineUsage: reads this
// computer every second and hands each reading to the widget's `usage` command, over one
// connection to the running app that is kept open and opened again when the app restarts.
//
//   node feed.mjs
// How often it reads, how it sorts and how many programs it sends are the widget's options: the
// widget says them in its answer to each reading.
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import os from "node:os";
import { connect } from "hivemind-api";

if (process.platform !== "linux") { console.error("the feeder reads /proc, so it runs on Linux only"); process.exit(1); }

const PLUGIN = "@dip497/system-monitor";
/** What the widget asked for last; until it answers, a reading a second of the 5 busiest. */
let want = { every: 1, by: "cpu", count: 5 };
const TICKS_PER_SECOND = 100;
const PAGE_BYTES = 4096;

// The person's connection, not an agent's: the feeder outlives any tile.
delete process.env.HCP_TOKEN;

const processorTimes = () => {
  let busy = 0, all = 0;
  for (const { times: t } of os.cpus()) {
    const sum = t.user + t.nice + t.sys + t.idle + t.irq;
    all += sum; busy += sum - t.idle;
  }
  return { busy, all };
};

// One buffer for every /proc read: a promise per file costs ten times the reading itself.
const buf = Buffer.alloc(4096);
const small = (file) => {
  const fd = openSync(file, "r");
  try { return buf.latin1Slice(0, readSync(fd, buf, 0, buf.length, 0)); } finally { closeSync(fd); }
};

/** Every process, by pid: its name, start (with the pid, which process it is), processor seconds and memory. */
function processes() {
  const seen = new Map();
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    let stat;
    try { stat = small(`/proc/${pid}/stat`); } catch { continue; }
    const close = stat.lastIndexOf(")");
    const f = stat.slice(close + 2).split(" ");
    seen.set(pid, { name: stat.slice(stat.indexOf("(") + 1, close), start: f[19], seconds: (Number(f[11]) + Number(f[12])) / TICKS_PER_SECOND, memory: Number(f[21]) * PAGE_BYTES });
  }
  return seen;
}

/** Linux cuts a name to 15 characters; the program's file name is whole. */
function fullName(pid, name) {
  if (name.length < 15) return name;
  try {
    const base = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0].split("/").pop() ?? "";
    return base.startsWith(name) ? base : name;
  } catch { return name; }
}

function memory() {
  const total = os.totalmem();
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(small("/proc/meminfo"));
    if (m) return { used: total - Number(m[1]) * 1024, total };
  } catch {}
  return { used: total - os.freemem(), total };
}

let lastTimes = processorTimes();
let lastAt = performance.now();
let lastProcs = processes();
const round = (n) => Math.round(n * 10) / 10;

function reading() {
  const now = performance.now();
  const times = processorTimes();
  const cores = Math.max(1, os.cpus().length);
  const all = times.all - lastTimes.all;
  const cpu = all > 0 ? Math.min(100, Math.max(0, ((times.busy - lastTimes.busy) / all) * 100)) : 0;
  const elapsed = (now - lastAt) / 1000;
  const procs = processes();
  const byName = new Map();
  for (const [pid, p] of procs) {
    const before = lastProcs.get(pid);
    const used = before && before.start === p.start ? p.seconds - before.seconds : p.seconds;
    const share = elapsed > 0 ? Math.max(0, used / (elapsed * cores)) * 100 : 0;
    const g = byName.get(p.name);
    if (!g) byName.set(p.name, { name: p.name, processes: 1, cpu: share, memory: p.memory, pid, top: share });
    else { g.processes++; g.cpu += share; g.memory += p.memory; if (share > g.top) { g.top = share; g.pid = pid; } }
  }
  lastTimes = times; lastAt = now; lastProcs = procs;
  const sort = want.by === "memory" ? (a, b) => b.memory - a.memory : (a, b) => b.cpu - a.cpu || b.memory - a.memory;
  const top = [...byName.values()].sort(sort).slice(0, want.count);
  const programs = top.map((p) => ({ name: fullName(p.pid, p.name), processes: p.processes, cpu: round(p.cpu), memory: p.memory }));
  return { cpu: round(cpu), cores, memory: memory(), programs };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (;;) {
  let hive;
  try { hive = await connect(); } catch (e) { console.error(`no Hivemind app answers (${e.message}); trying again`); await wait(5000); continue; }
  console.error("connected");
  let open = true;
  hive.closed.then(() => { open = false; });
  while (open) {
    const started = performance.now();
    const usage = reading();
    // Not placed, or its window is gone: say nothing and keep trying, as the widget may come back.
    const answer = await hive.call("plugin.call", [PLUGIN, "usage", usage], { timeoutMs: 5000 }).catch(() => null);
    const r = answer?.result;
    if (r && typeof r.every === "number" && typeof r.count === "number" && (r.by === "cpu" || r.by === "memory")) {
      const next = { every: Math.min(10, Math.max(1, r.every)), by: r.by, count: Math.min(20, Math.max(0, Math.floor(r.count))) };
      if (JSON.stringify(next) !== JSON.stringify(want)) console.error(`now every ${next.every} s, by ${next.by}, ${next.count} programs`);
      want = next;
    }
    await wait(Math.max(0, want.every * 1000 - (performance.now() - started)));
  }
  console.error("the app closed the connection; reconnecting");
  await wait(2000);
}
