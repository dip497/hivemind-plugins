// The widgets here, each run as the app runs it: the app's widget prelude and the widget's own code
// in one worker scope, driven by the messages the window sends (start, a press, hive.hm's
// callbacks, an agent's command), and judged by what it draws and answers.
import { expect, setSystemTime, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT as REPO, core } from "./app";
import { flat, run as runIn, type Node } from "./helpers/widget";

const { readWidget } = await core("widgets.ts");
const ROOT = path.join(REPO, "widgets");
/** The widget `name` under widgets/ (or a path from there), run. */
const run = (name: string, how?: Parameters<typeof runIn>[1]) => runIn(path.join(ROOT, name), how);

const texts = (n: Node | undefined) => flat(n).flatMap((x) => [x.text, x.label, x.value === undefined ? undefined : String(x.value)]).filter((t): t is string => !!t);

test("every widget here is one the app reads, under its folder's name, with a version, an icon and the commands an agent runs", async () => {
  // Those a package holds too: packages/<package>/widgets/<name>.
  const all = [...readdirSync(ROOT).map((name) => ({ name, dir: path.join(ROOT, name) })),
    ...readdirSync(path.join(REPO, "packages")).flatMap((p) => {
      const dir = path.join(REPO, "packages", p, "widgets");
      return existsSync(dir) ? readdirSync(dir).map((name) => ({ name, dir: path.join(dir, name) })) : [];
    })];
  for (const { name, dir } of all) {
    const w = await readWidget(dir);
    // HiveHub lists it under the id its widget.json says.
    const { id } = JSON.parse(readFileSync(path.join(dir, "widget.json"), "utf8"));
    expect([id, w.code.length > 0, !!w.version, w.icon?.startsWith("data:image/"), w.commands.length > 0]).toEqual([`@dip497/${name}`, true, true, true, true]);
  }
});

test("CI light: a failed report turns it red with its detail, notifies once, and its button asks an agent to fix that build", async () => {
  const w = run("ci-light");
  expect(texts(w.tree())).toContain("No build yet");
  await w.command("set", { state: "failed", name: "CI", branch: "main", detail: "typecheck: 2 errors" });
  await w.command("set", { state: "failed", name: "CI", branch: "main", detail: "typecheck: 2 errors" });
  const tree = w.tree();
  expect(flat(tree).find((n) => n.type === "image")?.src).toBe("light-failed.svg");
  expect(texts(tree)).toContain("typecheck: 2 errors");
  // The detail is shown whole, on as many lines as it needs.
  expect(flat(tree).find((n) => n.type === "text" && n.text === "typecheck: 2 errors")?.wrap).toBe(true);
  expect(w.notes()).toEqual(["CI failed on main"]);
  await w.press("fix");
  const spawn = w.calls.find((c) => c.path.join(".") === "commands.spawnAgent");
  expect((spawn?.args[2] as { prompt: string }).prompt).toContain('The build "CI" on main failed: typecheck: 2 errors');
  expect(await w.command("set", { state: "green" })).toEqual({ error: "state must be one of passed, failed, running, unknown" });
  await w.command("set", { state: "passed" });
  expect(flat(w.tree()).find((n) => n.type === "image")?.src).toBe("light-passed.svg");
  expect(flat(w.tree()).some((n) => n.type === "button")).toBe(false);
});

test("CI light: a `hive ctl view emit ci.build` event sets it as the command does", async () => {
  const w = run("ci-light");
  await w.emit("ci.build", { state: "running", name: "Deploy" });
  expect(texts(w.tree())).toContain("Build running");
});

