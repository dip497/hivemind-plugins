// The Jira tile's own logic (tools/jira/lib.js): the setup wizard's steps, the workflow mapping the
// person edits, and how the service's status reads. The proposal is the shape `discover` answers
// (src/service/commands.ts), for the cloud-scrum-company fixture's PAY board.
import { expect, test } from "bun:test";
// @ts-ignore plain ES module served to the app as it is
import * as jira from "../tools/jira/lib.js";

const PROPOSAL = {
  statuses: [
    { id: "jira:10000", name: "Backlog", category: "backlog", source: "jira", jiraCategory: "new" },
    { id: "jira:10001", name: "To Do", category: "todo", source: "jira", jiraCategory: "new" },
    { id: "jira:3", name: "In Progress", category: "in_progress", source: "jira", jiraCategory: "indeterminate" },
    { id: "jira:10003", name: "Code Review", category: "in_review", source: "jira", jiraCategory: "indeterminate" },
    { id: "jira:10004", name: "QA", category: "in_review", source: "jira", jiraCategory: "indeterminate" },
    { id: "jira:10006", name: "Done", category: "done", source: "jira", jiraCategory: "done" },
    { id: "jira:10007", name: "Won't Do", category: "cancelled", source: "jira", jiraCategory: "done" },
  ],
  board: { id: 12, name: "PAY board", type: "scrum", columns: [
    { name: "To Do", statuses: ["jira:10001"] },
    { name: "In Progress", statuses: ["jira:3"] },
    { name: "Review", statuses: ["jira:10003", "jira:10004"] },
    { name: "Done", statuses: ["jira:10006", "jira:10007"] },
  ] },
  cancelledResolutions: ["Won't Do"],
  resolutions: ["Done", "Won't Do", "Duplicate"],
  issueTypes: [{ id: "10004", name: "Bug" }, { id: "10001", name: "Story" }],
};

const run = (actions: object[], from = jira.initialWizard()) => actions.reduce((s, a) => jira.wizard(s, a), from);
const connected = { type: "status", status: { connected: true, transport: "mcp", site: "acme.atlassian.net", me: "Ujjwal Solanki", problems: [] } };
/** The wizard at a step, everything before it done as the person would. */
const at = (step: string) => {
  const s = run([connected, { type: "next" }, { type: "project", project: "PAY" }, { type: "discovered", proposal: PROPOSAL, boards: [{ id: 12, name: "PAY board", type: "scrum" }] }]);
  const want = jira.STEPS.findIndex((x: { id: string }) => x.id === step);
  return run(Array.from({ length: want - s.step }, () => ({ type: "next" })), s);
};

test("the wizard: no step is passed until it is complete, and Back keeps what was chosen", () => {
  let s = jira.initialWizard();
  // Connect: only a signed-in status moves it on (and it moves on by itself once).
  expect([jira.canAdvance(s), run([{ type: "next" }], s).step]).toEqual([false, 0]);
  s = run([{ type: "signing-in" }], s);
  expect(s.signIn).toBe("waiting");
  s = run([{ type: "status", status: { connected: false, problems: [] } }], s);
  expect([s.signIn, s.step]).toEqual(["waiting", 0]);
  s = run([connected], s);
  expect([s.signIn, s.step, s.site, s.me]).toEqual(["connected", 1, "acme.atlassian.net", "Ujjwal Solanki"]);
  // A later status does not move it again.
  expect(run([{ type: "back" }, connected], s).step).toBe(0);
  // Project: a project and its proposal; while discovering, not yet.
  s = run([{ type: "next" }, { type: "project", project: "PAY" }, { type: "discovering" }], s);
  expect([s.step, jira.canAdvance(s)]).toEqual([2, false]);
  s = run([{ type: "discovered", proposal: PROPOSAL, boards: [{ id: 12, name: "PAY board", type: "scrum" }] }], s);
  expect([jira.canAdvance(s), s.boardId]).toEqual([true, 12]);
  // Back and Next again keep it.
  s = run([{ type: "next" }, { type: "back" }, { type: "back" }, { type: "next" }], s);
  expect([s.step, s.project, s.proposal !== null]).toEqual([2, "PAY", true]);
});

