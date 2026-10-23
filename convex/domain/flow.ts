/**
 * How a row moves once it exists: commits start it and close its tasks, an
 * agent finishes a feature, a person accepts it or sends it back, and `next`
 * says what to build. See docs/work-contract.md, sections 5 to 9.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { type Actor, fail, originOf, principalOf, readableProjects, requireProject, requireScope, requireWorkspace, targetKey, taskKey, type Principal } from "../lib/access";
import { logActivity } from "../lib/activity";
import type { vVerdict } from "../schema";
import { categories, isChildTask, isFeature, isNote, isSettled, KNOWN_LIMIT, LIMITS, notReady, statusIn, tierOf, tierRank, type Tier } from "./contract";
import { assertEditable, cleanText, moveStatus, startParent, updateTask } from "./tasks";

async function load(ctx: QueryCtx, actor: Actor, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task) return fail("not_found", "Task not found.");
  const { project } = await requireProject(ctx, actor, task!.projectId, "write");
  assertEditable(actor, task!);
  return { t: task!, project, cat: categories(project) };
}

const children = (ctx: QueryCtx, id: Id<"tasks">) => ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", id)).collect();

// ---------- finish, review, block ----------

/** An agent or a person says a feature is ready for a person to try. */
export async function finishTask(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, summary: string) {
  const { t, project, cat } = await load(ctx, actor, taskId);
  const review = statusIn(project, "review");
  if (!review) return fail("invalid", "This project has no review status.");
  if (!isFeature(t)) fail("invalid", "Only a feature or a bug is finished. A task closes when its commit lands on the main branch.");
  if (isSettled(cat.get(t.status))) fail("invalid", `${taskKey(project, t)} is already closed.`);
  const text = cleanText(summary, LIMITS.summary, "Summary");
  if (!text) fail("invalid", "Say in up to three lines what a person can do now, where, and what was not verified.");
  if (text.split("\n").filter((l) => l.trim()).length > LIMITS.summaryLines) fail("invalid", `Keep the summary to ${LIMITS.summaryLines} lines.`);
  const kids = (await children(ctx, t._id)).filter((k) => !isNote(k));
  const open = kids.filter((k) => !isSettled(cat.get(k.status)));
  if (open.length) fail("invalid", `${open.length} of its tasks ${open.length === 1 ? "is" : "are"} still open: ${open.map((k) => taskKey(project, k)).join(", ")}.`);
  const why = project.contract ? notReady(t) : null;
  if (why) fail("invalid", why);
  await moveStatus(ctx, actor, project, t, review!, { note: text, extra: { summary: text, sentBack: undefined } });
  const commits = (await Promise.all([t, ...kids].map((x) => ctx.db.query("commits").withIndex("by_task", (q) => q.eq("taskId", x._id)).collect()))).flat();
  const warnings: string[] = [];
  if (!commits.length) warnings.push("No commit names this feature or its tasks. Put the key at the end of the commit subject.");
  else if (!commits.some((c) => c.onMain)) warnings.push("None of its commits is on the main branch yet, so a person cannot try it.");
  return { key: taskKey(project, t), status: review!, warnings };
}

/**
 * A person accepts a feature in review, or sends it back with the reason. An
 * agent does it only through `decide`, with the decide scope.
 */
export async function reviewTask(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, verdict: { accept: boolean; reason?: string }) {
  if (actor.kind !== "user" && !canDecide(actor)) return fail("forbidden", "A person accepts a feature or sends it back. Suggest it with recommend instead.");
  const { t, project, cat } = await load(ctx, actor, taskId);
  if (cat.get(t.status) !== "review") fail("invalid", `${taskKey(project, t)} is not in review.`);
  if (verdict.accept) {
    const done = statusIn(project, "completed");
    if (!done) return fail("invalid", "This project has no done status.");
    await moveStatus(ctx, actor, project, t, done!, { action: "accepted", note: cleanText(verdict.reason, 1_000, "Reason") || undefined });
    return { key: taskKey(project, t), status: done! };
  }
  const reason = cleanText(verdict.reason, 1_000, "Reason");
  if (!reason) fail("invalid", "Say in a line why it comes back.");
  const started = statusIn(project, "started");
  if (!started) return fail("invalid", "This project has no in-progress status.");
  await moveStatus(ctx, actor, project, t, started!, {
    action: "sent back",
    note: reason,
    extra: { sentBack: { reason, at: Date.now() }, sendBacks: (t.sendBacks ?? 0) + 1 },
  });
  return { key: taskKey(project, t), status: started! };
}

