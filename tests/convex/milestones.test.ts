import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { buildOrder } from "../../convex/domain/projects";
import { agentToken, world } from "./setup";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e?.data?.code as string) ?? String(e));

const task = (id: string, rank: number, done = false) =>
  ({ _id: id as Id<"tasks">, rank, number: rank, status: done ? "done" : "todo" }) as Doc<"tasks">;
const edge = (taskId: string, dependsOnId: string) => ({ taskId: taskId as Id<"tasks">, dependsOnId: dependsOnId as Id<"tasks"> });
const settled = (t: Doc<"tasks">) => t.status === "done";

describe("buildOrder", () => {
  test("a dependency comes first even when it ranks later", () => {
    expect(buildOrder([task("a", 1), task("b", 2), task("c", 3)], [edge("a", "c")], settled)).toEqual(["b", "c", "a"]);
  });

  test("a finished dependency holds nothing back", () => {
    expect(buildOrder([task("a", 1), task("c", 3, true)], [edge("a", "c")], settled)).toEqual(["a", "c"]);
  });

  test("a cycle still returns every task", () => {
    expect(buildOrder([task("a", 1), task("b", 2), task("c", 3)], [edge("a", "b"), edge("b", "a")], settled)).toEqual(["c", "a", "b"]);
  });
});

describe("board milestones", () => {
  test("sorted by order then key, tasks in build order, counted split and later-milestone waits", async () => {
    const { t, workspaceId, owner } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    const items = [
      { entity: "milestone" as const, externalId: "MB", fields: { key: "MB", name: "Second", order: 0 } },
      { entity: "milestone" as const, externalId: "MA", fields: { key: "MA", name: "First", order: 0 } },
      { entity: "milestone" as const, externalId: "MZ", fields: { key: "MZ", name: "Last", order: 5 } },
      { entity: "task" as const, externalId: "T1", milestoneExternalId: "MA", fields: { title: "one", status: "todo", rank: 1 } },
      { entity: "task" as const, externalId: "T2", milestoneExternalId: "MA", fields: { title: "two", status: "todo", rank: 2 } },
      { entity: "task" as const, externalId: "T3", milestoneExternalId: "MA", fields: { title: "done", status: "done", rank: 3 } },
      { entity: "task" as const, externalId: "D1", milestoneExternalId: "MA", fields: { title: "decision", status: "todo", countsTowardProgress: false } },
      { entity: "task" as const, externalId: "Z1", milestoneExternalId: "MZ", fields: { title: "later", status: "todo" } },
      { entity: "deps" as const, taskExternalId: "T1", dependsOn: ["T2"] },
      { entity: "deps" as const, taskExternalId: "T2", dependsOn: ["Z1"] },
    ];
    const res = await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items });
    expect(res.errors).toEqual([]);

    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "DEMO" }))!;
    const title = new Map(board.tasks.map((x) => [x.id as string, x.title]));
    expect(board.milestones.map((m) => m.key)).toEqual(["MA", "MB", "MZ"]);
    const ma = board.milestones[0];
    expect(ma.tasks.map((id) => title.get(id))).toEqual(["two", "one", "done"]);
    expect(ma.other.map((id) => title.get(id))).toEqual(["decision"]);
    expect(ma.tasks).toHaveLength(ma.progress.counted);
    expect(ma.waitsOn).toEqual(["MZ"]);
    expect(board.milestones[2].waitsOn).toEqual([]);
  });
});

