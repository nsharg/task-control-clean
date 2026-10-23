import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { agentToken, world } from "./setup";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e?.data?.code as string) ?? String(e));

const items = [
  { entity: "section" as const, externalId: "area:sm", fields: { key: "sm", name: "Stage machine" } },
  { entity: "section" as const, externalId: "phase:sm/core", parentExternalId: "area:sm", fields: { key: "core", name: "Core" } },
  { entity: "milestone" as const, externalId: "M0", fields: { key: "M0", name: "Hygiene" } },
  { entity: "task" as const, externalId: "SM-01", sectionExternalId: "phase:sm/core", milestoneExternalId: "M0", fields: { title: "intake stage", status: "done" } },
  { entity: "task" as const, externalId: "SM-02", sectionExternalId: "phase:sm/core", fields: { title: "brief stage", status: "todo" } },
  { entity: "deps" as const, taskExternalId: "SM-02", dependsOn: ["SM-01"] },
  { entity: "event" as const, externalId: "ev1", taskExternalId: "SM-01", fields: { at: 1, actor: "claude", action: "status", from: "todo", to: "done" } },
];

describe("sync", () => {
  test("push is idempotent and dry runs write nothing", async () => {
    const { t, workspaceId } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    const dry = await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items, dryRun: true });
    expect(dry.created).toBeGreaterThan(0);
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(0);

    const first = await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items });
    expect(first.errors).toEqual([]);
    expect(first.created).toBe(6);
    expect(first.keys["SM-01"]).toBe("DEMO-1");

    const second = await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items });
    expect(second.created + second.updated).toBe(0);
    expect(second.unchanged).toBe(items.length);
  });

  test("mirrored tasks are read-only in the app but open to comments", async () => {
    const { t, workspaceId, owner, guest } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items });
    const task = await t.run((ctx) => ctx.db.query("tasks").first());
    expect(await code(owner.as.mutation(api.tasks.update, { taskId: task!._id, patch: { status: "todo" } }))).toBe("managed");
    expect(await code(guest.as.mutation(api.comments.add, { target: { type: "task", id: task!._id }, body: "When will this ship?" }))).toBe("ok");
    // Another agent with write scope but a different source cannot edit it either.
    const other = await agentToken(t, workspaceId, { scopes: ["read", "write"], name: "other" });
    expect(await code(t.mutation(api.agent.api.updateTask, { token: other, projectKey: "DEMO", ref: "SM-01", patch: { title: "x" } }))).toBe("managed");
  });

  test("sync needs a token bound to a source", async () => {
    const { t, workspaceId } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"] });
    expect(await code(t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items }))).toBe("forbidden");
  });

  test("the change feed leaves out the caller's own source", async () => {
    const { t, workspaceId, guest, p1 } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    await t.mutation(api.agent.api.syncPush, { token, projectKey: "DEMO", items });
    await guest.as.mutation(api.tasks.create, { projectId: p1, title: "partner idea" });
    const feed = await t.query(api.agent.api.syncChanges, { token, projectKey: "DEMO" });
    expect(feed.changes.every((c) => c.origin !== "example-tracker")).toBe(true);
    expect(feed.changes.some((c) => c.action === "created" && c.origin === "app")).toBe(true);
  });
});

describe("ingest", () => {
  test("claim, lease and finish", async () => {
    const { t, workspaceId, guest, p1 } = await world();
    const a = await agentToken(t, workspaceId, { scopes: ["read", "ingest", "comment"], name: "laptop" });
    const b = await agentToken(t, workspaceId, { scopes: ["read", "ingest"], name: "other" });
    const { id } = await guest.as.mutation(api.tasks.create, { projectId: p1, title: "Add CSV export" });
    const pending = await t.query(api.agent.api.ingestPending, { token: a });
    expect(pending.items.map((i) => i.kind)).toEqual(["task"]);
    expect(pending.items[0].untrusted_content).toMatchObject({ title: "Add CSV export" });

    const ref = { type: "task" as const, id };
    expect((await t.mutation(api.agent.api.ingestClaim, { token: a, refs: [ref] })).claimed).toHaveLength(1);
    expect((await t.mutation(api.agent.api.ingestClaim, { token: b, refs: [ref] })).claimed).toHaveLength(0);
    expect(await code(t.mutation(api.agent.api.ingestDone, { token: b, ref, upstreamRef: "X-1" }))).toBe("invalid");

    await t.mutation(api.agent.api.ingestDone, { token: a, ref, upstreamRef: "FINDING-35" });
    const after = await t.run(async (ctx) => ({
      task: await ctx.db.get(id),
      comments: await ctx.db.query("comments").collect(),
      notes: await ctx.db.query("notifications").collect(),
    }));
    expect(after.task!.ingest).toMatchObject({ state: "done", ref: "FINDING-35" });
    expect(after.comments[0]).toMatchObject({ body: "Picked up as FINDING-35.", ingest: { state: "exempt" } });
    expect(after.notes.some((n) => n.kind === "ingested" && n.userId === guest.id)).toBe(true);
    expect((await t.query(api.agent.api.ingestPending, { token: a })).items).toHaveLength(0);
  });

  test("an expired lease can be claimed again", async () => {
    const { t, workspaceId, guest, p1 } = await world();
    const a = await agentToken(t, workspaceId, { scopes: ["read", "ingest"], name: "a" });
    const b = await agentToken(t, workspaceId, { scopes: ["read", "ingest"], name: "b" });
    const { id } = await guest.as.mutation(api.tasks.create, { projectId: p1, title: "x" });
    await t.mutation(api.agent.api.ingestClaim, { token: a, refs: [{ type: "task", id }] });
    await t.run((ctx) => ctx.db.patch(id, { ingest: { state: "claimed", claimedBy: "someone", leaseUntil: Date.now() - 1 } }));
    expect((await t.mutation(api.agent.api.ingestClaim, { token: b, refs: [{ type: "task", id }] })).claimed).toHaveLength(1);
  });
});
