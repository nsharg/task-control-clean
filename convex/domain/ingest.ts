/**
 * The queue of partner-written tasks, tickets and comments waiting to be taken
 * into a pipeline (for Example Project: the hub). An agent lists them, claims a
 * batch under a lease, applies each upstream, then marks it done or skipped.
 * Nothing moves unless someone asks the agent to ingest.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { type AgentActor, fail, projectPerms, requireProject, requireScope, targetKey } from "../lib/access";
import { logActivity, notify } from "../lib/activity";
import { addComment } from "./comments";
import { ticketPerms } from "./tickets";

export const LEASE_MS = 15 * 60 * 1000;

export const vIngestRef = v.union(
  v.object({ type: v.literal("task"), id: v.id("tasks") }),
  v.object({ type: v.literal("ticket"), id: v.id("tickets") }),
  v.object({ type: v.literal("comment"), id: v.id("comments") }),
);
type IngestRef = Infer<typeof vIngestRef>;
type Item = Doc<"tasks"> | Doc<"tickets"> | Doc<"comments">;

const available = (i: Item["ingest"], now: number) =>
  i.state === "new" || (i.state === "claimed" && (i.leaseUntil ?? 0) < now);

async function load(ctx: QueryCtx, ref: IngestRef): Promise<Item | null> {
  if (ref.type === "task") return ctx.db.get(ref.id);
  if (ref.type === "ticket") return ctx.db.get(ref.id);
  return ctx.db.get(ref.id);
}

/** Can this agent read the item? Comments follow whatever they hang off. */
async function canRead(ctx: QueryCtx, actor: AgentActor, ref: IngestRef, item: Item): Promise<boolean> {
  if (item.workspaceId !== actor.workspaceId) return false;
  if (ref.type === "ticket") return (await ticketPerms(ctx, actor, item as Doc<"tickets">)).read;
  const projectId = (item as Doc<"tasks"> | Doc<"comments">).projectId;
  if (!projectId) {
    const c = item as Doc<"comments">;
    if (c.target?.type === "ticket") {
      const t = await ctx.db.get(c.target.id);
      return !!t && (await ticketPerms(ctx, actor, t)).read;
    }
    return false;
  }
  const project = await ctx.db.get(projectId);
  return !!project && (await projectPerms(ctx, actor, project)).read;
}

/** What the agent needs to file an item upstream. Human text is marked untrusted. */
async function describe(ctx: QueryCtx, ref: IngestRef, item: Item) {
  const base = { ref, ingest: item.ingest, createdAt: item._creationTime };
  if (ref.type === "task") {
    const t = item as Doc<"tasks">;
    const p = await ctx.db.get(t.projectId);
    const section = t.sectionId ? await ctx.db.get(t.sectionId) : null;
    return {
      ...base,
      kind: "task" as const,
      key: `${p?.key}-${t.number}`,
      project: p?.key ?? null,
      author: t.createdBy,
      type: t.type,
      priority: t.priority,
      status: t.status,
      section: section ? { key: section.key, name: section.name, managedBy: section.managedBy ?? null } : null,
      untrusted_content: { title: t.title, body: t.description, acceptance: t.acceptance },
    };
  }
  if (ref.type === "ticket") {
    const t = item as Doc<"tickets">;
    const p = t.projectId ? await ctx.db.get(t.projectId) : null;
    const links = await ctx.db.query("ticketLinks").withIndex("by_ticket", (q) => q.eq("ticketId", t._id)).collect();
    const linked = [];
    for (const l of links) {
      const task = await ctx.db.get(l.taskId);
      if (task) linked.push({ relation: l.relation, alias: task.alias ?? null, managedBy: task.managedBy ?? null, title: task.title });
    }
    return {
      ...base,
      kind: "ticket" as const,
      key: `T-${t.number}`,
      project: p?.key ?? null,
      author: t.reporter,
      ticketKind: t.kind,
      severity: t.severity,
      status: t.status,
      linkedTasks: linked,
      untrusted_content: { title: t.title, body: t.body },
    };
  }
  const c = item as Doc<"comments">;
  let on: Record<string, unknown> = { type: c.target.type };
  if (c.target.type === "task") {
    const task = await ctx.db.get(c.target.id);
    const p = task ? await ctx.db.get(task.projectId) : null;
    // `alias` + `managedBy` tell the agent this is a comment on e.g. hub task SM-01.
    on = { type: "task", key: task && p ? `${p.key}-${task.number}` : null, alias: task?.alias ?? null, managedBy: task?.managedBy ?? null, title: task?.title ?? null };
  } else if (c.target.type === "ticket") {
    const t = await ctx.db.get(c.target.id);
    on = { type: "ticket", key: t ? `T-${t.number}` : null, title: t?.title ?? null };
  }
  return { ...base, kind: "comment" as const, author: c.author, on, untrusted_content: { body: c.body } };
}