export async function blockTask(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, input: { on: string; what: string }) {
  const { t, project } = await load(ctx, actor, taskId);
  const blocked = statusIn(project, "blocked");
  if (!blocked) return fail("invalid", "This project has no blocked status.");
  const on = cleanText(input.on, 80, "Who it waits on");
  const what = cleanText(input.what, 500, "What it waits for");
  if (!on || !what) fail("invalid", "Say who it waits on and what for.");
  await moveStatus(ctx, actor, project, t, blocked!, { note: `Waits on ${on}: ${what}`, extra: { blocked: { on, what } } });
  return { key: taskKey(project, t), status: blocked! };
}

/** A person looked at a stale row and wants it kept: it leaves the stale list for another 30 days. */
export async function keepTask(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">) {
  const { t } = await load(ctx, actor, taskId);
  await ctx.db.patch(t._id, { updatedAt: Date.now(), advice: undefined });
}

/** "Do this next": the row goes to the top of its milestone's queue. */
export async function rankFirst(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">) {
  const { t, project } = await load(ctx, actor, taskId);
  // The order is the owner's. An agent changes it only with the admin scope, on the owner's instruction.
  if (actor.kind === "agent" && !(await requireProject(ctx, actor, project._id)).perms.manage) {
    fail("forbidden", "A person sets the order. Agents build in the order they are given.");
  }
  const rows = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  const peers = rows.filter((r) => r._id !== t._id && r.milestoneId === t.milestoneId && r.parentTaskId === t.parentTaskId);
  if (!peers.length) return;
  await ctx.db.patch(t._id, { rank: Math.min(...peers.map((r) => r.rank)) - 1, updatedAt: Date.now() });
}

// ---------- commits ----------

export const vCommit = v.object({
  sha: v.string(),
  subject: v.string(),
  branch: v.optional(v.string()),
  model: v.optional(v.string()),
  onMain: v.optional(v.boolean()),
  at: v.optional(v.number()),
});
export type CommitInput = Infer<typeof vCommit>;

export const MAX_COMMITS = 500;

/**
 * Takes commits from the git hook. A commit names its rows in the subject
 * (`… (DEMO-12)`). The first one starts a row; one that is on the main branch
 * closes a task. A feature stays open until it is finished and accepted.
 */
export async function recordCommits(ctx: MutationCtx, actor: Actor, projectId: Id<"projects">, commits: CommitInput[]) {
  requireScope(actor, "write");
  const { project } = await requireProject(ctx, actor, projectId, "write");
  if (commits.length > MAX_COMMITS) fail("invalid", `Send at most ${MAX_COMMITS} commits per call.`);
  const cat = categories(project);
  const started = statusIn(project, "started");
  const done = statusIn(project, "completed");
  const keyRe = new RegExp(`\\b${project.key}-(\\d+)\\b`, "g");
  const res = { recorded: 0, moved: [] as { key: string; to: string }[], unknown: [] as string[] };
  for (const c of commits) {
    const sha = c.sha.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) fail("invalid", `"${c.sha.slice(0, 45)}" is not a commit sha.`);
    const subject = c.subject.trim().slice(0, 300);
    const numbers = [...new Set([...subject.matchAll(keyRe)].map((m) => Number(m[1])))];
    const seen = await ctx.db.query("commits").withIndex("by_project_sha", (q) => q.eq("projectId", project._id).eq("sha", sha)).collect();
    for (const n of numbers) {
      const found = await ctx.db.query("tasks").withIndex("by_project_number", (q) => q.eq("projectId", project._id).eq("number", n)).unique();
      // A mirrored row belongs to its source, so a commit does not move it.
      if (!found || found.managedBy) {
        if (!found) res.unknown.push(`${project.key}-${n}`);
        continue;
      }
      const row = seen.find((s) => s.taskId === found._id);
      if (row) {
        if (c.onMain && !row.onMain) await ctx.db.patch(row._id, { onMain: true });
      } else {
        await ctx.db.insert("commits", { projectId: project._id, taskId: found._id, sha, subject, branch: c.branch?.slice(0, 120), model: c.model?.slice(0, 80), onMain: !!c.onMain, at: c.at ?? Date.now() });
        res.recorded++;
      }
      // Earlier commits in this call may have moved the row already.
      const t = (await ctx.db.get(found._id))!;
      const now = cat.get(t.status);
      let to: string | undefined;
      if (c.onMain && isChildTask(t) && !isSettled(now) && done) to = done;
      else if ((now === "backlog" || now === "unstarted") && started && !isNote(t)) to = started;
      const extra: Partial<Doc<"tasks">> = { commitSha: sha.slice(0, 12) };
      if (!t.assignees.length && actor.kind === "agent") extra.assignees = [principalOf(actor)];
      await moveStatus(ctx, actor, project, t, to ?? t.status, { note: `${sha.slice(0, 8)} ${subject}`.slice(0, 200), extra });
      if (to) {
        res.moved.push({ key: taskKey(project, t), to });
        await startParent(ctx, actor, project, t);
      }
    }
  }
  return res;
}

