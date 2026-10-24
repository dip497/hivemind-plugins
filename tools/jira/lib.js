// What the Jira tile decides, apart from drawing it: the setup wizard's steps (a reducer), edits to the
// workflow mapping, scopes, and how the service's status reads. Plain functions on plain data, so the
// tests run them as the tile does. The commands they shape are the service's (src/service/commands.ts).

export const CATEGORIES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];
export const CATEGORY_LABEL = { backlog: "Backlog", todo: "Todo", in_progress: "In progress", in_review: "In review", done: "Done", cancelled: "Cancelled" };

export const SCOPES = [
  { kind: "mine", label: "Assigned to me", hint: "Your issues in the board's open sprints, or the project's open work without a board." },
  { kind: "mine+unassigned", label: "Mine and unassigned", hint: "Yours, and the ones nobody has taken yet." },
  { kind: "all", label: "Everything in scope", hint: "Everyone's issues; the board shows yours first (the assignee filter starts at Me)." },
  { kind: "jql", label: "My own JQL", hint: "Your JQL, always within the project." },
];
export const SPRINTS = [
  { id: "open", label: "Open sprints" },
  { id: "open+future", label: "Open and future sprints" },
  { id: "open+future+backlog", label: "Open and future sprints, and the backlog" },
];
export const PUSH_MODES = [
  { id: "off", label: "Nothing", hint: "Jira is read only from here." },
  { id: "status", label: "Status changes", hint: "Moving a card moves the Jira issue, by a legal transition." },
  { id: "status+comments", label: "Status and comments", hint: "Also the comments you and your agents write." },
  { id: "full", label: "Everything hive owns", hint: "Status, comments, assignee and the PR link." },
];

/** The wizard's steps, in order (design §13). */
export const STEPS = [
  { id: "connect", label: "Connect" },
  { id: "site", label: "Site" },
  { id: "project", label: "Project" },
  { id: "workflow", label: "Workflow" },
  { id: "scope", label: "Scope" },
  { id: "push", label: "Send to Jira" },
];

export const scopeOf = (kind, jql = "") => (kind === "jql" ? { kind, jql: jql.trim() } : { kind });
/** Why a scope can't be used yet, or null. */
export const scopeProblem = (scope) => (scope.kind === "jql" && !scope.jql?.trim() ? "Write the JQL to pull." : null);

// ── the workflow mapping ─────────────────────────────────────────

const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "status";
const jiraStatuses = (wf) => wf.statuses.filter((s) => s.source === "jira" && !s.retired);

/** The proposal with a hive-only "PR Created" status, following the review status, when it has no
 *  hive status of its own (design §4.2: decided 2026-10-24). Placed after the status it follows, and
 *  in that status's board column. */
export function withPrCreated(wf) {
  if (wf.statuses.some((s) => s.source === "hive")) return wf;
  const review = jiraStatuses(wf).find((s) => s.category === "in_review");
  const pr = { id: "hive:pr-created", name: "PR Created", category: "in_review", source: "hive", follow: review ? review.id : "stay" };
  const at = review ? wf.statuses.indexOf(review) + 1 : wf.statuses.length;
  const statuses = [...wf.statuses.slice(0, at), pr, ...wf.statuses.slice(at)];
  const board = wf.board && review
    ? { ...wf.board, columns: wf.board.columns.map((c) => (c.statuses.includes(review.id) ? { ...c, statuses: [...c.statuses, pr.id] } : c)) }
    : wf.board;
  return { ...wf, statuses, board };
}

