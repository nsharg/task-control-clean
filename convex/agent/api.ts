/**
 * The agent API: what REST (`/api/v1`) and MCP (`/api/mcp`) call. Every
 * function takes the caller's bearer token as `token`; `agentQuery` and
 * `agentMutation` resolve it, and the domain functions check scopes and
 * project access exactly as they do for people.
 */
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import * as C from "../domain/comments";
import { categories, isNote, isSettled, tierRank, type Tier } from "../domain/contract";
import * as F from "../domain/flow";
import * as I from "../domain/ingest";
import * as P from "../domain/projects";
import * as S from "../domain/sync";
import * as K from "../domain/tickets";
import * as T from "../domain/tasks";
import { type AgentActor, fail, projectByKey, requireScope, taskKey } from "../lib/access";
import { agentMutation, agentQuery } from "../lib/functions";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { vProjectRole, vSeverity, vTicketKind, vTicketStatus, vTier, vVerdict } from "../schema";

async function project(ctx: QueryCtx, actor: AgentActor, key: string, need: "read" | "comment" | "write" = "read") {
  return (await projectByKey(ctx, actor, actor.workspaceId, key, need)).project;
}

async function task(ctx: QueryCtx, actor: AgentActor, projectKey: string, ref: string) {
  return T.taskByRef(ctx, await project(ctx, actor, projectKey), ref);
}

/** Agents name a milestone and a section by key and a parent by its ref; the domain layer wants ids. */
async function refs(ctx: QueryCtx, p: Doc<"projects">, r: { milestone?: string | null; parent?: string | null; section?: string | null }) {
  const out: { milestoneId?: Id<"milestones"> | null; parentTaskId?: Id<"tasks"> | null; sectionId?: Id<"sections"> | null } = {};
  if (r.milestone !== undefined) {
    const key = r.milestone?.trim().toUpperCase();
    const m = key ? (await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).find((x) => x.key.toUpperCase() === key) : null;
    if (key && !m) fail("not_found", `Milestone ${key} not found. get_project_status lists the milestones.`);
    out.milestoneId = m?._id ?? null;
  }
  if (r.parent !== undefined) out.parentTaskId = r.parent ? (await T.taskByRef(ctx, p, r.parent))._id : null;
  if (r.section !== undefined) {
    const key = r.section?.trim().toLowerCase();
    const sec = key ? (await ctx.db.query("sections").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).find((x) => x.key.toLowerCase() === key) : null;
    if (key && !sec) fail("not_found", `Section ${key} not found.`);
    out.sectionId = sec?._id ?? null;
  }
  return out;
}

/** A row as an agent needs it in a list: a dozen short fields, the title as data. */
function lean(p: Doc<"projects">, t: Doc<"tasks">, keyOf: (id: string | undefined) => string | null, milestoneOf: (id: string | undefined) => string | null) {
  return {
    key: taskKey(p, t),
    ...(t.alias ? { alias: t.alias } : {}),
    type: t.type,
    status: t.status,
    parent: keyOf(t.parentTaskId),
    milestone: milestoneOf(t.milestoneId),
    tier: t.tier ?? null,
    urgent: t.priority === "urgent",
    assignees: t.assignees.map((a) => a.name),
    untrusted_content: { title: t.title },
  };
}

export const whoami = agentQuery({
  args: {},
  handler: async (ctx) => {
    const ws = await ctx.db.get(ctx.actor.workspaceId);
    return {
      agent: ctx.actor.name,
      workspace: ws ? { name: ws.name, slug: ws.slug } : null,
      scopes: ctx.actor.scopes,
      source: ctx.actor.source ?? null,
      projectRestricted: ctx.actor.projectIds.length > 0,
    };
  },
});

export const listProjects = agentQuery({
  args: {},
  handler: async (ctx) => {
    requireScope(ctx.actor, "read");
    return P.listProjects(ctx, ctx.actor, ctx.actor.workspaceId);
  },
});