// ---------- next ----------

/**
 * What a session should build, in the contract's order: urgent rows, then
 * features already under way, then ready features by milestone and rank. A
 * feature that waits on an unfinished one is left out, and so is one that
 * needs a higher tier than the session may take.
 */
export async function nextWork(ctx: QueryCtx, actor: Actor, projectId: Id<"projects">, opts: { label?: string; maxTier?: Tier; limit?: number }) {
  requireScope(actor, "read");
  const { project } = await requireProject(ctx, actor, projectId);
  const cat = categories(project);
  const c = (t: Doc<"tasks">) => cat.get(t.status) ?? "backlog";
  const tasks = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  const byId = new Map(tasks.map((t) => [t._id as string, t]));
  const kids = new Map<string, Doc<"tasks">[]>();
  for (const t of tasks) if (t.parentTaskId) kids.set(t.parentTaskId, [...(kids.get(t.parentTaskId) ?? []), t]);
  const milestones = await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  milestones.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const position = new Map(milestones.map((m, i) => [m._id as string, i]));
  const msOf = (t: Doc<"tasks">) => milestones.find((m) => m._id === t.milestoneId);
  const edges = await ctx.db.query("taskDeps").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
  const waits = (t: Doc<"tasks">) =>
    edges
      .filter((e) => e.taskId === t._id)
      .map((e) => byId.get(e.dependsOnId))
      .filter((d): d is Doc<"tasks"> => !!d && !isSettled(c(d)));
  const openTasks = (t: Doc<"tasks">) => (kids.get(t._id) ?? []).filter((k) => !isNote(k) && !isSettled(c(k))).sort((a, b) => a.rank - b.rank);
  const label = opts.label?.trim().toLowerCase();
  const maxTier = tierRank(opts.maxTier ?? "critical");
  const mine = (t: Doc<"tasks">) => t.assignees.some((a) => a.id === actor.id);

  const features = tasks.filter((t) => isFeature(t) && !isSettled(c(t)) && (!label || t.labels.includes(label)));
  const fits = (t: Doc<"tasks">) => tierRank(tierOf(t, openTasks(t))) <= maxTier;
  const order = (a: Doc<"tasks">, b: Doc<"tasks">) =>
    // A bug with no milestone is on something already shipped: it comes before new work.
    (position.get(a.milestoneId ?? "") ?? -1) - (position.get(b.milestoneId ?? "") ?? -1) || a.rank - b.rank || a.number - b.number;
  const present = (t: Doc<"tasks">) => {
    const open = openTasks(t);
    const m = msOf(t);
    return {
      key: taskKey(project, t),
      type: t.type,
      status: t.status,
      milestone: m?.key ?? null,
      tier: tierOf(t, open),
      urgent: t.priority === "urgent",
      mine: mine(t),
      tasks: open.map((k) => ({ key: taskKey(project, k), status: k.status, tier: k.tier ?? "standard", ...(k.blocked ? { waitsOn: k.blocked.on } : {}), untrusted_content: { title: k.title } })),
      notes: (kids.get(t._id) ?? []).filter((k) => isNote(k) && !isSettled(c(k))).length,
      untrusted_content: {
        title: t.title,
        description: t.description,
        acceptance: t.acceptance,
        ...(t.sentBack ? { sentBack: t.sentBack.reason } : {}),
      },
    };
  };
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 25);
  const resume = features.filter((t) => c(t) === "started").sort((a, b) => Number(!!b.sentBack) - Number(!!a.sentBack) || Number(mine(b)) - Number(mine(a)) || order(a, b));
  const ready = features.filter((t) => c(t) === "unstarted" && !msOf(t)?.closedAt && !msOf(t)?.unplanned && !waits(t).length);
  const urgent = [...resume, ...ready].filter((t) => t.priority === "urgent").sort(order);
  const rest = (xs: Doc<"tasks">[]) => xs.filter((t) => t.priority !== "urgent");
  const tooHigh = [...resume, ...ready].filter((t) => !fits(t)).length;
  return {
    project: project.key,
    urgent: urgent.filter(fits).map(present),
    resume: rest(resume).filter(fits).map(present),
    next: rest(ready).sort(order).filter(fits).slice(0, limit).map(present),
    blocked: features.filter((t) => c(t) === "blocked").map((t) => ({ key: taskKey(project, t), waitsOn: t.blocked?.on ?? null, untrusted_content: { title: t.title, what: t.blocked?.what ?? null } })),
    counts: { ready: ready.length, inReview: features.filter((t) => c(t) === "review").length, proposals: features.filter((t) => c(t) === "backlog").length, aboveYourTier: tooHigh },
  };
}