describe("roadmap fields", () => {
  test("sync stores the estimate; remaining work follows progress; tasks size a milestone without one", async () => {
    const { t, workspaceId, owner } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    const items = [
      { entity: "milestone" as const, externalId: "M0", fields: { key: "M0", name: "Est", agentHours: 40, estimateNote: "two schema changes", track: "Example Service" } },
      { entity: "milestone" as const, externalId: "M1", fields: { key: "M1", name: "Derived", order: 1 } },
      { entity: "task" as const, externalId: "A", milestoneExternalId: "M0", fields: { title: "a", status: "done" } },
      { entity: "task" as const, externalId: "B", milestoneExternalId: "M0", fields: { title: "b", status: "todo" } },
      { entity: "task" as const, externalId: "C", milestoneExternalId: "M1", fields: { title: "c", status: "todo", estimateDays: 4 } },
      { entity: "task" as const, externalId: "D", milestoneExternalId: "M1", fields: { title: "d", status: "todo" } },
    ];
    expect((await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items })).errors).toEqual([]);
    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "DEMO" }))!;
    const [m0, m1] = board.milestones;
    expect(m0).toMatchObject({ agentHours: 40, estimateNote: "two schema changes", track: "Example Service", remainingHours: 20 });
    expect(m0.lastDoneAt).not.toBeNull();
    expect(m1).toMatchObject({ agentHours: null, track: null, remainingHours: 3, derivedHours: 3 });
    expect(board.project.roadmap).toEqual({ hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] });

    // Clearing the estimate at the source clears it here.
    items[0] = { ...items[0], fields: { key: "M0", name: "Est", agentHours: null } as never };
    await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items });
    const again = (await owner.as.query(api.projects.board, { workspaceId, key: "DEMO" }))!;
    expect(again.milestones[0]).toMatchObject({ agentHours: null, track: null, estimateNote: null });

    const status = await t.query(api.agent.api.projectStatus, { token, projectKey: "DEMO" });
    expect(status.milestones[1]).toMatchObject({ key: "M1", remainingHours: 3, estimated: false });
  });

  test("work under way shortens hours left but not % done; an unplanned milestone has none", async () => {
    const { t, workspaceId, owner } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    const items = [
      { entity: "milestone" as const, externalId: "M0", fields: { key: "M0", name: "Est", agentHours: 40 } },
      { entity: "milestone" as const, externalId: "M1", fields: { key: "M1", name: "Derived", order: 1 } },
      { entity: "milestone" as const, externalId: "L", fields: { key: "LATER", name: "Later", order: 2, unplanned: true } },
      { entity: "task" as const, externalId: "A", milestoneExternalId: "M0", fields: { title: "a", status: "in_progress" } },
      { entity: "task" as const, externalId: "B", milestoneExternalId: "M0", fields: { title: "b", status: "review" } },
      { entity: "task" as const, externalId: "C", milestoneExternalId: "M1", fields: { title: "c", status: "in_progress", estimateDays: 4 } },
      { entity: "task" as const, externalId: "D", milestoneExternalId: "M1", fields: { title: "d", status: "todo" } },
      { entity: "task" as const, externalId: "E", milestoneExternalId: "L", fields: { title: "e", status: "todo", estimateDays: 10 } },
    ];
    expect((await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items })).errors).toEqual([]);
    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "DEMO" }))!;
    const [m0, m1, later] = board.milestones;
    // Half credit in progress, 0.8 in review: 40 × (1 − 1.3 / 2).
    expect(m0).toMatchObject({ remainingHours: 14, progress: { percent: 0 } });
    // 4 days × 0.5 h, half spent, plus 1 h for the unestimated task.
    expect(m1).toMatchObject({ remainingHours: 2, derivedHours: 2 });
    expect(later).toMatchObject({ unplanned: true, remainingHours: 0 });

    const status = await t.query(api.agent.api.projectStatus, { token, projectKey: "DEMO" });
    expect(status.milestones[2]).toMatchObject({ key: "LATER", unplanned: true, remainingHours: 0 });
  });

  test("capacity is validated and only project managers may change it", async () => {
    const { owner, member, p1: projectId, workspaceId } = await world();
    await owner.as.mutation(api.projects.update, { projectId, roadmap: { hoursPerDay: 6, workDays: [4, 0, 6, 0] } });
    expect(await code(owner.as.mutation(api.projects.update, { projectId, roadmap: { hoursPerDay: 0, workDays: [0] } }))).toBe("invalid");
    expect(await code(owner.as.mutation(api.projects.update, { projectId, roadmap: { hoursPerDay: 4, workDays: [] } }))).toBe("invalid");
    expect(await code(owner.as.mutation(api.projects.update, { projectId, roadmap: { hoursPerDay: 4, workDays: [7] } }))).toBe("invalid");
    expect(await code(member.as.mutation(api.projects.update, { projectId, roadmap: { hoursPerDay: 8, workDays: [0] } }))).not.toBe("ok");
    const list = await owner.as.query(api.projects.list, { workspaceId });
    expect(list.find((p) => p.key === "DEMO")!.roadmap).toEqual({ hoursPerDay: 6, workDays: [0, 4, 6] });
  });
});
