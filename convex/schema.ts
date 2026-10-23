import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Who did something: a signed-in person or an agent acting through a token. */
export const vPrincipal = v.object({
  kind: v.union(v.literal("user"), v.literal("agent")),
  id: v.string(),
  name: v.string(),
});

export const vWorkspaceRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("guest"),
);

export const vProjectRole = v.union(v.literal("lead"), v.literal("member"), v.literal("viewer"));

export const vStatusCategory = v.union(
  v.literal("backlog"),
  v.literal("unstarted"),
  v.literal("started"),
  v.literal("blocked"),
  v.literal("review"),
  v.literal("completed"),
  v.literal("canceled"),
);

export const vTaskType = v.union(
  v.literal("task"),
  v.literal("bug"),
  v.literal("feature"),
  v.literal("idea"),
  v.literal("finding"),
  v.literal("decision"),
  v.literal("requirement"),
  v.literal("chore"),
);

/** Which model and effort a row needs; the mapping lives in docs/work-contract.md. */
export const vTier = v.union(v.literal("routine"), v.literal("standard"), v.literal("critical"));

export const vPriority = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("urgent"),
);

export const vTicketKind = v.union(
  v.literal("bug"),
  v.literal("feature"),
  v.literal("question"),
  v.literal("support"),
);

export const vTicketStatus = v.union(
  v.literal("new"),
  v.literal("triaged"),
  v.literal("accepted"),
  v.literal("in_progress"),
  v.literal("resolved"),
  v.literal("closed"),
  v.literal("rejected"),
  v.literal("duplicate"),
);

export const vSeverity = v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"));

/**
 * Where a partner-authored item stands in the ingest queue. `exempt` covers
 * everything mirrored from a source or written by an agent: nothing to ingest.
 */
export const vIngest = v.object({
  state: v.union(
    v.literal("new"),
    v.literal("claimed"),
    v.literal("done"),
    v.literal("skipped"),
    v.literal("exempt"),
  ),
  claimedBy: v.optional(v.string()),
  leaseUntil: v.optional(v.number()),
  ref: v.optional(v.string()),
  note: v.optional(v.string()),
  at: v.optional(v.number()),
});

export const vTarget = v.union(
  v.object({ type: v.literal("task"), id: v.id("tasks") }),
  v.object({ type: v.literal("ticket"), id: v.id("tickets") }),
  v.object({ type: v.literal("project"), id: v.id("projects") }),
);

export const vScope = v.union(
  v.literal("read"),
  v.literal("write"),
  v.literal("comment"),
  v.literal("sync"),
  v.literal("ingest"),
  v.literal("admin"),
  /** Answer the owner's Needs you queue for them. Never implied by admin: the owner grants it on purpose. */
  v.literal("decide"),
);

/** An answer to a Needs you item: a feature to accept, a blocked row, a proposal, a stale row. */
export const vVerdict = v.union(
  v.literal("accept"),
  v.literal("send_back"),
  v.literal("unblock"),
  v.literal("approve"),
  v.literal("keep"),
  v.literal("drop"),
);

export const vStatusDef = v.object({
  key: v.string(),
  name: v.string(),
  category: vStatusCategory,
});