test("Test meter: a run reported shows the share passing and its failures, and earlier runs stay below it", async () => {
  const w = run("test-meter");
  await w.command("report", { passed: 40, failed: 0 });
  await w.command("report", { passed: 397, failed: 3, skipped: 2, failing: ["auth › refresh"] });
  const all = texts(w.tree());
  expect(all).toContain("99.2%");
  expect(all).toContain("Failing: auth › refresh");
  expect(all.some((t) => t.startsWith("✓ 40 passed"))).toBe(true);
  expect(flat(w.tree()).find((n) => n.type === "image")?.src).toBe("failing.svg");
  expect(w.notes()).toEqual(["3 tests failing"]);
  expect(await w.command("report", { passed: "many" })).toEqual({ error: "passed and failed must be numbers" });
});

test("Spend today: reports add up per agent, the budget notifies once when crossed, and yesterday's total is not today's", async () => {
  const w = run("spend-today", { options: { budget: 5 }, state: { day: "Mon Jan 01 2001", by: { old: { usd: 99, tokens: 1 } } } });
  expect(texts(w.tree())).toContain("$0.00");
  await w.command("add", { usd: 3, tokens: 1_200_000, agent: "claude" });
  await w.command("add", { usd: 2.5, tokens: 300_000, agent: "claude" });
  await w.command("add", { usd: 1, agent: "codex" });
  const today = await w.command("today");
  expect([today.usd, today.tokens, today.byAgent]).toEqual([6.5, 1_500_000, { claude: { usd: 5.5, tokens: 1_500_000 }, codex: { usd: 1, tokens: 0 } }]);
  expect(w.notes()).toEqual(["Today's agent budget of $5.00 is spent."]);
  expect(texts(w.tree())).toContain("over today's $5.00");
  expect(await w.command("add", { usd: -2 })).toEqual({ error: "add needs usd or tokens, as positive numbers" });
});

test("Focus timer: started for a length it counts that down, and paused it keeps the time left", async () => {
  const w = run("focus-timer", { options: { focus: 25, break: 5 } });
  expect(texts(w.tree())).toContain("25:00");
  expect(await w.command("start", { minutes: 10 })).toEqual({ phase: "focus", running: true, left: "10:00", rounds: 0 });
  const paused = await w.command("pause");
  expect([paused.running, paused.left]).toEqual([false, "10:00"]);
  expect(texts(w.tree())).toContain("Resume");
  await w.press("switch");
  expect(texts(w.tree())).toContain("05:00");
});

test("Waiting on you: an agent that asks shows with why, longest first; pressing it focuses it; answered, it leaves", async () => {
  const w = run("waiting-on-you");
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "b", agent: "codex", name: "docs" }, { id: "t", kind: "term", name: "shell" }] });
  expect(w.calls.filter((c) => c.path[0] === "subscribeStatus").map((c) => c.args[0])).toEqual(["a", "b"]);
  await w.fireNth("subscribeStatus", 1, "blocked", { since: Date.now() - 120_000, agent: { state: "waiting", waitingFor: "question" } });
  await w.fireNth("subscribeStatus", 0, "blocked", { since: Date.now() - 5_000, agent: { state: "waiting", waitingFor: "permission" } });
  const buttons = flat(w.tree()).filter((n) => n.type === "button");
  expect(buttons.map((b) => b.label)).toEqual(["docs asked you something · 2m", "tests wants permission · 5s"]);
  await w.press(buttons[0]!.action);
  expect(w.calls.find((c) => c.path.join(".") === "commands.focusTile")?.args).toEqual(["b"]);
  await w.fireNth("subscribeStatus", 1, "working", { agent: { state: "working" } });
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  expect(texts(w.tree())).toContain("All 2 agents are getting on with it.");
});

test("Agent pulse: it counts agents by what they are doing, and today's turns from history plus each turn after", async () => {
  let answer = (_: unknown) => {};
  const history = new Promise((r) => { answer = r; });
  const w = run("agent-pulse", { replies: { history } });
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude" }, { id: "b", agent: "codex" }, { id: "c", agent: "pi" }] });
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  await w.fireNth("subscribeStatus", 1, "blocked", { agent: { state: "waiting" } });
  await w.fireNth("subscribeStatus", 2, "idle", { agent: { state: "idle" } });
  // A turn that ends while the day's history is on its way counts as well as the ones before it.
  await w.fire("onEvents", { kind: "turn" });
  answer({ tiles: [{ turns: [1, 2, 3] }, { turns: [4] }] });
  await new Promise((r) => setTimeout(r, 0));
  expect(await w.command("status")).toEqual({ working: 1, waiting: 1, idle: 1, stuck: 0, turnsToday: 5 });
  expect(texts(w.tree())).toContain("33% of 3 agents busy");
});

