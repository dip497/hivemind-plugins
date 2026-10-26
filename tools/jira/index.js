// The Jira tile: a setup wizard until the workspace is linked, then five tabs — Status, Mapping,
// Scope, Browse and Conflicts. Everything it knows and changes goes through this plugin's own
// service (`host.call`, the commands in src/service/commands.ts): the tile never talks to Jira and
// holds no credential. "Sign in with Atlassian" opens Atlassian's page in the system browser; the
// service's loopback listener finishes the sign-in, and the tile waits for its status to say so.
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "hm-plugin://host/react.js";
import { Loading, useTileState } from "hm-plugin://host/sdk.js";
import { Badge, Button, Input, Label, Textarea, toast } from "hm-plugin://host/ui.js";
import {
  CATEGORIES, CATEGORY_LABEL, PUSH_MODES, SCOPES, SPRINTS, STEPS,
  addHiveStatus, budgetOf, canAdvance, configureArgs, fixFor, initialWizard, mappingProblems, relative,
  removeHiveStatus, renameStatus, scopeOf, scopeProblem, setCategory, setFollow, statusName, syncSummary, toggleResolution, wizard,
} from "./lib.js";

const h = React.createElement;
const muted = { color: "var(--color-fg3)", fontSize: 11.5 };
const small = { fontSize: 12, color: "var(--color-fg2)" };
const row = { display: "flex", alignItems: "center", gap: 8 };
const card = { border: "1px solid var(--color-line)", borderRadius: 8, background: "var(--color-bg)", padding: 12 };
const field = {
  height: 28, padding: "0 8px", borderRadius: 6, border: "1px solid var(--color-line)", background: "var(--color-bg)",
  color: "var(--color-fg)", fontSize: 12, fontFamily: "inherit",
};
const STATUS_EVERY_MS = 5_000;

/** A native select, drawn as the app's fields are. */
function Choice({ value, onChange, options, label, ...rest }) {
  return h("select", { value, "aria-label": label, onChange: (e) => onChange(e.target.value), style: field, ...rest },
    options.map((o) => h("option", { key: o.value, value: o.value, disabled: o.disabled }, o.label)));
}

/** One of a few, as cards: the label, its hint, and whether it is chosen. */
function Option({ chosen, disabled, onChoose, title, hint, children, ...rest }) {
  return h("label", {
    ...rest,
    style: { ...card, display: "block", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, borderColor: chosen ? "var(--color-accent, var(--color-info))" : "var(--color-line)" },
  },
  h("div", { style: row },
    h("input", { type: "radio", checked: !!chosen, disabled, onChange: () => onChoose?.(), style: { margin: 0 } }),
    h("span", { style: { fontSize: 13, fontWeight: 600 } }, title)),
  hint && h("div", { style: { ...muted, marginTop: 4, marginLeft: 21 } }, hint),
  children && h("div", { style: { marginTop: 8, marginLeft: 21 } }, children));
}

function Problem({ children, level = "err" }) {
  return h("p", { role: "alert", style: { margin: "8px 0", fontSize: 12, color: `var(--color-${level})` } }, children);
}

/** Open a page in the system browser (the app sends a window's new page to the OS). */
const openInBrowser = (url) => { window.open(url, "_blank", "noopener"); };

/** The service, as this tile asks it; one in-flight `status` at a time, read every few seconds. */
function useService(host) {
  const call = useCallback((command, args) => {
    if (typeof host.call !== "function") return Promise.reject(new Error("This version of Hivemind cannot reach the Jira service: update the app."));
    // The service may sync several workspaces and answers on its last connection: name this one.
    return host.call(command, { ...(args ?? {}), workspace: host.repoPath ?? host.cwd });
  }, [host]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { setStatus(await call("status")); setError(null); } catch (e) { setError(e.message); } finally { busy.current = false; }
  }, [call]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), STATUS_EVERY_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { call, status, error, refresh };
}

