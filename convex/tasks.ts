import { v } from "convex/values";
import * as F from "./domain/flow";
import * as T from "./domain/tasks";
import { fail, projectPerms, readableProjects, requireWorkspace } from "./lib/access";
import { userMutation, userQuery } from "./lib/functions";
import { vVerdict } from "./schema";

export const get = userQuery({
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }) => T.taskDetail(ctx, ctx.actor, taskId),
});

/** Tasks assigned to me across every project I can read. */
export const mine = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspace(ctx, ctx.actor, workspaceId);
    const out = [];
    for (const p of await readableProjects(ctx, ctx.actor, workspaceId)) {
      if (p.archivedAt) continue;
      const cat = new Map(p.statuses.map((s) => [s.key, s.category]));
      const tasks = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect();
      for (const t of tasks) {
        if (!t.assignees.some((a) => a.id === ctx.actor.id)) continue;
        const c = cat.get(t.status);
        if (c === "completed" || c === "canceled") continue;
        out.push({ ...T.presentTask(p, t), project: { key: p.key, name: p.name, color: p.color }, category: c ?? "backlog" });
      }
    }
    return out.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.updatedAt - a.updatedAt);
  },
});

export const create = userMutation({
  args: { projectId: v.id("projects"), ...T.vTaskInput },
  handler: (ctx, { projectId, ...input }) => T.createTask(ctx, ctx.actor, projectId, input),
});

export const update = userMutation({
  args: { taskId: v.id("tasks"), patch: T.vTaskPatch, note: v.optional(v.string()), ifVersion: v.optional(v.number()) },
  handler: (ctx, { taskId, patch, note, ifVersion }) => T.updateTask(ctx, ctx.actor, taskId, patch, { note, ifVersion }),
});

export const setDependencies = userMutation({
  args: { taskId: v.id("tasks"), dependsOn: v.array(v.id("tasks")) },
  handler: (ctx, { taskId, dependsOn }) => T.setDependencies(ctx, ctx.actor, taskId, dependsOn),
});

/** A feature is ready for a person to try. Agents use the same step through the API. */
export const finish = userMutation({
  args: { taskId: v.id("tasks"), summary: v.string() },
  handler: (ctx, { taskId, summary }) => F.finishTask(ctx, ctx.actor, taskId, summary),
});

/** Accept a feature in review, or send it back with the reason. */
export const review = userMutation({
  args: { taskId: v.id("tasks"), accept: v.boolean(), reason: v.optional(v.string()) },
  handler: (ctx, { taskId, accept, reason }) => F.reviewTask(ctx, ctx.actor, taskId, { accept, reason }),
});

export const block = userMutation({
  args: { taskId: v.id("tasks"), on: v.string(), what: v.string() },
  handler: (ctx, { taskId, on, what }) => F.blockTask(ctx, ctx.actor, taskId, { on, what }),
});

/** Keep a stale backlog row: it leaves the stale list for another month. */
export const keep = userMutation({
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }) => F.keepTask(ctx, ctx.actor, taskId),
});

/** "Do this next": move a row to the top of its milestone's queue. */
export const rankFirst = userMutation({
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }) => F.rankFirst(ctx, ctx.actor, taskId),
});

/** Answer a Needs you item, e.g. confirming an agent's suggestion. */
export const decide = userMutation({
  args: { taskId: v.id("tasks"), verdict: vVerdict, reason: v.optional(v.string()) },
  handler: (ctx, { taskId, verdict, reason }) => F.decide(ctx, ctx.actor, taskId, verdict, reason),
});

/** Everything waiting on a person's decision, across the workspace's contract projects. */
export const needsYou = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: (ctx, { workspaceId }) => F.needsYou(ctx, ctx.actor, workspaceId),
});

export const remove = userMutation({
  args: { taskId: v.id("tasks") },
  handler: (ctx, { taskId }) => T.deleteTask(ctx, ctx.actor, taskId),
});

/** Where a partner-written task went, when it was ingested upstream. */
export const ingestedAs = userQuery({
  args: { projectId: v.id("projects"), ref: v.string() },
  handler: async (ctx, { projectId, ref }) => {
    const p = await ctx.db.get(projectId);
    if (!p || !(await projectPerms(ctx, ctx.actor, p)).read) return fail("not_found", "Project not found.");
    const t = await ctx.db.query("tasks").withIndex("by_project_alias", (q) => q.eq("projectId", projectId).eq("alias", ref)).first();
    return t ? { id: t._id, key: `${p!.key}-${t.number}` } : null;
  },
});