// ---------- what a person has to decide ----------

export type Brief = {
  id: Id<"tasks">;
  key: string;
  title: string;
  type: Doc<"tasks">["type"];
  project: { key: string; name: string; color: string };
  milestone: string | null;
  updatedAt: number;
  createdBy: Principal;
  advice: { verdict: Verdict; reason: string; by: string; at: number } | null;
};

export type Verdict = Infer<typeof vVerdict>;
type Queue = "toAccept" | "blocked" | "proposals" | "stale";

/** Which answers fit each list of the Needs you page. */
export const VERDICTS: Record<Queue, Verdict[]> = {
  toAccept: ["accept", "send_back"],
  blocked: ["unblock", "drop"],
  proposals: ["approve", "drop"],
  stale: ["keep", "drop"],
};

/** The Needs you list a row is on, or null. needsYou and decide must agree on this. */
function queueOf(cat: Map<string, string>, t: Doc<"tasks">, staleBefore: number): Queue | null {
  const c = cat.get(t.status) ?? "backlog";
  if (isSettled(c)) return null;
  if (c === "blocked") return "blocked";
  if (isNote(t)) return c === "backlog" && !t.labels.includes(KNOWN_LIMIT) && t.updatedAt < staleBefore ? "stale" : null;
  if (!isFeature(t)) return null;
  if (c === "review") return "toAccept";
  if (c === "backlog") return t.updatedAt < staleBefore ? "stale" : "proposals";
  return null;
}

const staleCutoff = () => Date.now() - LIMITS.staleDays * 86_400_000;

/**
 * One list per kind of decision, across the contract projects a person can
 * write to: features to accept, rows that wait on someone, proposals to
 * approve, and backlog rows nobody has touched for a month.
 */
export async function needsYou(ctx: QueryCtx, actor: Actor, workspaceId: Id<"workspaces">) {
  await requireWorkspace(ctx, actor, workspaceId);
  const toAccept: (Brief & { acceptance: string; summary: string | null; tasks: number; commits: number; sendBacks: number })[] = [];
  const blocked: (Brief & { on: string | null; what: string | null })[] = [];
  const proposals: (Brief & { notReady: string | null; origin: string | null })[] = [];
  const stale: (Brief & { note: boolean })[] = [];
  let notes = 0;
  const staleBefore = staleCutoff();
  for (const p of await readableProjects(ctx, actor, workspaceId)) {
    if (p.archivedAt || !p.contract) continue;
    const { perms } = await requireProject(ctx, actor, p._id);
    if (!perms.write) continue;
    const cat = categories(p);
    const tasks = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect();
    const milestones = new Map((await ctx.db.query("milestones").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).map((m) => [m._id as string, m.key]));
    const brief = (t: Doc<"tasks">): Brief => ({
      id: t._id,
      key: taskKey(p, t),
      title: t.title,
      type: t.type,
      project: { key: p.key, name: p.name, color: p.color },
      milestone: milestones.get(t.milestoneId ?? "") ?? null,
      updatedAt: t.updatedAt,
      createdBy: t.createdBy,
      advice: t.advice ? { verdict: t.advice.verdict, reason: t.advice.reason, by: t.advice.by.name, at: t.advice.at } : null,
    });
    for (const t of tasks) {
      if (isNote(t) && !isSettled(cat.get(t.status)) && !t.labels.includes(KNOWN_LIMIT)) notes++;
      const queue = queueOf(cat, t, staleBefore);
      if (queue === "blocked") blocked.push({ ...brief(t), on: t.blocked?.on ?? null, what: t.blocked?.what ?? null });
      else if (queue === "stale") stale.push({ ...brief(t), note: isNote(t) });
      else if (queue === "proposals") proposals.push({ ...brief(t), notReady: notReady(t), origin: t.origin ?? null });
      else if (queue === "toAccept") {
        const kids = tasks.filter((k) => k.parentTaskId === t._id && !isNote(k));
        const commits = (await Promise.all([t, ...kids].map((x) => ctx.db.query("commits").withIndex("by_task", (q) => q.eq("taskId", x._id)).collect()))).flat();
        toAccept.push({ ...brief(t), acceptance: t.acceptance, summary: t.summary ?? null, tasks: kids.length, commits: commits.length, sendBacks: t.sendBacks ?? 0 });
      }
    }
  }
  const oldestFirst = <T extends Brief>(xs: T[]) => xs.sort((a, b) => a.updatedAt - b.updatedAt);
  return { toAccept: oldestFirst(toAccept), blocked: oldestFirst(blocked), proposals: oldestFirst(proposals), stale: oldestFirst(stale), notes };
}

