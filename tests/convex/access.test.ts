import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { agentToken, world } from "./setup";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e?.data?.code as string) ?? String(e));

describe("people", () => {
  test("signed-out callers are refused", async () => {
    const { t, workspaceId } = await world();
    expect(await code(t.query(api.projects.list, { workspaceId }))).toBe("unauthenticated");
  });

  test("outsiders cannot see a workspace", async () => {
    const { outsider, workspaceId } = await world();
    expect(await code(outsider.as.query(api.projects.list, { workspaceId }))).toBe("not_found");
    expect(await outsider.as.query(api.workspaces.bySlug, { slug: "acme" })).toBeNull();
  });

  test("guests see only the projects they were added to", async () => {
    const { guest, member, workspaceId } = await world();
    const guestKeys = (await guest.as.query(api.projects.list, { workspaceId })).map((p) => p.key);
    expect(guestKeys).toEqual(["DEMO"]);
    expect(await code(guest.as.query(api.projects.board, { workspaceId, key: "SEC" }))).toBe("not_found");
    // Members see open projects but not members-only ones.
    const memberKeys = (await member.as.query(api.projects.list, { workspaceId })).map((p) => p.key);
    expect(memberKeys).toEqual(["DEMO"]);
  });

  test("guests can add tasks and tickets and comment on them; they start in the ingest queue", async () => {
    const { guest, workspaceId, p1, t } = await world();
    const { id } = await guest.as.mutation(api.tasks.create, { projectId: p1, title: "Export is slow" });
    await guest.as.mutation(api.comments.add, { target: { type: "task", id }, body: "Seen on Safari too" });
    const tk = await guest.as.mutation(api.tickets.create, { workspaceId, projectId: p1, kind: "bug", title: "Crash on login" });
    const states = await t.run(async (ctx) => [
      (await ctx.db.get(id))!.ingest.state,
      (await ctx.db.get(tk.id))!.ingest.state,
      (await ctx.db.query("comments").first())!.ingest.state,
    ]);
    expect(states).toEqual(["new", "new", "new"]);
  });

  test("closing a ticket closes its comments until it is reopened", async () => {
    const { owner, guest, workspaceId, p1 } = await world();
    const tk = await guest.as.mutation(api.tickets.create, { workspaceId, projectId: p1, kind: "bug", title: "Crash on login" });
    const { id: commentId } = await guest.as.mutation(api.comments.add, { target: { type: "ticket", id: tk.id }, body: "Still happening" });
    await owner.as.mutation(api.tickets.update, { ticketId: tk.id, status: "closed" });
    expect(await code(guest.as.mutation(api.comments.add, { target: { type: "ticket", id: tk.id }, body: "Hello?" }))).toBe("forbidden");
    expect(await code(guest.as.mutation(api.comments.edit, { commentId, body: "Edited" }))).toBe("forbidden");
    await owner.as.mutation(api.tickets.update, { ticketId: tk.id, status: "triaged" });
    expect(await code(guest.as.mutation(api.comments.add, { target: { type: "ticket", id: tk.id }, body: "Hello?" }))).toBe("ok");
  });

  test("tickets can be deleted by their reporter or a lead, not by other members", async () => {
    const { owner, member, guest, workspaceId, p1, t } = await world();
    const tk = await guest.as.mutation(api.tickets.create, { workspaceId, projectId: p1, kind: "bug", title: "Crash on login" });
    await guest.as.mutation(api.comments.add, { target: { type: "ticket", id: tk.id }, body: "Still happening" });
    expect(await code(member.as.mutation(api.tickets.remove, { ticketId: tk.id }))).toBe("forbidden");
    expect(await code(guest.as.mutation(api.tickets.remove, { ticketId: tk.id }))).toBe("ok");
    const left = await t.run(async (ctx) => [await ctx.db.get(tk.id), (await ctx.db.query("comments").collect()).length]);
    expect(left).toEqual([null, 0]);
    const other = await member.as.mutation(api.tickets.create, { workspaceId, projectId: p1, kind: "question", title: "How?" });
    expect(await code(owner.as.mutation(api.tickets.remove, { ticketId: other.id }))).toBe("ok");
  });

  test("guests cannot search their way into other projects", async () => {
    const { owner, guest, workspaceId, p2 } = await world();
    await owner.as.mutation(api.tasks.create, { projectId: p2, title: "classified roadmap" });
    expect(await guest.as.query(api.search.run, { workspaceId, q: "classified" })).toEqual([]);
    expect((await owner.as.query(api.search.run, { workspaceId, q: "classified" })).length).toBe(1);
  });

  test("dependency cycles are refused", async () => {
    const { owner, p1 } = await world();
    const a = await owner.as.mutation(api.tasks.create, { projectId: p1, title: "A" });
    const b = await owner.as.mutation(api.tasks.create, { projectId: p1, title: "B" });
    await owner.as.mutation(api.tasks.setDependencies, { taskId: a.id, dependsOn: [b.id] });
    expect(await code(owner.as.mutation(api.tasks.setDependencies, { taskId: b.id, dependsOn: [a.id] }))).toBe("cycle");
  });
});

describe("accounts", () => {
  test("only the super admin creates workspaces and sees the admin console", async () => {
    const { member, owner } = await world();
    expect(await code(member.as.mutation(api.workspaces.create, { name: "Mine" }))).toBe("forbidden");
    expect(await code(member.as.query(api.admin.users, {}))).toBe("forbidden");
    expect((await owner.as.query(api.admin.users, {})).length).toBe(4);
  });

  test("an admin-issued password must be changed before anything else works", async () => {
    const { t, member, workspaceId } = await world();
    await t.run((ctx) => ctx.db.insert("profiles", { userId: member.id, mustChangePassword: true }));
    expect(await code(member.as.query(api.projects.list, { workspaceId }))).toBe("password_change_required");
    expect((await member.as.query(api.admin.me, {})).mustChangePassword).toBe(true);
  });

  test("disabled accounts are refused everywhere", async () => {
    const { t, member, workspaceId } = await world();
    await t.run((ctx) => ctx.db.insert("profiles", { userId: member.id, mustChangePassword: false, disabledAt: Date.now() }));
    expect(await code(member.as.query(api.projects.list, { workspaceId }))).toBe("unauthenticated");
    expect(await code(member.as.query(api.admin.me, {}))).toBe("unauthenticated");
  });
});

describe("agents", () => {
  test("bad, revoked and wrong-scope tokens are refused", async () => {
    const { t, workspaceId } = await world();
    expect(await code(t.query(api.agent.api.whoami, { token: "tc_nope" }))).toBe("unauthenticated");
    const revoked = await agentToken(t, workspaceId, { scopes: ["read"], revoked: true });
    expect(await code(t.query(api.agent.api.whoami, { token: revoked }))).toBe("unauthenticated");
    const read = await agentToken(t, workspaceId, { scopes: ["read"] });
    expect(await code(t.mutation(api.agent.api.createTask, { token: read, projectKey: "DEMO", title: "x" }))).toBe("forbidden");
    expect(await code(t.query(api.agent.api.ingestPending, { token: read }))).toBe("forbidden");
  });

  test("a project allowlist hides other projects", async () => {
    const { t, workspaceId, p1 } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read"], projectIds: [p1] });
    const keys = (await t.query(api.agent.api.listProjects, { token })).map((p) => p.key);
    expect(keys).toEqual(["DEMO"]);
    expect(await code(t.query(api.agent.api.projectStatus, { token, projectKey: "SEC" }))).toBe("not_found");
  });
});