/** A roll-up like `hub status`, plus blocked work and what can start next. */
export const projectStatus = agentQuery({
  args: { projectKey: v.string() },
  handler: async (ctx, { projectKey }) => {
    requireScope(ctx.actor, "read");
    const p = await project(ctx, ctx.actor, projectKey);
    const b = await P.projectBoard(ctx, ctx.actor, p._id);
    const cat = new Map(p.statuses.map((s) => [s.key, s.category]));
    const brief = (t: (typeof b.tasks)[number]) => ({ key: t.key, alias: t.alias, title: t.title, status: t.status });
    return {
      project: b.project,
      source: b.source,
      health: b.health,
      progress: b.progress,
      sections: b.sections.filter((s) => !s.parentId).map((s) => ({ key: s.key, name: s.name, progress: s.progress })),
      roadmap: b.project.roadmap,
      milestones: b.milestones.map((m) => ({
        key: m.key,
        name: m.name,
        order: m.order,
        track: m.track,
        progress: m.progress,
        agentHours: m.agentHours,
        remainingHours: m.remainingHours,
        estimated: m.agentHours !== null,
        unplanned: m.unplanned,
        closed: m.closedAt !== null,
        waitsOn: m.waitsOn,
        untrusted_content: { estimateNote: m.estimateNote },
      })),
      blocked: b.tasks.filter((t) => cat.get(t.status) === "blocked").map(brief),
      inProgress: b.tasks.filter((t) => cat.get(t.status) === "started").map(brief),
      next: b.tasks
        .filter((t) => (cat.get(t.status) === "unstarted" || cat.get(t.status) === "backlog") && t.openDeps === 0)
        .sort((a, c) => a.rank - c.rank)
        .slice(0, 15)
        .map(brief),
    };
  },
});

export const listTasks = agentQuery({
  args: {
    projectKey: v.string(),
    status: v.optional(v.array(v.string())),
    type: v.optional(v.string()),
    assignee: v.optional(v.string()),
    parent: v.optional(v.string()),
    managed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireScope(ctx.actor, "read");
    const p = await project(ctx, ctx.actor, args.projectKey);
    const all = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect();
    let rows = all;
    if (args.status?.length) rows = rows.filter((t) => args.status!.includes(t.status));
    if (args.type) rows = rows.filter((t) => t.type === args.type);
    if (args.assignee) rows = rows.filter((t) => t.assignees.some((a) => a.id === args.assignee || a.name === args.assignee));
    if (args.parent) {
      const parent = await T.taskByRef(ctx, p, args.parent);
      rows = rows.filter((t) => t.parentTaskId === parent._id);
    }
    if (args.managed !== undefined) rows = rows.filter((t) => !!t.managedBy === args.managed);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1000);
    const byId = new Map(all.map((t) => [t._id as string, t]));
    const milestones = new Map((await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).map((m) => [m._id as string, m.key]));
    const keyOf = (id: string | undefined) => (id && byId.has(id) ? taskKey(p, byId.get(id)!) : null);
    return { total: rows.length, tasks: rows.slice(0, limit).map((t) => lean(p, t, keyOf, (id) => milestones.get(id ?? "") ?? null)) };
  },
});

