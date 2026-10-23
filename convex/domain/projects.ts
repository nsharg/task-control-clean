import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  type Actor,
  fail,
  originOf,
  principalOf,
  projectPerms,
  readableProjects,
  requireProject,
  requireWorkspace,
  targetKey,
} from "../lib/access";
import { logActivity } from "../lib/activity";
import { categories, isFeature, isNote, isSettled, KNOWN_LIMIT, LIMITS } from "./contract";
import { cleanText, DEFAULT_STATUSES, presentTask } from "./tasks";

/** Generic roadmap defaults; each project can configure its own capacity and working days. */
export const DEFAULT_ROADMAP = { hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] };
/** Sizing a milestone without an estimate: agent-hours per human-estimated day, and per task with no estimate. */
export const HOURS_PER_ESTIMATE_DAY = 0.5;
export const HOURS_PER_UNESTIMATED_TASK = 1;
/**
 * How much of a task's size counts as spent when working out hours left. A task
 * in progress is part-built, so remaining hours shrink before it is done. Progress
 * % still counts only finished tasks, as the hub does.
 */
export const WORK_CREDIT: Record<string, number> = { completed: 1, review: 0.8, started: 0.5, blocked: 0.5 };

const COLORS = ["#10a37f", "#0a84ff", "#bf5af2", "#ff9f0a", "#ff375f", "#64d2ff", "#30d158", "#8e8e93"];

/**
 * Share of work done, as the hub counts it: canceled tasks are left out, and a
 * group is weighted by estimate when every task in it has one. A source can
 * mark tasks that are not planned work. In a mirrored project, tasks people
 * add here are input for the source, not planned work, until it takes them in.
 * A contract project counts features: the tasks under them and the notes are
 * not units of progress.
 */
export function progress(project: Doc<"projects">, tasks: Doc<"tasks">[], mirrored = false) {
  const cat = new Map(project.statuses.map((s) => [s.key, s.category]));
  const counted = tasks.filter((t) => isCounted(t, cat, mirrored, !!project.contract));
  const counts: Record<string, number> = {};
  for (const t of project.contract ? counted : tasks) counts[cat.get(t.status) ?? "backlog"] = (counts[cat.get(t.status) ?? "backlog"] ?? 0) + 1;
  const done = counted.filter((t) => cat.get(t.status) === "completed");
  const weighted = counted.length > 0 && counted.every((t) => t.estimateDays && t.estimateDays > 0);
  const sum = (xs: Doc<"tasks">[]) => xs.reduce((a, t) => a + (t.estimateDays ?? 0), 0);
  const percent = !counted.length
    ? 0
    : Math.round((weighted ? sum(done) / sum(counted) : done.length / counted.length) * 100);
  return { percent, done: done.length, counted: counted.length, total: tasks.length, weighted, counts };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Share of a group's work spent, with partial credit for work under way; weighted like `progress`. */
function workSpent(tasks: Doc<"tasks">[], cat: Map<string, string>) {
  if (!tasks.length) return 0;
  const credit = (t: Doc<"tasks">) => WORK_CREDIT[cat.get(t.status) ?? ""] ?? 0;
  const weighted = tasks.every((t) => t.estimateDays && t.estimateDays > 0);
  const size = (t: Doc<"tasks">) => (weighted ? t.estimateDays! : 1);
  return tasks.reduce((a, t) => a + size(t) * credit(t), 0) / tasks.reduce((a, t) => a + size(t), 0);
}

export function isCounted(t: Doc<"tasks">, cat: Map<string, string>, mirrored: boolean, contract = false) {
  // A proposal still in the backlog is not committed work, so it is not a unit of progress yet.
  if (contract) return isFeature(t) && !["canceled", "backlog"].includes(cat.get(t.status) ?? "");
  return cat.get(t.status) !== "canceled" && !t.excludeFromProgress && !(mirrored && !t.managedBy);
}

/**
 * Sizing in a contract project. A feature is estimated in agent-days and is one
 * day when it has no estimate. Credit comes from its own status, or from the
 * share of its tasks that are done while it is still being built.
 */
function featureSizing(project: Doc<"projects">, tasks: Doc<"tasks">[], cat: Map<string, string>) {
  const hoursPerDay = (project.roadmap ?? DEFAULT_ROADMAP).hoursPerDay;
  const kids = new Map<string, Doc<"tasks">[]>();
  for (const t of tasks) {
    if (t.parentTaskId && !isNote(t) && cat.get(t.status) !== "canceled") kids.set(t.parentTaskId, [...(kids.get(t.parentTaskId) ?? []), t]);
  }
  const hours = (t: Doc<"tasks">) => (t.estimateDays && t.estimateDays > 0 ? t.estimateDays : 1) * hoursPerDay;
  const credit = (t: Doc<"tasks">) => {
    const c = cat.get(t.status) ?? "";
    if (c === "completed" || c === "review") return WORK_CREDIT[c];
    const own = kids.get(t._id) ?? [];
    if (own.length) return (WORK_CREDIT.review * own.filter((k) => cat.get(k.status) === "completed").length) / own.length;
    return WORK_CREDIT[c] ?? 0;
  };
  return { hours, credit };
}

/**
 * The order to build a milestone's tasks in, as the hub plans it: a dependency
 * always comes first (Kahn's algorithm over edges inside the group, settled
 * dependencies ignored), ties broken by rank, then number. Tasks caught in a
 * cycle are appended in rank order rather than dropped.
 */
export function buildOrder(
  tasks: Doc<"tasks">[],
  edges: { taskId: Id<"tasks">; dependsOnId: Id<"tasks"> }[],
  settled: (t: Doc<"tasks">) => boolean,
) {
  const byId = new Map(tasks.map((t) => [t._id as string, t]));
  const cmp = (a: Doc<"tasks">, b: Doc<"tasks">) => a.rank - b.rank || a.number - b.number;
  const indeg = new Map(tasks.map((t) => [t._id as string, 0]));
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const dep = byId.get(e.dependsOnId);
    if (!byId.has(e.taskId) || !dep || settled(dep)) continue;
    indeg.set(e.taskId, indeg.get(e.taskId)! + 1);
    next.set(e.dependsOnId, [...(next.get(e.dependsOnId) ?? []), e.taskId]);
  }
  const ready = tasks.filter((t) => indeg.get(t._id) === 0).sort(cmp);
  const out: Doc<"tasks">[] = [];
  while (ready.length) {
    const t = ready.shift()!;
    out.push(t);
    for (const k of next.get(t._id) ?? []) {
      indeg.set(k, indeg.get(k)! - 1);
      if (indeg.get(k) === 0) {
        ready.push(byId.get(k)!);
        ready.sort(cmp);
      }
    }
  }
  if (out.length < tasks.length) out.push(...tasks.filter((t) => !out.includes(t)).sort(cmp));
  return out.map((t) => t._id);
}

