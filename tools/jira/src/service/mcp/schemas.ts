// What each Rovo MCP tool the service calls must answer (design §9.2: the output is
// semi-structured and `structuredContent` may be withheld, so every answer is read from its text
// and checked here). A field the sync reads is typed; anything else passes through. An answer that
// doesn't match fails loudly, naming the tool — never guessed at.
import { z } from "zod";

const Category = z.looseObject({ key: z.string(), colorName: z.string().optional() });
export const StatusZ = z.looseObject({ id: z.string(), name: z.string(), statusCategory: Category.optional() });
const UserZ = z.looseObject({ accountId: z.string().optional(), displayName: z.string(), timeZone: z.string().optional() });
const When = z.string().refine((s) => Number.isFinite(Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))), "not a timestamp");

export const ResourcesZ = z.array(z.looseObject({ id: z.string().min(1), url: z.string().url(), name: z.string().optional(), scopes: z.array(z.string()).optional() }));
export const UserInfoZ = z.looseObject({ account_id: z.string(), zoneinfo: z.string().nullable().optional() });
export const MyselfZ = z.looseObject({ accountId: z.string(), displayName: z.string(), timeZone: z.string().nullable().optional() });

export const ProjectsZ = z.looseObject({
  values: z.array(z.looseObject({ id: z.string(), key: z.string(), name: z.string(), style: z.string().optional(), simplified: z.boolean().optional() })),
  isLast: z.boolean().optional(),
});
export const ProjectStatusesZ = z.array(z.looseObject({ id: z.string(), name: z.string(), statuses: z.array(StatusZ) }));
export const IssueTypesZ = z.looseObject({
  issueTypes: z.array(z.looseObject({ id: z.string(), name: z.string(), subtask: z.boolean(), hierarchyLevel: z.number().int() })),
  total: z.number().int().optional(),
});
export const FieldMetaZ = z.looseObject({
  fields: z.array(z.looseObject({ fieldId: z.string(), name: z.string(), schema: z.looseObject({ type: z.string().optional(), custom: z.string().optional() }).optional() })),
  total: z.number().int(),
  startAt: z.number().int().optional(),
});
export const BoardsZ = z.looseObject({
  values: z.array(z.looseObject({ id: z.number().int(), name: z.string(), type: z.string() })),
  isLast: z.boolean().optional(),
  total: z.number().int().optional(),
});
export const BoardConfigZ = z.looseObject({
  id: z.number().int(),
  type: z.string().optional(),
  filter: z.looseObject({ id: z.string() }).optional(),
  subQuery: z.looseObject({ query: z.string().optional() }).optional(),
  columnConfig: z.looseObject({ columns: z.array(z.looseObject({ name: z.string(), statuses: z.array(z.looseObject({ id: z.string() })) })) }),
  estimation: z.looseObject({ field: z.looseObject({ fieldId: z.string(), displayName: z.string().optional() }).optional() }).optional(),
});
const SprintZ = z.looseObject({ id: z.number().int(), name: z.string(), state: z.enum(["active", "future", "closed"]), originBoardId: z.number().int().optional() });
export const FiltersZ = z.looseObject({ values: z.array(z.looseObject({ id: z.string(), name: z.string(), jql: z.string().optional() })), total: z.number().int().optional() });
export const SprintsZ = z.looseObject({ values: z.array(SprintZ), isLast: z.boolean().optional() });
export const SprintDataZ = z.looseObject({ board: z.looseObject({ id: z.number().int(), name: z.string(), type: z.string() }), sprint: SprintZ });

/** An issue as search answers it: what the sync reads is typed when it is there. */
export const IssueZ = z.looseObject({
  id: z.string().min(1),
  key: z.string().min(1),
  appliedContentFormat: z.string().optional(),
  fields: z.looseObject({
    summary: z.string().optional(),
    status: StatusZ.optional(),
    updated: When.optional(),
    created: When.optional(),
    assignee: UserZ.nullable().optional(),
    reporter: UserZ.nullable().optional(),
    issuetype: z.looseObject({ id: z.string(), name: z.string(), hierarchyLevel: z.number().int().optional(), subtask: z.boolean().optional() }).optional(),
    priority: z.looseObject({ name: z.string() }).nullable().optional(),
    labels: z.array(z.string()).optional(),
    components: z.array(z.looseObject({ name: z.string() })).optional(),
    fixVersions: z.array(z.looseObject({ name: z.string() })).optional(),
    parent: z.looseObject({ id: z.string(), key: z.string() }).nullable().optional(),
    description: z.string().nullable().optional(),
    resolution: z.looseObject({ name: z.string() }).nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
});
export const CountZ = z.looseObject({ total: z.number().int().nonnegative() });
export const SearchZ = z.looseObject({ issues: z.array(IssueZ), nextPageToken: z.string().optional(), isLast: z.boolean() });

export const CommentsZ = z.looseObject({
  comments: z.array(z.looseObject({
    id: z.string(),
    author: UserZ.optional(),
    body: z.string(),
    appliedContentFormat: z.string().optional(),
    created: When,
    updated: When.optional(),
  })),
  total: z.number().int().optional(),
  startAt: z.number().int().optional(),
  maxResults: z.number().int().optional(),
});

export const TransitionsZ = z.looseObject({
  transitions: z.array(z.looseObject({
    id: z.string(),
    name: z.string(),
    to: StatusZ,
    hasScreen: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    isConditional: z.boolean().optional(),
    isGlobal: z.boolean().optional(),
    fields: z.record(z.string(), z.looseObject({ required: z.boolean(), name: z.string(), allowedValues: z.array(z.looseObject({ id: z.string().optional(), name: z.string().optional() })).optional() })).optional(),
  })),
});

// ── writes (P3) ───────────────────────────────────────────────────────────────────────────────

/** transitionJiraIssue: where the issue landed (ASSUMED shape: the docs say only that it reports it). */
export const TransitionDoneZ = z.looseObject({ key: z.string().optional(), status: StatusZ.optional() });
/** addOrEditJiraIssueComment: the comment as Jira keeps it. */
export const CommentDoneZ = z.looseObject({ id: z.string().min(1), body: z.string().optional(), appliedContentFormat: z.string().optional() });
/** editJiraIssue answers the issue as getJiraIssue would; nothing of it is read. */
export const EditedZ = z.looseObject({});
/** listJiraIssueRemoteIssueLinks: the issue's links, without their globalId (design §9.2, P2 finding 3). */
export const RemoteLinksZ = z.array(z.looseObject({ id: z.number().int().optional(), object: z.looseObject({ url: z.string(), title: z.string().optional() }) }));
export const RemoteLinkDoneZ = z.looseObject({ id: z.number().int().optional() });
export const PropertyZ = z.looseObject({ key: z.string(), value: z.unknown() });

/** A tool failure: `{"error":true,"message","statusCode"}`, or the stale grant's `{"code":403,"message"}`. */
export const ToolErrorZ = z.union([
  z.looseObject({ error: z.literal(true), message: z.string(), statusCode: z.number().int().optional() }),
  z.looseObject({ code: z.number().int(), message: z.string() }),
]);
