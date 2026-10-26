// What each Jira REST call the service makes must answer (Cloud platform v3, Software 1.0). As
// over MCP (mcp/schemas.ts), a field the sync reads is typed and anything else passes through; an
// answer that doesn't match fails loudly, naming the call. Shapes REST shares with the Rovo tools,
// which answer REST's bodies, are taken from there.
import { z } from "zod";
import { BoardConfigZ, BoardsZ, MyselfZ, ProjectStatusesZ, ProjectsZ, SprintsZ, StatusZ, TransitionsZ } from "../mcp/schemas.js";

export { BoardConfigZ, BoardsZ, MyselfZ, ProjectStatusesZ, ProjectsZ, SprintsZ, TransitionsZ };

const When = z.string().refine((s) => Number.isFinite(Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))), "not a timestamp");
const UserZ = z.looseObject({ accountId: z.string().optional(), displayName: z.string(), timeZone: z.string().optional() });
/** An ADF document, or a string (a v2-shaped body). */
const RichZ = z.union([z.looseObject({ type: z.literal("doc"), content: z.array(z.unknown()) }), z.string()]);

export const TenantZ = z.looseObject({ cloudId: z.string().min(1) });
export const ServerInfoZ = z.looseObject({ baseUrl: z.string().url(), deploymentType: z.string().optional() });
export const IssueTypesZ = z.array(z.looseObject({ id: z.string(), name: z.string(), subtask: z.boolean(), hierarchyLevel: z.number().int().optional() }));
export const ResolutionsZ = z.looseObject({ values: z.array(z.looseObject({ id: z.string(), name: z.string() })), isLast: z.boolean().optional() });
export const FieldsZ = z.array(z.looseObject({ id: z.string(), name: z.string(), custom: z.boolean(), schema: z.looseObject({ type: z.string().optional(), custom: z.string().optional() }).optional() }));
export const PermissionsZ = z.looseObject({ permissions: z.record(z.string(), z.looseObject({ havePermission: z.boolean() })) });
export const FilterZ = z.looseObject({ id: z.string(), jql: z.string().optional() });
export const FeaturesZ = z.looseObject({ features: z.array(z.looseObject({ boardFeature: z.string(), state: z.string() })) });

/** An issue as search and bulkfetch answer it. */
export const IssueZ = z.looseObject({
  id: z.string().min(1),
  key: z.string().min(1),
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
    description: RichZ.nullable().optional(),
    resolution: z.looseObject({ name: z.string() }).nullable().optional(),
  }).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export const SearchZ = z.looseObject({ issues: z.array(IssueZ), nextPageToken: z.string().optional(), isLast: z.boolean().optional() });
export const BulkZ = z.looseObject({
  issues: z.array(IssueZ),
  issueErrors: z.array(z.looseObject({ id: z.string().optional(), errorMessage: z.string().optional() })).optional(),
});
export const CountZ = z.looseObject({ count: z.number().int().nonnegative() });
export const ParseZ = z.looseObject({ queries: z.array(z.looseObject({ query: z.string(), errors: z.array(z.string()).optional() })) });

export const CommentsZ = z.looseObject({
  comments: z.array(z.looseObject({ id: z.string(), author: UserZ.optional(), body: RichZ, created: When, updated: When.optional() })),
  total: z.number().int().optional(),
  startAt: z.number().int().optional(),
});
export const CommentZ = z.looseObject({ id: z.string() });
export const PropertyZ = z.looseObject({ key: z.string(), value: z.unknown() });

export const ChangelogZ = z.looseObject({
  issueChangeLogs: z.array(z.looseObject({
    issueId: z.string(),
    changeHistories: z.array(z.looseObject({
      id: z.string(),
      created: When,
      author: UserZ.optional(),
      items: z.array(z.looseObject({ field: z.string().optional(), fieldId: z.string().optional(), from: z.string().nullable().optional(), fromString: z.string().nullable().optional(), to: z.string().nullable().optional(), toString: z.string().nullable().optional() })),
    })),
  })),
  nextPageToken: z.string().optional(),
});

export const WorkflowsZ = z.looseObject({
  workflows: z.array(z.looseObject({
    name: z.string(),
    transitions: z.array(z.looseObject({
      id: z.string(),
      name: z.string(),
      type: z.string().optional(),
      toStatusReference: z.string(),
      links: z.array(z.looseObject({ fromStatusReference: z.string() })).optional(),
    })),
  })),
});

/** Jira's refusal body: `{errorMessages[], errors{}}` (platform), or the gateway's `{code, message}`. */
export const ErrorBodyZ = z.looseObject({
  errorMessages: z.array(z.string()).optional(),
  errors: z.record(z.string(), z.string()).optional(),
  message: z.string().optional(),
});
