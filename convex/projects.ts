import { v } from "convex/values";
import * as P from "./domain/projects";
import { projectByKey } from "./lib/access";
import { userMutation, userQuery } from "./lib/functions";
import { vProjectRole } from "./schema";

export const list = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: (ctx, { workspaceId }) => P.listProjects(ctx, ctx.actor, workspaceId),
});

export const board = userQuery({
  args: { workspaceId: v.id("workspaces"), key: v.string() },
  handler: async (ctx, { workspaceId, key }) => {
    const { project } = await projectByKey(ctx, ctx.actor, workspaceId, key);
    return P.projectBoard(ctx, ctx.actor, project._id);
  },
});

export const create = userMutation({
  args: {
    workspaceId: v.id("workspaces"),
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("workspace"), v.literal("members"))),
    color: v.optional(v.string()),
    contract: v.optional(v.boolean()),
  },
  handler: (ctx, args) => P.createProject(ctx, ctx.actor, args),
});

export const update = userMutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("workspace"), v.literal("members"))),
    archived: v.optional(v.boolean()),
    contract: v.optional(v.boolean()),
    roadmap: v.optional(v.object({ hoursPerDay: v.number(), workDays: v.array(v.number()) })),
  },
  handler: (ctx, { projectId, ...patch }) => P.updateProject(ctx, ctx.actor, projectId, patch),
});

export const setMember = userMutation({
  args: {
    projectId: v.id("projects"),
    kind: v.union(v.literal("user"), v.literal("agent")),
    principalId: v.string(),
    role: v.union(vProjectRole, v.null()),
  },
  handler: (ctx, { projectId, kind, principalId, role }) =>
    P.setProjectMember(ctx, ctx.actor, projectId, { kind, id: principalId }, role),
});

export const upsertSection = userMutation({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("sections")),
    parentId: v.optional(v.id("sections")),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: (ctx, { projectId, ...input }) => P.upsertSection(ctx, ctx.actor, projectId, input),
});

export const upsertMilestone = userMutation({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("milestones")),
    key: v.optional(v.string()),
    name: v.string(),
    goal: v.optional(v.string()),
    exitCriteria: v.optional(v.string()),
    track: v.optional(v.string()),
    agentHours: v.optional(v.union(v.number(), v.null())),
    estimateNote: v.optional(v.string()),
    order: v.optional(v.number()),
    unplanned: v.optional(v.boolean()),
    closed: v.optional(v.boolean()),
  },
  handler: (ctx, { projectId, ...input }) => P.upsertMilestone(ctx, ctx.actor, projectId, input),
});

export const removeMilestone = userMutation({
  args: { milestoneId: v.id("milestones") },
  handler: (ctx, { milestoneId }) => P.removeMilestone(ctx, ctx.actor, milestoneId),
});