export const getTask = agentQuery({
  args: { projectKey: v.string(), ref: v.string() },
  handler: async (ctx, { projectKey, ref }) => {
    requireScope(ctx.actor, "read");
    const t = await task(ctx, ctx.actor, projectKey, ref);
    const d = await T.taskDetail(ctx, ctx.actor, t._id);
    const comments = await C.listComments(ctx, ctx.actor, { type: "task", id: t._id });
    const row = (s: (typeof d.subtasks)[number]) => ({ key: s.key, type: s.type, status: s.status, tier: s.tier, ...(s.blockedOn ? { waitsOn: s.blockedOn } : {}), untrusted_content: { title: s.title } });
    // A feature needs the highest tier among its open tasks, as `next` reports it.
    const cat = new Map(d.project.statuses.map((s) => [s.key, s.category]));
    const open = d.subtasks.filter((s) => !isNote(s) && !isSettled(cat.get(s.status)));
    const tier = open.length ? open.map((s) => (s.tier ?? "standard") as Tier).reduce((a, b) => (tierRank(b) > tierRank(a) ? b : a)) : d.tier;
    return {
      key: d.key,
      alias: d.alias,
      type: d.type,
      status: d.status,
      tier,
      urgent: d.priority === "urgent",
      milestone: d.milestone?.key ?? null,
      parent: d.parent?.key ?? null,
      assignees: d.assignees.map((a) => a.name),
      labels: d.labels,
      estimateDays: d.estimateDays,
      managedBy: d.managedBy,
      version: d.version,
      notReady: d.notReady,
      sendBacks: d.sendBacks,
      tasks: d.subtasks.filter((s) => !isNote(s)).map(row),
      notes: d.subtasks.filter((s) => isNote(s)).map(row),
      dependsOn: d.dependsOn.map((x) => ({ key: x.key, status: x.status })),
      blocks: d.blocks.map((x) => ({ key: x.key, status: x.status })),
      tickets: d.tickets.map((x) => ({ key: x!.key, status: x!.status, relation: x!.relation })),
      commits: d.commits.slice(0, 20).map((c) => ({ sha: c.sha.slice(0, 8), onMain: c.onMain })),
      untrusted_content: {
        title: d.title,
        description: d.description,
        acceptance: d.acceptance,
        summary: d.summary,
        evidence: d.evidence || null,
        origin: d.origin,
        blocked: d.blocked,
        sentBack: d.sentBackReason,
        comments: comments.filter((c) => !c.deleted).slice(-20).map((c) => ({ author: c.author.name, body: c.body, at: c.createdAt })),
      },
    };
  },
});

const vNewTask = v.object({ title: v.string(), description: v.optional(v.string()), tier: v.optional(vTier) });

/** What an agent sends to create one row: a feature with its tasks, a task under a feature, or a note. */
const vNewRow = {
  ...T.vTaskInput,
  milestone: v.optional(v.string()),
  parent: v.optional(v.string()),
  section: v.optional(v.string()),
  /** The feature's tasks, in build order, created under it in the same call. */
  tasks: v.optional(v.array(vNewTask)),
};
const vNewRowObject = v.object(vNewRow);

async function createRow(ctx: MutationCtx, actor: AgentActor, p: Doc<"projects">, { milestone, parent, section, tasks, ...input }: Infer<typeof vNewRowObject>) {
  const r = await refs(ctx, p, { milestone, parent, section });
  const made = await T.createTask(ctx, actor, p._id, {
    ...input,
    milestoneId: r.milestoneId ?? input.milestoneId,
    parentTaskId: r.parentTaskId ?? input.parentTaskId,
    sectionId: r.sectionId ?? input.sectionId,
  });
  const under = [];
  for (const k of tasks ?? []) {
    const c = await T.createTask(ctx, actor, p._id, { title: k.title, description: k.description, tier: k.tier, type: "task", parentTaskId: made.id });
    under.push({ key: c.key, status: c.status });
  }
  return { key: made.key, status: made.status, ...(under.length ? { tasks: under } : {}) };
}

export const createTask = agentMutation({
  args: { projectKey: v.string(), ...vNewRow },
  handler: async (ctx, { projectKey, ...row }) => {
    requireScope(ctx.actor, "write");
    return createRow(ctx, ctx.actor, await project(ctx, ctx.actor, projectKey, "write"), row);
  },
});

export const MAX_BATCH = 50;

