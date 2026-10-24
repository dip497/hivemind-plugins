// Which Rovo MCP tool does what (design §9.2). Atlassian renames tools (CHANGE-3452:
// findJiraIssueAssignableUsers → listJiraIssueAssignableUsers) and some sites lack some (#282), so
// the transport never calls a tool by a hard-coded name: it reads the paged `tools/list` of
// `?tools=all` once per session and finds each capability here, by its known names, then by a
// pattern. Rovo's semantic `search` costs credits and is never one of them.

export type Capability =
  | "resources" | "userInfo" | "myself" | "search" | "issue" | "projects" | "projectStatuses" | "issueTypes" | "fieldMeta"
  | "boards" | "boardConfig" | "boardSprints" | "sprintData" | "boardIssues" | "comments" | "changelog"
  | "transitions" | "transition" | "comment" | "edit" | "assignable" | "remoteLinks" | "addRemoteLink"
  | "getProperty" | "setProperty" | "workflows";

/** Known names first (newest first), then a pattern for a rename nobody has seen yet. */
export const TOOL_NAMES: Record<Capability, { names: string[]; pattern?: RegExp }> = {
  resources: { names: ["getAccessibleAtlassianResources"] },
  userInfo: { names: ["atlassianUserInfo"] },
  myself: { names: ["getJiraCurrentUser"], pattern: /^getJira(Current|My)User$/ },
  search: { names: ["searchJiraIssuesUsingJql"], pattern: /^searchJiraIssues.*Jql$/ },
  issue: { names: ["getJiraIssue"] },
  projects: { names: ["listJiraProjects", "getVisibleJiraProjects"] },
  projectStatuses: { names: ["listJiraStatuses"] },
  issueTypes: { names: ["listJiraProjectIssueTypesMetadata", "getJiraProjectIssueTypesMetadata"] },
  fieldMeta: { names: ["getJiraIssueTypeMetaWithFields"] },
  boards: { names: ["listJiraBoards"] },
  boardConfig: { names: ["getJiraBoardConfig"], pattern: /^getJiraBoardConfig(uration)?$/ },
  boardSprints: { names: ["listJiraBoardSprints"] },
  sprintData: { names: ["getJiraBoardSprintData"] },
  boardIssues: { names: ["getJiraBoardIssueData"] },
  comments: { names: ["listJiraIssueComments", "getJiraIssueComments"] },
  changelog: { names: ["listJiraIssueChangelogs"] },
  transitions: { names: ["listJiraIssueTransitions", "getTransitionsForJiraIssue"] },
  transition: { names: ["transitionJiraIssue"] },
  comment: { names: ["addOrEditJiraIssueComment", "addCommentToJiraIssue"] },
  edit: { names: ["editJiraIssue"] },
  assignable: { names: ["listJiraIssueAssignableUsers", "findJiraIssueAssignableUsers"], pattern: /^(list|find)Jira.*AssignableUsers$/ },
  remoteLinks: { names: ["listJiraIssueRemoteIssueLinks", "getJiraIssueRemoteIssueLinks"] },
  addRemoteLink: { names: ["createJiraIssueRemoteIssueLink"] },
  getProperty: { names: ["getJiraEntityProperty"] },
  setProperty: { names: ["editJiraEntityProperty"] },
  workflows: { names: ["getJiraWorkflows"] },
};

/** Never called: Rovo semantic search "may consume up to 10 Rovo credits per call". */
export const NEVER = new Set(["search"]);

/** Each capability's tool among `listed`; a capability with none is absent. */
export function resolveTools(listed: readonly string[]): Partial<Record<Capability, string>> {
  const have = new Set(listed.filter((n) => !NEVER.has(n)));
  const out: Partial<Record<Capability, string>> = {};
  for (const [cap, { names, pattern }] of Object.entries(TOOL_NAMES) as [Capability, (typeof TOOL_NAMES)[Capability]][]) {
    const name = names.find((n) => have.has(n)) ?? (pattern ? [...have].find((n) => pattern.test(n)) : undefined);
    if (name) out[cap] = name;
  }
  return out;
}
