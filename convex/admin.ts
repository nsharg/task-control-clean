/**
 * Account administration. In the beta there is no sign-up and no email: the
 * super admin creates each account with a one-time password and hands it
 * over; the person must choose their own password at first sign-in.
 */
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { createAuth } from "./auth";
import { fail, requireSuperAdmin, requireUser } from "./lib/access";
import { logActivity } from "./lib/activity";
import { rateLimiter } from "./lib/rateLimits";
import { sessionQuery, userMutation, userQuery } from "./lib/functions";
import { vWorkspaceRole } from "./schema";

type AuthUser = { _id: string; name: string; email: string; createdAt: number };

/** A readable one-time password: 4 groups of 5 from an unambiguous alphabet (~100 bits). */
function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(20));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

// ---------- used by auth.ts ----------

export const consumeSignInAttempt = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => (await rateLimiter.limit(ctx, "signInPerAccount", { key: email })).ok,
});

export const anyUserExists = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    !!(await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] })),
});

export const isDisabled = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) =>
    !!(await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", userId)).unique())?.disabledAt,
});

export const clearMustChangePassword = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const p = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (p?.mustChangePassword) await ctx.db.patch(p._id, { mustChangePassword: false });
  },
});

// ---------- who am I ----------

/** Works while a password change is pending, so the app can send people to that screen. */
export const me = sessionQuery({
  args: {},
  handler: async (ctx) => ({
    id: ctx.actor.id,
    name: ctx.actor.name,
    email: ctx.actor.email,
    isSuperAdmin: ctx.actor.isSuperAdmin,
    mustChangePassword: ctx.actor.mustChangePassword,
  }),
});

// ---------- super admin ----------

export const users = userQuery({
  args: {},
  handler: async (ctx) => {
    requireSuperAdmin(ctx.actor);
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 500, cursor: null },
    })) as { page: AuthUser[] };
    const workspaces = await ctx.db.query("workspaces").collect();
    const wsName = new Map(workspaces.map((w) => [w._id as string, w]));
    const out = [];
    for (const u of res.page) {
      const profile = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", u._id)).unique();
      const memberships = await ctx.db.query("workspaceMembers").withIndex("by_user", (q) => q.eq("userId", u._id)).collect();
      out.push({
        id: u._id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
        disabled: !!profile?.disabledAt,
        mustChangePassword: !!profile?.mustChangePassword,
        workspaces: memberships.map((m) => ({ id: m.workspaceId, name: wsName.get(m.workspaceId)?.name ?? "?", role: m.role })),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const workspaceOptions = userQuery({
  args: {},
  handler: async (ctx) => {
    requireSuperAdmin(ctx.actor);
    const workspaces = await ctx.db.query("workspaces").collect();
    const out = [];
    for (const w of workspaces) {
      const projects = await ctx.db.query("projects").withIndex("by_workspace", (q) => q.eq("workspaceId", w._id)).collect();
      out.push({ id: w._id, name: w.name, projects: projects.filter((p) => !p.archivedAt).map((p) => ({ id: p._id, name: p.name, key: p.key })) });
    }
    return out;
  },
});

const vPlacement = {
  workspaceId: v.optional(v.id("workspaces")),
  role: v.optional(vWorkspaceRole),
  projectIds: v.optional(v.array(v.id("projects"))),
};

/** Checks the caller is the super admin (auth carries over from the calling action). */
export const assertSuperAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const actor = requireSuperAdmin(await requireUser(ctx));
    return { id: actor.id, name: actor.name };
  },
});

/** Adds a user to a workspace (and, for guests, to projects). Idempotent. */
export const placeUser = internalMutation({
  args: { userId: v.string(), name: v.string(), email: v.string(), byId: v.string(), byName: v.string(), ...vPlacement },
  handler: async (ctx, a) => {
    if (!a.workspaceId) return;
    const ws = await ctx.db.get(a.workspaceId);
    if (!ws) fail("invalid", "Unknown workspace.");
    const role = a.role ?? "member";
    const projectIds = a.projectIds ?? [];
    if (role === "guest" && !projectIds.length) fail("invalid", "Pick at least one project for a guest.");
    for (const pid of projectIds) if ((await ctx.db.get(pid))?.workspaceId !== a.workspaceId) fail("invalid", "Unknown project.");
    const existing = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", a.workspaceId!).eq("userId", a.userId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { role });
    else await ctx.db.insert("workspaceMembers", { workspaceId: a.workspaceId, userId: a.userId, role, name: a.name, email: a.email.toLowerCase() });
    for (const projectId of projectIds) {
      const pm = await ctx.db
        .query("projectMembers")
        .withIndex("by_project_principal", (q) => q.eq("projectId", projectId).eq("principalId", a.userId))
        .unique();
      if (!pm) await ctx.db.insert("projectMembers", { workspaceId: a.workspaceId, projectId, principalKind: "user", principalId: a.userId, role: "member" });
    }
    await logActivity(ctx, {
      workspaceId: a.workspaceId,
      targetKey: `workspace:${a.workspaceId}`,
      actor: { kind: "user", id: a.byId, name: a.byName },
      origin: "app",
      action: "added member",
      to: role,
      note: a.email,
    });
  },
});

