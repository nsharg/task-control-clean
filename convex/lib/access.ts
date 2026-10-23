import { ConvexError, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { isSuperAdminEmail } from "./superAdmin";
import type { vPrincipal, vScope, vWorkspaceRole } from "../schema";

export type Principal = Infer<typeof vPrincipal>;
export type Scope = Infer<typeof vScope>;
export type WorkspaceRole = Infer<typeof vWorkspaceRole>;

export type UserActor = {
  kind: "user";
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
};

export type AgentActor = {
  kind: "agent";
  id: Id<"agents">;
  name: string;
  workspaceId: Id<"workspaces">;
  tokenId: Id<"apiTokens">;
  scopes: Scope[];
  projectIds: Id<"projects">[];
  source?: string;
};

export type Actor = UserActor | AgentActor;

type Ctx = QueryCtx | MutationCtx;

export const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

export const principalOf = (actor: Actor): Principal => ({
  kind: actor.kind,
  id: actor.id,
  name: actor.name,
});

/** Where a change came from: `app`, or the source an agent pushes for. */
export const originOf = (actor: Actor) => (actor.kind === "agent" && actor.source ? actor.source : "app");

// ---------- identity ----------

/**
 * The signed-in person. Disabled accounts are refused everywhere. Someone who
 * still has an admin-issued password can only reach the password screen
 * (`allowPasswordChange`) until they choose their own.
 */
export async function requireUser(ctx: Ctx, opts: { allowPasswordChange?: boolean } = {}): Promise<UserActor> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return fail("unauthenticated", "Sign in to continue.");
  const id = user._id as string;
  const profile = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", id)).unique();
  if (profile?.disabledAt) fail("unauthenticated", "This account is disabled.");
  const mustChangePassword = !!profile?.mustChangePassword;
  if (mustChangePassword && !opts.allowPasswordChange) fail("password_change_required", "Choose a new password to continue.");
  return {
    kind: "user",
    id,
    name: user.name,
    email: user.email,
    isSuperAdmin: isSuperAdminEmail(user.email),
    mustChangePassword,
  };
}

/** Super admins manage accounts and workspaces. */
export function requireSuperAdmin(actor: Actor): UserActor {
  if (actor.kind !== "user" || !actor.isSuperAdmin) return fail("forbidden", "Only the super admin can do that.");
  return actor;
}