test("Agent pulse: left open past midnight, its turns today start again from the new day's turns", async () => {
  setSystemTime(new Date(2026, 9, 18, 23, 59));
  try {
    const w = run("agent-pulse", { replies: { history: { tiles: [{ turns: [1, 2] }] } } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await w.command("status")).turnsToday).toBe(2);
    setSystemTime(new Date(2026, 9, 19, 0, 1));
    await w.fire("onEvents", { kind: "turn" });
    expect((await w.command("status")).turnsToday).toBe(1);
  } finally {
    setSystemTime();
  }
});

test("Issue burndown: an issue is open each day from its creation until the day it was closed", async () => {
  const w = run("issue-burndown", { options: { days: 3 } });
  const day = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
  await w.fire("onIssues", [
    { id: "A-1", state: "todo", created: day(5), updated: day(5) },
    { id: "A-2", state: "done", created: day(5), updated: day(1) },
    { id: "A-3", state: "in_progress", created: new Date(Date.now() - 1000).toISOString(), updated: new Date().toISOString() },
    { id: "A-4", state: "cancelled", created: day(4), updated: day(3) },
  ]);
  expect((await w.command("burndown") as unknown as { open: number }[]).map((d) => d.open)).toEqual([2, 1, 2]);
  expect(flat(w.tree()).filter((n) => n.type === "meter").map((n) => n.value)).toEqual([2, 1, 2]);
});

test("Launchpad: a press starts the default agent with that button's job as its message", async () => {
  const w = run("launchpad", { options: { twoLabel: "Ship it", two: "Cut the release." } });
  const button = flat(w.tree()).find((n) => n.label === "▶  Ship it")!;
  await w.press(button.action);
  expect(w.calls.find((c) => c.path.join(".") === "commands.spawnAgent")?.args).toEqual([null, null, { name: "Ship it", prompt: "Cut the release." }]);
});

test("Dog: it barks, and notifies once, when an agent starts waiting on you, sits by it at a walk, and a click goes to that agent", async () => {
  const w = run("dog");
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "t", kind: "term", name: "shell" }] });
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  expect(w.notes()).toEqual([]);
  await w.fireNth("subscribeStatus", 0, "blocked", { agent: { state: "waiting", waitingFor: "question" } });
  await w.fireNth("subscribeStatus", 0, "blocked", { agent: { state: "waiting", waitingFor: "question" } });
  expect(w.tree().label).toBe("Biscuit is barking");
  expect(w.notes()).toEqual(["Biscuit barks: tests is waiting on you"]);
  await w.wait(20_000);
  expect(w.tree().label).toBe("Biscuit is waiting with you");
  expect(await w.command("status")).toEqual({ name: "Biscuit", doing: "waiting with you", waitingOn: ["tests"] });
  const moves = w.posted.filter((m) => m.type === "move") as unknown as { x: number; over: number }[];
  expect(moves.at(-1)!.x).toBeGreaterThan(0.9);
  // Never faster than a walk: a whole screen's width takes it 14 s.
  for (let i = 1; i < moves.length; i++) expect(moves[i]!.over).toBeGreaterThanOrEqual(Math.abs(moves[i]!.x - moves[i - 1]!.x) * 14_000);
  await w.click();
  expect(w.calls.find((c) => c.path.join(".") === "commands.focusTile")?.args).toEqual(["a"]);
});

