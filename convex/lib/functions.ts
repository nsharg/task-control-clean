/**
 * The only way to define a public Convex function in this app. Each builder
 * resolves the caller first, so a handler always has `ctx.actor`:
 *
 *   userQuery / userMutation     a signed-in, enabled person with their own password
 *   sessionQuery                 the same, but also during a forced password change
 *   agentQuery / agentMutation   an agent, from the `token` argument (REST + MCP)
 *
 * Handlers then check workspace or project access with `lib/access.ts`.
 * `tests/wrappers.test.ts` fails when an exported function skips these.
 */
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { fail, requireAgent, requireUser } from "./access";
import { rateLimiter } from "./rateLimits";

export const userQuery = customQuery(query, {
  args: {},
  input: async (ctx) => ({ ctx: { actor: await requireUser(ctx) }, args: {} }),
});

/** Like userQuery, but also open to someone who must still change an admin-issued password. */
export const sessionQuery = customQuery(query, {
  args: {},
  input: async (ctx) => ({ ctx: { actor: await requireUser(ctx, { allowPasswordChange: true }) }, args: {} }),
});

export const userMutation = customMutation(mutation, {
  args: {},
  input: async (ctx) => ({ ctx: { actor: await requireUser(ctx) }, args: {} }),
});

export const agentQuery = customQuery(query, {
  args: { token: v.string() },
  input: async (ctx, { token }) => ({ ctx: { actor: await requireAgent(ctx, token) }, args: {} }),
});

export const agentMutation = customMutation(mutation, {
  args: { token: v.string() },
  input: async (ctx, { token }) => {
    const actor = await requireAgent(ctx, token);
    const { ok, retryAfter } = await rateLimiter.limit(ctx, "agentWrite", { key: actor.tokenId });
    if (!ok) fail("rate_limited", `Too many writes. Retry in ${Math.ceil((retryAfter ?? 1000) / 1000)}s.`);
    const tok = await ctx.db.get(actor.tokenId);
    if (tok && (!tok.lastUsedAt || tok.lastUsedAt < Date.now() - 60_000)) {
      await ctx.db.patch(actor.tokenId, { lastUsedAt: Date.now() });
    }
    return { ctx: { actor }, args: {} };
  },
});
