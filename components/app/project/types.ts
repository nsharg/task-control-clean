import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Category, StatusDef } from "@/components/ui/status";
import { schedule } from "@/lib/roadmap";

export type BoardData = FunctionReturnType<typeof api.projects.board>;
export type TaskItem = BoardData["tasks"][number];

export function categoryOf(statuses: StatusDef[]) {
  const m = new Map(statuses.map((s) => [s.key, s.category]));
  return (key: string): Category => m.get(key) ?? "backlog";
}

/** Each milestone's ship date at the project's roadmap capacity, as the roadmap draws it. Unplanned milestones get no slot. */
export function planOf(board: BoardData, now = Date.now()) {
  return schedule(
    board.milestones.filter((m) => !m.unplanned).map((m) => ({
      id: m.id,
      track: m.track,
      remainingHours: m.remainingHours,
      shipped: m.closedAt !== null || (m.progress.counted > 0 && m.progress.done === m.progress.counted),
      startedAt: m.startedAt,
      lastDoneAt: m.lastDoneAt,
    })),
    board.project.roadmap,
    now,
  );
}

/** Findings and ideas: recorded, not work. */
export const isNoteType = (type: string) => type === "finding" || type === "idea";
/** A top-level row of work in a contract project: the unit a person accepts. */
export const isFeatureItem = (t: Pick<TaskItem, "parentTaskId" | "type">) => !t.parentTaskId && !isNoteType(t.type);

/** The tasks and notes under each feature, in build order. */
export function childrenOf(tasks: TaskItem[]) {
  const m = new Map<string, TaskItem[]>();
  for (const t of [...tasks].sort((a, b) => a.rank - b.rank)) if (t.parentTaskId) m.set(t.parentTaskId, [...(m.get(t.parentTaskId) ?? []), t]);
  return m;
}