/** "Sign in with Atlassian": ask the service for the page, open it, and wait for the status. */
async function startSignIn(call, site) {
  const { authorizeUrl } = await call("sign-in", site ? { site } : {});
  if (!/^https?:\/\//i.test(authorizeUrl ?? "")) throw new Error("The service gave no sign-in page to open.");
  openInBrowser(authorizeUrl);
  return authorizeUrl;
}

// ── the workflow mapping (wizard step 4 and the Mapping tab) ────

function WorkflowEditor({ value, onChange }) {
  const [newName, setNewName] = useState("");
  const jira = value.statuses.filter((s) => s.source === "jira");
  const hive = value.statuses.filter((s) => s.source === "hive");
  const columnOf = (id) => value.board?.columns.find((c) => c.statuses.includes(id))?.name ?? "—";
  const { errors, warnings } = mappingProblems(value);
  const followOptions = [{ value: "stay", label: "Stay where it is" }, ...jira.filter((s) => !s.retired).map((s) => ({ value: s.id, label: s.name }))];
  const th = { textAlign: "left", fontWeight: 500, ...muted, padding: "4px 8px" };
  const td = { padding: "4px 8px", fontSize: 12, borderTop: "1px solid var(--color-line)" };
  return h("div", { "data-jira-mapping": true, style: { display: "grid", gap: 14 } },
    h("section", null,
      h("h4", { style: { margin: "0 0 6px", fontSize: 12.5 } }, "Jira's statuses"),
      h("table", { style: { width: "100%", borderCollapse: "collapse" } },
        h("thead", null, h("tr", null, ["Status", "Jira category", "Board column", "In hive"].map((t) => h("th", { key: t, style: th }, t)))),
        h("tbody", null, jira.map((s) => h("tr", { key: s.id, "data-status": s.id },
          h("td", { style: td }, s.name, s.retired && h("span", { style: { ...muted, marginLeft: 6 } }, "retired")),
          h("td", { style: { ...td, ...muted } }, s.jiraCategory ?? "—"),
          h("td", { style: { ...td, ...muted } }, columnOf(s.id)),
          h("td", { style: td }, h(Choice, {
            value: s.category, label: `Category of ${s.name}`, "data-category-of": s.id,
            onChange: (c) => onChange(setCategory(value, s.id, c)),
            options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
          }))))))),
    h("section", null,
      h("h4", { style: { margin: "0 0 2px", fontSize: 12.5 } }, "hive-only statuses"),
      h("p", { style: { ...muted, margin: "0 0 6px" } }, "They exist only here. While an issue sits in one, Jira shows the status it follows."),
      hive.length === 0 && h("p", { style: muted }, "None."),
      hive.map((s) => h("div", { key: s.id, "data-hive-status": s.id, style: { ...row, marginBottom: 6 } },
        h(Input, { value: s.name, "aria-label": "Name", onChange: (e) => onChange(renameStatus(value, s.id, e.target.value)), style: { width: 160, height: 28, fontSize: 12 } }),
        h(Choice, { value: s.category, label: `Category of ${s.name}`, onChange: (c) => onChange(setCategory(value, s.id, c)), options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })) }),
        h("span", { style: muted }, "Jira shows"),
        h(Choice, { value: s.follow ?? "stay", label: `What Jira shows for ${s.name}`, "data-follow-of": s.id, onChange: (f) => onChange(setFollow(value, s.id, f)), options: followOptions }),
        h(Button, { size: "2xs", variant: "ghost", onClick: () => onChange(removeHiveStatus(value, s.id)), "aria-label": `Remove ${s.name}` }, "Remove"))),
      h("form", { style: row, onSubmit: (e) => { e.preventDefault(); if (newName.trim()) { onChange(addHiveStatus(value, newName, "in_review")); setNewName(""); } } },
        h(Input, { value: newName, placeholder: "New hive status", "aria-label": "New hive status", onChange: (e) => setNewName(e.target.value), style: { width: 180, height: 28, fontSize: 12 } }),
        h(Button, { size: "2xs", variant: "outline", type: "submit", disabled: !newName.trim() }, "Add"))),
    h("section", null,
      h("h4", { style: { margin: "0 0 2px", fontSize: 12.5 } }, "Cancelled resolutions"),
      h("p", { style: { ...muted, margin: "0 0 6px" } }, "A done issue with one of these resolutions is Cancelled in hive."),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
        (value.resolutions ?? value.cancelledResolutions).map((r) => {
          const on = value.cancelledResolutions.includes(r);
          return h(Button, { key: r, size: "2xs", variant: on ? "secondary" : "ghost", "aria-pressed": on, "data-resolution": r, onClick: () => onChange(toggleResolution(value, r)) }, on ? `✓ ${r}` : r);
        }))),
    errors.map((e) => h(Problem, { key: e }, e)),
    warnings.map((w) => h("div", { key: w.category, style: { ...row, ...small } },
      h("span", { style: { color: "var(--color-warn)" } }, `${w.text}.`),
      h(Button, { size: "2xs", variant: "ghost", onClick: () => onChange(addHiveStatus(value, CATEGORY_LABEL[w.category], w.category)) }, `Add a hive status for it`))));
}

// ── the scope (wizard step 5 and the Scope tab) ────────────────

function ScopeEditor({ kind, jql, sprints, excludedTypes, issueTypes, scrum, onChange }) {
  return h("div", { "data-jira-scope": true, style: { display: "grid", gap: 8 } },
    SCOPES.map((s) => h(Option, {
      key: s.kind, chosen: kind === s.kind, title: s.label, hint: s.hint, onChoose: () => onChange({ kind: s.kind }), "data-scope": s.kind,
    }, s.kind === "jql" && kind === "jql" ? h(Textarea, { value: jql, rows: 3, placeholder: "labels = payments AND priority >= High", "aria-label": "JQL", onChange: (e) => onChange({ jql: e.target.value }), style: { fontFamily: "var(--font-mono)", fontSize: 12 } }) : null)),
    scrum && h("div", { style: row }, h(Label, null, "Sprints"),
      h(Choice, { value: sprints, label: "Sprints", onChange: (v) => onChange({ sprints: v }), options: SPRINTS.map((s) => ({ value: s.id, label: s.label })) })),
    issueTypes?.length > 0 && h("div", null,
      h(Label, null, "Leave out these issue types"),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 } }, issueTypes.map((t) => h("label", { key: t.id, style: { ...row, gap: 4, ...small } },
        h("input", { type: "checkbox", checked: excludedTypes.includes(t.name), onChange: () => onChange({ toggleType: t.name }), "data-exclude": t.name }), t.name)))));
}

