import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { fail, requireSuperAdmin, requireWorkspace } from "./lib/access";
import { userMutation, userQuery } from "./lib/functions";
import { vWorkspaceRole } from "./schema";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "workspace";

/** The signed-in user's workspaces, for the switcher and the landing redirect. */
export const mine = userQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("workspaceMembers").withIndex("by_user", (q) => q.eq("userId", ctx.actor.id)).collect();
    const out = [];
    for (const m of rows) {
      const w = await ctx.db.get(m.workspaceId);
      if (w) out.push({ id: w._id, name: w.name, slug: w.slug, role: m.role });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const bySlug = userQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const w = await ctx.db.query("workspaces").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!w) return null;
    const m = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", w._id).eq("userId", ctx.actor.id))
      .unique();
    if (!m) return null;
    return {
      id: w._id,
      name: w.name,
      slug: w.slug,
      role: m.role,
      me: { id: ctx.actor.id, name: ctx.actor.name, email: ctx.actor.email, isSuperAdmin: ctx.actor.isSuperAdmin },
    };
  },
});

/** Only the super admin creates workspaces. */
export const create = userMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    requireSuperAdmin(ctx.actor);
    const clean = name.trim().slice(0, 60);
    if (!clean) fail("invalid", "Name is required.");
    const base = slugify(clean);
    let slug = base;
    for (let i = 2; await ctx.db.query("workspaces").withIndex("by_slug", (q) => q.eq("slug", slug)).unique(); i++) slug = `${base}-${i}`;
    const id = await ctx.db.insert("workspaces", { name: clean, slug, createdBy: ctx.actor.id, seq: 0, ticketSeq: 0 });
    await ctx.db.insert("workspaceMembers", { workspaceId: id, userId: ctx.actor.id, role: "owner", name: ctx.actor.name, email: ctx.actor.email });
    return { id, slug };
  },
});

export const rename = userMutation({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, { workspaceId, name }) => {
    await requireWorkspace(ctx, ctx.actor, workspaceId, "admin");
    const clean = name.trim().slice(0, 60);
    if (!clean) fail("invalid", "Name is required.");
    await ctx.db.patch(workspaceId, { name: clean });
  },
});

export const members = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { role } = await requireWorkspace(ctx, ctx.actor, workspaceId);
    const rows = await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const agents = await ctx.db.query("agents").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    // Guests see names only; email addresses stay with members.
    return {
      people: rows.map((m) => ({ userId: m.userId, name: m.name, email: role === "guest" ? null : m.email, role: m.role })),
      agents: agents.filter((a) => !a.disabledAt).map((a) => ({ id: a._id, name: a.name })),
    };
  },
});

export const setRole = userMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.string(), role: vWorkspaceRole },
  handler: async (ctx, { workspaceId, userId, role }) => {
    const { role: mine } = await requireWorkspace(ctx, ctx.actor, workspaceId, "admin");
    const target = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .unique();
    if (!target) return fail("not_found", "Member not found.");
    if ((role === "owner" || target!.role === "owner") && mine !== "owner") fail("forbidden", "Only an owner can change owners.");
    if (target!.role === "owner" && role !== "owner") await assertAnotherOwner(ctx, workspaceId, userId);
    await ctx.db.patch(target!._id, { role });
  },
});

export const removeMember = userMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.string() },
  handler: async (ctx, { workspaceId, userId }) => {
    const self = userId === ctx.actor.id;
    const { role: mine } = await requireWorkspace(ctx, ctx.actor, workspaceId, self ? "guest" : "admin");
    const target = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .unique();
    if (!target) return;
    if (target.role === "owner") {
      if (!self && mine !== "owner") fail("forbidden", "Only an owner can remove an owner.");
      await assertAnotherOwner(ctx, workspaceId, userId);
    }
    for (const pm of await ctx.db.query("projectMembers").withIndex("by_principal", (q) => q.eq("principalId", userId)).collect()) {
      if (pm.workspaceId === workspaceId) await ctx.db.delete(pm._id);
    }
    await ctx.db.delete(target._id);
  },
});

async function assertAnotherOwner(ctx: { db: import("./_generated/server").MutationCtx["db"] }, workspaceId: Id<"workspaces">, userId: string) {
  const owners = (await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect()).filter(
    (m) => m.role === "owner" && m.userId !== userId,
  );
  if (!owners.length) fail("invalid", "A workspace needs at least one owner.");
}
