import { v } from "convex/values";
import * as C from "./domain/comments";
import { userMutation, userQuery } from "./lib/functions";
import { vTarget } from "./schema";

export const list = userQuery({
  args: { target: vTarget },
  handler: (ctx, { target }) => C.listComments(ctx, ctx.actor, target),
});

export const add = userMutation({
  args: { target: vTarget, body: v.string(), mentions: v.optional(v.array(v.string())) },
  handler: (ctx, { target, body, mentions }) => C.addComment(ctx, ctx.actor, target, body, mentions),
});

export const edit = userMutation({
  args: { commentId: v.id("comments"), body: v.string() },
  handler: (ctx, { commentId, body }) => C.editComment(ctx, ctx.actor, commentId, body),
});

export const remove = userMutation({
  args: { commentId: v.id("comments") },
  handler: (ctx, { commentId }) => C.deleteComment(ctx, ctx.actor, commentId),
});
