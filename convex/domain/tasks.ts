import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  type Actor,
  fail,
  originOf,
  principalOf,
  type Principal,
  requireProject,
  targetKey,
  taskKey,
} from "../lib/access";
import { logActivity, notify } from "../lib/activity";
import { vPriority, vTaskType, vTier } from "../schema";
import { categories, checkPriority, checkTitle, checkType, isFeature, isNote, isSettled, LIMITS, notReady, statusIn } from "./contract";

export const DEFAULT_STATUSES = [
  { key: "backlog", name: "Backlog", category: "backlog" as const },
  { key: "todo", name: "To do", category: "unstarted" as const },
  { key: "in_progress", name: "In progress", category: "started" as const },
  { key: "blocked", name: "Blocked", category: "blocked" as const },
  { key: "review", name: "In review", category: "review" as const },
  { key: "done", name: "Done", category: "completed" as const },
  { key: "superseded", name: "Superseded", category: "canceled" as const },
];

export const vTaskInput = {
  title: v.string(),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  type: v.optional(vTaskType),
  priority: v.optional(vPriority),
  assigneeIds: v.optional(v.array(v.string())),
  sectionId: v.optional(v.id("sections")),
  milestoneId: v.optional(v.id("milestones")),
  parentTaskId: v.optional(v.id("tasks")),
  estimateDays: v.optional(v.number()),
  dueAt: v.optional(v.number()),
  labels: v.optional(v.array(v.string())),
  acceptance: v.optional(v.string()),
  tier: v.optional(vTier),
  origin: v.optional(v.string()),
};

export const vTaskPatch = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  type: v.optional(vTaskType),
  priority: v.optional(vPriority),
  assigneeIds: v.optional(v.array(v.string())),
  sectionId: v.optional(v.union(v.id("sections"), v.null())),
  milestoneId: v.optional(v.union(v.id("milestones"), v.null())),
  parentTaskId: v.optional(v.union(v.id("tasks"), v.null())),
  tier: v.optional(v.union(vTier, v.null())),
  origin: v.optional(v.string()),
  estimateDays: v.optional(v.union(v.number(), v.null())),
  dueAt: v.optional(v.union(v.number(), v.null())),
  labels: v.optional(v.array(v.string())),
  acceptance: v.optional(v.string()),
  evidence: v.optional(v.string()),
  commitSha: v.optional(v.string()),
  rank: v.optional(v.number()),
});
export type TaskPatch = Infer<typeof vTaskPatch>;

type TaskInput = {
  [K in keyof typeof vTaskInput]?: Infer<(typeof vTaskInput)[K]>;
} & { title: string };

// ---------- validation ----------

export function cleanText(s: string | undefined, max: number, label: string) {
  const t = (s ?? "").trim();
  if (t.length > max) fail("invalid", `${label} is too long (max ${max} characters).`);
  return t;
}

function cleanTitle(s: string) {
  const t = cleanText(s, 300, "Title");
  if (!t) fail("invalid", "Title is required.");
  return t;
}