export async function sha256(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Resolves a bearer token. Every failure gets the same message, so a caller learns nothing. */
export async function requireAgent(ctx: Ctx, token: string): Promise<AgentActor> {
  const denied = () => fail("unauthenticated", "Invalid or expired token.");
  if (!/^tc_[A-Za-z0-9_-]{40,}$/.test(token)) denied();
  const hash = await sha256(token);
  const tok = await ctx.db
    .query("apiTokens")
    .withIndex("by_hash", (q) => q.eq("hash", hash))
    .unique();
  if (!tok || tok.revokedAt || (tok.expiresAt && tok.expiresAt < Date.now())) denied();
  const agent = await ctx.db.get(tok!.agentId);
  if (!agent || agent.disabledAt) denied();
  return {
    kind: "agent",
    id: agent!._id,
    name: agent!.name,
    workspaceId: tok!.workspaceId,
    tokenId: tok!._id,
    scopes: tok!.scopes,
    projectIds: tok!.projectIds,
    source: tok!.source,
  };
}

export function requireScope(actor: Actor, scope: Scope) {
  if (actor.kind === "agent" && !actor.scopes.includes(scope) && !actor.scopes.includes("admin")) {
    fail("forbidden", `This token lacks the "${scope}" scope.`);
  }
}

// ---------- workspaces ----------

const RANK: Record<WorkspaceRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export async function membership(ctx: Ctx, workspaceId: Id<"workspaces">, userId: string) {
  return ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .unique();
}

export async function workspaceRole(
  ctx: Ctx,
  actor: Actor,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceRole | null> {
  if (actor.kind === "agent") {
    if (actor.workspaceId !== workspaceId) return null;
    return actor.scopes.includes("admin") ? "admin" : "member";
  }
  return (await membership(ctx, workspaceId, actor.id))?.role ?? null;
}

export async function requireWorkspace(
  ctx: Ctx,
  actor: Actor,
  workspaceId: Id<"workspaces">,
  min: WorkspaceRole = "guest",
) {
  const workspace = await ctx.db.get(workspaceId);
  const role = workspace ? await workspaceRole(ctx, actor, workspaceId) : null;
  if (!workspace || !role) return fail("not_found", "Workspace not found.");
  if (RANK[role] < RANK[min]) fail("forbidden", "You don't have permission to do that.");
  return { workspace, role };
}

// ---------- projects ----------

export type ProjectPerms = { read: boolean; comment: boolean; write: boolean; manage: boolean };
const NONE: ProjectPerms = { read: false, comment: false, write: false, manage: false };
const ALL: ProjectPerms = { read: true, comment: true, write: true, manage: true };

/** An archived project is a record: everyone who could read it still can, and only a manager can restore it. */
export async function projectPerms(ctx: Ctx, actor: Actor, project: Doc<"projects">): Promise<ProjectPerms> {
  const p = await livePerms(ctx, actor, project);
  return project.archivedAt ? { ...p, comment: false, write: false } : p;
}

async function livePerms(ctx: Ctx, actor: Actor, project: Doc<"projects">): Promise<ProjectPerms> {
  if (actor.kind === "agent") {
    if (actor.workspaceId !== project.workspaceId) return NONE;
    if (actor.projectIds.length && !actor.projectIds.includes(project._id)) return NONE;
    const has = (s: Scope) => actor.scopes.includes(s) || actor.scopes.includes("admin");
    return { read: has("read"), comment: has("comment"), write: has("write"), manage: has("admin") };
  }
  const role = await workspaceRole(ctx, actor, project.workspaceId);
  if (!role) return NONE;
  if (role === "owner" || role === "admin") return ALL;
  const pm = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_principal", (q) => q.eq("projectId", project._id).eq("principalId", actor.id))
    .unique();
  if (pm?.role === "lead") return ALL;
  if (pm?.role === "member") return { read: true, comment: true, write: true, manage: false };
  if (pm?.role === "viewer") return { read: true, comment: true, write: false, manage: false };
  // Not a project member: members see workspace-visible projects, guests see nothing.
  if (role === "member" && project.visibility === "workspace") {
    return { read: true, comment: true, write: true, manage: false };
  }
  return NONE;
}

export async function requireProject(
  ctx: Ctx,
  actor: Actor,
  projectId: Id<"projects">,
  need: keyof ProjectPerms = "read",
) {
  const project = await ctx.db.get(projectId);
  const perms = project ? await projectPerms(ctx, actor, project) : NONE;
  // A project you cannot read does not exist, as far as you can tell.
  if (!project || !perms.read) return fail("not_found", "Project not found.");
  if (project.archivedAt && (need === "write" || need === "comment")) fail("archived", "This project is archived and read-only.");
  if (!perms[need]) fail("forbidden", "You don't have permission to do that.");
  return { project: project!, perms };
}

export async function projectByKey(
  ctx: Ctx,
  actor: Actor,
  workspaceId: Id<"workspaces">,
  key: string,
  need: keyof ProjectPerms = "read",
) {
  const project = await ctx.db
    .query("projects")
    .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspaceId).eq("key", key.toUpperCase()))
    .unique();
  if (!project) return fail("not_found", "Project not found.");
  return requireProject(ctx, actor, project!._id, need);
}

export async function readableProjects(ctx: Ctx, actor: Actor, workspaceId: Id<"workspaces">) {
  const all = await ctx.db
    .query("projects")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const out: Doc<"projects">[] = [];
  for (const p of all) if ((await projectPerms(ctx, actor, p)).read) out.push(p);
  return out;
}

// ---------- keys ----------

export const taskKey = (project: Pick<Doc<"projects">, "key">, task: Pick<Doc<"tasks">, "number">) =>
  `${project.key}-${task.number}`;
export const ticketKey = (ticket: Pick<Doc<"tickets">, "number">) => `T-${ticket.number}`;
export const targetKey = (type: "task" | "ticket" | "project", id: string) => `${type}:${id}`;

/** Parses `DEMO-42`, `SM-01` (an alias) or `T-7`. */
export function parseRef(ref: string) {
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(ref.trim());
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: Number(m[2]), raw: ref.trim() };
}