test("Dog: it naps once every agent has been idle a while, not while one works, and wakes when one starts", async () => {
  const w = run("dog", { options: { name: "Rex" } });
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "b", agent: "codex", name: "docs" }] });
  await w.fireNth("subscribeStatus", 0, "idle", { agent: { state: "idle" } });
  await w.fireNth("subscribeStatus", 1, "working", { agent: { state: "working" } });
  await w.wait(300_000);
  expect(w.tree().label).not.toBe("Rex is asleep");
  await w.fireNth("subscribeStatus", 1, "idle", { agent: { state: "idle" } });
  await w.wait(120_000);
  expect(w.tree().label).toBe("Rex is asleep");
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  expect(w.tree().label).not.toBe("Rex is asleep");
});

test("Dog: quiet, it still barks but sends no notification", async () => {
  const w = run("dog", { options: { quiet: true } });
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }] });
  await w.fireNth("subscribeStatus", 0, "blocked", { agent: { state: "waiting" } });
  expect(w.tree().label).toBe("Biscuit is barking");
  expect(w.notes()).toEqual([]);
});

type Move = { x: number; y: number; over: number };
const movesOf = (w: ReturnType<typeof run>) => w.posted.filter((m) => m.type === "move") as unknown as Move[];
/** Let its time pass until what it draws says it rests, or a few minutes have gone. */
async function untilResting(w: ReturnType<typeof run>) {
  for (let i = 0; i < 600 && !String(w.tree().label).endsWith("resting"); i++) await w.wait(500);
  return String(w.tree().label);
}

test("Butterflies: it flutters in short glides, then lands and rests with slower wings", async () => {
  const w = run("butterflies");
  expect(w.tree().label).toMatch(/butterfly, fluttering$/);
  await w.wait(5_000);
  const legs = movesOf(w).slice(1);
  expect(legs.length).toBeGreaterThan(10);
  // Short glides, one after another, never a dash across the screen.
  for (const [i, m] of legs.entries()) {
    expect(m.over).toBeLessThan(500);
    if (i) expect(Math.hypot(m.x - legs[i - 1]!.x, m.y - legs[i - 1]!.y)).toBeLessThan(0.12);
  }
  expect(await untilResting(w)).toMatch(/butterfly, resting$/);
  const before = movesOf(w).length;
  await w.wait(3_000);
  expect(movesOf(w).length).toBe(before);
  expect((w.tree() as { fps?: number }).fps).toBeLessThan(10);
});

test("Butterflies: an agent getting to work, a turn ending or a click sends a resting one off fast", async () => {
  const w = run("butterflies");
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }] });
  await w.fireNth("subscribeStatus", 0, "idle", { agent: { state: "idle" } });
  for (const send of [
    () => w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } }),
    () => w.fire("onEvents", { kind: "turn", tileId: "a" }),
    () => w.click(),
  ]) {
    await untilResting(w);
    await w.fireNth("subscribeStatus", 0, "idle", { agent: { state: "idle" } });
    const from = movesOf(w).length;
    await send();
    expect(w.tree().label).toMatch(/scattering$/);
    await w.wait(1_000);
    const dash = movesOf(w).slice(from - 1);
    // Faster than it flutters about: a fifth of the screen and more in a second.
    const flown = dash.slice(1).reduce((sum, m, i) => sum + Math.hypot(m.x - dash[i]!.x, m.y - dash[i]!.y), 0);
    expect(flown).toBeGreaterThan(0.2);
  }
});

test("Butterflies: each one placed keeps a colour of its own, and the colour option sets it", async () => {
  const w = run("butterflies");
  const kept = w.state().colour;
  expect(["orange", "blue", "yellow", "pink", "green"]).toContain(kept as string);
  expect(run("butterflies", { state: { colour: "pink" } }).tree().label).toMatch(/^A pink butterfly/);
  expect(run("butterflies", { state: { colour: "pink" }, options: { colour: "blue" } }).tree().label).toMatch(/^A blue butterfly/);
  expect(await run("butterflies").command("scatter")).toMatchObject({ doing: "scattering" });
});

