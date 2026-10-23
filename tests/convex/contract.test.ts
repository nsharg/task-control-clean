import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { agentToken, world } from "./setup";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e?.data?.code as string) ?? String(e));
const ACCEPT = "1. On the notebook page, press Add: the form opens.\n2. Saving adds exactly one note to the notebook.";

/** A contract project `WRK` with one milestone `M1`, and an agent token that can write to it. */
async function contractWorld() {
  const w = await world();
  const { id: projectId } = await w.owner.as.mutation(api.projects.create, { workspaceId: w.workspaceId, key: "WRK", name: "Work", contract: true });
  const m1 = await w.owner.as.mutation(api.projects.upsertMilestone, { projectId, key: "M1", name: "First" });
  const token = await agentToken(w.t, w.workspaceId, { scopes: ["read", "write", "comment"], name: "Claude Code" });
  const status = async (key: string) => (await w.t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: key })).status;
  const feature = (title: string, extra: Record<string, unknown> = {}) =>
    w.t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title, milestone: "M1", acceptance: ACCEPT, origin: "owner, in chat", ...extra });
  return { ...w, projectId, m1: m1.id, token, status, feature };
}

describe("milestones", () => {
  test("a manager creates and edits them; others cannot; keys are unique", async () => {
    const { owner, member, projectId, workspaceId } = await contractWorld();
    expect(await code(member.as.mutation(api.projects.upsertMilestone, { projectId, key: "M2", name: "Second" }))).toBe("forbidden");
    expect(await code(owner.as.mutation(api.projects.upsertMilestone, { projectId, key: "M1", name: "Again" }))).toBe("invalid");
    expect(await code(owner.as.mutation(api.projects.upsertMilestone, { projectId, key: "2x", name: "Bad key" }))).toBe("invalid");
    const m2 = await owner.as.mutation(api.projects.upsertMilestone, { projectId, key: "m2", name: "Second", goal: "Users can organize notes", agentHours: 40, track: "Example Service" });
    await owner.as.mutation(api.projects.upsertMilestone, { projectId, id: m2.id, name: "Second, renamed" });
    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "WRK" }))!;
    expect(board.milestones.map((m) => [m.key, m.name, m.agentHours, m.track])).toEqual([
      ["M1", "First", null, null],
      ["M2", "Second, renamed", 40, "Example Service"],
    ]);
    await owner.as.mutation(api.projects.removeMilestone, { milestoneId: m2.id });
    expect((await owner.as.query(api.projects.board, { workspaceId, key: "WRK" }))!.milestones).toHaveLength(1);
  });
});