export default defineSchema({
  /** Security-relevant events, kept 30 days. Watched by monitor.ts. */
  securityEvents: defineTable({
    at: v.number(),
    kind: v.union(
      v.literal("sign_in_failed"),
      v.literal("sign_in_throttled"),
      v.literal("sign_in_disabled"),
      v.literal("sign_up_rejected"),
      v.literal("bad_token"),
      v.literal("token_rate_limited"),
      v.literal("proxy_secret_missing"),
      v.literal("admin_action"),
    ),
    ip: v.optional(v.string()),
    email: v.optional(v.string()),
    detail: v.optional(v.string()),
  })
    .index("by_at", ["at"])
    .index("by_kind_at", ["kind", "at"]),

  /** Raised by the monitor; shown in /admin and sent to ALERT_WEBHOOK_URL. */
  alerts: defineTable({
    at: v.number(),
    kind: v.string(),
    severity: v.union(v.literal("warning"), v.literal("critical")),
    message: v.string(),
    acknowledgedAt: v.optional(v.number()),
    delivered: v.boolean(),
  })
    .index("by_at", ["at"])
    .index("by_kind_at", ["kind", "at"]),

  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.string(),
    /** Monotonic counter for `activity.seq`, the sync change-feed cursor. */
    seq: v.number(),
    ticketSeq: v.number(),
  }).index("by_slug", ["slug"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    role: vWorkspaceRole,
    name: v.string(),
    email: v.string(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  /** App-side facts about a Better Auth user that the auth tables do not hold. */
  profiles: defineTable({
    userId: v.string(),
    /** Set when an admin issues a password; cleared when the user changes it. */
    mustChangePassword: v.boolean(),
    disabledAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  projects: defineTable({
    workspaceId: v.id("workspaces"),
    key: v.string(),
    name: v.string(),
    description: v.string(),
    color: v.string(),
    /** `workspace`: every non-guest member sees it. `members`: only project members. */
    visibility: v.union(v.literal("workspace"), v.literal("members")),
    statuses: v.array(vStatusDef),
    taskSeq: v.number(),
    createdBy: v.string(),
    archivedAt: v.optional(v.number()),
    /** Roadmap capacity: agent-hours per working day, and the working weekdays (0 = Sunday). */
    roadmap: v.optional(v.object({ hoursPerDay: v.number(), workDays: v.array(v.number()) })),
    /**
     * The project follows the work contract (docs/work-contract.md): features
     * with tasks under them, the entry and closing rules in domain/contract.ts,
     * and progress counted in features. Projects from before it leave this unset.
     */
    contract: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_key", ["workspaceId", "key"]),

  projectMembers: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    principalKind: v.union(v.literal("user"), v.literal("agent")),
    principalId: v.string(),
    role: vProjectRole,
  })
    .index("by_project", ["projectId"])
    .index("by_principal", ["principalId"])
    .index("by_project_principal", ["projectId", "principalId"]),

  sections: defineTable({
    projectId: v.id("projects"),
    parentId: v.optional(v.id("sections")),
    key: v.string(),
    name: v.string(),
    description: v.string(),
    doc: v.optional(v.string()),
    order: v.number(),
    managedBy: v.optional(v.string()),
  })
    .index("by_project", ["projectId", "order"])
    .index("by_parent", ["parentId"]),

  milestones: defineTable({
    projectId: v.id("projects"),
    key: v.string(),
    name: v.string(),
    goal: v.string(),
    exitCriteria: v.string(),
    order: v.number(),
    /** Coding-agent hours the whole milestone takes, as the source estimates it. */
    agentHours: v.optional(v.number()),
    estimateNote: v.optional(v.string()),
    /** Milestones on different tracks are built in parallel on the roadmap. */
    track: v.optional(v.string()),
    /** A parking lot (e.g. the hub's LATER): its tasks are listed but not scheduled, so the roadmap leaves it out. */
    unplanned: v.optional(v.boolean()),
    /** Set by a person once every feature is done and the exit criteria hold. */
    closedAt: v.optional(v.number()),
    managedBy: v.optional(v.string()),
  }).index("by_project", ["projectId", "order"]),

  tasks: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    number: v.number(),
    /** External key shown next to the app key, e.g. the hub's `SM-01`. */
    alias: v.optional(v.string()),
    title: v.string(),
    description: v.string(),
    status: v.string(),
    type: vTaskType,
    priority: vPriority,
    assignees: v.array(vPrincipal),
    sectionId: v.optional(v.id("sections")),
    milestoneId: v.optional(v.id("milestones")),
    rank: v.number(),
    parentTaskId: v.optional(v.id("tasks")),
    estimateDays: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    labels: v.array(v.string()),
    acceptance: v.string(),
    evidence: v.string(),
    commitSha: v.string(),
    context: v.optional(v.string()),
    instructions: v.optional(v.string()),
    tier: v.optional(vTier),
    /** Who asked for a top-level row that an agent created. Without it the row is a proposal. */
    origin: v.optional(v.string()),
    /** Written when a feature is finished: what a person can do now, and what was not verified. */
    summary: v.optional(v.string()),
    /** Who a blocked row waits on, and for what. */
    blocked: v.optional(v.object({ on: v.string(), what: v.string() })),
    /** The last time a person sent the row back from review, and how often that happened. */
    sentBack: v.optional(v.object({ reason: v.string(), at: v.number() })),
    sendBacks: v.optional(v.number()),
    /** An agent's suggested answer while the row is on the Needs you page. A person confirms it; any move clears it. */
    advice: v.optional(v.object({ verdict: vVerdict, reason: v.string(), by: vPrincipal, at: v.number() })),
    /** Source that owns this task; its fields are read-only in the app. */
    managedBy: v.optional(v.string()),
    /** Set by a source for work that is not planned work (e.g. the hub's inbox). */
    excludeFromProgress: v.optional(v.boolean()),
    ingest: vIngest,
    createdBy: vPrincipal,
    updatedAt: v.number(),
    version: v.number(),
  })
    .index("by_project", ["projectId", "rank"])
    .index("by_project_number", ["projectId", "number"])
    .index("by_project_alias", ["projectId", "alias"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_parent", ["parentTaskId"])
    .index("by_ingest", ["workspaceId", "ingest.state"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["workspaceId", "projectId"] }),

  /** Commits that name a row's key in their subject, reported by the git hook. They are the row's evidence. */
  commits: defineTable({
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
    sha: v.string(),
    subject: v.string(),
    branch: v.optional(v.string()),
    /** The model named in the commit's Co-Authored-By trailer. */
    model: v.optional(v.string()),
    onMain: v.boolean(),
    at: v.number(),
  })
    .index("by_task", ["taskId", "at"])
    .index("by_project_sha", ["projectId", "sha"]),

  taskDeps: defineTable({
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
    dependsOnId: v.id("tasks"),
  })
    .index("by_project", ["projectId"])
    .index("by_task", ["taskId"])
    .index("by_depends_on", ["dependsOnId"]),

  tickets: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    number: v.number(),
    kind: vTicketKind,
    title: v.string(),
    body: v.string(),
    severity: vSeverity,
    status: vTicketStatus,
    reporter: vPrincipal,
    assignee: v.optional(vPrincipal),
    ingest: vIngest,
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId", "status"])
    .index("by_project", ["projectId", "status"])
    .index("by_workspace_number", ["workspaceId", "number"])
    .index("by_ingest", ["workspaceId", "ingest.state"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["workspaceId", "projectId"] }),

  ticketLinks: defineTable({
    ticketId: v.id("tickets"),
    taskId: v.id("tasks"),
    relation: v.union(v.literal("implements"), v.literal("duplicates"), v.literal("relates")),
  })
    .index("by_ticket", ["ticketId"])
    .index("by_task", ["taskId"]),

  comments: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    target: vTarget,
    targetKey: v.string(),
    author: vPrincipal,
    body: v.string(),
    mentions: v.array(v.string()),
    externalOrigin: v.optional(v.string()),
    ingest: vIngest,
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_target", ["targetKey"])
    .index("by_ingest", ["workspaceId", "ingest.state"]),

  /** Append-only. There is no function that updates or deletes a row. */
  activity: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    seq: v.number(),
    targetKey: v.string(),
    actor: vPrincipal,
    /** `app` for changes made here; a source name for synced changes. */
    origin: v.string(),
    action: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_workspace_seq", ["workspaceId", "seq"])
    .index("by_project_seq", ["projectId", "seq"])
    .index("by_target", ["targetKey", "seq"]),

  externalRefs: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    source: v.string(),
    entityType: v.union(
      v.literal("section"),
      v.literal("milestone"),
      v.literal("task"),
      v.literal("event"),
      v.literal("comment"),
    ),
    externalId: v.string(),
    entityId: v.string(),
    contentHash: v.string(),
    lastSyncedAt: v.number(),
  })
    .index("by_key", ["projectId", "source", "entityType", "externalId"])
    .index("by_entity", ["entityId"]),

  syncSources: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    name: v.string(),
    label: v.string(),
    lastPushAt: v.optional(v.number()),
  }).index("by_project_name", ["projectId", "name"]),

  agents: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.string(),
    createdBy: v.string(),
    disabledAt: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),

  apiTokens: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
    scopes: v.array(vScope),
    /** Empty means every project the workspace has. */
    projectIds: v.array(v.id("projects")),
    /** The only source this token may push as, if it has `sync`. */
    source: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdBy: v.string(),
  })
    .index("by_hash", ["hash"])
    .index("by_agent", ["agentId"])
    .index("by_workspace", ["workspaceId"]),

  notifications: defineTable({
    userId: v.string(),
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("mention"),
      v.literal("assigned"),
      v.literal("comment"),
      v.literal("status"),
      v.literal("ticket"),
      v.literal("ingested"),
    ),
    targetKey: v.string(),
    title: v.string(),
    actor: vPrincipal,
    readAt: v.optional(v.number()),
  }).index("by_user", ["userId", "readAt"]),
});