/** How many issues a scope pulls now, asked of the service (`browse`), a moment after it changes.
 *  `draft`: the wizard's project, board, sprints and excluded types, before anything is linked. */
function usePreview(call, scope, enabled, draft) {
  const [preview, setPreview] = useState(null);
  const key = JSON.stringify([scope, draft]);
  useEffect(() => {
    if (!enabled || scopeProblem(scope)) { setPreview(null); return; }
    let live = true;
    setPreview({ loading: true });
    const t = setTimeout(() => {
      call("browse", { scope, ...(draft ?? {}) }).then(
        (r) => { if (live) setPreview({ count: r.total ?? r.issues.length, more: !r.total && !!r.nextPageToken }); },
        (e) => { if (live) setPreview({ error: e.message }); },
      );
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [call, key, enabled]);
  return preview;
}

function PreviewLine({ preview }) {
  if (!preview) return null;
  if (preview.loading) return h("p", { style: muted }, "Counting what it pulls…");
  if (preview.error) return h(Problem, { level: "warn" }, `Could not count it: ${preview.error}`);
  return h("p", { "data-preview-count": preview.count, style: small }, preview.count === 0
    ? "It pulls nothing right now. That is fine for a new sprint; the sync never archives everything on an empty answer."
    : `It pulls ${preview.count}${preview.more ? "+" : ""} issue${preview.count === 1 ? "" : "s"} now.`);
}

// ── the wizard ─────────────────────────────────────────────────

function Wizard({ call, status, refresh }) {
  const [w, dispatch] = useReducer(wizard, undefined, initialWizard);
  const step = STEPS[w.step].id;
  const fail = (e) => dispatch({ type: "error", error: e.message ?? String(e) });
  useEffect(() => { if (status) dispatch({ type: "status", status }); }, [status]);
  // While the browser is open, read the status more often than the tile does.
  useEffect(() => {
    if (w.signIn !== "waiting") return;
    const t = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(t);
  }, [w.signIn, refresh]);
  useEffect(() => {
    if (step !== "project" || w.projects) return;
    call("projects").then((r) => dispatch({ type: "projects", projects: r.projects ?? [] }), () => dispatch({ type: "projects", projects: [] }));
  }, [step, w.projects, call]);
  // Discover the project's workflow once it is named, and again for the board chosen.
  useEffect(() => {
    if (step !== "project" || !w.project || w.proposal || w.discovering) return;
    if (w.boards.length > 1 && w.boardId == null) return;
    dispatch({ type: "discovering" });
    call("discover", { project: w.project, ...(w.boardId != null ? { boardId: w.boardId } : {}) })
      .then((r) => dispatch({ type: "discovered", proposal: r.proposal, boards: r.boards }), fail);
  }, [step, w.project, w.boardId, w.proposal, w.boards.length]);
  const scope = scopeOf(w.scopeKind, w.jql);
  const preview = usePreview(call, scope, step === "scope", {
    project: w.project, ...(w.boardId != null ? { boardId: w.boardId } : {}), ...(w.proposal?.board?.type === "scrum" ? { sprints: w.sprints } : {}), excludedTypes: w.excludedTypes,
  });

  const signIn = () => { dispatch({ type: "signing-in" }); startSignIn(call).catch(fail); };
  // The API-token path: check it (names any missing scope), then keep it. The token goes straight to
  // the service, which keeps it as the plugin's secret; the wizard forgets it once it is kept.
  const connectRest = async () => {
    const r = w.rest;
    const args = {
      transport: "rest", site: r.site.trim(), email: r.email.trim(), apiToken: r.token,
      ...(r.cloudId.trim() ? { cloudId: r.cloudId.trim() } : {}), ...(r.expiresOn ? { expiresOn: r.expiresOn } : {}),
    };
    dispatch({ type: "signing-in" });
    try {
      const check = await call("test-connection", args);
      dispatch({ type: "rest-checked", missingScopes: check.missingScopes });
      await call("sign-in", args);
      dispatch({ type: "rest-field", field: "token", value: "" });
      await refresh();
    } catch (e) {
      const code = e?.code ?? "";
      if (code === "NOT_FOUND" || /cloud ?id/i.test(e?.message ?? "")) dispatch({ type: "rest-needs-cloud-id", error: "Atlassian didn't say this site's Cloud ID: paste it below (Atlassian Administration shows it in the address, after /s/)." });
      else if (code === "FORBIDDEN") fail(new Error("Atlassian refused that email and token. Check both, and that the token is a scoped token with the Jira scopes."));
      else fail(e);
    }
  };
  const restField = (field) => (e) => dispatch({ type: "rest-field", field, value: e.target.value });
  const finish = async () => {
    dispatch({ type: "finishing" });
    try {
      const out = await call("configure", configureArgs(w));
      dispatch({ type: "finished", summary: out.firstSync ?? {} });
      await refresh();
    } catch (e) { fail(e); }
  };

  const body = (() => {
    switch (step) {
      case "connect": return h("div", { style: { display: "grid", gap: 10 } },
        h(Option, { chosen: w.transport === "mcp", title: "Sign in with Atlassian", hint: "Recommended. Atlassian's sign-in page opens in your browser; hive keeps the sign-in, never a password.", onChoose: () => dispatch({ type: "transport", transport: "mcp" }), "data-transport": "mcp" },
          w.signIn === "connected" ? h("span", { style: { ...small, color: "var(--color-ok)" } }, `Signed in${w.me ? ` as ${w.me}` : ""}.`)
            : w.signIn === "waiting" ? h("div", { style: row }, h("span", { style: small }, "Finish signing in in your browser…"), h(Button, { size: "2xs", variant: "ghost", onClick: signIn }, "Open the page again"))
              : h(Button, { size: "sm", onClick: signIn, "data-sign-in": true }, "Sign in with Atlassian")),
        h(Option, { chosen: w.transport === "rest", title: "Scoped API token", hint: "For heavy use, or when your organisation blocks the sign-in. Make a scoped token on Atlassian's API tokens page with the Jira read and write scopes and the board and sprint scopes.", onChoose: () => dispatch({ type: "transport", transport: "rest" }), "data-transport": "rest" },
          w.transport === "rest" && (w.signIn === "connected"
            ? h("span", { style: { ...small, color: "var(--color-ok)" } }, `Connected${w.me ? ` as ${w.me}` : ""} with the token.`)
            : h("div", { style: { display: "grid", gap: 6, maxWidth: 360 } },
              h(Input, { value: w.rest.site, onChange: restField("site"), placeholder: "acme.atlassian.net", "aria-label": "Jira site", "data-rest-site": true, style: { height: 28, fontSize: 12 } }),
              h(Input, { value: w.rest.email, onChange: restField("email"), placeholder: "you@company.com", "aria-label": "Atlassian account email", "data-rest-email": true, style: { height: 28, fontSize: 12 } }),
              h(Input, { value: w.rest.token, onChange: restField("token"), type: "password", autoComplete: "off", placeholder: "Scoped API token", "aria-label": "Scoped API token", "data-rest-token": true, style: { height: 28, fontSize: 12 } }),
              h("label", { style: { ...small, display: "grid", gap: 4 } }, "The day it expires (Atlassian shows it on the token page; hive warns you 14 days before)",
                h(Input, { value: w.rest.expiresOn, onChange: restField("expiresOn"), type: "date", "aria-label": "Token expiry date", "data-rest-expires": true, style: { height: 28, fontSize: 12 } })),
              w.rest.needsCloudId && h(Input, { value: w.rest.cloudId, onChange: restField("cloudId"), placeholder: "Cloud ID", "aria-label": "Cloud ID", "data-rest-cloud-id": true, style: { height: 28, fontSize: 12 } }),
              h("div", null, h(Button, { size: "sm", disabled: w.signIn === "waiting" || !w.rest.site.trim() || !w.rest.email.trim() || !w.rest.token, onClick: () => void connectRest(), "data-rest-connect": true }, w.signIn === "waiting" ? "Checking the token…" : "Test and connect")))),
          w.transport === "rest" && w.rest.missingScopes.length > 0 && h("p", { style: { ...small, color: "var(--color-warn)" }, "data-missing-scopes": true },
            `The token lacks ${w.rest.missingScopes.join(", ")}: what needs them stays off until you add them to a new token.`)));
      case "site": return h("div", { style: { ...card, display: "grid", gap: 6 }, "data-site": w.site ?? "" },
        h("div", { style: small }, "Site"),
        h("div", { style: { fontSize: 15, fontWeight: 600 } }, w.site ?? "—"),
        h("div", { style: { ...small, color: "var(--color-ok)" }, "data-connected-as": w.me ?? "" }, `Connected as ${w.me ?? "you"}`),
        h("div", null, h(Button, { size: "2xs", variant: "ghost", onClick: () => call("sign-out").then(() => { dispatch({ type: "signed-out" }); void refresh(); }, fail) }, "Use another account")));
      case "project": return h("div", { style: { display: "grid", gap: 10 } },
        h("div", { style: row },
          h(Label, null, "Project"),
          w.projects?.length
            ? h(Choice, { value: w.project, label: "Project", "data-project-pick": true, onChange: (p) => dispatch({ type: "project", project: p }), options: [{ value: "", label: "Choose a project", disabled: true }, ...w.projects.map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` }))] })
            : h(Input, { value: w.project, placeholder: "PAY", "aria-label": "Project key", onChange: (e) => dispatch({ type: "project", project: e.target.value.toUpperCase().trim() }), style: { width: 120, height: 28, fontSize: 12 } })),
        w.boards.length > 1 && h("div", { style: row },
          h(Label, null, "Board"),
          h(Choice, { value: w.boardId == null ? "" : String(w.boardId), label: "Board", "data-board-pick": true, onChange: (b) => dispatch({ type: "board", boardId: Number(b) }),
            options: [{ value: "", label: "Choose a board", disabled: true }, ...w.boards.map((b) => ({ value: String(b.id), label: `${b.name} (${b.type})` }))] })),
        w.discovering && h(Loading, { label: `Reading ${w.project}'s workflow` }),
        w.proposal && h("p", { style: small, "data-discovered": true }, `${w.proposal.statuses.filter((s) => s.source === "jira").length} statuses${w.proposal.board ? ` on ${w.proposal.board.name ?? "the board"}, ${w.proposal.board.columns.length} columns` : ", no board"}.`));
      case "workflow": return h(WorkflowEditor, { value: w.proposal, onChange: (p) => dispatch({ type: "mapping", proposal: p }) });
      case "scope": return h("div", null,
        h(ScopeEditor, {
          kind: w.scopeKind, jql: w.jql, sprints: w.sprints, excludedTypes: w.excludedTypes, issueTypes: w.proposal?.issueTypes, scrum: w.proposal?.board?.type === "scrum",
          onChange: (c) => { if (c.kind || c.jql !== undefined) dispatch({ type: "scope", kind: c.kind, jql: c.jql }); if (c.sprints) dispatch({ type: "sprints", sprints: c.sprints }); if (c.toggleType) dispatch({ type: "exclude", issueType: c.toggleType }); },
        }),
        h(PreviewLine, { preview }));
      case "push": return h("div", { style: { display: "grid", gap: 8 } },
        PUSH_MODES.map((m) => h(Option, { key: m.id, chosen: w.push === m.id, title: m.label, hint: m.hint, onChoose: () => dispatch({ type: "push", push: m.id }), "data-push": m.id })));
    }
  })();

  // Linked: the tabs take over as soon as the status says so.
  if (w.summary !== null) return h(Loading, { label: "Opening the Jira tabs" });
  const last = w.step === STEPS.length - 1;
  return h("div", { "data-jira-wizard": true, "data-jira-step": step, style: { display: "flex", flexDirection: "column", height: "100%" } },
    h("div", { style: { display: "flex", gap: 4, padding: "10px 16px", borderBottom: "1px solid var(--color-line)" } },
      STEPS.map((s, i) => h("span", { key: s.id, style: { fontSize: 11.5, padding: "2px 8px", borderRadius: 999, background: i === w.step ? "var(--color-bg3)" : "transparent", color: i <= w.step ? "var(--color-fg)" : "var(--color-fg3)" } }, `${i + 1}. ${s.label}`))),
    h("div", { style: { flex: 1, minHeight: 0, overflow: "auto", padding: 16 } },
      h("h3", { style: { margin: "0 0 12px", fontSize: 15 } }, {
        connect: "Connect to Jira", site: "Your Jira site", project: "Which project", workflow: "Its workflow, in hive",
        scope: "What to pull", push: "What hive sends to Jira",
      }[step]),
      body,
      w.error && h(Problem, null, w.error)),
    h("div", { style: { ...row, justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid var(--color-line)" } },
      w.step > 0 && h(Button, { size: "sm", variant: "ghost", onClick: () => dispatch({ type: "back" }) }, "Back"),
      last ? h(Button, { size: "sm", disabled: !canAdvance(w), onClick: finish, "data-finish": true }, w.finishing ? "Linking and syncing…" : "Finish")
        : h(Button, { size: "sm", disabled: !canAdvance(w), onClick: () => dispatch({ type: "next" }), "data-next": true }, "Next")));
}

// ── the tabs ───────────────────────────────────────────────────

function Fact({ label, children, ...rest }) {
  return h("div", { ...rest, style: { display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--color-line)", fontSize: 12.5 } },
    h("span", { style: muted }, label), h("span", null, children));
}

function StatusTab({ call, status, refresh, goTo }) {
  const [syncing, setSyncing] = useState(false);
  const budget = budgetOf(status.budget);
  const syncNow = async () => {
    setSyncing(true);
    try { toast.success(syncSummary(await call("sync-now"))); } catch (e) { toast.error("The sync failed", { description: e.message }); }
    setSyncing(false);
    void refresh();
  };
  const fix = (f) => {
    if (f.action === "sign-in") startSignIn(call, status.site).catch((e) => toast.error("Could not start the sign-in", { description: e.message }));
    else if (f.action === "scope") goTo("scope");
    else void syncNow();
  };
  return h("div", { "data-jira-tab-body": "status", style: { padding: 16, display: "grid", gap: 12, alignContent: "start" } },
    status.problems.length > 0 && h("div", { style: { ...card, borderColor: "var(--color-warn)", display: "grid", gap: 6 } },
      status.problems.map((p) => {
        const f = fixFor(p);
        return h("div", { key: p, style: row, "data-problem": p },
          h("span", { style: { flex: 1, fontSize: 12.5 } }, p),
          f && h(Button, { size: "2xs", variant: "outline", onClick: () => fix(f) }, f.label));
      })),
    h("div", null,
      h(Fact, { label: "Connection", "data-fact": "connection" }, status.connected
        ? h("span", { style: { color: "var(--color-ok)" } }, `Connected as ${status.me ?? "you"} to ${status.site ?? "Jira"}`)
        : h("span", { style: row }, h("span", { style: { color: "var(--color-err)" } }, "Not connected"), h(Button, { size: "2xs", variant: "outline", onClick: () => fix({ action: "sign-in" }) }, "Sign in with Atlassian"))),
      h(Fact, { label: "Transport", "data-fact": "transport" }, status.transport === "rest" ? "Scoped API token (REST)" : "Sign in with Atlassian (Rovo MCP)"),
      h(Fact, { label: "Project" }, `${status.project}${status.boardId != null ? ` · board ${status.boardId}` : ""}`),
      h(Fact, { label: "Last sync", "data-fact": "last-sync" }, relative(status.lastSync)),
      h(Fact, { label: "Next sync" }, status.nextSync ? relative(status.nextSync) : "—"),
      h(Fact, { label: "Issues", "data-fact": "counts" }, status.counts
        ? `${status.counts.mirrored} mirrored · ${status.counts.conflicts} in conflict · ${status.counts.archived} archived` : "—"),
      h(Fact, { label: "Atlassian calls" }, budget
        ? h("span", { style: { display: "grid", gap: 4 } },
          h("span", null, budget.text),
          h("span", { style: { height: 4, borderRadius: 2, background: "var(--color-bg3)", overflow: "hidden", maxWidth: 260 } },
            h("span", { style: { display: "block", height: "100%", width: `${Math.round(budget.share * 100)}%`, background: `var(--color-${budget.level})` } })))
        : "—"),
      status.rateLimitedUntil && Date.parse(status.rateLimitedUntil) > Date.now()
        && h(Fact, { label: "Rate limited" }, h("span", { style: { color: "var(--color-warn)" } }, `Atlassian asked hive to wait; syncing again ${relative(status.rateLimitedUntil)}`))),
    h("div", null, h(Button, { size: "sm", onClick: syncNow, disabled: syncing || !status.connected, "data-sync-now": true }, syncing ? "Syncing…" : "Sync now")));
}

function MappingTab({ call }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { call("mapping").then((m) => { setSaved(m); setDraft(m); }, (e) => setError(e.message)); }, [call]);
  if (error && !draft) return h(Problem, null, error);
  if (!draft) return h(Loading, { label: "Reading the mapping" });
  const changed = JSON.stringify(saved) !== JSON.stringify(draft);
  const save = async () => {
    setSaving(true);
    try { const m = await call("set-mapping", { workflow: draft }); setSaved(m); setDraft(m); toast.success("Saved the mapping"); } catch (e) { toast.error("Could not save the mapping", { description: e.message }); }
    setSaving(false);
  };
  return h("div", { "data-jira-tab-body": "mapping", style: { padding: 16, display: "grid", gap: 12 } },
    h(WorkflowEditor, { value: draft, onChange: setDraft }),
    h("div", { style: row },
      h(Button, { size: "sm", disabled: !changed || saving || mappingProblems(draft).errors.length > 0, onClick: save, "data-save-mapping": true }, saving ? "Saving…" : "Save"),
      changed && h(Button, { size: "sm", variant: "ghost", onClick: () => setDraft(saved) }, "Undo changes")));
}

function ScopeTab({ call, status, refresh }) {
  const [kind, setKind] = useState(status.scope?.kind ?? "mine");
  const [jql, setJql] = useState(status.scope?.kind === "jql" ? status.scope.jql : "");
  const [sprints, setSprints] = useState(status.sprints ?? "open");
  const [excluded, setExcluded] = useState(status.excludedTypes ?? []);
  const [types, setTypes] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { call("mapping").then((m) => setTypes(m), () => setTypes({})); }, [call]);
  const scope = scopeOf(kind, jql);
  const preview = usePreview(call, scope, true);
  const save = async () => {
    setSaving(true);
    try { await call("set-scope", { scope, sprints, excludedTypes: excluded }); toast.success("Saved the scope; the next sync uses it"); void refresh(); } catch (e) { toast.error("Could not save the scope", { description: e.message }); }
    setSaving(false);
  };
  return h("div", { "data-jira-tab-body": "scope", style: { padding: 16, display: "grid", gap: 10, alignContent: "start" } },
    h(ScopeEditor, {
      kind, jql, sprints, excludedTypes: excluded, issueTypes: types?.issueTypes, scrum: types?.board?.type === "scrum",
      onChange: (c) => {
        if (c.kind) setKind(c.kind);
        if (c.jql !== undefined) setJql(c.jql);
        if (c.sprints) setSprints(c.sprints);
        if (c.toggleType) setExcluded((x) => (x.includes(c.toggleType) ? x.filter((t) => t !== c.toggleType) : [...x, c.toggleType]));
      },
    }),
    h(PreviewLine, { preview }),
    h("p", { style: muted }, "Issues that leave the scope are archived, never deleted; one with a branch or PR stays on the board as not in scope."),
    h("div", null, h(Button, { size: "sm", disabled: saving || !!scopeProblem(scope), onClick: save, "data-save-scope": true }, saving ? "Saving…" : "Save")));
}

function BrowseTab({ call }) {
  const [jql, setJql] = useState("");
  const [kind, setKind] = useState("all");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tracking, setTracking] = useState({});
  const run = async (pageToken) => {
    setLoading(true); setError(null);
    try {
      const args = kind === "jql" ? { jql } : { scope: scopeOf(kind) };
      const r = await call("browse", pageToken ? { ...args, pageToken } : args);
      setResult((was) => (pageToken && was ? { ...r, issues: [...was.issues, ...r.issues] } : r));
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { void run(); }, []);
  const track = async (key) => {
    setTracking((t) => ({ ...t, [key]: "…" }));
    try {
      const { id } = await call("track", { key });
      setTracking((t) => ({ ...t, [key]: id }));
      setResult((r) => r && { ...r, issues: r.issues.map((i) => (i.key === key ? { ...i, tracked: true } : i)) });
      toast.success(`${key} is on the board`);
    } catch (e) { setTracking((t) => ({ ...t, [key]: undefined })); toast.error(`Could not track ${key}`, { description: e.message }); }
  };
  const td = { padding: "5px 8px", fontSize: 12, borderTop: "1px solid var(--color-line)" };
  return h("div", { "data-jira-tab-body": "browse", style: { display: "flex", flexDirection: "column", height: "100%" } },
    h("form", { onSubmit: (e) => { e.preventDefault(); void run(); }, style: { ...row, padding: "10px 16px", borderBottom: "1px solid var(--color-line)" } },
      h(Choice, { value: kind, label: "What to browse", onChange: setKind, options: SCOPES.map((s) => ({ value: s.kind, label: s.kind === "jql" ? "JQL" : s.label })) }),
      kind === "jql" && h(Input, { value: jql, placeholder: "project = PAY AND text ~ webhook", "aria-label": "JQL", onChange: (e) => setJql(e.target.value), style: { flex: 1, height: 28, fontSize: 12, fontFamily: "var(--font-mono)" } }),
      h(Button, { size: "sm", type: "submit", disabled: loading || (kind === "jql" && !jql.trim()), "data-browse-run": true }, "Search"),
      h("span", { style: muted }, "Shown live; nothing is written until you track one.")),
    h("div", { style: { flex: 1, minHeight: 0, overflow: "auto" } },
      error && h(Problem, null, error),
      !result && loading && h(Loading, { label: "Asking Jira" }),
      result && (result.issues.length === 0 ? h("p", { style: { ...muted, padding: 16 } }, "No issues.")
        : h("table", { style: { width: "100%", borderCollapse: "collapse" } },
          h("tbody", null, result.issues.map((i) => h("tr", { key: i.key, "data-browse-issue": i.key },
            h("td", { style: { ...td, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" } }, i.key),
            h("td", { style: td }, i.summary),
            h("td", { style: { ...td, ...muted, whiteSpace: "nowrap" } }, i.status),
            h("td", { style: { ...td, ...muted, whiteSpace: "nowrap" } }, i.assignee ?? "Unassigned"),
            h("td", { style: { ...td, textAlign: "right" } }, i.tracked
              ? h(Badge, { variant: "secondary" }, tracking[i.key] && tracking[i.key] !== "…" ? `Tracked as ${tracking[i.key]}` : "Tracked")
              : h(Button, { size: "2xs", variant: "outline", disabled: tracking[i.key] === "…", onClick: () => track(i.key), "data-track": i.key }, "Track"))))))),
      result?.nextPageToken && h("div", { style: { padding: 10 } }, h(Button, { size: "sm", variant: "ghost", disabled: loading, onClick: () => run(result.nextPageToken) }, "More"))));
}

function ConflictsTab({ call, hm, refresh }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [wf, setWf] = useState(null);
  const load = useCallback(() => call("conflicts").then(setList, (e) => setError(e.message)), [call]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { hm.issues?.workflow?.().then(setWf, () => {}); }, [hm]);
  const keep = async (id, side) => {
    try { await call("resolve", { id, keep: side }); toast.success(side === "jira" ? `${id} takes Jira's status` : `${id} keeps hive's status`); } catch (e) { toast.error(`Could not resolve ${id}`, { description: e.message }); }
    void load(); void refresh();
  };
  if (error) return h(Problem, null, error);
  if (!list) return h(Loading, { label: "Reading the conflicts" });
  return h("div", { "data-jira-tab-body": "conflicts", style: { padding: 16, display: "grid", gap: 8, alignContent: "start" } },
    h("p", { style: { ...muted, margin: 0 } }, "Both sides moved an issue to different statuses since the last sync. With no answer, Jira's status wins after a day."),
    list.length === 0 ? h("p", { style: small }, "No conflicts.")
      : list.map((c) => h("div", { key: c.id, "data-conflict": c.id, style: { ...card, display: "grid", gap: 6 } },
        h("div", { style: row }, h("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12 } }, c.id), c.title && h("span", { style: { fontSize: 12.5 } }, c.title), h("span", { style: { ...muted, marginLeft: "auto" } }, `since ${relative(c.since)}`)),
        h("div", { style: small }, `hive: ${statusName(wf, c.local)} · Jira: ${statusName(wf, c.remote)}`),
        h("div", { style: row },
          h(Button, { size: "2xs", variant: "outline", onClick: () => keep(c.id, "jira"), "data-keep": "jira" }, "Keep Jira"),
          h(Button, { size: "2xs", variant: "ghost", onClick: () => keep(c.id, "hive"), "data-keep": "hive" }, "Keep hive")))));
}

const TABS = [
  { id: "status", label: "Status" },
  { id: "mapping", label: "Mapping" },
  { id: "scope", label: "Scope" },
  { id: "browse", label: "Browse" },
  { id: "conflicts", label: "Conflicts" },
];

function Tabs({ hm, call, status, refresh, summary, onSummarySeen }) {
  const [tab, setTab] = useTileState(hm, "tab", "status");
  const conflicts = status.counts?.conflicts ?? 0;
  return h("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
    h("div", { role: "tablist", style: { ...row, gap: 4, padding: "6px 12px", borderBottom: "1px solid var(--color-line)" } },
      TABS.map((t) => h(Button, { key: t.id, role: "tab", size: "2xs", variant: tab === t.id ? "secondary" : "ghost", "aria-selected": tab === t.id, "data-jira-tab": t.id, onClick: () => setTab(t.id) },
        t.id === "conflicts" && conflicts ? `${t.label} ${conflicts}` : t.label)),
      h("span", { style: { flex: 1 } }),
      h("span", { style: muted }, status.connected ? `${status.site ?? ""} · ${status.project}` : "Not connected")),
    summary && h("div", { "data-first-sync": true, style: { ...row, padding: "8px 16px", background: "var(--color-bg3)", fontSize: 12.5 } },
      h("span", { style: { flex: 1 } }, `Linked ${status.project}. First sync: ${syncSummary(summary)}. Open the Issues tile to see the board.`),
      h(Button, { size: "2xs", variant: "ghost", onClick: onSummarySeen }, "OK")),
    h("div", { style: { flex: 1, minHeight: 0, overflow: "auto" } },
      tab === "status" ? h(StatusTab, { call, status, refresh, goTo: setTab })
        : tab === "mapping" ? h(MappingTab, { call })
          : tab === "scope" ? h(ScopeTab, { call, status, refresh })
            : tab === "browse" ? h(BrowseTab, { call })
              : h(ConflictsTab, { call, hm, refresh })));
}

function Jira({ hm, host }) {
  const { call, status, error, refresh } = useService(host);
  const [summary, setSummary] = useState(null);
  // The wizard hands its first sync's summary to the tabs it gives way to.
  const linked = !!status?.project;
  const wasLinked = useRef(linked);
  const [lastSummary, setLastSummary] = useState(null);
  useEffect(() => { if (linked && !wasLinked.current && lastSummary) setSummary(lastSummary); wasLinked.current = linked; }, [linked, lastSummary]);
  if (!status) {
    if (error) return h("div", { style: { padding: 16, display: "grid", gap: 8 } },
      h(Problem, null, `The Jira service does not answer: ${error}`),
      h("p", { style: small }, "Switch it on for this workspace in Settings ▸ Plugins ▸ Jira; the tile connects as soon as it runs."),
      h("div", null, h(Button, { size: "sm", variant: "outline", onClick: refresh }, "Try again")));
    return h(Loading, { label: "Reaching the Jira service" });
  }
  return linked
    ? h(Tabs, { hm, call, status, refresh, summary, onSummarySeen: () => setSummary(null) })
    : h(WizardHost, { call, status, refresh, onSummary: setLastSummary });
}

/** The wizard, which reports its first sync's summary before the tabs replace it. */
function WizardHost({ call, status, refresh, onSummary }) {
  const wrapped = useMemo(() => async (command, args) => {
    const out = await call(command, args);
    if (command === "configure") onSummary(out?.firstSync ?? { created: [], updated: [], unchanged: 0, conflicts: 0, archived: [] });
    return out;
  }, [call, onSummary]);
  return h(Wizard, { call: wrapped, status, refresh });
}

export default { tiles: { jira: Jira } };