/** Many rows in one call, in order, all or nothing: a refusal names the item and nothing is created. */
export const createTasks = agentMutation({
  args: { projectKey: v.string(), items: v.array(vNewRowObject) },
  handler: async (ctx, { projectKey, items }) => {
    requireScope(ctx.actor, "write");
    const p = await project(ctx, ctx.actor, projectKey, "write");
    if (!items.length || items.length > MAX_BATCH) fail("invalid", `Send 1 to ${MAX_BATCH} items per call.`);
    const created = [];
    for (const [i, row] of items.entries()) {
      try {
        created.push(await createRow(ctx, ctx.actor, p, row));
      } catch (e) {
        if (!(e instanceof ConvexError)) throw e;
        const d = e.data as { code?: string; message?: string };
        fail(d.code ?? "invalid", `Item ${i + 1} ("${row.title.slice(0, 60)}"): ${d.message ?? "refused."} Nothing was created.`);
      }
    }
    return { created };
  },
});

export const updateTask = agentMutation({
  args: {
    projectKey: v.string(),
    ref: v.string(),
    patch: v.object({
      ...T.vTaskPatch.fields,
      milestone: v.optional(v.union(v.string(), v.null())),
      parent: v.optional(v.union(v.string(), v.null())),
    }),
    note: v.optional(v.string()),
    ifVersion: v.optional(v.number()),
  },
  handler: async (ctx, { projectKey, ref, patch: { milestone, parent, ...patch }, note, ifVersion }) => {
    requireScope(ctx.actor, "write");
    const t = await task(ctx, ctx.actor, projectKey, ref);
    const p = (await ctx.db.get(t.projectId))!;
    const cat = categories(p).get(patch.status ?? "");
    if ((cat === "completed" || cat === "blocked") && !note && !patch.evidence) {
      fail("invalid", `Moving to ${patch.status} needs a note or evidence saying why.`);
    }
    const r = await refs(ctx, p, { milestone, parent });
    const res = await T.updateTask(
      ctx,
      ctx.actor,
      t._id,
      { ...patch, ...(r.milestoneId !== undefined ? { milestoneId: r.milestoneId } : {}), ...(r.parentTaskId !== undefined ? { parentTaskId: r.parentTaskId } : {}) },
      { note, ifVersion },
    );
    return { key: res.key, status: res.status, changed: res.changed };
  },
});

export const setDependencies = agentMutation({
  args: { projectKey: v.string(), ref: v.string(), dependsOn: v.array(v.string()) },
  handler: async (ctx, { projectKey, ref, dependsOn }) => {
    requireScope(ctx.actor, "write");
    const p = await project(ctx, ctx.actor, projectKey, "write");
    const t = await T.taskByRef(ctx, p, ref);
    const on = [];
    for (const d of dependsOn) on.push((await T.taskByRef(ctx, p, d))._id);
    await T.setDependencies(ctx, ctx.actor, t._id, on);
    return { key: taskKey(p, t), dependsOn: on.length };
  },
});

/** For a row made by mistake. Work with commits is part of the record: drop it with `superseded` instead. */
export const deleteTask = agentMutation({
  args: { projectKey: v.string(), ref: v.string() },
  handler: async (ctx, { projectKey, ref }) => {
    requireScope(ctx.actor, "write");
    const t = await task(ctx, ctx.actor, projectKey, ref);
    if (await ctx.db.query("commits").withIndex("by_task", (q) => q.eq("taskId", t._id)).first()) {
      fail("invalid", "This row has commits, so it is part of the record. Set it to superseded with a note instead.");
    }
    await T.deleteTask(ctx, ctx.actor, t._id);
    return { deleted: ref };
  },
});

// ---------- managing projects: the admin scope ----------

/** Setting up and changing projects is the owner's. A token does it only when a workspace admin gave it the admin scope. */
function requireAdmin(actor: AgentActor) {
  if (!actor.scopes.includes("admin")) {
    fail("forbidden", 'This needs a token with the "admin" scope. A workspace admin issues one under Agents & API tokens.');
  }
}