export function presentProject(p: Doc<"projects">) {
  return {
    id: p._id,
    key: p.key,
    name: p.name,
    description: p.description,
    color: p.color,
    visibility: p.visibility,
    statuses: p.statuses,
    archived: !!p.archivedAt,
    contract: !!p.contract,
    roadmap: p.roadmap ?? DEFAULT_ROADMAP,
  };
}

async function projectTasks(ctx: QueryCtx, projectId: Id<"projects">) {
  return ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
}

export async function listProjects(ctx: QueryCtx, actor: Actor, workspaceId: Id<"workspaces">) {
  await requireWorkspace(ctx, actor, workspaceId);
  const projects = await readableProjects(ctx, actor, workspaceId);
  const out = [];
  for (const p of projects) {
    const tasks = await projectTasks(ctx, p._id);
    const source = await ctx.db.query("syncSources").withIndex("by_project_name", (q) => q.eq("projectId", p._id)).first();
    out.push({
      ...presentProject(p),
      progress: progress(p, tasks, !!source),
      source: source ? { name: source.name, label: source.label, lastPushAt: source.lastPushAt ?? null } : null,
    });
  }
  return out.sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
}

/** Everything the project pages need in one read: tree, milestones, tasks, roll-ups. */
export async function projectBoard(ctx: QueryCtx, actor: Actor, projectId: Id<"projects">) {
  const { project, perms } = await requireProject(ctx, actor, projectId);
  const tasks = await projectTasks(ctx, project._id);
  const source = await ctx.db.query("syncSources").withIndex("by_project_name", (q) => q.eq("projectId", project._id)).first();
  const mirrored = !!source;
  const sections = await ctx.db.query("sections").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  const milestones = await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  const cat = new Map(project.statuses.map((s) => [s.key, s.category]));
  const byId = new Map(tasks.map((t) => [t._id as string, t]));
  const deps = new Map<string, number>();
  const openDeps = new Map<string, number>();
  const edges = await ctx.db.query("taskDeps").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  for (const d of edges) {
    deps.set(d.taskId, (deps.get(d.taskId) ?? 0) + 1);
    const c = cat.get(byId.get(d.dependsOnId)?.status ?? "");
    if (c !== "completed" && c !== "canceled") openDeps.set(d.taskId, (openDeps.get(d.taskId) ?? 0) + 1);
  }
  // Section roll-ups include the tasks of child sections.
  const childrenOf = new Map<string, string[]>();
  for (const s of sections) if (s.parentId) childrenOf.set(s.parentId, [...(childrenOf.get(s.parentId) ?? []), s._id]);
  const inSection = (sid: string): Doc<"tasks">[] => [
    ...tasks.filter((t) => t.sectionId === sid),
    ...(childrenOf.get(sid) ?? []).flatMap(inSection),
  ];
  const members = await ctx.db.query("projectMembers").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  // Milestones in the hub's order (ord, then key), each with its tasks in build
  // order and any later milestone its open work waits on, which means the
  // order is wrong.
  milestones.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const settled = (t: Doc<"tasks">) => ["completed", "canceled"].includes(cat.get(t.status) ?? "");
  const contract = !!project.contract;
  const sizing = featureSizing(project, tasks, cat);
  const position = new Map(milestones.map((m, i) => [m._id as string, i]));
  const waitsOn = new Map<string, Set<string>>();
  for (const e of edges) {
    const t = byId.get(e.taskId);
    const dep = byId.get(e.dependsOnId);
    if (!t?.milestoneId || !dep?.milestoneId || settled(t) || settled(dep)) continue;
    if (position.get(dep.milestoneId)! > position.get(t.milestoneId)!) {
      waitsOn.set(t.milestoneId, (waitsOn.get(t.milestoneId) ?? new Set()).add(milestones[position.get(dep.milestoneId)!].key));
    }
  }
  return {
    project: presentProject(project),
    perms,
    source: source ? { name: source.name, label: source.label, lastPushAt: source.lastPushAt ?? null } : null,
    progress: progress(project, tasks, mirrored),
    sections: sections.map((s) => ({
      id: s._id,
      parentId: s.parentId ?? null,
      key: s.key,
      name: s.name,
      description: s.description,
      order: s.order,
      managedBy: s.managedBy ?? null,
      progress: progress(project, inSection(s._id), mirrored),
    })),
    milestones: milestones.map((m) => {
      const inM = tasks.filter((t) => t.milestoneId === m._id);
      const order = buildOrder(inM, edges, settled);
      const countedTasks = inM.filter((t) => isCounted(t, cat, mirrored, contract));
      const counted = new Set(countedTasks.map((t) => t._id as string));
      const p = progress(project, inM, mirrored);
      const done = countedTasks.filter((t) => cat.get(t.status) === "completed");
      const begun = countedTasks.filter((t) => ["completed", "started", "review", "blocked"].includes(cat.get(t.status) ?? ""));
      const derivedHours = round1(
        countedTasks.reduce(
          (a, t) =>
            a +
            (contract
              ? sizing.hours(t) * (1 - sizing.credit(t))
              : (t.estimateDays ? t.estimateDays * HOURS_PER_ESTIMATE_DAY : HOURS_PER_UNESTIMATED_TASK) * (1 - (WORK_CREDIT[cat.get(t.status) ?? ""] ?? 0))),
          0,
        ),
      );
      const total = countedTasks.reduce((a, t) => a + sizing.hours(t), 0);
      const spent = contract ? (total ? countedTasks.reduce((a, t) => a + sizing.hours(t) * sizing.credit(t), 0) / total : 0) : workSpent(countedTasks, cat);
      return {
        id: m._id,
        key: m.key,
        name: m.name,
        goal: m.goal,
        exitCriteria: m.exitCriteria,
        order: m.order,
        managedBy: m.managedBy ?? null,
        progress: p,
        agentHours: m.agentHours ?? null,
        estimateNote: m.estimateNote ?? null,
        track: m.track ?? null,
        unplanned: !!m.unplanned,
        closedAt: m.closedAt ?? null,
        derivedHours,
        // A parking-lot milestone is not scheduled, and a closed one is finished: neither has hours left to build.
        remainingHours: m.unplanned || m.closedAt
          ? 0
          : m.agentHours !== undefined
            ? round1(m.agentHours * (1 - spent))
            : derivedHours,
        startedAt: begun.length ? Math.min(...begun.map((t) => t.updatedAt)) : null,
        lastDoneAt: done.length ? Math.max(...done.map((t) => t.updatedAt)) : null,
        tasks: order.filter((id) => counted.has(id)),
        other: order.filter((id) => !counted.has(id)),
        waitsOn: [...(waitsOn.get(m._id) ?? [])],
      };
    }),
    tasks: tasks.map((t) => ({ ...presentTask(project, t), deps: deps.get(t._id) ?? 0, openDeps: openDeps.get(t._id) ?? 0 })),
    health: contract ? health(project, tasks) : null,
    members: members.map((m) => ({ id: m._id, principalId: m.principalId, kind: m.principalKind, role: m.role })),
  };
}

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

