import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { Principal } from "./access";

/**
 * Appends to the activity log, the audit trail and the sync change feed.
 * `seq` comes from a per-workspace counter so `sync.changes` can page by it.
 */
export async function logActivity(
  ctx: MutationCtx,
  e: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"projects">;
    targetKey: string;
    actor: Principal;
    origin: string;
    action: string;
    from?: string;
    to?: string;
    note?: string;
    at?: number;
  },
) {
  const ws = await ctx.db.get(e.workspaceId);
  if (!ws) return;
  const seq = ws.seq + 1;
  await ctx.db.patch(e.workspaceId, { seq });
  await ctx.db.insert("activity", { ...e, seq, at: e.at ?? Date.now() });
}

export async function notify(
  ctx: MutationCtx,
  n: {
    userIds: string[];
    workspaceId: Id<"workspaces">;
    kind: "mention" | "assigned" | "comment" | "status" | "ticket" | "ingested";
    targetKey: string;
    title: string;
    actor: Principal;
  },
) {
  const { userIds, ...rest } = n;
  for (const userId of new Set(userIds)) {
    if (userId === n.actor.id) continue;
    await ctx.db.insert("notifications", { ...rest, userId });
  }
}