const vRoadmap = v.object({ hoursPerDay: v.number(), workDays: v.array(v.number()) });
const vVisibility = v.union(v.literal("workspace"), v.literal("members"));

export const createProject = agentMutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.optional(vVisibility),
    /** Milestones, features and tasks: on unless told otherwise. */
    contract: v.optional(v.boolean()),
    roadmap: v.optional(vRoadmap),
  },
  handler: async (ctx, { roadmap, contract, ...args }) => {
    requireAdmin(ctx.actor);
    if (ctx.actor.projectIds.length) fail("forbidden", "This token is limited to certain projects, so it cannot create one.");
    const made = await P.createProject(ctx, ctx.actor, { workspaceId: ctx.actor.workspaceId, ...args, contract: contract ?? true });
    if (roadmap) await P.updateProject(ctx, ctx.actor, made.id, { roadmap });
    return { key: made.key, contract: contract ?? true };
  },
});

export const updateProject = agentMutation({
  args: {
    projectKey: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    visibility: v.optional(vVisibility),
    archived: v.optional(v.boolean()),
    contract: v.optional(v.boolean()),
    roadmap: v.optional(vRoadmap),
  },
  handler: async (ctx, { projectKey, ...patch }) => {
    requireAdmin(ctx.actor);
    const p = await project(ctx, ctx.actor, projectKey);
    await P.updateProject(ctx, ctx.actor, p._id, patch);
    return P.presentProject((await ctx.db.get(p._id))!);
  },
});

/** Creates the milestone when the project has none with this key, and changes it otherwise. */
export const setMilestone = agentMutation({
  args: {
    projectKey: v.string(),
    key: v.string(),
    newKey: v.optional(v.string()),
    name: v.optional(v.string()),
    goal: v.optional(v.string()),
    exitCriteria: v.optional(v.string()),
    order: v.optional(v.number()),
    track: v.optional(v.string()),
    agentHours: v.optional(v.union(v.number(), v.null())),
    estimateNote: v.optional(v.string()),
    unplanned: v.optional(v.boolean()),
    closed: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectKey, key, newKey, name, ...fields }) => {
    requireAdmin(ctx.actor);
    const p = await project(ctx, ctx.actor, projectKey);
    const wanted = key.trim().toUpperCase();
    const existing = (await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).find((m) => m.key.toUpperCase() === wanted);
    if (!existing && !name) fail("invalid", `Milestone ${wanted} does not exist yet. Give it a name to create it.`);
    const res = await P.upsertMilestone(ctx, ctx.actor, p._id, { id: existing?._id, key: newKey ?? existing?.key ?? wanted, name: name ?? existing!.name, ...fields });
    return { key: res.key, created: !existing };
  },
});

export const deleteMilestone = agentMutation({
  args: { projectKey: v.string(), key: v.string() },
  handler: async (ctx, { projectKey, key }) => {
    requireAdmin(ctx.actor);
    const p = await project(ctx, ctx.actor, projectKey);
    const m = (await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).find((x) => x.key.toUpperCase() === key.trim().toUpperCase());
    if (!m) return fail("not_found", `Milestone ${key} not found.`);
    await P.removeMilestone(ctx, ctx.actor, m!._id);
    return { deleted: m!.key };
  },
});

/** People and agents of the workspace, by id, for assignees and project access. No email addresses. */
export const listMembers = agentQuery({
  args: { projectKey: v.optional(v.string()) },
  handler: async (ctx, { projectKey }) => {
    requireScope(ctx.actor, "read");
    const ws = ctx.actor.workspaceId;
    const people = await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect();
    const agents = await ctx.db.query("agents").withIndex("by_workspace", (q) => q.eq("workspaceId", ws)).collect();
    const p = projectKey ? await project(ctx, ctx.actor, projectKey) : null;
    const roles = new Map(p ? (await ctx.db.query("projectMembers").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).map((m) => [m.principalId, m.role]) : []);
    const inProject = (id: string) => (p ? { projectRole: roles.get(id) ?? null } : {});
    return {
      people: people.map((m) => ({ id: m.userId, name: m.name, role: m.role, ...inProject(m.userId) })),
      agents: agents.filter((a) => !a.disabledAt).map((a) => ({ id: a._id as string, name: a.name, ...inProject(a._id) })),
    };
  },
});

