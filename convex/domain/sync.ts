/**
 * Source-agnostic, one-way mirror: an agent pushes a source's records into a
 * project, keyed by external ID. Mirrored records are read-only in the app
 * (`managedBy`). Pushing the same content twice writes nothing.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  type AgentActor,
  fail,
  projectPerms,
  requireProject,
  requireScope,
  sha256,
  targetKey,
} from "../lib/access";
import { logActivity } from "../lib/activity";
import { vPriority, vTaskType } from "../schema";
import { replaceDeps, requireStatus } from "./tasks";

export const MAX_ITEMS = 200;

const vSection = v.object({
  entity: v.literal("section"),
  externalId: v.string(),
  parentExternalId: v.optional(v.string()),
  fields: v.object({
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    doc: v.optional(v.string()),
    order: v.optional(v.number()),
  }),
});

const vMilestone = v.object({
  entity: v.literal("milestone"),
  externalId: v.string(),
  fields: v.object({
    key: v.string(),
    name: v.string(),
    goal: v.optional(v.string()),
    exitCriteria: v.optional(v.string()),
    order: v.optional(v.number()),
    agentHours: v.optional(v.union(v.number(), v.null())),
    estimateNote: v.optional(v.string()),
    track: v.optional(v.string()),
    unplanned: v.optional(v.boolean()),
  }),
});

const vTask = v.object({
  entity: v.literal("task"),
  externalId: v.string(),
  sectionExternalId: v.optional(v.string()),
  milestoneExternalId: v.optional(v.string()),
  fields: v.object({
    title: v.string(),
    status: v.string(),
    type: v.optional(vTaskType),
    priority: v.optional(vPriority),
    description: v.optional(v.string()),
    estimateDays: v.optional(v.union(v.number(), v.null())),
    acceptance: v.optional(v.string()),
    evidence: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    context: v.optional(v.string()),
    instructions: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    rank: v.optional(v.number()),
    /** False for items the source does not count as planned work. */
    countsTowardProgress: v.optional(v.boolean()),
  }),
});

/** Replaces a task's dependencies. Sent after the tasks, so every target exists. */
const vDeps = v.object({
  entity: v.literal("deps"),
  taskExternalId: v.string(),
  dependsOn: v.array(v.string()),
});

/** A history entry from the source. Imported once, never updated. */
const vEvent = v.object({
  entity: v.literal("event"),
  externalId: v.string(),
  taskExternalId: v.string(),
  fields: v.object({
    at: v.number(),
    actor: v.string(),
    action: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    note: v.optional(v.string()),
  }),
});

export const vSyncItem = v.union(vSection, vMilestone, vTask, vDeps, vEvent);
export type SyncItem = Infer<typeof vSyncItem>;

type Result = {
  created: number;
  updated: number;
  unchanged: number;
  errors: { externalId: string; message: string }[];
  keys: Record<string, string>;
};

