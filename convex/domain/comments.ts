import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  type Actor,
  fail,
  originOf,
  principalOf,
  type ProjectPerms,
  requireProject,
  targetKey,
} from "../lib/access";
import { logActivity, notify } from "../lib/activity";
import type { vTarget } from "../schema";
import { cleanText, ingestFor } from "./tasks";
import { requireTicket } from "./tickets";

export type Target = Infer<typeof vTarget>;

/** Access to whatever a comment hangs off, plus the facts needed to notify people. */
export async function resolveTarget(ctx: QueryCtx, actor: Actor, target: Target, need: keyof ProjectPerms) {
  if (target.type === "task") {
    const task = await ctx.db.get(target.id);
    if (!task) return fail("not_found", "Task not found.");
    const { project } = await requireProject(ctx, actor, task!.projectId, need);
    const watchers = task!.assignees.filter((a) => a.kind === "user").map((a) => a.id);
    if (task!.createdBy.kind === "user") watchers.push(task!.createdBy.id);
    return {
      workspaceId: project.workspaceId,
      projectId: project._id as Id<"projects"> | undefined,
      label: `${project.key}-${task!.number} ${task!.title}`,
      watchers,
      locked: false,
    };
  }
  if (target.type === "ticket") {
    const { ticket } = await requireTicket(ctx, actor, target.id, need);
    const watchers = [ticket.reporter, ticket.assignee].filter((p) => p?.kind === "user").map((p) => p!.id);
    // A closed ticket's thread is closed too, until the ticket is reopened.
    const locked = ticket.status === "closed";
    return { workspaceId: ticket.workspaceId, projectId: ticket.projectId, label: `T-${ticket.number} ${ticket.title}`, watchers, locked };
  }
  const { project } = await requireProject(ctx, actor, target.id, need);
  return { workspaceId: project.workspaceId, projectId: project._id as Id<"projects"> | undefined, label: project.name, watchers: [] as string[], locked: false };
}

export function presentComment(c: Doc<"comments">) {
  return {
    id: c._id,
    author: c.author,
    body: c.deletedAt ? "" : c.body,
    deleted: !!c.deletedAt,
    editedAt: c.editedAt ?? null,
    createdAt: c._creationTime,
    ingest: c.ingest,
    externalOrigin: c.externalOrigin ?? null,
  };
}

export async function listComments(ctx: QueryCtx, actor: Actor, target: Target) {
  await resolveTarget(ctx, actor, target, "read");
  const rows = await ctx.db.query("comments").withIndex("by_target", (q) => q.eq("targetKey", targetKey(target.type, target.id))).collect();
  return rows.map(presentComment);
}

export async function addComment(
  ctx: MutationCtx,
  actor: Actor,
  target: Target,
  body: string,
  mentionIds: string[] = [],
  extra: { externalOrigin?: string } = {},
) {
  const t = await resolveTarget(ctx, actor, target, "comment");
  if (t.locked) fail("forbidden", "Comments are closed on this ticket.");
  const text = cleanText(body, 20_000, "Comment");
  if (!text) fail("invalid", "Comment is empty.");
  // Only people in the workspace can be mentioned.
  const mentions: string[] = [];
  for (const id of [...new Set(mentionIds)].slice(0, 20)) {
    const m = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", t.workspaceId).eq("userId", id))
      .unique();
    if (m) mentions.push(id);
  }
  const key = targetKey(target.type, target.id);
  const id = await ctx.db.insert("comments", {
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    target,
    targetKey: key,
    author: principalOf(actor),
    body: text,
    mentions,
    externalOrigin: extra.externalOrigin,
    ingest: ingestFor(actor),
  });
  await logActivity(ctx, {
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    targetKey: key,
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "commented",
    note: text.slice(0, 280),
  });
  await notify(ctx, { userIds: mentions, workspaceId: t.workspaceId, kind: "mention", targetKey: key, title: t.label, actor: principalOf(actor) });
  await notify(ctx, {
    userIds: t.watchers.filter((w) => !mentions.includes(w)),
    workspaceId: t.workspaceId,
    kind: "comment",
    targetKey: key,
    title: t.label,
    actor: principalOf(actor),
  });
  return { id };
}

export async function editComment(ctx: MutationCtx, actor: Actor, commentId: Id<"comments">, body: string) {
  const c = await ctx.db.get(commentId);
  if (!c || c.deletedAt) return fail("not_found", "Comment not found.");
  if (c!.author.id !== actor.id) fail("forbidden", "You can only edit your own comments.");
  if ((await resolveTarget(ctx, actor, c!.target, "comment")).locked) fail("forbidden", "Comments are closed on this ticket.");
  const text = cleanText(body, 20_000, "Comment");
  if (!text) fail("invalid", "Comment is empty.");
  await ctx.db.patch(commentId, { body: text, editedAt: Date.now() });
}

export async function deleteComment(ctx: MutationCtx, actor: Actor, commentId: Id<"comments">) {
  const c = await ctx.db.get(commentId);
  if (!c || c.deletedAt) return;
  const t = await resolveTarget(ctx, actor, c.target, "read");
  let canModerate = false;
  if (t.projectId) {
    const project = await ctx.db.get(t.projectId);
    canModerate = !!project && (await requireProject(ctx, actor, project._id, "read")).perms.manage;
  }
  if (c.author.id !== actor.id && !canModerate) fail("forbidden", "You can only delete your own comments.");
  // Soft delete keeps the thread shape and the audit trail.
  await ctx.db.patch(commentId, { deletedAt: Date.now(), body: "" });
}