test("several boards: the person picks one before the workflow is read for it", () => {
  const boards = [{ id: 12, name: "PAY board", type: "scrum" }, { id: 13, name: "PAY bugs", type: "kanban" }];
  let s = run([connected, { type: "next" }, { type: "project", project: "PAY" }, { type: "discovered", proposal: { ...PROPOSAL, board: null }, boards }]);
  expect([s.boardId, jira.canAdvance(s)]).toEqual([null, false]);
  s = run([{ type: "board", boardId: 13 }], s);
  expect([s.boardId, s.proposal, jira.canAdvance(s)]).toEqual([13, null, false]);
  s = run([{ type: "discovered", proposal: { ...PROPOSAL, board: { ...PROPOSAL.board, id: 13, type: "kanban" } }, boards }], s);
  expect([s.boardId, jira.canAdvance(s)]).toEqual([13, true]);
  // Another project starts the choice over.
  expect(run([{ type: "project", project: "OPS" }], s)).toMatchObject({ project: "OPS", boards: [], boardId: null, proposal: null });
});

test("the proposal gets PR Created after the review status, in its column, unless it has a hive status", () => {
  const s = at("workflow");
  const ids = s.proposal.statuses.map((x: { id: string }) => x.id);
  expect(ids.slice(3, 5)).toEqual(["jira:10003", "hive:pr-created"]);
  expect(s.proposal.statuses[4]).toEqual({ id: "hive:pr-created", name: "PR Created", category: "in_review", source: "hive", follow: "jira:10003" });
  expect(s.proposal.board.columns[2].statuses).toEqual(["jira:10003", "jira:10004", "hive:pr-created"]);
  // One the service already proposed is kept as it is.
  const own = { ...PROPOSAL, statuses: [...PROPOSAL.statuses, { id: "hive:qa-ready", name: "QA ready", category: "in_review", source: "hive", follow: "stay" }] };
  expect(jira.withPrCreated(own)).toBe(own);
  // No review status: it stays where it is in Jira.
  const noReview = { ...PROPOSAL, statuses: PROPOSAL.statuses.filter((x) => x.category !== "in_review") };
  expect(jira.withPrCreated(noReview).statuses.at(-1)).toMatchObject({ id: "hive:pr-created", follow: "stay" });
});

test("mapping edits: categories, hive statuses (named, unique, removed from the board) and cancelled resolutions", () => {
  let wf = jira.withPrCreated(PROPOSAL);
  wf = jira.setCategory(wf, "jira:10004", "in_progress");
  expect(wf.statuses.find((x: { id: string }) => x.id === "jira:10004").category).toBe("in_progress");
  expect(() => jira.setCategory(wf, "jira:10004", "doing")).toThrow();
  // Jira's names are Jira's; a hive status is renamed.
  expect(jira.renameStatus(wf, "jira:10001", "Ready")).toBe(wf);
  expect(jira.renameStatus(wf, "hive:pr-created", "PR open").statuses[4].name).toBe("PR open");
  wf = jira.addHiveStatus(wf, "PR Created", "in_review");
  wf = jira.addHiveStatus(wf, "Désign ✓ review", "in_review", "jira:10003");
  expect(wf.statuses.slice(-2).map((x: { id: string; follow: string }) => [x.id, x.follow])).toEqual([["hive:pr-created-2", "stay"], ["hive:design-review", "jira:10003"]]);
  wf = jira.setFollow(wf, "hive:design-review", "jira:10004");
  expect(wf.statuses.at(-1).follow).toBe("jira:10004");
  // Removing one takes it off the board too; a Jira status is not removed.
  wf = jira.removeHiveStatus(wf, "hive:pr-created");
  expect([wf.statuses.some((x: { id: string }) => x.id === "hive:pr-created"), wf.board.columns[2].statuses]).toEqual([false, ["jira:10003", "jira:10004"]]);
  expect(jira.removeHiveStatus(wf, "jira:3")).toBe(wf);
  wf = jira.toggleResolution(wf, "Duplicate");
  wf = jira.toggleResolution(wf, "Won't Do");
  expect(wf.cancelledResolutions).toEqual(["Duplicate"]);
});

