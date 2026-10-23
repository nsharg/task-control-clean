import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation } from "./_generated/server";
import { fail, requireUser, requireWorkspace, sha256 } from "./lib/access";
import { logActivity } from "./lib/activity";
import { userMutation, userQuery } from "./lib/functions";
import { rateLimiter } from "./lib/rateLimits";
import { randomToken } from "./lib/random";
import { vScope } from "./schema";

const SOURCE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const list = userQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspace(ctx, ctx.actor, workspaceId, "admin");
    const agents = await ctx.db.query("agents").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const tokens = await ctx.db.query("apiTokens").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    return agents.map((a) => ({
      id: a._id,
      name: a.name,
      description: a.description,
      disabled: !!a.disabledAt,
      tokens: tokens
        .filter((t) => t.agentId === a._id)
        .map((t) => ({
          id: t._id,
          name: t.name,
          prefix: t.prefix,
          scopes: t.scopes,
          projectIds: t.projectIds,
          source: t.source ?? null,
          expiresAt: t.expiresAt ?? null,
          lastUsedAt: t.lastUsedAt ?? null,
          revoked: !!t.revokedAt,
          createdAt: t._creationTime,
        })),
    }));
  },
});

export const create = userMutation({
  args: { workspaceId: v.id("workspaces"), name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, name, description }) => {
    await requireWorkspace(ctx, ctx.actor, workspaceId, "admin");
    const clean = name.trim().slice(0, 40);
    if (!clean) fail("invalid", "Name is required.");
    return ctx.db.insert("agents", { workspaceId, name: clean, description: (description ?? "").slice(0, 500), createdBy: ctx.actor.id });
  },
});

export const setDisabled = userMutation({
  args: { agentId: v.id("agents"), disabled: v.boolean() },
  handler: async (ctx, { agentId, disabled }) => {
    const a = await ctx.db.get(agentId);
    if (!a) return fail("not_found", "Agent not found.");
    await requireWorkspace(ctx, ctx.actor, a!.workspaceId, "admin");
    await ctx.db.patch(agentId, { disabledAt: disabled ? Date.now() : undefined });
  },
});

export const storeToken = internalMutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    scopes: v.array(vScope),
    projectIds: v.array(v.id("projects")),
    source: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
    hash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"apiTokens">> => {
    const actor = await requireUser(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return fail("not_found", "Agent not found.");
    await requireWorkspace(ctx, actor, agent!.workspaceId, "admin");
    const { ok } = await rateLimiter.limit(ctx, "tokenCreate", { key: agent!.workspaceId });
    if (!ok) fail("rate_limited", "Too many tokens created. Try again later.");
    if (!args.scopes.length) fail("invalid", "Pick at least one scope.");
    if (args.source !== undefined && !SOURCE_RE.test(args.source)) fail("invalid", "Source must be lowercase letters, digits and dashes, e.g. my-tracker.");
    if (args.scopes.includes("sync") && !args.source) fail("invalid", "A token with the sync scope needs a source name.");
    for (const pid of args.projectIds) {
      const p = await ctx.db.get(pid);
      if (!p || p.workspaceId !== agent!.workspaceId) fail("invalid", "Unknown project.");
    }
    const days = args.expiresInDays;
    if (days !== undefined && (days < 1 || days > 730)) fail("invalid", "Expiry must be between 1 and 730 days.");
    const id = await ctx.db.insert("apiTokens", {
      workspaceId: agent!.workspaceId,
      agentId: agent!._id,
      name: args.name.trim().slice(0, 60) || "token",
      prefix: args.prefix,
      hash: args.hash,
      scopes: [...new Set(args.scopes)],
      projectIds: args.projectIds,
      source: args.source,
      expiresAt: days ? Date.now() + days * 86_400_000 : undefined,
      createdBy: actor.id,
    });
    await logActivity(ctx, {
      workspaceId: agent!.workspaceId,
      targetKey: `agent:${agent!._id}`,
      actor: { kind: "user", id: actor.id, name: actor.name },
      origin: "app",
      action: "created token",
      note: `${agent!.name}: ${args.scopes.join(", ")}`,
    });
    return id;
  },
});

/** Makes a token and returns it once. Only its SHA-256 hash is stored. */
export const createToken = action({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    scopes: v.array(vScope),
    projectIds: v.array(v.id("projects")),
    source: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ token: string; id: Id<"apiTokens"> }> => {
    const token = randomToken("tc_");
    const id = await ctx.runMutation(internal.agents.storeToken, { ...args, hash: await sha256(token), prefix: token.slice(0, 10) });
    return { token, id };
  },
});

export const revokeToken = userMutation({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, { tokenId }) => {
    const t = await ctx.db.get(tokenId);
    if (!t) return;
    await requireWorkspace(ctx, ctx.actor, t.workspaceId, "admin");
    await ctx.db.patch(tokenId, { revokedAt: Date.now() });
  },
});