describe("how work comes in", () => {
  test("a feature is ready only with a milestone and acceptance; otherwise it waits in the backlog", async () => {
    const { owner, projectId, m1 } = await contractWorld();
    const loose = await owner.as.mutation(api.tasks.create, { projectId, title: "Add a note to a existing notebook" });
    expect(loose.status).toBe("backlog");
    const ready = await owner.as.mutation(api.tasks.create, { projectId, title: "Pause every note at once", milestoneId: m1, acceptance: ACCEPT });
    expect(ready.status).toBe("todo");
    expect(await code(owner.as.mutation(api.tasks.create, { projectId, title: "No acceptance", milestoneId: m1, status: "todo" }))).toBe("invalid");
    // One line is enough for a bug, and a bug needs no milestone.
    expect((await owner.as.mutation(api.tasks.create, { projectId, title: "Totals show zero", type: "bug", acceptance: "The totals match Example Service." })).status).toBe("todo");
    // Filling in what was missing lets it leave the backlog.
    expect(await code(owner.as.mutation(api.tasks.update, { taskId: loose.id, patch: { status: "todo" } }))).toBe("invalid");
    await owner.as.mutation(api.tasks.update, { taskId: loose.id, patch: { milestoneId: m1, acceptance: ACCEPT } });
    expect(await code(owner.as.mutation(api.tasks.update, { taskId: loose.id, patch: { status: "todo" } }))).toBe("ok");
  });

  test("an agent's own proposal waits for a person; a request it was given starts ready", async () => {
    const { t, token, owner, feature } = await contractWorld();
    const own = await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "Cache the report rows", milestone: "M1", acceptance: ACCEPT });
    expect(own.status).toBe("backlog");
    expect(await code(t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: own.key, patch: { status: "todo" } }))).toBe("forbidden");
    const asked = await feature("Export notes as CSV");
    expect(asked.status).toBe("todo");
    // "Record it, I'll decide when": asked for, written in full, and still out of the build queue.
    expect((await feature("Import notes from a spreadsheet", { status: "backlog" })).status).toBe("backlog");
    // A person approves the proposal.
    const detail = await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: own.key });
    expect(detail.notReady).toBeNull();
    const row = await t.run((ctx) => ctx.db.query("tasks").collect());
    await owner.as.mutation(api.tasks.update, { taskId: row.find((r) => r.title === "Cache the report rows")!._id, patch: { status: "todo" } });
  });

  test("agents keep titles short and never file requirements or decisions", async () => {
    const { t, token, feature } = await contractWorld();
    expect(await code(feature("x".repeat(81)))).toBe("invalid");
    expect(await code(feature("Record the pilot figures", { type: "decision" }))).toBe("invalid");
    expect(await code(t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "y".repeat(201), type: "finding" }))).toBe("invalid");
    const note = await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "The CTA shows as a raw enum in two places", type: "finding", status: "todo" });
    expect(note.status).toBe("backlog");
  });

  test("a feature is created with its tasks; two levels only; at most seven tasks", async () => {
    const { t, token, feature, owner, workspaceId } = await contractWorld();
    const f = await feature("Add a note to a existing notebook", { labels: ["service"], tasks: [{ title: "Draft takes a new note", tier: "critical" }, { title: "Pick list shows it" }] });
    expect(f.tasks).toHaveLength(2);
    const child = await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: f.tasks![0].key });
    expect(child).toMatchObject({ parent: f.key, milestone: "M1", tier: "critical", type: "task", labels: ["service"] });
    const add = (parent: string) => t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "One more slice", parent });
    expect(await code(add(f.tasks![0].key))).toBe("invalid");
    for (let i = 0; i < 5; i++) await add(f.key);
    expect(await code(add(f.key))).toBe("invalid");
    // A task takes its feature's milestone, and follows it when the feature moves.
    const m2 = await owner.as.mutation(api.projects.upsertMilestone, { projectId: (await owner.as.query(api.projects.board, { workspaceId, key: "WRK" }))!.project.id, key: "M2", name: "Second" });
    expect(await code(t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: f.tasks![0].key, patch: { milestone: "M2" } }))).toBe("invalid");
    await t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: f.key, patch: { milestone: "M2" } });
    expect((await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: f.tasks![1].key })).milestone).toBe("M2");
    expect(m2.key).toBe("M2");
  });

  test("urgent is a person's call, except for a bug, and three is the most", async () => {
    const { t, token, owner, projectId, feature } = await contractWorld();
    expect(await code(feature("Jump the queue", { priority: "urgent" }))).toBe("forbidden");
    expect(await code(feature("Old-style priority", { priority: "high" }))).toBe("invalid");
    const bug = await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "A user sees another user's notes", type: "bug", priority: "urgent", acceptance: "User A's list holds only A's notes." });
    expect(bug.status).toBe("todo");
    for (const title of ["Second", "Third"]) await owner.as.mutation(api.tasks.create, { projectId, title, type: "bug", priority: "urgent", acceptance: "Fixed." });
    expect(await code(owner.as.mutation(api.tasks.create, { projectId, title: "Fourth", type: "bug", priority: "urgent", acceptance: "Fixed." }))).toBe("invalid");
  });
});

