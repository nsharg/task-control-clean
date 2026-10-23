import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  type Actor,
  fail,
  originOf,
  principalOf,
  projectPerms,
  type ProjectPerms,
  requireProject,
  requireWorkspace,
  targetKey,
  ticketKey,
  workspaceRole,
} from "../lib/access";
import { logActivity, notify } from "../lib/activity";
import type { vSeverity, vTicketKind, vTicketStatus } from "../schema";
import { cleanText, ingestFor } from "./tasks";

type Kind = Infer<typeof vTicketKind>;
type Status = Infer<typeof vTicketStatus>;
type Severity = Infer<typeof vSeverity>;

/**
 * A ticket filed on a project follows that project's access. A ticket with no
 * project is visible to workspace members, and to the guest who reported it.
 */
export async function ticketPerms(ctx: QueryCtx, actor: Actor, ticket: Doc<"tickets">): Promise<ProjectPerms> {
  if (ticket.projectId) {
    const project = await ctx.db.get(ticket.projectId);
    if (project) {
      const p = await projectPerms(ctx, actor, project);
      // Reporters can always follow and comment on their own ticket.
      if (!p.read && ticket.reporter.id === actor.id) return { read: true, comment: true, write: false, manage: false };
      return p;
    }
  }
  const role = await workspaceRole(ctx, actor, ticket.workspaceId);
  if (role === "owner" || role === "admin") return { read: true, comment: true, write: true, manage: true };
  if (role === "member") return { read: true, comment: true, write: true, manage: false };
  if (role === "guest" && ticket.reporter.id === actor.id) return { read: true, comment: true, write: false, manage: false };
  return { read: false, comment: false, write: false, manage: false };
}

export async function requireTicket(ctx: QueryCtx, actor: Actor, ticketId: Id<"tickets">, need: keyof ProjectPerms = "read") {
  const ticket = await ctx.db.get(ticketId);
  const perms = ticket ? await ticketPerms(ctx, actor, ticket) : null;
  if (!ticket || !perms?.read) return fail("not_found", "Ticket not found.");
  if (!perms![need]) fail("forbidden", "You don't have permission to do that.");
  return { ticket: ticket!, perms: perms! };
}

export async function ticketByRef(ctx: QueryCtx, workspaceId: Id<"workspaces">, ref: string) {
  const m = /^T-(\d+)$/i.exec(ref.trim());
  const t = m
    ? await ctx.db
        .query("tickets")
        .withIndex("by_workspace_number", (q) => q.eq("workspaceId", workspaceId).eq("number", Number(m[1])))
        .unique()
    : null;
  if (!t) return fail("not_found", `Ticket ${ref} not found.`);
  return t!;
}

export function presentTicket(t: Doc<"tickets">, project?: Doc<"projects"> | null) {
  return {
    id: t._id,
    key: ticketKey(t),
    kind: t.kind,
    title: t.title,
    severity: t.severity,
    status: t.status,
    reporter: t.reporter,
    assignee: t.assignee ?? null,
    project: project ? { id: project._id, key: project.key, name: project.name } : null,
    ingest: t.ingest,
    createdAt: t._creationTime,
    updatedAt: t.updatedAt,
  };
}