test("mapping problems: what core would refuse blocks the step; a category with no status is a warning", () => {
  const wf = jira.withPrCreated(PROPOSAL);
  expect(jira.mappingProblems(wf)).toEqual({ errors: [], warnings: [] });
  const cases: Array<[string, object, string[], string[]]> = [
    ["a follow to a status that is gone", jira.setFollow(wf, "hive:pr-created", "jira:999"), ["PR Created follows a Jira status this workflow does not have"], []],
    ["a nameless hive status", jira.renameStatus(wf, "hive:pr-created", " "), ["A status has no name"], []],
    ["a status listed twice", { ...wf, statuses: [...wf.statuses, wf.statuses[0]] }, ["Backlog is listed twice"], []],
    ["no cancelled status", jira.setCategory(wf, "jira:10007", "done"), [], ["cancelled"]],
  ];
  for (const [what, value, errors, warned] of cases) {
    const p = jira.mappingProblems(value);
    expect([what, p.errors, p.warnings.map((w: { category: string }) => w.category)]).toEqual([what, errors, warned]);
  }
  // An error holds the wizard's step; a warning does not.
  const s = at("workflow");
  expect(jira.canAdvance({ ...s, proposal: jira.setFollow(s.proposal, "hive:pr-created", "jira:999") })).toBe(false);
  expect(jira.canAdvance({ ...s, proposal: jira.setCategory(s.proposal, "jira:10007", "done") })).toBe(true);
});

test("scope: JQL needs some; Finish sends the edited workflow, the scope, Scrum sprints, excluded types and push mode", () => {
  let s = at("scope");
  expect(jira.canAdvance(s)).toBe(true);
  s = run([{ type: "scope", kind: "jql" }], s);
  expect(jira.canAdvance(s)).toBe(false);
  s = run([{ type: "scope", jql: "  labels = payments " }, { type: "sprints", sprints: "open+future" }, { type: "exclude", issueType: "Bug" }, { type: "exclude", issueType: "Story" }, { type: "exclude", issueType: "Story" }, { type: "next" }], s);
  expect(jira.STEPS[s.step].id).toBe("push");
  expect(s.push).toBe("status");
  expect(run([{ type: "push", push: "nonsense" }], s).push).toBe("status");
  s = run([{ type: "push", push: "status+comments" }], s);
  expect(jira.configureArgs(s)).toEqual({
    project: "PAY", boardId: 12, scope: { kind: "jql", jql: "labels = payments" }, sprints: "open+future",
    excludedTypes: ["Bug"], push: "status+comments", workflow: s.proposal,
  });
  // A Kanban board takes no sprints; the default scope is mine.
  const k = at("push");
  expect(jira.configureArgs({ ...k, proposal: { ...k.proposal, board: { ...k.proposal.board, type: "kanban" } } })).not.toHaveProperty("sprints");
  expect(jira.configureArgs(k).scope).toEqual({ kind: "mine" });
});

test("a failure is shown and lets the person try again; signing out starts over", () => {
  let s = run([{ type: "signing-in" }, { type: "error", error: "consent declined" }]);
  expect([s.signIn, s.error]).toEqual(["idle", "consent declined"]);
  s = at("push");
  s = run([{ type: "finishing" }], s);
  expect(jira.canAdvance(s)).toBe(false);
  s = run([{ type: "error", error: "Jira said 503" }], s);
  expect([s.finishing, jira.canAdvance(s), s.error]).toEqual([false, true, "Jira said 503"]);
  expect(run([{ type: "signed-out" }], s)).toEqual(jira.initialWizard());
  // Losing the connection mid-wizard: signed out again, on the step it was.
  const lost = run([{ type: "status", status: { connected: false, problems: ["sign in again"] } }], at("scope"));
  expect([lost.signIn, lost.step]).toEqual(["idle", 4]);
});