/** Stable JSON, so the same content always hashes the same. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") {
    return `{${Object.keys(x)
      .sort()
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

async function refOf(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  source: string,
  entityType: Doc<"externalRefs">["entityType"],
  externalId: string,
) {
  return ctx.db
    .query("externalRefs")
    .withIndex("by_key", (q) =>
      q.eq("projectId", projectId).eq("source", source).eq("entityType", entityType).eq("externalId", externalId),
    )
    .unique();
}

export async function requireSyncSource(actor: AgentActor) {
  requireScope(actor, "sync");
  if (!actor.source) fail("forbidden", "This token is not bound to a sync source. Create a token with a source name.");
  return actor.source!;
}

export async function push(
  ctx: MutationCtx,
  actor: AgentActor,
  input: { projectId: Id<"projects">; items: SyncItem[]; dryRun?: boolean; logChanges?: boolean; sourceLabel?: string },
) {
  const source = await requireSyncSource(actor);
  const { project } = await requireProject(ctx, actor, input.projectId, "read");
  if (project.archivedAt) fail("archived", "This project is archived and read-only.");
  if (project.contract) fail("invalid", "This project follows the work contract and is worked in directly. It cannot also be a mirror.");
  if (input.items.length > MAX_ITEMS) fail("invalid", `Send at most ${MAX_ITEMS} items per call.`);
  const dry = !!input.dryRun;
  const now = Date.now();
  const res: Result = { created: 0, updated: 0, unchanged: 0, errors: [], keys: {} };
  const actorP = { kind: "agent" as const, id: actor.id, name: actor.name };
  const log = input.logChanges ?? true;
  let taskSeq = project.taskSeq;

  const idOf = async (type: Doc<"externalRefs">["entityType"], externalId?: string) => {
    if (!externalId) return undefined;
    const r = await refOf(ctx, project._id, source, type, externalId);
    return r?.entityId;
  };

  for (const item of input.items) {
    const externalId = item.entity === "deps" ? item.taskExternalId : item.externalId;
    try {
      if (item.entity === "deps") {
        const taskId = (await idOf("task", item.taskExternalId)) as Id<"tasks"> | undefined;
        if (!taskId) throw new Error(`Unknown task ${item.taskExternalId}.`);
        const ids: Id<"tasks">[] = [];
        for (const d of item.dependsOn) {
          const id = (await idOf("task", d)) as Id<"tasks"> | undefined;
          if (!id) throw new Error(`Unknown dependency ${d}.`);
          ids.push(id);
        }
        const task = await ctx.db.get(taskId);
        if (!task) throw new Error(`Task ${item.taskExternalId} was deleted.`);
        const have = (await ctx.db.query("taskDeps").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect())
          .map((d) => d.dependsOnId as string)
          .sort();
        if (stable(have) === stable([...new Set(ids as string[])].sort())) res.unchanged++;
        else {
          res.updated++;
          if (!dry) await replaceDeps(ctx, task, ids);
        }
        continue;
      }

      const hash = await sha256(stable(item));
      const existing = await refOf(ctx, project._id, source, item.entity, item.externalId);
      // Events are history: once imported they never change.
      if (existing && (existing.contentHash === hash || item.entity === "event")) {
        res.unchanged++;
        if (item.entity === "task") {
          const t = await ctx.db.get(existing.entityId as Id<"tasks">);
          if (t) res.keys[item.externalId] = `${project.key}-${t.number}`;
        }
        continue;
      }
      if (dry) {
        if (existing) res.updated++;
        else res.created++;
        continue;
      }

      let entityId: string;
      if (item.entity === "section") {
        const parentId = (await idOf("section", item.parentExternalId)) as Id<"sections"> | undefined;
        if (item.parentExternalId && !parentId) throw new Error(`Unknown parent section ${item.parentExternalId}.`);
        const doc = {
          projectId: project._id,
          parentId,
          key: item.fields.key,
          name: item.fields.name.slice(0, 120),
          description: (item.fields.description ?? "").slice(0, 2000),
          doc: item.fields.doc,
          order: item.fields.order ?? 0,
          managedBy: source,
        };
        if (existing) {
          entityId = existing.entityId;
          await ctx.db.patch(entityId as Id<"sections">, doc);
        } else entityId = await ctx.db.insert("sections", doc);
      } else if (item.entity === "milestone") {
        const doc = {
          projectId: project._id,
          key: item.fields.key,
          name: item.fields.name.slice(0, 120),
          goal: (item.fields.goal ?? "").slice(0, 2000),
          exitCriteria: (item.fields.exitCriteria ?? "").slice(0, 2000),
          order: item.fields.order ?? 0,
          agentHours: typeof item.fields.agentHours === "number" && item.fields.agentHours >= 0 ? item.fields.agentHours : undefined,
          estimateNote: item.fields.estimateNote?.slice(0, 1000) || undefined,
          track: item.fields.track?.trim().slice(0, 40) || undefined,
          unplanned: item.fields.unplanned || undefined,
          managedBy: source,
        };
        if (existing) {
          entityId = existing.entityId;
          await ctx.db.patch(entityId as Id<"milestones">, doc);
        } else entityId = await ctx.db.insert("milestones", doc);
      } else if (item.entity === "task") {
        requireStatus(project, item.fields.status);
        const sectionId = (await idOf("section", item.sectionExternalId)) as Id<"sections"> | undefined;
        const milestoneId = (await idOf("milestone", item.milestoneExternalId)) as Id<"milestones"> | undefined;
        const f = item.fields;
        const fields = {
          alias: item.externalId,
          title: f.title.slice(0, 300) || item.externalId,
          description: (f.description ?? "").slice(0, 50_000),
          status: f.status,
          type: f.type ?? "task",
          priority: f.priority ?? "none",
          sectionId,
          milestoneId,
          estimateDays: f.estimateDays ?? undefined,
          acceptance: (f.acceptance ?? "").slice(0, 5000),
          evidence: (f.evidence ?? "").slice(0, 5000),
          commitSha: (f.commitSha ?? "").slice(0, 64),
          context: f.context?.slice(0, 20_000),
          instructions: f.instructions?.slice(0, 20_000),
          labels: (f.labels ?? []).slice(0, 20),
          excludeFromProgress: f.countsTowardProgress === false ? true : undefined,
          managedBy: source,
          updatedAt: now,
        };
        if (existing) {
          entityId = existing.entityId;
          const before = await ctx.db.get(entityId as Id<"tasks">);
          if (!before) throw new Error("Mirrored task was deleted in the app.");
          await ctx.db.patch(before._id, { ...fields, rank: f.rank ?? before.rank, version: before.version + 1 });
          res.keys[item.externalId] = `${project.key}-${before.number}`;
          if (log && before.status !== f.status) {
            await logActivity(ctx, {
              workspaceId: project.workspaceId,
              projectId: project._id,
              targetKey: targetKey("task", before._id),
              actor: actorP,
              origin: source,
              action: "status",
              from: before.status,
              to: f.status,
            });
          }
        } else {
          taskSeq++;
          entityId = await ctx.db.insert("tasks", {
            ...fields,
            workspaceId: project.workspaceId,
            projectId: project._id,
            number: taskSeq,
            assignees: [],
            rank: f.rank ?? taskSeq * 1000,
            ingest: { state: "exempt" },
            createdBy: actorP,
            version: 1,
          });
          res.keys[item.externalId] = `${project.key}-${taskSeq}`;
          if (log) {
            await logActivity(ctx, {
              workspaceId: project.workspaceId,
              projectId: project._id,
              targetKey: targetKey("task", entityId),
              actor: actorP,
              origin: source,
              action: "created",
              to: f.status,
              note: f.title,
            });
          }
        }
      } else {
        // event
        const taskId = (await idOf("task", item.taskExternalId)) as Id<"tasks"> | undefined;
        if (!taskId) throw new Error(`Unknown task ${item.taskExternalId}.`);
        const f = item.fields;
        await logActivity(ctx, {
          workspaceId: project.workspaceId,
          projectId: project._id,
          targetKey: targetKey("task", taskId),
          actor: { kind: "agent", id: actor.id, name: `${f.actor.slice(0, 40)} · ${source}` },
          origin: source,
          action: f.action.slice(0, 40),
          from: f.from ?? undefined,
          to: f.to ?? undefined,
          note: f.note?.slice(0, 2000),
          at: f.at,
        });
        entityId = taskId;
      }

      if (existing) await ctx.db.patch(existing._id, { contentHash: hash, lastSyncedAt: now, entityId });
      else {
        await ctx.db.insert("externalRefs", {
          workspaceId: project.workspaceId,
          projectId: project._id,
          source,
          entityType: item.entity,
          externalId: item.externalId,
          entityId,
          contentHash: hash,
          lastSyncedAt: now,
        });
      }
      if (existing) res.updated++;
      else res.created++;
    } catch (e) {
      res.errors.push({ externalId, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!dry) {
    if (taskSeq !== project.taskSeq) await ctx.db.patch(project._id, { taskSeq });
    const src = await ctx.db
      .query("syncSources")
      .withIndex("by_project_name", (q) => q.eq("projectId", project._id).eq("name", source))
      .unique();
    if (src) await ctx.db.patch(src._id, { lastPushAt: now, ...(input.sourceLabel ? { label: input.sourceLabel } : {}) });
    else {
      await ctx.db.insert("syncSources", {
        workspaceId: project.workspaceId,
        projectId: project._id,
        name: source,
        label: input.sourceLabel ?? source,
        lastPushAt: now,
      });
    }
  }
  return { source, dryRun: dry, ...res };
}

/**
 * Changes after `cursor`, in order. Changes that came from the caller's own
 * source are left out so a bridge never sees its own writes echoed back.
 */