export const setProjectMember = agentMutation({
  args: { projectKey: v.string(), kind: v.union(v.literal("user"), v.literal("agent")), id: v.string(), role: v.union(vProjectRole, v.null()) },
  handler: async (ctx, { projectKey, kind, id, role }) => {
    requireAdmin(ctx.actor);
    const p = await project(ctx, ctx.actor, projectKey);
    await P.setProjectMember(ctx, ctx.actor, p._id, { kind, id }, role);
    return { ok: true };
  },
});

/** "Do this next", on the owner's instruction: the row goes to the top of its milestone's queue. */
export const rankFirst = agentMutation({
  args: { projectKey: v.string(), ref: v.string() },
  handler: async (ctx, { projectKey, ref }) => {
    requireAdmin(ctx.actor);
    const t = await task(ctx, ctx.actor, projectKey, ref);
    await F.rankFirst(ctx, ctx.actor, t._id);
    return { key: ref, first: true };
  },
});

// ---------- the work contract: next, finish, block, commits ----------

export const next = agentQuery({
  args: { projectKey: v.string(), label: v.optional(v.string()), maxTier: v.optional(vTier), limit: v.optional(v.number()) },
  handler: async (ctx, { projectKey, ...opts }) => F.nextWork(ctx, ctx.actor, (await project(ctx, ctx.actor, projectKey))._id, opts),
});

export const finish = agentMutation({
  args: { projectKey: v.string(), ref: v.string(), summary: v.string() },
  handler: async (ctx, { projectKey, ref, summary }) => {
    requireScope(ctx.actor, "write");
    return F.finishTask(ctx, ctx.actor, (await task(ctx, ctx.actor, projectKey, ref))._id, summary);
  },
});

export const block = agentMutation({
  args: { projectKey: v.string(), ref: v.string(), on: v.string(), what: v.string() },
  handler: async (ctx, { projectKey, ref, on, what }) => {
    requireScope(ctx.actor, "write");
    return F.blockTask(ctx, ctx.actor, (await task(ctx, ctx.actor, projectKey, ref))._id, { on, what });
  },
});

export const commits = agentMutation({
  args: { projectKey: v.string(), commits: v.array(F.vCommit) },
  handler: async (ctx, { projectKey, commits }) => F.recordCommits(ctx, ctx.actor, (await project(ctx, ctx.actor, projectKey, "write"))._id, commits),
});

// ---------- the owner's queue: needs you, recommend, decide ----------

/** The owner's Needs you page, as an agent reads it: people's text under untrusted_content. */
export const needsYou = agentQuery({
  args: { projectKey: v.optional(v.string()) },
  handler: async (ctx, { projectKey }) => {
    requireScope(ctx.actor, "read");
    const q = await F.needsYou(ctx, ctx.actor, ctx.actor.workspaceId);
    const want = projectKey?.trim().toUpperCase();
    const item = (x: F.Brief, untrusted: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      key: x.key,
      project: x.project.key,
      type: x.type,
      milestone: x.milestone,
      updatedAt: x.updatedAt,
      ...extra,
      advice: x.advice ? { verdict: x.advice.verdict, by: x.advice.by } : null,
      untrusted_content: { title: x.title, ...untrusted, ...(x.advice ? { adviceReason: x.advice.reason } : {}) },
    });
    const mine = <X extends { project: { key: string } }>(xs: X[]) => xs.filter((x) => !want || x.project.key === want);
    return {
      answers: F.VERDICTS,
      canDecide: F.canDecide(ctx.actor),
      toAccept: mine(q.toAccept).map((x) => item(x, { summary: x.summary, acceptance: x.acceptance }, { tasks: x.tasks, commits: x.commits, sendBacks: x.sendBacks })),
      blocked: mine(q.blocked).map((x) => item(x, { on: x.on, what: x.what })),
      proposals: mine(q.proposals).map((x) => item(x, { origin: x.origin }, { notReady: x.notReady })),
      stale: mine(q.stale).map((x) => item(x, {}, { note: x.note })),
    };
  },
});