export async function listTickets(
  ctx: QueryCtx,
  actor: Actor,
  workspaceId: Id<"workspaces">,
  filter: { projectId?: Id<"projects">; status?: Status; open?: boolean },
) {
  await requireWorkspace(ctx, actor, workspaceId);
  const rows = filter.projectId
    ? await ctx.db.query("tickets").withIndex("by_project", (q) => q.eq("projectId", filter.projectId)).order("desc").take(500)
    : await ctx.db.query("tickets").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(500);
  const closed = new Set<Status>(["resolved", "closed", "rejected", "duplicate"]);
  const projects = new Map<string, Doc<"projects"> | null>();
  const out = [];
  for (const t of rows) {
    if (t.workspaceId !== workspaceId) continue;
    if (filter.status && t.status !== filter.status) continue;
    if (filter.open && closed.has(t.status)) continue;
    if (!(await ticketPerms(ctx, actor, t)).read) continue;
    if (t.projectId && !projects.has(t.projectId)) projects.set(t.projectId, await ctx.db.get(t.projectId));
    out.push(presentTicket(t, t.projectId ? projects.get(t.projectId) : null));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function ticketDetail(ctx: QueryCtx, actor: Actor, ticketId: Id<"tickets">) {
  const { ticket, perms } = await requireTicket(ctx, actor, ticketId);
  const project = ticket.projectId ? await ctx.db.get(ticket.projectId) : null;
  const links = await ctx.db.query("ticketLinks").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).collect();
  const tasks = [];
  for (const l of links) {
    const task = await ctx.db.get(l.taskId);
    const p = task ? await ctx.db.get(task.projectId) : null;
    if (task && p && (await projectPerms(ctx, actor, p)).read) {
      tasks.push({ id: task._id, key: `${p.key}-${task.number}`, alias: task.alias ?? null, title: task.title, status: task.status, relation: l.relation, linkId: l._id });
    }
  }
  const activity = await ctx.db
    .query("activity")
    .withIndex("by_target", (q) => q.eq("targetKey", targetKey("ticket", ticket._id)))
    .order("desc")
    .take(100);
  return {
    ...presentTicket(ticket, project),
    body: ticket.body,
    perms,
    tasks,
    activity: activity.map((a) => ({ id: a._id, actor: a.actor, origin: a.origin, action: a.action, from: a.from ?? null, to: a.to ?? null, note: a.note ?? null, at: a.at })),
  };
}

export async function createTicket(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"projects">;
    kind: Kind;
    title: string;
    body?: string;
    severity?: Severity;
  },
) {
  const { workspace } = await requireWorkspace(ctx, actor, input.workspaceId);
  // Filing on a project needs comment access to it (viewers and guests members can file).
  let project: Doc<"projects"> | null = null;
  if (input.projectId) project = (await requireProject(ctx, actor, input.projectId, "comment")).project;
  const title = cleanText(input.title, 300, "Title");
  if (!title) fail("invalid", "Title is required.");
  const number = workspace.ticketSeq + 1;
  await ctx.db.patch(workspace._id, { ticketSeq: number });
  const id = await ctx.db.insert("tickets", {
    workspaceId: workspace._id,
    projectId: project?._id,
    number,
    kind: input.kind,
    title,
    body: cleanText(input.body, 50_000, "Description"),
    severity: input.severity ?? "medium",
    status: "new",
    reporter: principalOf(actor),
    ingest: ingestFor(actor),
    updatedAt: Date.now(),
  });
  await logActivity(ctx, {
    workspaceId: workspace._id,
    projectId: project?._id,
    targetKey: targetKey("ticket", id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "opened",
    to: "new",
    note: title,
  });
  // Tell project leads, or workspace admins when there is no project.
  const leads = project
    ? (await ctx.db.query("projectMembers").withIndex("by_project", (q) => q.eq("projectId", project!._id)).collect())
        .filter((m) => m.role === "lead" && m.principalKind === "user")
        .map((m) => m.principalId)
    : [];
  const admins = (await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).collect())
    .filter((m) => m.role === "owner" || m.role === "admin")
    .map((m) => m.userId);
  await notify(ctx, {
    userIds: leads.length ? leads : admins,
    workspaceId: workspace._id,
    kind: "ticket",
    targetKey: targetKey("ticket", id),
    title: `T-${number} ${title}`,
    actor: principalOf(actor),
  });
  return { id, key: `T-${number}` };
}

