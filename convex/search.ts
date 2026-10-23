import { v } from "convex/values";
import { projectPerms, requireWorkspace } from "./lib/access";
import { ticketPerms } from "./domain/tickets";
import { userQuery } from "./lib/functions";
import type { Doc } from "./_generated/dataModel";

/** ⌘K search over task and ticket titles, filtered to what the caller can read. */
export const run = userQuery({
  args: { workspaceId: v.id("workspaces"), q: v.string() },
  handler: async (ctx, { workspaceId, q }) => {
    await requireWorkspace(ctx, ctx.actor, workspaceId);
    const text = q.trim().slice(0, 100);
    if (!text) return [];
    const perms = new Map<string, Doc<"projects"> | null>();
    const readable = async (pid: Doc<"tasks">["projectId"]) => {
      if (!perms.has(pid)) {
        const p = await ctx.db.get(pid);
        perms.set(pid, p && (await projectPerms(ctx, ctx.actor, p)).read ? p : null);
      }
      return perms.get(pid);
    };
    const out: { type: "task" | "ticket"; id: string; key: string; title: string; status: string; projectKey: string | null }[] = [];
    const tasks = await ctx.db.query("tasks").withSearchIndex("search_title", (s) => s.search("title", text).eq("workspaceId", workspaceId)).take(40);
    // A key ("DEMO-12") or an alias ("SM-01") goes straight to its task.
    const upper = text.toUpperCase();
    const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(upper);
    if (m) {
      const projects = await ctx.db.query("projects").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
      for (const p of projects) {
        const hit =
          p.key === m[1]
            ? await ctx.db.query("tasks").withIndex("by_project_number", (q) => q.eq("projectId", p._id).eq("number", Number(m[2]))).unique()
            : await ctx.db.query("tasks").withIndex("by_project_alias", (q) => q.eq("projectId", p._id).eq("alias", text.trim())).first();
        if (hit && !tasks.some((t) => t._id === hit._id)) tasks.unshift(hit);
      }
    }
    for (const t of tasks) {
      const p = await readable(t.projectId);
      if (p) out.push({ type: "task", id: t._id, key: `${p.key}-${t.number}`, title: t.title, status: t.status, projectKey: p.key });
    }
    const tickets = await ctx.db.query("tickets").withSearchIndex("search_title", (s) => s.search("title", text).eq("workspaceId", workspaceId)).take(20);
    for (const t of tickets) {
      if ((await ticketPerms(ctx, ctx.actor, t)).read) out.push({ type: "ticket", id: t._id, key: `T-${t.number}`, title: t.title, status: t.status, projectKey: null });
    }
    return out.sort((a, b) => Number(b.key === upper) - Number(a.key === upper)).slice(0, 30);
  },
});