describe("how work moves and closes", () => {
  test("commits start a task and its feature, and landing on main closes the task", async () => {
    const { t, token, feature, status } = await contractWorld();
    const f = await feature("Add a note to a existing notebook", { tasks: [{ title: "Draft takes a new note" }, { title: "Pick list shows it" }] });
    const [a, b] = f.tasks!.map((x) => x.key);
    const push = (commits: { sha: string; subject: string; onMain?: boolean }[]) => t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits });
    const first = await push([{ sha: "a1b2c3d4", subject: `feat(service): a published draft takes a new note (${a})` }]);
    expect(first).toMatchObject({ recorded: 1, moved: [{ key: a, to: "in_progress" }], unknown: [] });
    expect([await status(a), await status(b), await status(f.key)]).toEqual(["in_progress", "todo", "in_progress"]);
    // The same commit again changes nothing; on main it closes the task but never the feature.
    expect((await push([{ sha: "a1b2c3d4", subject: `feat(service): a published draft takes a new note (${a})` }])).recorded).toBe(0);
    await push([
      { sha: "a1b2c3d4", subject: `feat(service): a published draft takes a new note (${a})`, onMain: true },
      { sha: "e5f6a7b8", subject: `feat(service): the pick list shows it (${b}) and a stray key (WRK-999)`, onMain: true },
    ]);
    expect([await status(a), await status(b), await status(f.key)]).toEqual(["done", "done", "in_progress"]);
    const detail = await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: f.key });
    expect(detail.commits.map((c) => [c.sha, c.onMain])).toEqual(expect.arrayContaining([["a1b2c3d4", true], ["e5f6a7b8", true]]));
    expect(detail.assignees).toEqual([]);
    expect((await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: a })).assignees).toEqual(["Claude Code"]);
  });

  test("an agent finishes a feature, a person accepts it or sends it back", async () => {
    const { t, token, owner, feature, status, workspaceId } = await contractWorld();
    const f = await feature("Add a note to a existing notebook", { tasks: [{ title: "Draft takes a new note" }] });
    const finish = (summary: string) => t.mutation(api.agent.api.finish, { token, projectKey: "WRK", ref: f.key, summary });
    expect(await code(finish("You can add a note from the notebook page."))).toBe("invalid");
    await t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits: [{ sha: "abc12345", subject: `feat: draft (${f.tasks![0].key})`, onMain: true }] });
    expect(await code(t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: f.key, patch: { status: "done" }, note: "built" }))).toBe("forbidden");
    expect(await code(t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: f.key, patch: { status: "review" } }))).toBe("invalid");
    expect(await code(finish("one\ntwo\nthree\nfour"))).toBe("invalid");
    expect(await finish("You can add a note from the notebook page.\nNot verified: large attachments.")).toMatchObject({ status: "review", warnings: [] });

    const needs = await owner.as.query(api.tasks.needsYou, { workspaceId });
    expect(needs.toAccept).toHaveLength(1);
    expect(needs.toAccept[0]).toMatchObject({ key: f.key, summary: "You can add a note from the notebook page.\nNot verified: large attachments.", tasks: 1, commits: 1 });
    const taskId = needs.toAccept[0].id;
    expect(await code(owner.as.mutation(api.tasks.review, { taskId, accept: false }))).toBe("invalid");
    await owner.as.mutation(api.tasks.review, { taskId, accept: false, reason: "The new note appears in the wrong notebook." });
    expect(await status(f.key)).toBe("in_progress");
    const brief = await t.query(api.agent.api.next, { token, projectKey: "WRK" });
    expect(brief.resume[0]).toMatchObject({ key: f.key, untrusted_content: { sentBack: "The new note appears in the wrong notebook." } });

    await finish("Fixed: the new note appears in its selected notebook.");
    await owner.as.mutation(api.tasks.review, { taskId, accept: true });
    expect(await status(f.key)).toBe("done");
    expect((await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: f.key })).sendBacks).toBe(1);
    expect((await owner.as.query(api.tasks.needsYou, { workspaceId })).toAccept).toHaveLength(0);
  });

  test("blocking names who and what, and unblocking forgets it", async () => {
    const { t, token, owner, feature, workspaceId } = await contractWorld();
    const f = await feature("Go live on the dummy account");
    expect(await code(t.mutation(api.agent.api.block, { token, projectKey: "WRK", ref: f.key, on: "", what: "the sample workspace" }))).toBe("invalid");
    await t.mutation(api.agent.api.block, { token, projectKey: "WRK", ref: f.key, on: "owner", what: "builds the dummy sample workspace in Example Service" });
    const needs = await owner.as.query(api.tasks.needsYou, { workspaceId });
    expect(needs.blocked[0]).toMatchObject({ key: f.key, on: "owner", what: "builds the dummy sample workspace in Example Service" });
    await owner.as.mutation(api.tasks.update, { taskId: needs.blocked[0].id, patch: { status: "todo" } });
    expect((await owner.as.query(api.tasks.needsYou, { workspaceId })).blocked).toHaveLength(0);
    expect((await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: f.key })).untrusted_content.blocked).toBeNull();
  });
});