/** Suggest an answer; the owner confirms it on the page. */
export const recommend = agentMutation({
  args: { projectKey: v.string(), ref: v.string(), verdict: vVerdict, reason: v.string() },
  handler: async (ctx, { projectKey, ref, verdict, reason }) =>
    F.recommend(ctx, ctx.actor, (await task(ctx, ctx.actor, projectKey, ref))._id, verdict, reason),
});

/** Answer for the owner. Needs the decide scope, and the owner's instruction in the session. */
export const decide = agentMutation({
  args: { projectKey: v.string(), ref: v.string(), verdict: vVerdict, reason: v.string() },
  handler: async (ctx, { projectKey, ref, verdict, reason }) =>
    F.decide(ctx, ctx.actor, (await task(ctx, ctx.actor, projectKey, ref))._id, verdict, reason),
});

export const addComment = agentMutation({
  args: {
    target: v.union(
      v.object({ type: v.literal("task"), projectKey: v.string(), ref: v.string() }),
      v.object({ type: v.literal("ticket"), ref: v.string() }),
    ),
    body: v.string(),
  },
  handler: async (ctx, { target, body }) => {
    requireScope(ctx.actor, "comment");
    if (target.type === "task") {
      const t = await task(ctx, ctx.actor, target.projectKey, target.ref);
      return C.addComment(ctx, ctx.actor, { type: "task", id: t._id }, body);
    }
    const tk = await K.ticketByRef(ctx, ctx.actor.workspaceId, target.ref);
    return C.addComment(ctx, ctx.actor, { type: "ticket", id: tk._id }, body);
  },
});

export const listTickets = agentQuery({
  args: { projectKey: v.optional(v.string()), status: v.optional(vTicketStatus), open: v.optional(v.boolean()) },
  handler: async (ctx, { projectKey, status, open }) => {
    requireScope(ctx.actor, "read");
    const projectId = projectKey ? (await project(ctx, ctx.actor, projectKey))._id : undefined;
    const rows = await K.listTickets(ctx, ctx.actor, ctx.actor.workspaceId, { projectId, status, open });
    return rows.map(({ title, ...t }) => ({ ...t, untrusted_content: { title } }));
  },
});

export const getTicket = agentQuery({
  args: { ref: v.string() },
  handler: async (ctx, { ref }) => {
    requireScope(ctx.actor, "read");
    const tk = await K.ticketByRef(ctx, ctx.actor.workspaceId, ref);
    const { title, body, ...rest } = await K.ticketDetail(ctx, ctx.actor, tk._id);
    const comments = await C.listComments(ctx, ctx.actor, { type: "ticket", id: tk._id });
    return { ...rest, untrusted_content: { title, body, comments: comments.map((c) => ({ author: c.author.name, body: c.body, at: c.createdAt })) } };
  },
});

export const createTicket = agentMutation({
  args: { projectKey: v.optional(v.string()), kind: vTicketKind, title: v.string(), body: v.optional(v.string()), severity: v.optional(vSeverity) },
  handler: async (ctx, { projectKey, ...input }) => {
    requireScope(ctx.actor, "write");
    const projectId = projectKey ? (await project(ctx, ctx.actor, projectKey, "comment"))._id : undefined;
    return K.createTicket(ctx, ctx.actor, { ...input, projectId, workspaceId: ctx.actor.workspaceId });
  },
});