test("the status reads as the person says it: times, the budget, a fix per problem, a sync's summary", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  expect([
    jira.relative(undefined, now), jira.relative("2026-10-24T11:59:40Z", now), jira.relative("2026-10-24T11:57:00Z", now),
    jira.relative("2026-10-24T12:02:00Z", now), jira.relative("2026-10-24T09:00:00Z", now), jira.relative("2026-10-21T12:00:00Z", now),
  ]).toEqual(["never", "just now", "3 min ago", "in 2 min", "3 h ago", "3 d ago"]);
  expect(jira.budgetOf({ used: 120, limit: 400 })).toEqual({ share: 0.3, text: "120 of 400 Atlassian calls this hour", level: "ok" });
  expect([jira.budgetOf({ used: 300, limit: 400 }).level, jira.budgetOf({ used: 500, limit: 400 }).share, jira.budgetOf(undefined)]).toEqual(["warn", 1, null]);
  expect(["sign in again", "Scope returned nothing; nothing was archived", "rate limited until 12:05", "a capability missing: changelog"].map(jira.fixFor))
    .toEqual([{ label: "Sign in again", action: "sign-in" }, { label: "Check the scope", action: "scope" }, null, { label: "Sync now", action: "sync" }]);
  expect(jira.syncSummary({ created: ["PAY-1", "PAY-2"], updated: ["PAY-3"], unchanged: 4, conflicts: 1, archived: [] })).toBe("2 new, 1 updated, 4 unchanged, 1 in conflict");
  expect(jira.syncSummary({ created: [], updated: [], unchanged: 0, conflicts: 0, archived: [] })).toBe("Nothing to pull");
  expect([jira.statusName({ statuses: PROPOSAL.statuses }, "jira:3"), jira.statusName(null, "jira:3")]).toEqual(["In Progress", "jira:3"]);
});

// The API-token path: chosen, its fields kept as typed, a Cloud ID asked for only when Atlassian
// didn't say it, and the scopes the token lacks shown.
test("the token path: chosen, fields kept, a Cloud ID asked for only when needed, missing scopes shown", () => {
  let w = jira.wizard(jira.initialWizard(), { type: "transport", transport: "rest" });
  expect(w.transport).toBe("rest");
  w = jira.wizard(w, { type: "rest-field", field: "site", value: "acme.atlassian.net" });
  w = jira.wizard(w, { type: "rest-field", field: "email", value: "me@acme.com" });
  expect([w.rest.site, w.rest.email, w.rest.needsCloudId]).toEqual(["acme.atlassian.net", "me@acme.com", false]);
  w = jira.wizard(jira.wizard(w, { type: "signing-in" }), { type: "rest-needs-cloud-id", error: "paste it" });
  expect([w.signIn, w.rest.needsCloudId, w.error]).toEqual(["idle", true, "paste it"]);
  w = jira.wizard(w, { type: "rest-checked", missingScopes: ["read:sprint:jira-software"] });
  expect(w.rest.missingScopes).toEqual(["read:sprint:jira-software"]);
  expect(jira.canAdvance(w)).toBe(false);
  w = jira.wizard(w, { type: "status", status: { connected: true, site: "acme.atlassian.net", me: "Ujjwal Solanki" } });
  expect([w.signIn, w.step, jira.canAdvance({ ...w, step: 0 })]).toEqual(["connected", 1, true]);
  expect(jira.wizard(w, { type: "transport", transport: "nope" }).transport).toBe("rest");
});

test("a waiting push's form: pre-filled values, Send off while a required field is empty, and what it asks in one line", () => {
  const wf = { statuses: PROPOSAL.statuses };
  const screen = {
    transition: { id: "71", name: "Release", to: "jira:10006" },
    fields: [
      { id: "resolution", name: "Resolution", required: true, kind: "choice", choices: [{ id: "10000", name: "Done" }, { id: "10001", name: "Won't Do" }], value: "Done" },
      { id: "customfield_1", name: "Release notes", required: true, kind: "text" },
      { id: "comment", name: "Comment", required: false, kind: "text" },
    ],
  };
  expect(jira.formStart(screen)).toEqual({ resolution: "Done" });
  expect(jira.formMissing(screen, jira.formStart(screen))).toEqual(["Release notes"]);
  expect(jira.formMissing(screen, { resolution: "Done", customfield_1: "  " })).toEqual(["Release notes"]);
  expect(jira.formMissing(screen, { resolution: "Done", customfield_1: "v2" })).toEqual([]);
  expect(jira.pushAsk({ waiting: { message: "m", form: screen } }, wf)).toBe("Release → Done");
  const way = { transition: { id: "21", name: "Start", to: "jira:3" }, fields: [], path: [{ id: "21", name: "Start", to: "jira:3" }, { id: "41", name: "Request review", to: "jira:10003" }] };
  expect(jira.formMissing(way, {})).toEqual([]);
  expect(jira.pushAsk({ waiting: { message: "m", form: way } }, wf)).toBe("OK the way: Start → In Progress, then Request review → Code Review");
  expect(jira.pushAsk({ waiting: { message: "only words" } }, wf)).toBe("only words");
});