const replace = (wf, id, patch) => ({ ...wf, statuses: wf.statuses.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

export function setCategory(wf, id, category) {
  if (!CATEGORIES.includes(category)) throw new Error(`no category ${category}`);
  return replace(wf, id, { category });
}

export function renameStatus(wf, id, name) {
  const s = wf.statuses.find((x) => x.id === id);
  if (!s || s.source !== "hive") return wf; // Jira's names are Jira's
  return replace(wf, id, { name });
}

/** A new hive-only status, its id made from its name and never one already used. */
export function addHiveStatus(wf, name, category, follow = "stay") {
  const base = `hive:${slug(name)}`;
  let id = base;
  for (let n = 2; wf.statuses.some((s) => s.id === id); n++) id = `${base}-${n}`;
  return { ...wf, statuses: [...wf.statuses, { id, name: name.trim(), category, source: "hive", follow }] };
}

/** Remove a hive-only status, and from the board's columns; a Jira status is Jira's to remove. */
export function removeHiveStatus(wf, id) {
  if (wf.statuses.find((s) => s.id === id)?.source !== "hive") return wf;
  return {
    ...wf,
    statuses: wf.statuses.filter((s) => s.id !== id),
    board: wf.board ? { ...wf.board, columns: wf.board.columns.map((c) => ({ ...c, statuses: c.statuses.filter((x) => x !== id) })) } : wf.board,
  };
}

export const setFollow = (wf, id, follow) => replace(wf, id, { follow });

export function toggleResolution(wf, name) {
  const has = wf.cancelledResolutions.includes(name);
  return { ...wf, cancelledResolutions: has ? wf.cancelledResolutions.filter((r) => r !== name) : [...wf.cancelledResolutions, name] };
}

/** What stops the mapping being written (`errors`, the same rules core checks, design §4.2) and what
 *  is worth a look (`warnings`). */
export function mappingProblems(wf) {
  const errors = [], warnings = [];
  const ids = new Set();
  for (const s of wf.statuses) {
    if (ids.has(s.id)) errors.push(`${s.name} is listed twice`);
    ids.add(s.id);
    if (!s.name?.trim()) errors.push(`A status has no name`);
    if (s.source === "hive" && s.follow && s.follow !== "stay" && !jiraStatuses(wf).some((j) => j.id === s.follow)) {
      errors.push(`${s.name} follows a Jira status this workflow does not have`);
    }
  }
  for (const c of CATEGORIES) {
    if (!wf.statuses.some((s) => s.category === c && !s.retired)) warnings.push({ category: c, text: `No status is ${CATEGORY_LABEL[c]}` });
  }
  return { errors, warnings };
}

// ── the wizard ───────────────────────────────────────────────────

export const initialWizard = () => ({
  step: 0,
  transport: "mcp",
  /** "idle" | "waiting" (the browser is open) | "connected". */
  signIn: "idle",
  site: null,
  me: null,
  project: "",
  projects: null,
  boards: [],
  boardId: null,
  proposal: null,
  discovering: false,
  scopeKind: "mine",
  jql: "",
  sprints: "open",
  excludedTypes: [],
  preview: null,
  push: "status",
  finishing: false,
  summary: null,
  error: null,
});

/** The wizard's one reducer: every change the person or the service makes to it. */
export function wizard(state, action) {
  switch (action.type) {
    case "transport": return action.transport === "mcp" ? { ...state, transport: "mcp" } : state; // the token waits for P2b
    case "signing-in": return { ...state, signIn: "waiting", error: null };
    case "status": {
      const s = action.status;
      if (!s.connected) return state.signIn === "connected" ? { ...state, signIn: "idle", site: null, me: null } : state;
      const first = state.signIn !== "connected";
      return { ...state, signIn: "connected", site: s.site ?? null, me: s.me ?? null, step: first && state.step === 0 ? 1 : state.step, error: null };
    }
    case "signed-out": return { ...initialWizard() };
    case "projects": return { ...state, projects: action.projects };
    case "project": return action.project === state.project ? state : { ...state, project: action.project, boards: [], boardId: null, proposal: null, preview: null };
    case "discovering": return { ...state, discovering: true, error: null };
    case "discovered": {
      const boards = action.boards ?? [];
      // Several boards: the person picks; the proposal of the one asked for is kept.
      const boardId = state.boardId ?? action.proposal?.board?.id ?? (boards.length === 1 ? boards[0].id : null);
      return { ...state, discovering: false, boards, boardId, proposal: action.proposal ? withPrCreated(action.proposal) : null };
    }
    case "board": return { ...state, boardId: action.boardId, proposal: null };
    case "mapping": return { ...state, proposal: action.proposal };
    case "scope": return { ...state, scopeKind: action.kind ?? state.scopeKind, jql: action.jql ?? state.jql, preview: null };
    case "sprints": return { ...state, sprints: action.sprints, preview: null };
    case "exclude": {
      const has = state.excludedTypes.includes(action.issueType);
      return { ...state, excludedTypes: has ? state.excludedTypes.filter((t) => t !== action.issueType) : [...state.excludedTypes, action.issueType], preview: null };
    }
    case "preview": return { ...state, preview: action.preview };
    case "push": return PUSH_MODES.some((m) => m.id === action.push) ? { ...state, push: action.push } : state;
    case "next": return canAdvance(state) && state.step < STEPS.length - 1 ? { ...state, step: state.step + 1, error: null } : state;
    case "back": return state.step > 0 ? { ...state, step: state.step - 1, error: null } : state;
    case "finishing": return { ...state, finishing: true, error: null };
    case "finished": return { ...state, finishing: false, summary: action.summary };
    case "error": return { ...state, discovering: false, finishing: false, signIn: state.signIn === "waiting" ? "idle" : state.signIn, error: action.error };
    default: return state;
  }
}

/** Whether the step shown is complete, so Next (or Finish) can be pressed. */
export function canAdvance(state) {
  switch (STEPS[state.step]?.id) {
    case "connect": return state.signIn === "connected";
    case "site": return state.signIn === "connected" && !!state.site;
    case "project": return !!state.project && !!state.proposal && !state.discovering && (state.boards.length <= 1 || state.boardId != null);
    case "workflow": return !!state.proposal && mappingProblems(state.proposal).errors.length === 0;
    case "scope": return !scopeProblem(scopeOf(state.scopeKind, state.jql));
    case "push": return !state.finishing;
    default: return false;
  }
}

/** What Finish sends the service (`configure`). */
export function configureArgs(state) {
  return {
    project: state.project,
    ...(state.boardId != null ? { boardId: state.boardId } : {}),
    scope: scopeOf(state.scopeKind, state.jql),
    ...(state.proposal?.board?.type === "scrum" ? { sprints: state.sprints } : {}),
    excludedTypes: state.excludedTypes,
    push: state.push,
    workflow: state.proposal,
  };
}

// ── the service's status, as the Status tab says it ─────────────

/** "3 min ago", "just now", "in 2 min". */
export function relative(iso, now = Date.now()) {
  if (!iso) return "never";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "never";
  const a = Math.abs(ms);
  const text = a < 45_000 ? null : a < 3_600_000 ? `${Math.round(a / 60_000)} min` : a < 86_400_000 ? `${Math.round(a / 3_600_000)} h` : `${Math.round(a / 86_400_000)} d`;
  if (!text) return ms > 0 ? "in a moment" : "just now";
  return ms > 0 ? `in ${text}` : `${text} ago`;
}

/** The budget as a share and what to say about it. */
export function budgetOf(b) {
  if (!b || !(b.limit > 0)) return null;
  const share = Math.min(1, b.used / b.limit);
  return { share, text: `${b.used} of ${b.limit} Atlassian calls this hour`, level: share >= 0.9 ? "err" : share >= 0.7 ? "warn" : "ok" };
}

/** The fix the tile offers for one of the service's problems. */
export function fixFor(problem) {
  const p = problem.toLowerCase();
  if (/sign in again|signed out|not signed in|re-?auth|expired/.test(p)) return { label: "Sign in again", action: "sign-in" };
  if (/scope|returned nothing|jql/.test(p)) return { label: "Check the scope", action: "scope" };
  if (/rate|limit|budget/.test(p)) return null;
  return { label: "Sync now", action: "sync" };
}

/** One line for what a sync did. */
export function syncSummary(out) {
  if (!out) return "";
  const parts = [];
  if (out.created?.length) parts.push(`${out.created.length} new`);
  if (out.updated?.length) parts.push(`${out.updated.length} updated`);
  if (out.unchanged) parts.push(`${out.unchanged} unchanged`);
  if (out.archived?.length) parts.push(`${out.archived.length} archived`);
  if (out.conflicts) parts.push(`${out.conflicts} in conflict`);
  return parts.length ? parts.join(", ") : "Nothing to pull";
}

/** A status's name by id, from a workflow; the id itself when it is unknown. */
export const statusName = (wf, id) => wf?.statuses?.find((s) => s.id === id)?.name ?? id;