test("a widget that reads what it may do draws at once, before the app has sent hive.hm's values", async () => {
  for (const name of ["ci-light", "launchpad"]) {
    const w = run(name, { values: false });
    expect([name, w.tree()?.type]).toEqual([name, "stack"]);
  }
});

const ARCHIPELAGO = "../packages/archipelago/widgets";

test("Harbour: boats calling you wait at the dock longest first with their project, a finished agent waits in port, pressing one goes to it, and the bell rings for a new one", async () => {
  const w = run(`${ARCHIPELAGO}/harbour`, { options: { bell: true } });
  await w.fire("on:structure", {
    frames: [{ id: "f1", title: "web-app" }, { id: "f2", title: "infra" }],
    tiles: [{ id: "a", agent: "claude", name: "tests", frameId: "f1" }, { id: "b", agent: "codex", name: "docs", frameId: "f2" }, { id: "c", agent: "pi", name: "api", frameId: "f1" }, { id: "d", agent: "pi", name: "lint", frameId: "f2" }, { id: "t", kind: "term", name: "shell" }],
  });
  expect(w.calls.filter((c) => c.path[0] === "subscribeStatus").map((c) => c.args[0])).toEqual(["a", "b", "c", "d"]);
  await w.fireNth("subscribeStatus", 0, "blocked", { since: Date.now() - 5_000, agent: { state: "waiting", waitingFor: "permission" } });
  await w.fireNth("subscribeStatus", 1, "blocked", { since: Date.now() - 120_000, agent: { state: "waiting", waitingFor: "question" } });
  await w.fireNth("subscribeStatus", 2, "idle", { since: Date.now() - 60_000, agent: { state: "done" } });
  await w.fireNth("subscribeStatus", 3, "working", { agent: { state: "working" } });
  const buttons = flat(w.tree()).filter((n) => n.type === "button");
  expect(buttons.map((b) => b.label)).toEqual(["docs · infra asked you something · 2m", "tests · web-app wants permission · 5s", "api · web-app · back 1m ago"]);
  expect(texts(w.tree())).toContain("1 more out at work");
  expect(w.notes()).toEqual(["tests · web-app wants permission", "docs · infra asked you something"]);
  await w.press(buttons[2]!.action);
  expect(w.calls.find((c) => c.path.join(".") === "commands.focusTile")?.args).toEqual(["c"]);
  expect(await w.command("dock")).toMatchObject({ calling: [{ id: "b", project: "infra" }, { id: "a", project: "web-app" }], inPort: [{ id: "c" }], atWork: 1 });
  // Set to work again, it sails out of port; answered, a boat leaves the dock.
  for (const n of [2, 0, 1]) await w.fireNth("subscribeStatus", n, "working", { agent: { state: "working" } });
  expect(texts(w.tree())).toContain("Calm harbour: 4 of 4 agents out at work, none waiting on you.");
});

