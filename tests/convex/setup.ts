/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { api, components } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { sha256 } from "../../convex/lib/access";

export const modules = import.meta.glob("../../convex/**/*.*s");

export function setup() {
  process.env.SUPER_ADMIN_EMAILS = "owner@example.com";
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, "betterAuth");
  rateLimiterTest.register(t, "rateLimiter");
  return t;
}
export type T = ReturnType<typeof setup>;

/** Creates a verified Better Auth user with a live session and returns a client acting as them. */
export async function user(t: T, name: string) {
  const now = Date.now();
  const email = `${name.toLowerCase()}@example.com`;
  const u = (await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "user", data: { name, email, emailVerified: true, createdAt: now, updatedAt: now } },
  })) as { _id: string };
  const s = (await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "session", data: { userId: u._id, token: `tok-${name}`, expiresAt: now + 86_400_000, createdAt: now, updatedAt: now } },
  })) as { _id: string };
  return { id: u._id, email, as: t.withIdentity({ subject: u._id, sessionId: s._id, name, email }) };
}

/** Inserts an agent and a token directly, returning the raw token. */
export async function agentToken(
  t: T,
  workspaceId: Id<"workspaces">,
  opts: { scopes: ("read" | "write" | "comment" | "sync" | "ingest" | "admin" | "decide")[]; source?: string; projectIds?: Id<"projects">[]; revoked?: boolean; name?: string },
) {
  const token = `tc_${"x".repeat(20)}${Math.random().toString(36).slice(2).padEnd(24, "y")}`;
  const hash = await sha256(token);
  await t.run(async (ctx) => {
    const agentId = await ctx.db.insert("agents", { workspaceId, name: opts.name ?? "claude", description: "", createdBy: "test" });
    await ctx.db.insert("apiTokens", {
      workspaceId,
      agentId,
      name: "t",
      prefix: token.slice(0, 10),
      hash,
      scopes: opts.scopes,
      projectIds: opts.projectIds ?? [],
      source: opts.source,
      revokedAt: opts.revoked ? Date.now() : undefined,
      createdBy: "test",
    });
  });
  return token;
}

/** Owner, member, guest (on P1 only) and outsider, one workspace, P1 (open) and P2 (members only). */
export async function world() {
  const t = setup();
  const owner = await user(t, "Owner");
  const member = await user(t, "Member");
  const guest = await user(t, "Guest");
  const outsider = await user(t, "Outsider");
  const { id: workspaceId } = await owner.as.mutation(api.workspaces.create, { name: "Example Workspace" });
  const p1 = await owner.as.mutation(api.projects.create, { workspaceId, key: "DEMO", name: "Example Project" });
  const p2 = await owner.as.mutation(api.projects.create, { workspaceId, key: "SEC", name: "Secret", visibility: "members" });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", { workspaceId, userId: member.id, role: "member", name: "Member", email: member.email });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId: guest.id, role: "guest", name: "Guest", email: guest.email });
    await ctx.db.insert("projectMembers", { workspaceId, projectId: p1.id, principalKind: "user", principalId: guest.id, role: "member" });
  });
  return { t, owner, member, guest, outsider, workspaceId, p1: p1.id, p2: p2.id };
}