describe("next", () => {
  test("urgent first, then work under way, then ready features by milestone and rank", async () => {
    const { t, token, owner, projectId, feature } = await contractWorld();
    await owner.as.mutation(api.projects.upsertMilestone, { projectId, key: "M0", name: "Earlier", order: -1 });
    const later = await feature("Later feature");
    const second = await feature("Second feature");
    const earlier = await feature("Earlier milestone", { milestone: "M0" });
    const started = await feature("Under way", { tasks: [{ title: "Slice" }] });
    await t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits: [{ sha: "1234abcd", subject: `wip (${started.tasks![0].key})` }] });
    const bug = await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "A note is saved twice", type: "bug", priority: "urgent", acceptance: "One saved note per request." });
    const proposal = await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "Nice to have", milestone: "M1", acceptance: ACCEPT });
    const brief = await t.query(api.agent.api.next, { token, projectKey: "WRK" });
    expect(brief.urgent.map((x) => x.key)).toEqual([bug.key]);
    expect(brief.resume.map((x) => x.key)).toEqual([started.key]);
    expect(brief.resume[0].tasks.map((x) => x.status)).toEqual(["in_progress"]);
    expect(brief.next.map((x) => x.key)).toEqual([earlier.key, later.key, second.key]);
    expect(brief.next.map((x) => x.key)).not.toContain(proposal.key);
    expect(brief.counts).toMatchObject({ proposals: 1, inReview: 0 });
    expect(brief.next[0].untrusted_content).toMatchObject({ title: "Earlier milestone", acceptance: ACCEPT });

    // A person says "do this next"; an agent cannot reorder.
    const id = (await t.run((ctx) => ctx.db.query("tasks").collect())).find((r) => r.title === "Second feature")!._id;
    expect(await code(t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: second.key, patch: { title: "Second feature" } }))).toBe("ok");
    await owner.as.mutation(api.tasks.rankFirst, { taskId: id });
    expect((await t.query(api.agent.api.next, { token, projectKey: "WRK" })).next.map((x) => x.key)).toEqual([earlier.key, second.key, later.key]);
  });

  test("a session sees only its area and the tiers it may take; a waiting feature is left out", async () => {
    const { t, token, owner, feature } = await contractWorld();
    const service = await feature("Example Service feature", { labels: ["service"], tasks: [{ title: "Writes to Example Service", tier: "critical" }, { title: "Wording", tier: "routine" }] });
    const uiFeature = await feature("Interface feature", { labels: ["uiFeature"], tier: "routine" });
    const waiting = await feature("Waits on uiFeature", { labels: ["uiFeature"] });
    const ids = new Map((await t.run((ctx) => ctx.db.query("tasks").collect())).map((r) => [r.title, r._id as Id<"tasks">]));
    await owner.as.mutation(api.tasks.setDependencies, { taskId: ids.get("Waits on uiFeature")!, dependsOn: [ids.get("Interface feature")!] });
    const next = async (opts: { label?: string; maxTier?: "routine" | "standard" | "critical" }) =>
      (await t.query(api.agent.api.next, { token, projectKey: "WRK", ...opts })).next.map((x) => x.key);
    expect(await next({})).toEqual([service.key, uiFeature.key]);
    expect(await next({ label: "uiFeature" })).toEqual([uiFeature.key]);
    expect(await next({ maxTier: "standard" })).toEqual([uiFeature.key]);
    expect((await t.query(api.agent.api.next, { token, projectKey: "WRK", maxTier: "routine" })).counts.aboveYourTier).toBe(1);
    expect(waiting.status).toBe("todo");
  });
});

describe("progress", () => {
  test("counts features, with credit for finished tasks; notes and tasks are not units", async () => {
    const { t, token, owner, feature, workspaceId } = await contractWorld();
    const f = await feature("Two-day feature", { estimateDays: 2, tasks: [{ title: "First half" }, { title: "Second half" }] });
    await feature("One-day feature");
    await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "A finding", type: "finding", parent: f.key });
    await t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits: [{ sha: "0a0b0c0d", subject: `feat: first half (${f.tasks![0].key})`, onMain: true }] });
    // A proposal nobody approved is not a unit of progress either.
    await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "An agent's own idea", milestone: "M1", acceptance: ACCEPT });
    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "WRK" }))!;
    expect(board.progress).toMatchObject({ counted: 2, done: 0, percent: 0, total: 6 });
    // 2 days × 8 h, 0.8 × half its tasks spent, plus an untouched day: 16 × 0.6 + 8.
    expect(board.milestones[0]).toMatchObject({ remainingHours: 17.6, derivedHours: 17.6, progress: { counted: 2 } });
    expect(board.health).toMatchObject({ orphans: 0, proposals: 1, notes: 1, inReview: 0, stale: 0 });
  });
});

