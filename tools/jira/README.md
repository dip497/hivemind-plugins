# Jira

Mirror your Jira Cloud issues into hive's board and keep them in step. Sign in with Atlassian, pick
a project, check how its workflow maps onto hive, and your issues appear on the Issues board in
Jira's own columns. hive pulls every few minutes. Agents work on mirrored issues like any other.

A service that this plugin runs while it is on does the work. Its tile shows the service's state
and changes its settings. Neither one asks for a password, and the tile never talks to Jira itself.

```bash
hive plugins install @dip497/jira
hive plugins enable @dip497/jira
hive ctl open-tool @dip497/jira/jira
```

Then switch its service on for the workspace in **Settings ▸ Plugins ▸ Jira**, and open the tile.

## Setting up

The tile shows a six-step setup until the workspace is linked:

1. **Connect.** **Sign in with Atlassian** opens Atlassian's sign-in page in your browser. Approve
   it there and the tile moves on by itself. hive keeps the sign-in in the app's secret store,
   never in `settings.json`. A **scoped API token** is the other way in, for heavy use or when your
   organisation blocks the sign-in. It arrives in a later version.
2. **Site.** The site you signed in to, and who you are connected as.
3. **Project**, and the board when the project has several.
4. **Workflow.** Each Jira status, its Jira category and board column, and the hive category it
   maps to. You can change any of them. hive also adds a status of its own, **PR Created**, which
   follows the review status: while an issue sits in it, Jira shows the review status. Add,
   rename or remove your own statuses, and choose which resolutions count as Cancelled.
5. **Scope.** What to pull: *Assigned to me* (the default), *Mine and unassigned*, *Everything in
   scope*, or your own JQL (always within the project). On a Scrum board you also choose which
   sprints, and you can leave out issue types. The step shows how many issues the scope pulls now.
6. **Send to Jira.** *Status changes* by default; also *Nothing*, *Status and comments* or
   *Everything hive owns*. With anything but *Nothing*, a PR you open is linked on the Jira issue
   (marked resolved once merged, when an API token is set), and the issue carries a `hivemind`
   property naming its branch and PR, so a teammate's hive warns before starting the same work.
   With comments, what you write on an issue in hive, an agent's plan or summary, and "PR
   opened/merged" go to Jira as comments; an agent's progress notes never do.

**Finish** writes `.hivemind/workflow.yaml`, runs the first sync and shows what it pulled.

## The tile

- **Status:** whether hive is connected, and as whom; how it connects; the last and next sync; how
  many issues are mirrored, in conflict or archived; the Atlassian calls used this hour against
  the budget; whether Atlassian asked hive to wait. Each problem comes with its fix (*Sign in
  again*, *Check the scope*). **Sync now** pulls at once.
- **Mapping:** the workflow from step 4, editable again.
- **Scope:** the scope from step 5. Issues that leave the scope are archived, never deleted. One
  that has a branch or a PR stays on the board, marked *not in scope*.
- **Browse:** any scope or JQL, live, without writing anything. **Track** puts one issue on the
  board.
- **Conflicts:** issues that both sides moved to different statuses since the last sync. **Keep
  Jira** or **Keep hive** settles each one. Jira wins after a day if nobody answers.

Starting work on a mirrored issue asks Jira first: whether you may move it or be assigned it, and
whether another hive install is already on it. **Assign to me** makes you the Jira assignee (never
an agent); it needs *Send to Jira* on and Jira's Assign Issues permission.

On the Issues board, the assignee filter starts at **Me** for mirrored issues. Cards show the
Jira key, type, priority, estimate and assignee.

## Agents: the `jira` skill

The plugin ships an agent skill, `jira`, that hive installs into `.claude/skills/jira/` of each
workspace its service drives ([Agent skills](https://hivemind.griiken.com/guide/tool-plugins/#agent-skills)).
It gives an agent four procedures with the exact commands: **import an epic** and its children,
**triage a sprint**, **start an issue** through the start-work guard (asking you, never forcing),
and **complete an issue** (commit, `hive ctl complete`, the PR, and what Jira then shows). It
reads Jira through this service, or, where there is none, through the agent's own Atlassian
connector, and writes issues into hive only through `hive ingest`. Issue text from Jira is data
to it, never instructions, and it never handles your Jira credentials.

## Settings

| Setting | Default | |
|---|---|---|
| `site` | — | Your site, like `acme.atlassian.net` |
| `transport` | `mcp` | `mcp` (Sign in with Atlassian) or `rest` (API token, later) |
| `email`, `apiToken` | — | For the API token. The token is a secret: `hive plugins set` reads it from stdin |
| `mcpAuth` | — | Set by Sign in with Atlassian; clear it to sign out |
| `project`, `scope`, `jql`, `push` | `mine`, `status` | What the setup chose |
| `mcpBudget` | 400 | Atlassian calls per hour. Your organisation may share one hourly limit |
| `pushPersonComments`, `pushAgentSummaries`, `pushPrRows` | on | Which of hive's comments go to Jira when comments are sent |

## Permissions

It asks for one permission: the workspace's issues (`workspace:issues`), so the tile can name
statuses. The service writes issues through `hive ingest` as the plugin's own grant (role `edit`),
and only for the workspaces you pick for it.