export async function updateTicket(
  ctx: MutationCtx,
  actor: Actor,
  ticketId: Id<"tickets">,
  patch: {
    title?: string;
    body?: string;
    kind?: Kind;
    severity?: Severity;
    status?: Status;
    assigneeId?: string | null;
    projectId?: Id<"projects"> | null;
  },
) {
  const { ticket, perms } = await requireTicket(ctx, actor, ticketId);
  const isReporter = ticket.reporter.id === actor.id;
  const triage = patch.status !== undefined || patch.assigneeId !== undefined || patch.projectId !== undefined || patch.severity !== undefined;
  if (triage && !perms.write) fail("forbidden", "Only project members can triage tickets.");
  if (!perms.write && !isReporter) fail("forbidden", "You don't have permission to do that.");
  const next: Partial<Doc<"tickets">> = {};
  const changes: { action: string; from?: string; to?: string }[] = [];
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 300, "Title");
    if (!title) fail("invalid", "Title is required.");
    next.title = title;
  }
  if (patch.body !== undefined) next.body = cleanText(patch.body, 50_000, "Description");
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.severity !== undefined && patch.severity !== ticket.severity) {
    next.severity = patch.severity;
    changes.push({ action: "severity", from: ticket.severity, to: patch.severity });
  }
  if (patch.status !== undefined && patch.status !== ticket.status) {
    next.status = patch.status;
    changes.push({ action: "status", from: ticket.status, to: patch.status });
  }
  if (patch.projectId !== undefined) {
    if (patch.projectId) await requireProject(ctx, actor, patch.projectId, "write");
    next.projectId = patch.projectId ?? undefined;
    changes.push({ action: "moved" });
  }
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId === null) next.assignee = undefined;
    else {
      const m = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", ticket.workspaceId).eq("userId", patch.assigneeId!))
        .unique();
      if (!m) fail("invalid", "The assignee is not a member of this workspace.");
      next.assignee = { kind: "user", id: m!.userId, name: m!.name };
    }
    changes.push({ action: "assigned", to: next.assignee?.name ?? "nobody" });
  }
  await ctx.db.patch(ticket._id, { ...next, updatedAt: Date.now() });
  for (const c of changes) {
    await logActivity(ctx, {
      workspaceId: ticket.workspaceId,
      projectId: next.projectId ?? ticket.projectId,
      targetKey: targetKey("ticket", ticket._id),
      actor: principalOf(actor),
      origin: originOf(actor),
      ...c,
    });
  }
  const watchers = [ticket.reporter, ticket.assignee, next.assignee].filter((p) => p?.kind === "user").map((p) => p!.id);
  if (changes.length) {
    await notify(ctx, {
      userIds: watchers,
      workspaceId: ticket.workspaceId,
      kind: "status",
      targetKey: targetKey("ticket", ticket._id),
      title: `T-${ticket.number} ${next.status ? `→ ${next.status.replace("_", " ")}` : "updated"}`,
      actor: principalOf(actor),
    });
  }
  return { id: ticket._id, key: ticketKey(ticket) };
}

export async function linkTicket(
  ctx: MutationCtx,
  actor: Actor,
  ticketId: Id<"tickets">,
  taskId: Id<"tasks">,
  relation: "implements" | "duplicates" | "relates",
) {
  const { ticket } = await requireTicket(ctx, actor, ticketId, "comment");
  const task = await ctx.db.get(taskId);
  if (!task) return fail("not_found", "Task not found.");
  // Linking is allowed with comment access, so partners can point a ticket at a synced task.
  await requireProject(ctx, actor, task!.projectId, "comment");
  if (task!.workspaceId !== ticket.workspaceId) fail("invalid", "That task is in another workspace.");
  const existing = await ctx.db.query("ticketLinks").withIndex("by_ticket", (q) => q.eq("ticketId", ticketId)).collect();
  const same = existing.find((l) => l.taskId === taskId);
  if (same) await ctx.db.patch(same._id, { relation });
  else await ctx.db.insert("ticketLinks", { ticketId, taskId, relation });
  await logActivity(ctx, {
    workspaceId: ticket.workspaceId,
    projectId: task!.projectId,
    targetKey: targetKey("ticket", ticketId),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "linked",
    to: `task:${taskId}`,
    note: relation,
  });
}

export async function unlinkTicket(ctx: MutationCtx, actor: Actor, linkId: Id<"ticketLinks">) {
  const link = await ctx.db.get(linkId);
  if (!link) return;
  await requireTicket(ctx, actor, link.ticketId, "comment");
  await ctx.db.delete(linkId);
}

export async function deleteTicket(ctx: MutationCtx, actor: Actor, ticketId: Id<"tickets">) {
  const { ticket, perms } = await requireTicket(ctx, actor, ticketId);
  if (!perms.manage && ticket.reporter.id !== actor.id) fail("forbidden", "Only the reporter or a project lead can delete a ticket.");
  for (const l of await ctx.db.query("ticketLinks").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).collect()) await ctx.db.delete(l._id);
  for (const c of await ctx.db.query("comments").withIndex("by_target", (q) => q.eq("targetKey", targetKey("ticket", ticket._id))).collect()) await ctx.db.delete(c._id);
  await ctx.db.delete(ticket._id);
  await logActivity(ctx, {
    workspaceId: ticket.workspaceId,
    projectId: ticket.projectId,
    targetKey: targetKey("ticket", ticket._id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "deleted",
    note: `${ticketKey(ticket)} ${ticket.title}`,
  });
}