export async function changes(
  ctx: QueryCtx,
  actor: AgentActor,
  input: { cursor?: number; projectId?: Id<"projects">; limit?: number },
) {
  requireScope(actor, "read");
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const after = input.cursor ?? 0;
  let rows: Doc<"activity">[];
  if (input.projectId) {
    await requireProject(ctx, actor, input.projectId, "read");
    rows = await ctx.db
      .query("activity")
      .withIndex("by_project_seq", (q) => q.eq("projectId", input.projectId).gt("seq", after))
      .take(limit);
  } else {
    rows = await ctx.db
      .query("activity")
      .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", actor.workspaceId).gt("seq", after))
      .take(limit);
  }
  const readable = new Map<string, boolean>();
  const out = [];
  for (const a of rows) {
    if (a.projectId && !readable.has(a.projectId)) {
      const p = await ctx.db.get(a.projectId);
      readable.set(a.projectId, !!p && (await projectPerms(ctx, actor, p)).read);
    }
    if (a.projectId && !readable.get(a.projectId)) continue;
    if (actor.source && a.origin === actor.source) continue;
    out.push({
      seq: a.seq,
      at: a.at,
      target: a.targetKey,
      actor: a.actor,
      origin: a.origin,
      action: a.action,
      from: a.from ?? null,
      to: a.to ?? null,
      untrusted_content: a.note ?? null,
    });
  }
  const cursor = rows.length ? rows[rows.length - 1].seq : after;
  return { cursor, hasMore: rows.length === limit, changes: out };
}