describe("closing a milestone and archiving a project", () => {
  test("a milestone closes only when its features are done and its notes decided", async () => {
    const { t, token, owner, projectId, m1, feature, workspaceId } = await contractWorld();
    const f = await feature("Only feature");
    const note = await t.mutation(api.agent.api.createTask, { token, projectKey: "WRK", title: "Hover text is cut", type: "idea", parent: f.key });
    const close = () => owner.as.mutation(api.projects.upsertMilestone, { projectId, id: m1, name: "First", closed: true });
    expect(await code(close())).toBe("invalid");
    await t.mutation(api.agent.api.finish, { token, projectKey: "WRK", ref: f.key, summary: "Done." });
    const needs = await owner.as.query(api.tasks.needsYou, { workspaceId });
    await owner.as.mutation(api.tasks.review, { taskId: needs.toAccept[0].id, accept: true });
    expect(await code(close())).toBe("invalid");
    await t.mutation(api.agent.api.updateTask, { token, projectKey: "WRK", ref: note.key, patch: { labels: ["known-limit"] } });
    expect(await code(close())).toBe("ok");
    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "WRK" }))!;
    expect(board.milestones[0].closedAt).not.toBeNull();
    expect(board.milestones[0].remainingHours).toBe(0);
  });

  test("an archived project can be read by those who could, and changed by nobody", async () => {
    const { t, token, owner, member, projectId, feature, workspaceId } = await contractWorld();
    const f = await feature("Before the archive");
    await owner.as.mutation(api.projects.update, { projectId, archived: true });
    expect(await code(feature("After the archive"))).toBe("archived");
    expect(await code(member.as.mutation(api.tasks.create, { projectId, title: "Late idea" }))).toBe("archived");
    expect(await code(t.mutation(api.agent.api.addComment, { token, target: { type: "task", projectKey: "WRK", ref: f.key }, body: "hello" }))).toBe("archived");
    expect(await code(t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits: [{ sha: "deadbeef", subject: `x (${f.key})` }] }))).toBe("archived");
    expect((await t.query(api.agent.api.getTask, { token, projectKey: "WRK", ref: f.key })).status).toBe("todo");
    expect((await member.as.query(api.projects.board, { workspaceId, key: "WRK" }))!.perms).toMatchObject({ read: true, write: false, comment: false });
    await owner.as.mutation(api.projects.update, { projectId, archived: false });
    expect(await code(feature("After the restore"))).toBe("ok");
  });

  test("a mirrored project cannot follow the contract, and a contract project cannot be mirrored", async () => {
    const { t, owner, workspaceId, p1 } = await contractWorld();
    const sync = await agentToken(t, workspaceId, { scopes: ["read", "sync"], source: "example-tracker" });
    const item = { entity: "task" as const, externalId: "T1", fields: { title: "one", status: "todo" } };
    expect(await code(t.mutation(api.agent.api.syncPush, { token: sync, projectKey: "WRK", items: [item] }))).toBe("invalid");
    await t.mutation(api.agent.api.syncPush, { token: sync, projectKey: "DEMO", items: [item] });
    expect(await code(owner.as.mutation(api.projects.update, { projectId: p1, contract: true }))).toBe("invalid");
  });
});