export async function createProject(
  ctx: MutationCtx,
  actor: Actor,
  input: { workspaceId: Id<"workspaces">; key: string; name: string; description?: string; visibility?: "workspace" | "members"; color?: string; contract?: boolean },
) {
  await requireWorkspace(ctx, actor, input.workspaceId, "member");
  const key = input.key.trim().toUpperCase();
  if (!KEY_RE.test(key)) fail("invalid", "Key must be 2–10 letters or digits, starting with a letter (e.g. DEMO).");
  if (key === "T") fail("invalid", "That key is reserved for tickets.");
  const clash = await ctx.db
    .query("projects")
    .withIndex("by_workspace_key", (q) => q.eq("workspaceId", input.workspaceId).eq("key", key))
    .unique();
  if (clash) fail("invalid", `A project with key ${key} already exists.`);
  const name = cleanText(input.name, 80, "Name");
  if (!name) fail("invalid", "Name is required.");
  const existing = await ctx.db.query("projects").withIndex("by_workspace", (q) => q.eq("workspaceId", input.workspaceId)).collect();
  const id = await ctx.db.insert("projects", {
    workspaceId: input.workspaceId,
    key,
    name,
    description: cleanText(input.description, 2_000, "Description"),
    color: input.color && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : COLORS[existing.length % COLORS.length],
    visibility: input.visibility ?? "workspace",
    statuses: DEFAULT_STATUSES,
    taskSeq: 0,
    createdBy: actor.id,
    contract: input.contract || undefined,
  });
  if (actor.kind === "user") {
    await ctx.db.insert("projectMembers", {
      workspaceId: input.workspaceId,
      projectId: id,
      principalKind: "user",
      principalId: actor.id,
      role: "lead",
    });
  }
  await logActivity(ctx, {
    workspaceId: input.workspaceId,
    projectId: id,
    targetKey: targetKey("project", id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "created project",
    note: name,
  });
  return { id, key };
}

export async function updateProject(
  ctx: MutationCtx,
  actor: Actor,
  projectId: Id<"projects">,
  patch: {
    name?: string;
    description?: string;
    color?: string;
    visibility?: "workspace" | "members";
    archived?: boolean;
    contract?: boolean;
    roadmap?: { hoursPerDay: number; workDays: number[] };
  },
) {
  const { project } = await requireProject(ctx, actor, projectId, "manage");
  const next: Partial<Doc<"projects">> = {};
  if (patch.name !== undefined) {
    next.name = cleanText(patch.name, 80, "Name");
    if (!next.name) fail("invalid", "Name is required.");
  }
  if (patch.description !== undefined) next.description = cleanText(patch.description, 2_000, "Description");
  if (patch.color !== undefined && /^#[0-9a-f]{6}$/i.test(patch.color)) next.color = patch.color;
  if (patch.visibility !== undefined) next.visibility = patch.visibility;
  if (patch.archived !== undefined) next.archivedAt = patch.archived ? Date.now() : undefined;
  if (patch.contract !== undefined) {
    if (patch.contract && (await ctx.db.query("syncSources").withIndex("by_project_name", (q) => q.eq("projectId", project._id)).first())) {
      fail("invalid", "This project mirrors another tracker, so its rows are not edited here. The work contract is for projects worked in directly.");
    }
    next.contract = patch.contract || undefined;
  }
  if (patch.roadmap !== undefined) {
    const { hoursPerDay, workDays } = patch.roadmap;
    if (!(hoursPerDay >= 0.5 && hoursPerDay <= 24)) fail("invalid", "Hours per day must be between 0.5 and 24.");
    const days = [...new Set(workDays)].sort((a, b) => a - b);
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail("invalid", "Pick at least one working day.");
    next.roadmap = { hoursPerDay, workDays: days };
  }
  await ctx.db.patch(project._id, next);
}

export async function setProjectMember(
  ctx: MutationCtx,
  actor: Actor,
  projectId: Id<"projects">,
  principal: { kind: "user" | "agent"; id: string },
  role: "lead" | "member" | "viewer" | null,
) {
  const { project } = await requireProject(ctx, actor, projectId, "manage");
  if (principal.kind === "user") {
    const m = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", project.workspaceId).eq("userId", principal.id))
      .unique();
    if (!m) fail("invalid", "That person is not in this workspace.");
  } else {
    const agentId = ctx.db.normalizeId("agents", principal.id);
    const agent = agentId ? await ctx.db.get(agentId) : null;
    if (!agent || agent.workspaceId !== project.workspaceId) fail("invalid", "Unknown agent.");
  }
  const existing = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_principal", (q) => q.eq("projectId", projectId).eq("principalId", principal.id))
    .unique();
  if (role === null) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  if (existing) await ctx.db.patch(existing._id, { role });
  else {
    await ctx.db.insert("projectMembers", {
      workspaceId: project.workspaceId,
      projectId,
      principalKind: principal.kind,
      principalId: principal.id,
      role,
    });
  }
}

export async function upsertSection(
  ctx: MutationCtx,
  actor: Actor,
  projectId: Id<"projects">,
  input: { id?: Id<"sections">; parentId?: Id<"sections">; name: string; description?: string },
) {
  const { project } = await requireProject(ctx, actor, projectId, "manage");
  const name = cleanText(input.name, 80, "Name");
  if (!name) fail("invalid", "Name is required.");
  if (input.id) {
    const s = await ctx.db.get(input.id);
    if (!s || s.projectId !== project._id) return fail("not_found", "Section not found.");
    if (s!.managedBy) fail("managed", `This section is synced from ${s!.managedBy}.`);
    await ctx.db.patch(s!._id, { name, description: cleanText(input.description, 2_000, "Description") });
    return s!._id;
  }
  if (input.parentId && (await ctx.db.get(input.parentId))?.projectId !== project._id) fail("invalid", "Unknown parent section.");
  return ctx.db.insert("sections", {
    projectId: project._id,
    parentId: input.parentId,
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
    name,
    description: cleanText(input.description, 2_000, "Description"),
    order: Date.now(),
  });
}

/** What a contract project should keep near zero, for the line on its overview. */
function health(project: Doc<"projects">, tasks: Doc<"tasks">[]) {
  const cat = categories(project);
  const c = (t: Doc<"tasks">) => cat.get(t.status) ?? "backlog";
  const open = tasks.filter((t) => !isSettled(c(t)));
  const features = open.filter(isFeature);
  const ids = new Set(tasks.map((t) => t._id as string));
  const inReview = features.filter((t) => c(t) === "review");
  const staleBefore = Date.now() - LIMITS.staleDays * 86_400_000;
  return {
    // Work that is under way with no milestone, or a task whose feature is gone.
    orphans:
      features.filter((t) => c(t) !== "backlog" && !t.milestoneId && t.type !== "bug").length +
      open.filter((t) => t.parentTaskId && !ids.has(t.parentTaskId)).length,
    proposals: features.filter((t) => c(t) === "backlog").length,
    notes: open.filter((t) => isNote(t) && !t.labels.includes(KNOWN_LIMIT)).length,
    inReview: inReview.length,
    oldestReviewAt: inReview.length ? Math.min(...inReview.map((t) => t.updatedAt)) : null,
    stale: open.filter((t) => c(t) === "backlog" && !t.parentTaskId && t.updatedAt < staleBefore && !t.labels.includes(KNOWN_LIMIT)).length,
  };
}

const MILESTONE_KEY_RE = /^[A-Z][A-Z0-9]{0,7}$/;

export async function upsertMilestone(
  ctx: MutationCtx,
  actor: Actor,
  projectId: Id<"projects">,
  input: {
    id?: Id<"milestones">;
    key?: string;
    name: string;
    goal?: string;
    exitCriteria?: string;
    track?: string;
    agentHours?: number | null;
    estimateNote?: string;
    order?: number;
    unplanned?: boolean;
    closed?: boolean;
  },
) {
  const { project } = await requireProject(ctx, actor, projectId, "manage");
  if (project.archivedAt) fail("archived", "This project is archived and read-only.");
  const all = await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  const existing = input.id ? all.find((m) => m._id === input.id) : undefined;
  if (input.id && !existing) return fail("not_found", "Milestone not found.");
  if (existing?.managedBy) fail("managed", `This milestone is synced from ${existing.managedBy}.`);
  const name = cleanText(input.name, 80, "Name");
  if (!name) fail("invalid", "Name is required.");
  const key = (input.key ?? existing?.key ?? "").trim().toUpperCase();
  if (!MILESTONE_KEY_RE.test(key)) fail("invalid", "Key must be 1–8 letters or digits, starting with a letter (e.g. M1).");
  if (all.some((m) => m.key === key && m._id !== existing?._id)) fail("invalid", `Milestone ${key} already exists.`);
  if (input.agentHours != null && !(input.agentHours >= 0 && input.agentHours <= 100_000)) fail("invalid", "Agent-hours must be zero or more.");
  const doc = {
    key,
    name,
    goal: cleanText(input.goal ?? existing?.goal, 2_000, "Goal"),
    exitCriteria: cleanText(input.exitCriteria ?? existing?.exitCriteria, 2_000, "Exit criteria"),
    order: input.order ?? existing?.order ?? Math.max(-1, ...all.map((m) => m.order)) + 1,
    track: input.track !== undefined ? cleanText(input.track, 40, "Track") || undefined : existing?.track,
    agentHours: input.agentHours !== undefined ? (input.agentHours ?? undefined) : existing?.agentHours,
    estimateNote: input.estimateNote !== undefined ? cleanText(input.estimateNote, 1_000, "Estimate note") || undefined : existing?.estimateNote,
    unplanned: input.unplanned !== undefined ? input.unplanned || undefined : existing?.unplanned,
    closedAt: existing?.closedAt,
  };
  if (input.closed !== undefined && input.closed !== !!existing?.closedAt) {
    if (input.closed && existing) {
      const cat = categories(project);
      const rows = (await projectTasks(ctx, project._id)).filter((t) => t.milestoneId === existing._id);
      const open = rows.filter((t) => isFeature(t) && !isSettled(cat.get(t.status)));
      if (open.length) fail("invalid", `${open.length} feature${open.length === 1 ? " is" : "s are"} still open in ${key}. Finish or move them first.`);
      const notes = rows.filter((t) => isNote(t) && !isSettled(cat.get(t.status)) && !t.labels.includes(KNOWN_LIMIT));
      if (notes.length) fail("invalid", `${notes.length} note${notes.length === 1 ? "" : "s"} under ${key} still need${notes.length === 1 ? "s" : ""} a decision: promote, accept as a known limit, or drop.`);
    }
    doc.closedAt = input.closed ? Date.now() : undefined;
  }
  if (existing) {
    await ctx.db.patch(existing._id, doc);
    return { id: existing._id, key };
  }
  const id = await ctx.db.insert("milestones", { projectId: project._id, ...doc });
  await logActivity(ctx, {
    workspaceId: project.workspaceId,
    projectId: project._id,
    targetKey: targetKey("project", project._id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "created milestone",
    note: `${key} ${name}`,
  });
  return { id, key };
}

/** Only an empty milestone can be removed; one with rows in it is part of the record. */
export async function removeMilestone(ctx: MutationCtx, actor: Actor, milestoneId: Id<"milestones">) {
  const m = await ctx.db.get(milestoneId);
  if (!m) return fail("not_found", "Milestone not found.");
  const { project } = await requireProject(ctx, actor, m!.projectId, "manage");
  if (project.archivedAt) fail("archived", "This project is archived and read-only.");
  if (m!.managedBy) fail("managed", `This milestone is synced from ${m!.managedBy}.`);
  if ((await projectTasks(ctx, project._id)).some((t) => t.milestoneId === m!._id)) fail("invalid", "This milestone has rows in it. Move them first.");
  await ctx.db.delete(m!._id);
}

export { projectPerms };