test("Town ledger: a project's turns over the week, its worktree's with it, raise its town; today's show apart, a turn now counts at once, a quiet project says so, and a history that trailed is read again", async () => {
  // Every day of the week answers the same: two turns in docs, one in its worktree.
  const replies: Record<string, unknown> = { history: { tiles: [{ frameId: "docs", turns: [1, 2] }, { frameId: "fix", turns: [3] }] } };
  const w = run(`${ARCHIPELAGO}/town-ledger`, { replies });
  await w.fire("on:structure", {
    frames: [{ id: "docs", title: "docs" }, { id: "fix", title: "fix-login", parentId: "docs" }, { id: "api", title: "api" }],
    tiles: [{ id: "a", agent: "claude", frameId: "api" }],
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(await w.command("ledger")).toEqual([
    { project: "docs", turns: 21, today: 3, town: "church", next: { town: "castle", turnsToGo: 3 }, quietDays: 0 },
    { project: "api", turns: 0, today: 0, town: "well", next: { town: "windmill", turnsToGo: 4 }, quietDays: 7 },
  ]);
  expect(texts(w.tree())).toContain("api · quiet all week");
  await w.fire("onEvents", { kind: "turn", tileId: "a", outcome: "done" });
  // A turn that failed builds nothing.
  await w.fire("onEvents", { kind: "turn", tileId: "a", outcome: "failed" });
  expect((await w.command("ledger"))[1]).toEqual({ project: "api", turns: 1, today: 1, town: "well", next: { town: "windmill", turnsToGo: 3 }, quietDays: 0 });
  expect(flat(w.tree()).filter((n) => n.type === "image").map((n) => n.src)).toEqual(["church.svg", "well.svg"]);
  // Today's history caught up with two more turns in docs: read again, the larger count stands.
  replies.history = { tiles: [{ frameId: "docs", turns: [1, 2, 3, 4] }, { frameId: "fix", turns: [5] }] };
  await w.wait(15_000);
  await new Promise((r) => setTimeout(r, 0));
  expect((await w.command("ledger"))[0]).toMatchObject({ project: "docs", turns: 23, today: 5 });
});

test("Weather: a storm when one stopped, with a button to it; a squall when some call you, with one to the longest waiting; fair while they work; becalmed when all rest", async () => {
  const w = run(`${ARCHIPELAGO}/weather`);
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "b", agent: "codex", name: "docs" }, { id: "c", agent: "pi", name: "api" }] });
  const sky = async () => ((await w.command("forecast")) as { weather: string }).weather;
  expect(await sky()).toBe("becalmed");
  await w.fireNth("subscribeStatus", 0, "working", { agent: { state: "working" } });
  await w.fireNth("subscribeStatus", 1, "idle", { agent: { state: "idle" } });
  expect(await sky()).toBe("fair");
  await w.fireNth("subscribeStatus", 2, "blocked", { since: Date.now() - 1_000, agent: { state: "waiting" } });
  await w.fireNth("subscribeStatus", 1, "blocked", { since: Date.now() - 90_000, agent: { state: "waiting" } });
  expect(await sky()).toBe("squall");
  expect(texts(w.tree())).toContain("2 calling you · 1 at work");
  const go = flat(w.tree()).filter((n) => n.type === "button");
  expect(go.map((b) => b.label)).toEqual(["Go to docs, waiting longest"]);
  await w.press(go[0]!.action);
  expect(w.calls.find((c) => c.path.join(".") === "commands.focusTile")?.args).toEqual(["b"]);
  await w.fireNth("subscribeStatus", 0, "idle", { agent: { state: "failed" } });
  expect(await w.command("forecast")).toMatchObject({ weather: "storm", working: 0, calling: 2, failed: 1, idle: 0, stopped: ["tests"], waitingLongest: "docs" });
  expect(flat(w.tree()).filter((n) => n.type === "button").map((b) => b.label)).toEqual(["Go to tests, stopped", "Go to docs, waiting longest"]);
  expect(flat(w.tree()).find((n) => n.type === "image")?.src).toBe("storm.svg");
});

test("Harbour: an agent without hooks, seen go from working to idle, is back in port too", async () => {
  const w = run(`${ARCHIPELAGO}/harbour`);
  await w.fire("on:structure", { frames: [], tiles: [{ id: "a", agent: "standin", name: "refunds" }, { id: "b", agent: "standin", name: "lint" }] });
  await w.fireNth("subscribeStatus", 0, "working", {});
  await w.fireNth("subscribeStatus", 0, "idle", {});
  // One idle from the start never sailed: it is not back from anything.
  await w.fireNth("subscribeStatus", 1, "idle", {});
  expect(await w.command("dock")).toMatchObject({ calling: [], inPort: [{ id: "a", name: "refunds" }], atWork: 0 });
  await w.fireNth("subscribeStatus", 0, "working", {});
  expect(((await w.command("dock")) as { inPort: unknown[] }).inPort).toEqual([]);
});