describe("managing a project through the API", () => {
  test("only a token with the admin scope sets up projects and milestones", async () => {
    const { t, token, workspaceId, owner, p1 } = await contractWorld();
    const admin = await agentToken(t, workspaceId, { scopes: ["read", "write", "comment", "admin"], name: "Planner" });
    const limited = await agentToken(t, workspaceId, { scopes: ["read", "write", "admin"], projectIds: [p1] });
    expect(await code(t.mutation(api.agent.api.createProject, { token, key: "NEW", name: "New" }))).toBe("forbidden");
    expect(await code(t.mutation(api.agent.api.setMilestone, { token, projectKey: "WRK", key: "M2", name: "Second" }))).toBe("forbidden");
    expect(await code(t.mutation(api.agent.api.updateProject, { token, projectKey: "WRK", archived: true }))).toBe("forbidden");
    expect(await code(t.mutation(api.agent.api.rankFirst, { token, projectKey: "WRK", ref: "WRK-1" }))).toBe("forbidden");
    // A token tied to certain projects cannot make another one.
    expect(await code(t.mutation(api.agent.api.createProject, { token: limited, key: "NEW", name: "New" }))).toBe("forbidden");

    expect(await t.mutation(api.agent.api.createProject, { token: admin, key: "new", name: "New product", roadmap: { hoursPerDay: 6, workDays: [0, 1, 2, 3, 4] } })).toEqual({ key: "NEW", contract: true });
    expect(await code(t.mutation(api.agent.api.setMilestone, { token: admin, projectKey: "NEW", key: "M1" }))).toBe("invalid");
    expect(await t.mutation(api.agent.api.setMilestone, { token: admin, projectKey: "NEW", key: "m1", name: "First", goal: "Users can organize notes", agentHours: 40 })).toEqual({ key: "M1", created: true });
    expect(await t.mutation(api.agent.api.setMilestone, { token: admin, projectKey: "NEW", key: "M1", exitCriteria: "1. A user saves a note." })).toEqual({ key: "M1", created: false });
    await t.mutation(api.agent.api.setMilestone, { token: admin, projectKey: "NEW", key: "M9", name: "Empty" });
    expect(await t.mutation(api.agent.api.deleteMilestone, { token: admin, projectKey: "NEW", key: "M9" })).toEqual({ deleted: "M9" });
    // The owner sees what the agent set up.
    const board = (await owner.as.query(api.projects.board, { workspaceId, key: "NEW" }))!;
    expect(board.project).toMatchObject({ contract: true, roadmap: { hoursPerDay: 6 } });
    expect(board.milestones.map((m) => [m.key, m.name, m.goal, m.exitCriteria, m.agentHours])).toEqual([["M1", "First", "Users can organize notes", "1. A user saves a note.", 40]]);

    await t.mutation(api.agent.api.updateProject, { token: admin, projectKey: "NEW", name: "Renamed", archived: true });
    expect(await code(t.mutation(api.agent.api.setMilestone, { token: admin, projectKey: "NEW", key: "M2", name: "Second" }))).toBe("archived");
    expect((await t.mutation(api.agent.api.updateProject, { token: admin, projectKey: "NEW", archived: false })).archived).toBe(false);
  });

  test("a batch is all or nothing, and names the item it stopped on", async () => {
    const { t, token, owner, workspaceId } = await contractWorld();
    const item = (title: string, extra: Record<string, unknown> = {}) => ({ title, milestone: "M1", acceptance: ACCEPT, origin: "owner, plan approved", ...extra });
    const bad = t.mutation(api.agent.api.createTasks, { token, projectKey: "WRK", items: [item("First"), item("x".repeat(90)), item("Third")] });
    await expect(bad).rejects.toMatchObject({ data: { code: "invalid", message: expect.stringContaining("Item 2") } });
    expect((await owner.as.query(api.projects.board, { workspaceId, key: "WRK" }))!.tasks).toHaveLength(0);
    const ok = await t.mutation(api.agent.api.createTasks, { token, projectKey: "WRK", items: [item("First", { tasks: [{ title: "Slice" }] }), item("Second"), { title: "A finding", type: "finding" as const }] });
    expect(ok.created.map((c) => [c.key, c.status, c.tasks?.length ?? 0])).toEqual([["WRK-1", "todo", 1], ["WRK-3", "todo", 0], ["WRK-4", "backlog", 0]]);
    expect(await code(t.mutation(api.agent.api.createTasks, { token, projectKey: "WRK", items: [] }))).toBe("invalid");
  });

  test("dependencies, deleting a mistake, the order and project access", async () => {
    const { t, token, workspaceId, guest, feature } = await contractWorld();
    const admin = await agentToken(t, workspaceId, { scopes: ["read", "write", "admin"], name: "Planner" });
    const a = await feature("First built");
    const b = await feature("Waits on the first");
    const c = await feature("Made by mistake");
    await t.mutation(api.agent.api.setDependencies, { token, projectKey: "WRK", ref: b.key, dependsOn: [a.key] });
    expect(await code(t.mutation(api.agent.api.setDependencies, { token, projectKey: "WRK", ref: a.key, dependsOn: [b.key] }))).toBe("cycle");
    expect((await t.query(api.agent.api.next, { token, projectKey: "WRK" })).next.map((x) => x.key)).toEqual([a.key, c.key]);

    // The author deletes its own mistake; a row with commits stays on record.
    await t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits: [{ sha: "feedc0de", subject: `wip (${a.key})` }] });
    expect(await code(t.mutation(api.agent.api.deleteTask, { token, projectKey: "WRK", ref: a.key }))).toBe("invalid");
    expect(await code(t.mutation(api.agent.api.deleteTask, { token: admin, projectKey: "WRK", ref: c.key }))).toBe("ok");
    const d = await feature("Second in line");
    const e = await feature("Jumps the line");
    await t.mutation(api.agent.api.rankFirst, { token: admin, projectKey: "WRK", ref: e.key });
    expect((await t.query(api.agent.api.next, { token, projectKey: "WRK" })).next.map((x) => x.key)).toEqual([e.key, d.key]);

    // A guest sees the project once the admin token adds them.
    expect(await code(guest.as.query(api.projects.board, { workspaceId, key: "WRK" }))).toBe("not_found");
    const members = await t.query(api.agent.api.listMembers, { token, projectKey: "WRK" });
    const g = members.people.find((m) => m.name === "Guest")!;
    expect(g).toMatchObject({ role: "guest", projectRole: null });
    expect(members.people.every((m) => !("email" in m))).toBe(true);
    expect(await code(t.mutation(api.agent.api.setProjectMember, { token, projectKey: "WRK", kind: "user", id: g.id, role: "viewer" }))).toBe("forbidden");
    await t.mutation(api.agent.api.setProjectMember, { token: admin, projectKey: "WRK", kind: "user", id: g.id, role: "viewer" });
    expect((await guest.as.query(api.projects.board, { workspaceId, key: "WRK" }))!.perms).toMatchObject({ read: true, write: false });
  });
});