// ---------- answering it: recommend, decide ----------

/** Only a token the owner granted the decide scope answers for them; admin does not imply it. */
export const canDecide = (actor: Actor) => actor.kind === "agent" && actor.scopes.includes("decide");

async function onQueue(ctx: QueryCtx, actor: Actor, taskId: Id<"tasks">, verdict: Verdict) {
  const loaded = await load(ctx, actor, taskId);
  const { t, project, cat } = loaded;
  if (!project.contract) fail("invalid", "Only a project that follows the work contract has a Needs you queue.");
  const queue = queueOf(cat, t, staleCutoff());
  const key = taskKey(project, t);
  if (!queue) return fail("invalid", `${key} is not waiting on a decision.`);
  if (!VERDICTS[queue!].includes(verdict)) fail("invalid", `${key} is in ${queue}; answer it with ${VERDICTS[queue!].join(" or ")}.`);
  return { ...loaded, key };
}

/**
 * Suggest an answer to a Needs you item. The owner sees it on the page and
 * confirms it with one click; it changes nothing until then.
 */
export async function recommend(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, verdict: Verdict, reason: string) {
  requireScope(actor, "write");
  const { t, project, key } = await onQueue(ctx, actor, taskId, verdict);
  const why = cleanText(reason, 500, "Reason");
  if (!why) fail("invalid", "Say in a line why, so the owner can confirm without opening the row.");
  // Not a change to the row: updatedAt stays, so a stale row stays stale.
  await ctx.db.patch(t._id, { advice: { verdict, reason: why, by: principalOf(actor), at: Date.now() } });
  await logActivity(ctx, {
    workspaceId: project.workspaceId,
    projectId: project._id,
    targetKey: targetKey("task", t._id),
    actor: principalOf(actor),
    origin: originOf(actor),
    action: "recommended",
    to: verdict,
    note: why,
  });
  return { key, recommended: verdict };
}

/**
 * Answer a Needs you item. A person always may. An agent needs the decide
 * scope and says why; each answer goes through the same step a person's
 * button does, so every other rule still holds.
 */
export async function decide(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, verdict: Verdict, reason?: string) {
  if (actor.kind === "agent" && !canDecide(actor)) {
    fail("forbidden", 'This token cannot decide for the owner. Use recommend, or ask the owner for a token with the "decide" scope.');
  }
  requireScope(actor, "write");
  const { t, project, key } = await onQueue(ctx, actor, taskId, verdict);
  const why = cleanText(reason, 1_000, "Reason");
  if (actor.kind === "agent" && !why) fail("invalid", "Say in a line why, for the owner reading the history.");
  const to = (category: "unstarted" | "started" | "canceled") => statusIn(project, category) ?? fail("invalid", `This project has no ${category} status.`);
  switch (verdict) {
    case "accept":
    case "send_back":
      await reviewTask(ctx, actor, taskId, { accept: verdict === "accept", reason: why });
      break;
    case "keep":
      await keepTask(ctx, actor, taskId);
      await logActivity(ctx, { workspaceId: project.workspaceId, projectId: project._id, targetKey: targetKey("task", t._id), actor: principalOf(actor), origin: originOf(actor), action: "kept", note: why || undefined });
      break;
    case "approve":
      await updateTask(ctx, actor, taskId, { status: to("unstarted") }, { note: why || undefined, forOwner: true });
      break;
    case "unblock": {
      const commit = await ctx.db.query("commits").withIndex("by_task", (q) => q.eq("taskId", t._id)).first();
      await updateTask(ctx, actor, taskId, { status: to(commit ? "started" : "unstarted") }, { note: why || undefined, forOwner: true });
      break;
    }
    case "drop":
      await updateTask(ctx, actor, taskId, { status: to("canceled") }, { note: why || "Dropped from Needs you.", forOwner: true });
      break;
  }
  const after = (await ctx.db.get(t._id))!;
  return { key, decided: verdict, status: after.status };
}