export const setProfile = internalMutation({
  args: { userId: v.string(), mustChangePassword: v.optional(v.boolean()), disabled: v.optional(v.boolean()), createdBy: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const p = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", a.userId)).unique();
    const patch = {
      ...(a.mustChangePassword !== undefined ? { mustChangePassword: a.mustChangePassword } : {}),
      ...(a.disabled !== undefined ? { disabledAt: a.disabled ? Date.now() : undefined } : {}),
    };
    if (p) await ctx.db.patch(p._id, patch);
    else await ctx.db.insert("profiles", { userId: a.userId, mustChangePassword: a.mustChangePassword ?? false, createdBy: a.createdBy, ...patch });
  },
});

async function authContext(ctx: ActionCtx) {
  return (await createAuth(ctx).$context).internalAdapter;
}

async function hash(ctx: ActionCtx, password: string) {
  return (await createAuth(ctx).$context).password.hash(password);
}

/** Creates an account with a one-time password and returns it once, for the admin to hand over. */
export const createUser = action({
  args: { name: v.string(), email: v.string(), ...vPlacement },
  handler: async (ctx, a): Promise<{ userId: string; password: string }> => {
    const admin = await ctx.runQuery(internal.admin.assertSuperAdmin, {});
    const name = a.name.trim().slice(0, 80);
    const email = a.email.trim().toLowerCase();
    if (!name) fail("invalid", "Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail("invalid", "Enter a valid email address.");
    const db = await authContext(ctx);
    if (await db.findUserByEmail(email)) fail("invalid", "An account with that email already exists. Add it to a workspace instead.");
    const password = generatePassword();
    const user = await db.createUser({ name, email, emailVerified: true });
    await db.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await hash(ctx, password) });
    await ctx.runMutation(internal.admin.setProfile, { userId: user.id, mustChangePassword: true, createdBy: admin.id });
    await ctx.runMutation(internal.admin.placeUser, { userId: user.id, name, email, byId: admin.id, byName: admin.name, workspaceId: a.workspaceId, role: a.role, projectIds: a.projectIds });
    await ctx.runMutation(internal.monitor.record, { kind: "admin_action", email, detail: `account created by ${admin.name}` });
    return { userId: user.id, password };
  },
});

/** Issues a new one-time password and signs the person out everywhere. */
export const resetPassword = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<{ password: string }> => {
    const admin = await ctx.runQuery(internal.admin.assertSuperAdmin, {});
    const db = await authContext(ctx);
    if (!(await db.findUserById(userId))) fail("not_found", "User not found.");
    const password = generatePassword();
    await db.updatePassword(userId, await hash(ctx, password));
    await db.deleteUserSessions(userId);
    await ctx.runMutation(internal.admin.setProfile, { userId, mustChangePassword: true, createdBy: admin.id });
    await ctx.runMutation(internal.monitor.record, { kind: "admin_action", detail: `password reset for ${userId} by ${admin.name}` });
    return { password };
  },
});

/** Disables or re-enables an account. Disabling also ends every session. */
export const setDisabled = action({
  args: { userId: v.string(), disabled: v.boolean() },
  handler: async (ctx, { userId, disabled }) => {
    const admin = await ctx.runQuery(internal.admin.assertSuperAdmin, {});
    if (userId === admin.id) fail("invalid", "You can't disable your own account.");
    await ctx.runMutation(internal.admin.setProfile, { userId, disabled });
    if (disabled) await (await authContext(ctx)).deleteUserSessions(userId);
    await ctx.runMutation(internal.monitor.record, { kind: "admin_action", detail: `${disabled ? "disabled" : "enabled"} ${userId} by ${admin.name}` });
  },
});

export const signOutEverywhere = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await ctx.runQuery(internal.admin.assertSuperAdmin, {});
    await (await authContext(ctx)).deleteUserSessions(userId);
  },
});

/** Adds an existing account to a workspace. */
export const addToWorkspace = userMutation({
  args: { userId: v.string(), workspaceId: v.id("workspaces"), role: vWorkspaceRole, projectIds: v.optional(v.array(v.id("projects"))) },
  handler: async (ctx, a) => {
    const admin = requireSuperAdmin(ctx.actor);
    const u = (await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: a.userId }] })) as AuthUser | null;
    if (!u) return fail("not_found", "User not found.");
    await ctx.runMutation(internal.admin.placeUser, {
      userId: a.userId,
      name: u!.name,
      email: u!.email,
      byId: admin.id,
      byName: admin.name,
      workspaceId: a.workspaceId as Id<"workspaces">,
      role: a.role,
      projectIds: a.projectIds,
    });
  },
});