describe("the owner's queue: recommend and decide", () => {
  /** A feature in review, a blocked one and a proposal, all in WRK. */
  async function queue() {
    const w = await contractWorld();
    const { t, token, feature } = w;
    const review = await feature("Add a note to a existing notebook", { tasks: [{ title: "Draft takes a new note" }] });
    await t.mutation(api.agent.api.commits, { token, projectKey: "WRK", commits: [{ sha: "abc12345", subject: `feat: draft (${review.tasks![0].key})`, onMain: true }] });
    await t.mutation(api.agent.api.finish, { token, projectKey: "WRK", ref: review.key, summary: "You can add a note from the notebook page." });
    const blocked = await feature("Go live on the dummy account");
    await t.mutation(api.agent.api.block, { token, projectKey: "WRK", ref: blocked.key, on: "owner", what: "the sample workspace" });
    const proposal = await feature("Archive selected notes", { origin: undefined });
    const decider = await agentToken(t, w.workspaceId, { scopes: ["read", "write", "comment", "decide"], name: "Assistant" });
    return { ...w, review: review.key, blocked: blocked.key, proposal: proposal.key, decider };
  }

  test("an agent reads the queue with people's text as data, and suggests answers that change nothing", async () => {
    const { t, token, owner, workspaceId, review, blocked, proposal, status } = await queue();
    const q = await t.query(api.agent.api.needsYou, { token });
    expect(q.canDecide).toBe(false);
    expect(q.toAccept[0]).toMatchObject({ key: review, project: "WRK", advice: null, untrusted_content: { title: "Add a note to a existing notebook", summary: "You can add a note from the notebook page." } });
    expect(q.blocked.map((x) => x.key)).toEqual([blocked]);
    expect(q.proposals.map((x) => x.key)).toEqual([proposal]);

    const rec = (ref: string, verdict: "accept" | "approve" | "keep", reason = "Acceptance lines hold on main.") => t.mutation(api.agent.api.recommend, { token, projectKey: "WRK", ref, verdict, reason });
    expect(await code(rec(review, "approve"))).toBe("invalid");
    expect(await code(rec(review, "accept", " "))).toBe("invalid");
    await rec(review, "accept");
    await rec(proposal, "approve", "The owner asked for this in the planning call.");
    expect(await status(review)).toBe("review");

    const needs = await owner.as.query(api.tasks.needsYou, { workspaceId });
    expect(needs.toAccept[0].advice).toMatchObject({ verdict: "accept", reason: "Acceptance lines hold on main.", by: "Claude Code" });
    expect((await t.query(api.agent.api.needsYou, { token, projectKey: "WRK" })).proposals[0]).toMatchObject({ advice: { verdict: "approve", by: "Claude Code" } });

    // The owner confirms: the same step as the button, and the suggestion is gone with the row.
    await owner.as.mutation(api.tasks.decide, { taskId: needs.toAccept[0].id, verdict: "accept", reason: needs.toAccept[0].advice!.reason });
    expect(await status(review)).toBe("done");
    const after = await owner.as.query(api.tasks.needsYou, { workspaceId });
    expect(after.toAccept).toHaveLength(0);
    expect(after.proposals[0].advice).not.toBeNull();
  });

  test("only a token with the decide scope answers for the owner, and admin does not imply it", async () => {
    const { t, token, workspaceId, review, decider, status } = await queue();
    const admin = await agentToken(t, workspaceId, { scopes: ["read", "write", "admin"], name: "PM" });
    const decide = (tok: string, ref: string, verdict: "accept" | "send_back" | "unblock" | "approve" | "keep" | "drop", reason = "Checked on main.") =>
      t.mutation(api.agent.api.decide, { token: tok, projectKey: "WRK", ref, verdict, reason });
    expect(await code(decide(token, review, "accept"))).toBe("forbidden");
    expect(await code(decide(admin, review, "accept"))).toBe("forbidden");
    expect(await code(t.mutation(api.agent.api.updateTask, { token: admin, projectKey: "WRK", ref: review, patch: { status: "done" }, note: "x" }))).toBe("forbidden");
    expect(await code(decide(decider, review, "accept", ""))).toBe("invalid");
    expect(await code(decide(decider, review, "keep"))).toBe("invalid");
    expect((await t.query(api.agent.api.needsYou, { token: decider })).canDecide).toBe(true);
    await decide(decider, review, "send_back", "The new note appears in the wrong notebook.");
    expect(await status(review)).toBe("in_progress");
    expect(await code(decide(decider, review, "accept"))).toBe("invalid");
    // Outside `decide`, the scope opens nothing: finish-to-done and approving a proposal by update stay a person's.
    expect(await code(t.mutation(api.agent.api.updateTask, { token: decider, projectKey: "WRK", ref: review, patch: { status: "done" }, note: "x" }))).toBe("forbidden");
  });

  test("an agent told to clear the queue unblocks, approves, keeps and drops, and the history names it", async () => {
    const { t, owner, workspaceId, blocked, proposal, decider, status, feature } = await queue();
    const decide = (ref: string, verdict: "unblock" | "approve" | "keep" | "drop", reason: string) => t.mutation(api.agent.api.decide, { token: decider, projectKey: "WRK", ref, verdict, reason });
    await decide(blocked, "unblock", "The owner built the sample workspace for this example.");
    expect(await status(blocked)).toBe("todo");
    await decide(proposal, "approve", "The owner asked for this in the planning call.");
    expect(await status(proposal)).toBe("todo");

    // A proposal that is not ready stays where it is, whoever decides.
    const loose = await feature("Something vague", { origin: undefined, acceptance: "" });
    expect(await code(decide(loose.key, "approve", "Looks useful."))).toBe("invalid");
    await decide(loose.key, "drop", "Too vague to build; no one asked again.");
    expect(await status(loose.key)).toBe("superseded");

    // A row nobody touched for a month: keep resets the clock.
    const old = await feature("Old idea", { origin: undefined });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("tasks").collect()).find((r) => r.title === "Old idea")!;
      await ctx.db.patch(row._id, { updatedAt: Date.now() - 40 * 86_400_000 });
    });
    expect((await t.query(api.agent.api.needsYou, { token: decider })).stale.map((x) => x.key)).toEqual([old.key]);
    expect(await code(decide(old.key, "approve", "x"))).toBe("invalid");
    await decide(old.key, "keep", "Still on the owner's list for M2.");
    expect((await owner.as.query(api.tasks.needsYou, { workspaceId })).stale).toHaveLength(0);

    const history = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.actor.name === "Assistant").map((a) => [a.action, a.note]));
    expect(history).toEqual(
      expect.arrayContaining([
        ["status", "The owner built the sample workspace for this example."],
        ["status", "The owner asked for this in the planning call."],
        ["status", "Too vague to build; no one asked again."],
        ["kept", "Still on the owner's list for M2."],
      ]),
    );
  });
});
