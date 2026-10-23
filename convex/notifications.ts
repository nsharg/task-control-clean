import { v } from "convex/values";
import { userMutation, userQuery } from "./lib/functions";

export const list = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", ctx.actor.id)).order("desc").take(200);
    return rows
      .filter((n) => n.workspaceId === workspaceId)
      .map((n) => ({ id: n._id, kind: n.kind, targetKey: n.targetKey, title: n.title, actor: n.actor, read: !!n.readAt, at: n._creationTime }));
  },
});

export const unreadCount = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", ctx.actor.id).eq("readAt", undefined)).take(100);
    return rows.filter((n) => n.workspaceId === workspaceId).length;
  },
});

export const markRead = userMutation({
  args: { ids: v.optional(v.array(v.id("notifications"))), workspaceId: v.id("workspaces") },
  handler: async (ctx, { ids, workspaceId }) => {
    const rows = ids
      ? await Promise.all(ids.map((id) => ctx.db.get(id)))
      : await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", ctx.actor.id).eq("readAt", undefined)).take(500);
    for (const n of rows) {
      if (n && n.userId === ctx.actor.id && n.workspaceId === workspaceId && !n.readAt) await ctx.db.patch(n._id, { readAt: Date.now() });
    }
  },
});