test("Weather: the weather has held since the first agent came to be in the mood that makes it, not since the widget opened", async () => {
  const w = run(`${ARCHIPELAGO}/weather`);
  await w.fire("on:structure", { tiles: [{ id: "a", agent: "claude", name: "tests" }, { id: "b", agent: "codex", name: "docs" }] });
  await w.fireNth("subscribeStatus", 0, "blocked", { since: Date.now() - 12 * 60_000, agent: { state: "waiting" } });
  await w.fireNth("subscribeStatus", 1, "blocked", { since: Date.now() - 60_000, agent: { state: "waiting" } });
  expect(await w.command("forecast")).toMatchObject({ weather: "squall", for: "12m" });
  expect(texts(w.tree())).toContain("Squall for 12m");
});

test("Ship's log: turns, calls, arrivals and departures land newest first, once each, with who and where; an open agent's entry goes to it, a closed one's only reads; it keeps its log across a restart", async () => {
  const now = Date.now();
  const w = run(`${ARCHIPELAGO}/ships-log`, { options: { shown: 6, comings: true } });
  await w.fire("on:structure", { frames: [{ id: "f1", title: "web-app" }], tiles: [{ id: "a", agent: "claude", name: "refunds", frameId: "f1" }, { id: "b", agent: "codex", name: "lint", frameId: "f1" }] });
  await w.fire("onEvents", { kind: "tileOpened", seq: 1, at: now - 600_000, tileId: "b", agent: "codex", spawnedBy: "a" });
  await w.fire("onEvents", { kind: "turn", seq: 2, at: now - 120_000, tileId: "a", outcome: "done" });
  await w.fire("onEvents", { kind: "needsInput", seq: 3, at: now - 30_000, tileId: "b", reason: "permission" });
  // The same event again, as a replay brings it: logged once.
  await w.fire("onEvents", { kind: "turn", seq: 2, at: now - 120_000, tileId: "a", outcome: "done" });
  await w.fire("onEvents", { kind: "tileClosed", seq: 4, at: now - 5_000, tileId: "a", lastStatus: "exited", failed: true });
  expect(await w.command("log")).toEqual([
    { when: "5s", agent: "refunds · web-app", what: "stopped, error", needsYou: false, open: true },
    { when: "30s", agent: "lint · web-app", what: "needs your OK", needsYou: true, open: true },
    { when: "2m", agent: "refunds · web-app", what: "finished", needsYou: false, open: true },
    { when: "10m", agent: "lint · web-app", what: "started, by refunds · web-app", needsYou: false, open: true },
  ]);
  // refunds is gone from the workspace: its entries read, they no longer go anywhere.
  await w.fire("on:structure", { frames: [{ id: "f1", title: "web-app" }], tiles: [{ id: "b", agent: "codex", name: "lint", frameId: "f1" }] });
  const tree = flat(w.tree());
  expect(tree.filter((n) => n.type === "button").map((n) => n.label)).toEqual(["30s · lint · web-app needs your OK", "10m · lint · web-app started, by refunds · web-app"]);
  await w.press(tree.find((n) => n.type === "button")!.action);
  expect(w.calls.find((c) => c.path.join(".") === "commands.focusTile")?.args).toEqual(["b"]);
  // Started again, it reads the log it kept.
  const again = run(`${ARCHIPELAGO}/ships-log`, { state: w.state(), options: { shown: 6, comings: false } });
  await again.fire("on:structure", { frames: [], tiles: [] });
  expect(((await again.command("log")) as unknown[]).length).toBe(4);
  // With arrivals and departures off, only turns and calls are logged.
  await again.fire("onEvents", { kind: "tileOpened", seq: 9, at: Date.now(), tileId: "c", agent: "pi" });
  expect(((await again.command("log")) as unknown[]).length).toBe(4);
});