export const updateTicket = agentMutation({
  args: { ref: v.string(), status: v.optional(vTicketStatus), severity: v.optional(vSeverity) },
  handler: async (ctx, { ref, ...patch }) => {
    requireScope(ctx.actor, "write");
    const tk = await K.ticketByRef(ctx, ctx.actor.workspaceId, ref);
    return K.updateTicket(ctx, ctx.actor, tk._id, patch);
  },
});

export const linkTicket = agentMutation({
  args: { ref: v.string(), projectKey: v.string(), taskRef: v.string(), relation: v.union(v.literal("implements"), v.literal("duplicates"), v.literal("relates")) },
  handler: async (ctx, { ref, projectKey, taskRef, relation }) => {
    requireScope(ctx.actor, "comment");
    const tk = await K.ticketByRef(ctx, ctx.actor.workspaceId, ref);
    const t = await task(ctx, ctx.actor, projectKey, taskRef);
    await K.linkTicket(ctx, ctx.actor, tk._id, t._id, relation);
    return { ok: true };
  },
});

// ---------- ingest ----------

export const ingestPending = agentQuery({
  args: { projectKey: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { projectKey, limit }) => {
    const projectId = projectKey ? (await project(ctx, ctx.actor, projectKey))._id : undefined;
    return I.pending(ctx, ctx.actor, { projectId, limit });
  },
});

export const ingestClaim = agentMutation({
  args: { refs: v.array(I.vIngestRef) },
  handler: (ctx, { refs }) => I.claim(ctx, ctx.actor, refs),
});

export const ingestDone = agentMutation({
  args: { ref: I.vIngestRef, upstreamRef: v.string(), note: v.optional(v.string()), reply: v.optional(v.string()) },
  handler: (ctx, args) => I.markDone(ctx, ctx.actor, args),
});

export const ingestSkip = agentMutation({
  args: { ref: I.vIngestRef, reason: v.string() },
  handler: (ctx, args) => I.skip(ctx, ctx.actor, args),
});

export const ingestRelease = agentMutation({
  args: { refs: v.array(I.vIngestRef) },
  handler: (ctx, { refs }) => I.release(ctx, ctx.actor, refs),
});

// ---------- sync ----------

export const syncPush = agentMutation({
  args: {
    projectKey: v.string(),
    items: v.array(S.vSyncItem),
    dryRun: v.optional(v.boolean()),
    logChanges: v.optional(v.boolean()),
    sourceLabel: v.optional(v.string()),
  },
  handler: async (ctx, { projectKey, ...input }) => {
    const p = await project(ctx, ctx.actor, projectKey);
    return S.push(ctx, ctx.actor, { projectId: p._id as Id<"projects">, ...input });
  },
});

export const syncChanges = agentQuery({
  args: { projectKey: v.optional(v.string()), cursor: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { projectKey, cursor, limit }) => {
    const projectId = projectKey ? (await project(ctx, ctx.actor, projectKey))._id : undefined;
    return S.changes(ctx, ctx.actor, { projectId, cursor, limit });
  },
});

export const syncStatus = agentQuery({
  args: { projectKey: v.string() },
  handler: async (ctx, { projectKey }) => {
    requireScope(ctx.actor, "read");
    const p = await project(ctx, ctx.actor, projectKey);
    const sources = await ctx.db.query("syncSources").withIndex("by_project_name", (q) => q.eq("projectId", p._id)).collect();
    const out = [];
    for (const s of sources) {
      const refs = await ctx.db
        .query("externalRefs")
        .withIndex("by_key", (q) => q.eq("projectId", p._id).eq("source", s.name))
        .collect();
      const counts: Record<string, number> = {};
      for (const r of refs) counts[r.entityType] = (counts[r.entityType] ?? 0) + 1;
      out.push({ name: s.name, label: s.label, lastPushAt: s.lastPushAt ?? null, counts });
    }
    return { project: p.key, sources: out };
  },
});