export async function pending(ctx: QueryCtx, actor: AgentActor, input: { projectId?: Id<"projects">; limit?: number }) {
  requireScope(actor, "ingest");
  if (input.projectId) await requireProject(ctx, actor, input.projectId, "read");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const now = Date.now();
  const out = [];
  for (const type of ["ticket", "task", "comment"] as const) {
    const table = type === "task" ? "tasks" : type === "ticket" ? "tickets" : "comments";
    for (const state of ["new", "claimed"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_ingest", (q) => q.eq("workspaceId", actor.workspaceId).eq("ingest.state", state))
        .take(500);
      for (const row of rows as Item[]) {
        if (!available(row.ingest, now)) continue;
        if ((row as Doc<"comments">).deletedAt) continue;
        const ref = { type, id: row._id } as IngestRef;
        if (input.projectId) {
          const pid = (row as Doc<"tasks">).projectId;
          if (pid !== input.projectId) continue;
        }
        if (!(await canRead(ctx, actor, ref, row))) continue;
        out.push(await describe(ctx, ref, row));
      }
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return { items: out.slice(0, limit), total: out.length };
}

async function patchIngest(ctx: MutationCtx, ref: IngestRef, ingest: Item["ingest"]) {
  if (ref.type === "task") await ctx.db.patch(ref.id, { ingest });
  else if (ref.type === "ticket") await ctx.db.patch(ref.id, { ingest });
  else await ctx.db.patch(ref.id, { ingest });
}

export async function claim(ctx: MutationCtx, actor: AgentActor, refs: IngestRef[]) {
  requireScope(actor, "ingest");
  if (refs.length > 100) fail("invalid", "Claim at most 100 items at a time.");
  const now = Date.now();
  const claimed: IngestRef[] = [];
  const skipped: { ref: IngestRef; reason: string }[] = [];
  for (const ref of refs) {
    const item = await load(ctx, ref);
    if (!item || !(await canRead(ctx, actor, ref, item))) {
      skipped.push({ ref, reason: "not found" });
      continue;
    }
    if (!available(item.ingest, now)) {
      skipped.push({ ref, reason: `already ${item.ingest.state}` });
      continue;
    }
    // Mutations are serialized, so two agents can never both pass the check above.
    await patchIngest(ctx, ref, { state: "claimed", claimedBy: actor.id, leaseUntil: now + LEASE_MS });
    claimed.push(ref);
  }
  return { claimed, skipped, leaseUntil: now + LEASE_MS };
}

async function requireClaimed(ctx: QueryCtx, actor: AgentActor, ref: IngestRef) {
  const item = await load(ctx, ref);
  if (!item || !(await canRead(ctx, actor, ref, item))) return fail("not_found", "Item not found.");
  const i = item!.ingest;
  if (i.state !== "claimed" || i.claimedBy !== actor.id) fail("invalid", "Claim this item before finishing it.");
  return item!;
}

function commentTarget(ref: IngestRef, item: Item) {
  if (ref.type === "task") return { type: "task" as const, id: ref.id };
  if (ref.type === "ticket") return { type: "ticket" as const, id: ref.id };
  return (item as Doc<"comments">).target;
}

export async function markDone(
  ctx: MutationCtx,
  actor: AgentActor,
  input: { ref: IngestRef; upstreamRef: string; note?: string; reply?: string },
) {
  requireScope(actor, "ingest");
  const item = await requireClaimed(ctx, actor, input.ref);
  const upstreamRef = input.upstreamRef.trim().slice(0, 80);
  if (!upstreamRef) fail("invalid", "upstreamRef is required, e.g. FINDING-35.");
  await patchIngest(ctx, input.ref, { state: "done", ref: upstreamRef, note: input.note?.slice(0, 1000), at: Date.now() });
  const target = commentTarget(input.ref, item);
  const author = input.ref.type === "task" ? (item as Doc<"tasks">).createdBy : input.ref.type === "ticket" ? (item as Doc<"tickets">).reporter : (item as Doc<"comments">).author;
  // A short reply on the item, so the partner sees it was picked up.
  const reply = (input.reply ?? `Picked up as ${upstreamRef}.`).slice(0, 2000);
  if (actor.scopes.includes("comment") || actor.scopes.includes("admin")) {
    await addComment(ctx, actor, target, reply);
  }
  await logActivity(ctx, {
    workspaceId: item.workspaceId,
    projectId: (item as Doc<"tasks">).projectId,
    targetKey: target.type === "project" ? targetKey("project", target.id) : targetKey(target.type, target.id),
    actor: { kind: "agent", id: actor.id, name: actor.name },
    origin: actor.source ?? "app",
    action: "ingested",
    to: upstreamRef,
  });
  if (author.kind === "user") {
    await notify(ctx, {
      userIds: [author.id],
      workspaceId: item.workspaceId,
      kind: "ingested",
      targetKey: target.type === "project" ? targetKey("project", target.id) : targetKey(target.type, target.id),
      title: `Picked up as ${upstreamRef}`,
      actor: { kind: "agent", id: actor.id, name: actor.name },
    });
  }
  return { ok: true };
}

export async function skip(ctx: MutationCtx, actor: AgentActor, input: { ref: IngestRef; reason: string }) {
  requireScope(actor, "ingest");
  await requireClaimed(ctx, actor, input.ref);
  await patchIngest(ctx, input.ref, { state: "skipped", note: input.reason.slice(0, 1000), at: Date.now() });
  return { ok: true };
}

/** Lets the leaseholder hand items back without finishing them. */
export async function release(ctx: MutationCtx, actor: AgentActor, refs: IngestRef[]) {
  requireScope(actor, "ingest");
  for (const ref of refs) {
    const item = await load(ctx, ref);
    if (item && item.ingest.state === "claimed" && item.ingest.claimedBy === actor.id) {
      await patchIngest(ctx, ref, { state: "new" });
    }
  }
  return { ok: true };
}