const cleanLabels = (labels: string[] | undefined) =>
  [...new Set((labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

export function requireStatus(project: Doc<"projects">, status: string) {
  const def = project.statuses.find((s) => s.key === status);
  if (!def) fail("invalid", `Unknown status "${status}". Use one of: ${project.statuses.map((s) => s.key).join(", ")}.`);
  return def!;
}

async function resolveAssignees(ctx: QueryCtx, project: Doc<"projects">, ids: string[]): Promise<Principal[]> {
  const out: Principal[] = [];
  for (const id of [...new Set(ids)].slice(0, 10)) {
    const m = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", project.workspaceId).eq("userId", id))
      .unique();
    if (m) {
      out.push({ kind: "user", id, name: m.name });
      continue;
    }
    const agentId = ctx.db.normalizeId("agents", id);
    const agent = agentId ? await ctx.db.get(agentId) : null;
    if (agent && agent.workspaceId === project.workspaceId && !agent.disabledAt) {
      out.push({ kind: "agent", id, name: agent.name });
      continue;
    }
    fail("invalid", "An assignee is not a member of this workspace.");
  }
  return out;
}

async function checkRefs(
  ctx: QueryCtx,
  project: Doc<"projects">,
  refs: { sectionId?: Id<"sections"> | null; milestoneId?: Id<"milestones"> | null; parentTaskId?: Id<"tasks"> | null },
) {
  if (refs.sectionId && (await ctx.db.get(refs.sectionId))?.projectId !== project._id) fail("invalid", "Unknown section.");
  if (refs.milestoneId && (await ctx.db.get(refs.milestoneId))?.projectId !== project._id) fail("invalid", "Unknown milestone.");
  if (refs.parentTaskId && (await ctx.db.get(refs.parentTaskId))?.projectId !== project._id) fail("invalid", "Unknown parent task.");
}

/** A task that came from a source can only be changed by that source's token. */
export function assertEditable(actor: Actor, task: Doc<"tasks">) {
  if (task.managedBy && !(actor.kind === "agent" && actor.source === task.managedBy)) {
    fail("managed", `This task is synced from ${task.managedBy} and is read-only here. Comment on it instead.`);
  }
}

export const ingestFor = (actor: Actor) => ({ state: actor.kind === "user" ? ("new" as const) : ("exempt" as const) });

// ---------- reads ----------

export function presentTask(project: Doc<"projects">, t: Doc<"tasks">) {
  return {
    id: t._id,
    key: taskKey(project, t),
    alias: t.alias ?? null,
    title: t.title,
    status: t.status,
    type: t.type,
    priority: t.priority,
    assignees: t.assignees,
    sectionId: t.sectionId ?? null,
    milestoneId: t.milestoneId ?? null,
    parentTaskId: t.parentTaskId ?? null,
    rank: t.rank,
    estimateDays: t.estimateDays ?? null,
    dueAt: t.dueAt ?? null,
    labels: t.labels,
    tier: t.tier ?? null,
    blockedOn: t.blocked?.on ?? null,
    sentBack: !!t.sentBack,
    managedBy: t.managedBy ?? null,
    ingest: t.ingest,
    createdBy: t.createdBy,
    createdAt: t._creationTime,
    updatedAt: t.updatedAt,
  };
}

export async function taskByRef(ctx: QueryCtx, project: Doc<"projects">, ref: string) {
  const r = ref.trim();
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(r);
  if (m && m[1].toUpperCase() === project.key) {
    const t = await ctx.db
      .query("tasks")
      .withIndex("by_project_number", (q) => q.eq("projectId", project._id).eq("number", Number(m[2])))
      .unique();
    if (t) return t;
  }
  const byAlias = await ctx.db
    .query("tasks")
    .withIndex("by_project_alias", (q) => q.eq("projectId", project._id).eq("alias", r))
    .first();
  if (byAlias) return byAlias;
  return fail("not_found", `Task ${r} not found.`);
}

export async function taskDetail(ctx: QueryCtx, actor: Actor, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task) return fail("not_found", "Task not found.");
  const { project, perms } = await requireProject(ctx, actor, task!.projectId);
  const t = task!;
  const deps = await ctx.db.query("taskDeps").withIndex("by_task", (q) => q.eq("taskId", t._id)).collect();
  const dependents = await ctx.db.query("taskDeps").withIndex("by_depends_on", (q) => q.eq("dependsOnId", t._id)).collect();
  const load = async (ids: Id<"tasks">[]) =>
    (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter(Boolean).map((x) => presentTask(project, x!));
  const links = await ctx.db.query("ticketLinks").withIndex("by_task", (q) => q.eq("taskId", t._id)).collect();
  const tickets = (
    await Promise.all(
      links.map(async (l) => {
        const tk = await ctx.db.get(l.ticketId);
        return tk ? { id: tk._id, key: `T-${tk.number}`, title: tk.title, status: tk.status, relation: l.relation } : null;
      }),
    )
  ).filter(Boolean);
  const subtasks = (await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", t._id)).collect()).sort((a, b) => a.rank - b.rank);
  const parent = t.parentTaskId ? await ctx.db.get(t.parentTaskId) : null;
  // A feature's evidence is every commit that names it or one of its tasks.
  const commits = (
    await Promise.all([t, ...subtasks].map((x) => ctx.db.query("commits").withIndex("by_task", (q) => q.eq("taskId", x._id)).collect()))
  )
    .flat()
    .sort((a, b) => b.at - a.at);
  const milestones = project.contract
    ? (await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect()).filter((m) => !m.closedAt || m._id === t.milestoneId)
    : [];
  const section = t.sectionId ? await ctx.db.get(t.sectionId) : null;
  const milestone = t.milestoneId ? await ctx.db.get(t.milestoneId) : null;
  const activity = await ctx.db
    .query("activity")
    .withIndex("by_target", (q) => q.eq("targetKey", targetKey("task", t._id)))
    .order("desc")
    .take(100);
  return {
    ...presentTask(project, t),
    description: t.description,
    acceptance: t.acceptance,
    evidence: t.evidence,
    commitSha: t.commitSha,
    context: t.context ?? null,
    instructions: t.instructions ?? null,
    origin: t.origin ?? null,
    summary: t.summary ?? null,
    blocked: t.blocked ?? null,
    sentBackReason: t.sentBack?.reason ?? null,
    sendBacks: t.sendBacks ?? 0,
    version: t.version,
    project: { id: project._id, key: project.key, name: project.name, statuses: project.statuses, contract: !!project.contract },
    /** In a contract project: why this row cannot leave the backlog yet, if it cannot. */
    notReady: project.contract && isFeature(t) ? notReady(t) : null,
    parent: parent ? { id: parent._id, key: taskKey(project, parent), title: parent.title } : null,
    milestones: milestones.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map((m) => ({ id: m._id, key: m.key, name: m.name })),
    commits: commits.slice(0, 50).map((c) => ({ sha: c.sha, subject: c.subject, onMain: c.onMain, model: c.model ?? null, at: c.at })),
    perms: { ...perms, edit: perms.write && (!t.managedBy || (actor.kind === "agent" && actor.source === t.managedBy)) },
    section: section ? { id: section._id, name: section.name } : null,
    milestone: milestone ? { id: milestone._id, key: milestone.key, name: milestone.name } : null,
    dependsOn: await load(deps.map((d) => d.dependsOnId)),
    blocks: await load(dependents.map((d) => d.taskId)),
    subtasks: subtasks.map((s) => presentTask(project, s)),
    tickets,
    activity: activity.map((a) => ({
      id: a._id,
      actor: a.actor,
      origin: a.origin,
      action: a.action,
      from: a.from ?? null,
      to: a.to ?? null,
      note: a.note ?? null,
      at: a.at,
    })),
  };
}

// ---------- writes ----------

const fmtStatus = (project: Doc<"projects">, key: string) => project.statuses.find((s) => s.key === key)?.name ?? key;

/**
 * Changes a row's status on behalf of a flow (a commit, a finish, a review),
 * with the same history entry and notices as an edit by hand.
 */
export async function moveStatus(
  ctx: MutationCtx,
  actor: Actor,
  project: Doc<"projects">,
  t: Doc<"tasks">,
  status: string,
  opts: { note?: string; action?: string; extra?: Partial<Doc<"tasks">> } = {},
) {
  if (status === t.status && !opts.extra) return;
  const cat = categories(project);
  const extra: Partial<Doc<"tasks">> = { ...opts.extra };
  // Leaving "blocked" drops what it was waiting on.
  if (cat.get(t.status) === "blocked" && cat.get(status) !== "blocked") extra.blocked = undefined;
  // A suggested answer is about the row as it was.
  if (status !== t.status) extra.advice = undefined;
  await ctx.db.patch(t._id, { ...extra, status, updatedAt: Date.now(), version: t.version + 1 });
  if (status === t.status) return;
  await logActivity(ctx, {
    workspaceId: project.workspaceId,
    projectId: project._id,
    targetKey: targetKey("task", t._id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: opts.action ?? "status",
    from: t.status,
    to: status,
    note: opts.note,
  });
  const watchers = t.assignees.filter((a) => a.kind === "user").map((a) => a.id);
  if (t.createdBy.kind === "user") watchers.push(t.createdBy.id);
  await notify(ctx, {
    userIds: watchers,
    workspaceId: project.workspaceId,
    kind: "status",
    targetKey: targetKey("task", t._id),
    title: `${taskKey(project, t)} → ${fmtStatus(project, status)}`,
    actor: principalOf(actor),
  });
}

/** Work on a task means its feature is being built. */
export async function startParent(ctx: MutationCtx, actor: Actor, project: Doc<"projects">, child: Pick<Doc<"tasks">, "parentTaskId">) {
  if (!child.parentTaskId) return;
  const parent = await ctx.db.get(child.parentTaskId);
  const started = statusIn(project, "started");
  if (parent && started && categories(project).get(parent.status) === "unstarted") await moveStatus(ctx, actor, project, parent, started);
}

async function openUrgent(ctx: QueryCtx, project: Doc<"projects">, except?: Id<"tasks">) {
  const cat = categories(project);
  const rows = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  return rows.filter((r) => r.priority === "urgent" && r._id !== except && isFeature(r) && !isSettled(cat.get(r.status))).length;
}

export async function createTask(ctx: MutationCtx, actor: Actor, projectId: Id<"projects">, input: TaskInput) {
  const { project } = await requireProject(ctx, actor, projectId, "write");
  const rules = !!project.contract;
  const cat = categories(project);
  await checkRefs(ctx, project, input);
  const parent = input.parentTaskId ? await ctx.db.get(input.parentTaskId) : null;
  const type = input.type ?? (rules && !parent ? "feature" : "task");
  const priority = input.priority ?? "none";
  const acceptance = cleanText(input.acceptance, 5_000, "Acceptance");
  const origin = cleanText(input.origin, 200, "Origin") || undefined;
  let milestoneId = input.milestoneId;
  let sectionId = input.sectionId;
  let status = input.status;

  if (rules) {
    checkType(type);
    checkTitle(actor, type, input.title);
    checkPriority(actor, type, priority);
    const backlog = statusIn(project, "backlog") ?? project.statuses[0].key;
    const todo = statusIn(project, "unstarted") ?? backlog;
    if (parent) {
      if (parent.parentTaskId) fail("invalid", "Two levels only: a task cannot hold tasks. Put this under the feature.");
      if (isNote(parent)) fail("invalid", "A note cannot hold tasks. Promote it to a bug or a task first.");
      if (!isNote({ type })) {
        const siblings = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", parent._id)).collect();
        if (siblings.filter((s) => !isNote(s) && cat.get(s.status) !== "canceled").length >= LIMITS.tasksPerFeature) {
          fail("invalid", `A feature holds at most ${LIMITS.tasksPerFeature} tasks. Split the feature in two.`);
        }
      }
      // A task lives where its feature lives.
      milestoneId = parent.milestoneId;
      sectionId = sectionId ?? parent.sectionId;
    }
    if (isNote({ type })) status = backlog;
    else if (parent) status = status ?? todo;
    else {
      const seriousBug = type === "bug" && priority === "urgent";
      const why =
        notReady({ type, milestoneId, acceptance }) ??
        (actor.kind === "agent" && !origin && !seriousBug
          ? "An agent's own proposal waits in the backlog until a person approves it. If someone asked for this, pass `origin` to say who and when."
          : null);
      if (status === undefined) status = why ? backlog : todo;
      else if (why && !["backlog", "canceled"].includes(cat.get(status) ?? "")) fail("invalid", why);
    }
    if (priority === "urgent" && !parent && (await openUrgent(ctx, project)) >= LIMITS.urgentOpen) {
      fail("invalid", `${LIMITS.urgentOpen} urgent rows are already open. Re-rank instead of adding another.`);
    }
  }
  status = status ?? project.statuses.find((s) => s.category === "unstarted")?.key ?? project.statuses[0].key;
  requireStatus(project, status);
  const assignees = await resolveAssignees(ctx, project, input.assigneeIds ?? []);
  const number = project.taskSeq + 1;
  await ctx.db.patch(project._id, { taskSeq: number });
  const now = Date.now();
  const title = cleanTitle(input.title);
  const id = await ctx.db.insert("tasks", {
    workspaceId: project.workspaceId,
    projectId: project._id,
    number,
    title,
    description: cleanText(input.description, 50_000, "Description"),
    status,
    type,
    priority,
    assignees,
    sectionId,
    milestoneId,
    parentTaskId: input.parentTaskId,
    rank: now,
    estimateDays: input.estimateDays,
    dueAt: input.dueAt,
    labels: cleanLabels(input.labels?.length || !rules || !parent ? input.labels : parent.labels),
    acceptance,
    evidence: "",
    commitSha: "",
    tier: input.tier,
    origin,
    ingest: ingestFor(actor),
    createdBy: principalOf(actor),
    updatedAt: now,
    version: 1,
  });
  const key = `${project.key}-${number}`;
  await logActivity(ctx, {
    workspaceId: project.workspaceId,
    projectId: project._id,
    targetKey: targetKey("task", id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "created",
    to: status,
    note: title,
  });
  await notify(ctx, {
    userIds: assignees.filter((a) => a.kind === "user").map((a) => a.id),
    workspaceId: project.workspaceId,
    kind: "assigned",
    targetKey: targetKey("task", id),
    title: `${key} ${title}`,
    actor: principalOf(actor),
  });
  return { id, key, status };
}

export async function updateTask(
  ctx: MutationCtx,
  actor: Actor,
  taskId: Id<"tasks">,
  patch: TaskPatch,
  opts: { note?: string; ifVersion?: number; forOwner?: boolean } = {},
) {
  const task = await ctx.db.get(taskId);
  if (!task) return fail("not_found", "Task not found.");
  const t = task!;
  const { project } = await requireProject(ctx, actor, t.projectId, "write");
  assertEditable(actor, t);
  if (opts.ifVersion !== undefined && opts.ifVersion !== t.version) {
    fail("conflict", "This task changed since you loaded it. Reload and try again.");
  }
  const rules = !!project.contract;
  const cat = categories(project);
  const next: Partial<Doc<"tasks">> = {};
  const changes: { action: string; from?: string; to?: string }[] = [];
  const type = patch.type ?? t.type;
  if (patch.title !== undefined && patch.title.trim() !== t.title) {
    if (rules) checkTitle(actor, type, patch.title);
    next.title = cleanTitle(patch.title);
    changes.push({ action: "renamed", from: t.title, to: next.title });
  }
  if (patch.description !== undefined && patch.description !== t.description) {
    next.description = cleanText(patch.description, 50_000, "Description");
    changes.push({ action: "edited description" });
  }
  if (patch.type !== undefined && patch.type !== t.type) {
    if (rules) checkType(patch.type);
    next.type = patch.type;
    changes.push({ action: "type", from: t.type, to: patch.type });
  }
  if (patch.priority !== undefined && patch.priority !== t.priority) {
    if (rules) {
      checkPriority(actor, type, patch.priority);
      if (patch.priority === "urgent" && !t.parentTaskId && (await openUrgent(ctx, project, t._id)) >= LIMITS.urgentOpen) {
        fail("invalid", `${LIMITS.urgentOpen} urgent rows are already open. Re-rank instead of adding another.`);
      }
    }
    next.priority = patch.priority;
    changes.push({ action: "priority", from: t.priority, to: patch.priority });
  }
  let newlyAssigned: string[] = [];
  if (patch.assigneeIds !== undefined) {
    const assignees = await resolveAssignees(ctx, project, patch.assigneeIds);
    const before = new Set(t.assignees.map((a) => a.id));
    newlyAssigned = assignees.filter((a) => a.kind === "user" && !before.has(a.id)).map((a) => a.id);
    next.assignees = assignees;
    changes.push({ action: "assigned", to: assignees.map((a) => a.name).join(", ") || "nobody" });
  }
  await checkRefs(ctx, project, { sectionId: patch.sectionId, milestoneId: patch.milestoneId, parentTaskId: patch.parentTaskId });
  if (patch.sectionId !== undefined) next.sectionId = patch.sectionId ?? undefined;

  // Moving under a feature, or out from under one.
  let parentId = t.parentTaskId;
  if (patch.parentTaskId !== undefined && (patch.parentTaskId ?? undefined) !== t.parentTaskId) {
    parentId = patch.parentTaskId ?? undefined;
    if (parentId === t._id) fail("invalid", "A row cannot be its own parent.");
    const parent = parentId ? await ctx.db.get(parentId) : null;
    if (rules && parent) {
      if (parent.parentTaskId) fail("invalid", "Two levels only: a task cannot hold tasks. Put this under the feature.");
      if (isNote(parent)) fail("invalid", "A note cannot hold tasks. Promote it to a bug or a task first.");
      const own = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", t._id)).first();
      if (own) fail("invalid", "This row holds tasks of its own. Move them first.");
      next.milestoneId = parent.milestoneId;
    }
    next.parentTaskId = parentId;
    changes.push({ action: "moved", to: parent ? taskKey(project, parent) : "top level" });
  }
  if (patch.milestoneId !== undefined && (patch.milestoneId ?? undefined) !== t.milestoneId) {
    if (rules && parentId) fail("invalid", "A task takes its feature's milestone. Change it on the feature.");
    next.milestoneId = patch.milestoneId ?? undefined;
    changes.push({ action: "milestone" });
  }
  if (patch.estimateDays !== undefined) next.estimateDays = patch.estimateDays ?? undefined;
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt ?? undefined;
  if (patch.labels !== undefined) next.labels = cleanLabels(patch.labels);
  if (patch.acceptance !== undefined) next.acceptance = cleanText(patch.acceptance, 5_000, "Acceptance");
  if (patch.evidence !== undefined) next.evidence = cleanText(patch.evidence, 5_000, "Evidence");
  if (patch.commitSha !== undefined) next.commitSha = cleanText(patch.commitSha, 64, "Commit");
  if (patch.rank !== undefined) next.rank = patch.rank;
  if (patch.tier !== undefined) next.tier = patch.tier ?? undefined;
  if (patch.origin !== undefined) next.origin = cleanText(patch.origin, 200, "Origin") || undefined;

  if (patch.status !== undefined && patch.status !== t.status) {
    requireStatus(project, patch.status);
    const from = cat.get(t.status);
    const to = cat.get(patch.status);
    if (rules) {
      const after = { type, parentTaskId: parentId, milestoneId: "milestoneId" in next ? next.milestoneId : t.milestoneId, acceptance: next.acceptance ?? t.acceptance };
      if (isFeature(after)) {
        if (actor.kind === "agent" && to === "completed") fail("forbidden", "A person accepts a feature. Call finish to send it to review.");
        if (actor.kind === "agent" && to === "review") fail("invalid", "Use finish: it checks the feature's tasks and takes the summary.");
        if (from === "backlog" && !["backlog", "canceled"].includes(to ?? "")) {
          const why = notReady(after);
          if (why) fail("invalid", why);
          const seriousBug = type === "bug" && (next.priority ?? t.priority) === "urgent";
          // `forOwner`: an agent with the decide scope, answering the Needs you page for the owner (flow.ts, decide).
          if (actor.kind === "agent" && !(next.origin ?? t.origin) && !seriousBug && !opts.forOwner) {
            fail("forbidden", "Only a person moves a proposal out of the backlog. If someone asked for it, set `origin` to say who and when.");
          }
        }
      }
      if (actor.kind === "agent" && to === "canceled" && !opts.note) fail("invalid", "Say why it is dropped, and which row replaces it if one does.");
    }
    next.status = patch.status;
    if (from === "blocked" && to !== "blocked") next.blocked = undefined;
    next.advice = undefined;
    changes.push({ action: "status", from: t.status, to: patch.status });
  }
  if (!Object.keys(next).length) return { id: t._id, key: taskKey(project, t), status: t.status, changed: false };

  // Clearing an optional field needs an explicit `undefined` in the patch.
  await ctx.db.patch(t._id, { ...next, updatedAt: Date.now(), version: t.version + 1 });
  for (const c of changes) {
    await logActivity(ctx, {
      workspaceId: project.workspaceId,
      projectId: project._id,
      targetKey: targetKey("task", t._id),
      actor: principalOf(actor),
      origin: originOf(actor),
      ...c,
      note: c.action === "status" ? opts.note : undefined,
    });
  }
  if (rules) {
    // A feature's tasks follow it to another milestone.
    if ("milestoneId" in next && !parentId) {
      for (const c of await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", t._id)).collect()) {
        await ctx.db.patch(c._id, { milestoneId: next.milestoneId });
      }
    }
    if (next.status && cat.get(next.status) === "started") await startParent(ctx, actor, project, { parentTaskId: parentId });
  }
  const key = taskKey(project, t);
  await notify(ctx, {
    userIds: newlyAssigned,
    workspaceId: project.workspaceId,
    kind: "assigned",
    targetKey: targetKey("task", t._id),
    title: `${key} ${next.title ?? t.title}`,
    actor: principalOf(actor),
  });
  if (next.status) {
    const watchers = [...t.assignees.filter((a) => a.kind === "user").map((a) => a.id)];
    if (t.createdBy.kind === "user") watchers.push(t.createdBy.id);
    await notify(ctx, {
      userIds: watchers,
      workspaceId: project.workspaceId,
      kind: "status",
      targetKey: targetKey("task", t._id),
      title: `${key} → ${fmtStatus(project, next.status)}`,
      actor: principalOf(actor),
    });
  }
  return { id: t._id, key, status: next.status ?? t.status, changed: true };
}

/** Replaces a task's dependencies, refusing any change that would make a cycle. */
export async function setDependencies(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, dependsOn: Id<"tasks">[]) {
  const task = await ctx.db.get(taskId);
  if (!task) return fail("not_found", "Task not found.");
  await requireProject(ctx, actor, task!.projectId, "write");
  assertEditable(actor, task!);
  await replaceDeps(ctx, task!, dependsOn);
}

export async function replaceDeps(ctx: MutationCtx, task: Doc<"tasks">, dependsOn: Id<"tasks">[]) {
  const wanted = [...new Set(dependsOn)].filter((d) => d !== task._id);
  for (const d of wanted) {
    const dep = await ctx.db.get(d);
    if (!dep || dep.projectId !== task.projectId) fail("invalid", "A dependency is not in this project.");
    if (await reaches(ctx, d, task._id)) fail("cycle", `That dependency would create a cycle.`);
  }
  const existing = await ctx.db.query("taskDeps").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect();
  const keep = new Set(wanted);
  for (const e of existing) if (!keep.has(e.dependsOnId)) await ctx.db.delete(e._id);
  const have = new Set(existing.map((e) => e.dependsOnId));
  for (const d of wanted) if (!have.has(d)) await ctx.db.insert("taskDeps", { projectId: task.projectId, taskId: task._id, dependsOnId: d });
}

/** Whether `from` depends, directly or not, on `to`. */
async function reaches(ctx: QueryCtx, from: Id<"tasks">, to: Id<"tasks">) {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur) || seen.size > 5000) continue;
    seen.add(cur);
    const next = await ctx.db.query("taskDeps").withIndex("by_task", (q) => q.eq("taskId", cur)).collect();
    stack.push(...next.map((n) => n.dependsOnId));
  }
  return false;
}

export async function deleteTask(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task) return fail("not_found", "Task not found.");
  const t = task!;
  const { project, perms } = await requireProject(ctx, actor, t.projectId, "write");
  assertEditable(actor, t);
  const isAuthor = t.createdBy.id === actor.id;
  if (!perms.manage && !isAuthor) fail("forbidden", "Only the author or a project lead can delete a task.");
  if (await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", t._id)).first()) {
    fail("invalid", "This row holds tasks. Move or delete them first.");
  }
  for (const c of await ctx.db.query("commits").withIndex("by_task", (q) => q.eq("taskId", t._id)).collect()) await ctx.db.delete(c._id);
  for (const d of await ctx.db.query("taskDeps").withIndex("by_task", (q) => q.eq("taskId", t._id)).collect()) await ctx.db.delete(d._id);
  for (const d of await ctx.db.query("taskDeps").withIndex("by_depends_on", (q) => q.eq("dependsOnId", t._id)).collect()) await ctx.db.delete(d._id);
  for (const l of await ctx.db.query("ticketLinks").withIndex("by_task", (q) => q.eq("taskId", t._id)).collect()) await ctx.db.delete(l._id);
  for (const c of await ctx.db.query("comments").withIndex("by_target", (q) => q.eq("targetKey", targetKey("task", t._id))).collect()) await ctx.db.delete(c._id);
  await ctx.db.delete(t._id);
  await logActivity(ctx, {
    workspaceId: project.workspaceId,
    projectId: project._id,
    targetKey: targetKey("task", t._id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "deleted",
    note: `${taskKey(project, t)} ${t.title}`,
  });
}
