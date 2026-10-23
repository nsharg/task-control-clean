/**
 * The work contract (docs/work-contract.md) as the server holds it, in a
 * project that has `contract` set. A row with no parent is a feature or a bug:
 * a person accepts it. A row with a parent is a task: it closes when its commit
 * lands on the main branch. Findings and ideas are notes: recorded, not work.
 */
import type { Doc } from "../_generated/dataModel";
import { type Actor, fail } from "../lib/access";

export const LIMITS = {
  title: 80,
  note: 200,
  acceptanceLines: 5,
  tasksPerFeature: 7,
  urgentOpen: 3,
  summary: 600,
  summaryLines: 3,
  staleDays: 30,
};

/** The label of a note a person has read and accepted as a limit of the product: it stays on record and asks for nothing. */
export const KNOWN_LIMIT = "known-limit";

type Row = Pick<Doc<"tasks">, "type" | "parentTaskId">;

export const isNote = (t: Pick<Doc<"tasks">, "type">) => t.type === "finding" || t.type === "idea";
/** A top-level row of work: the unit a person accepts. */
export const isFeature = (t: Row) => !t.parentTaskId && !isNote(t);
/** A slice of a feature. */
export const isChildTask = (t: Row) => !!t.parentTaskId && !isNote(t);

export const categories = (project: Pick<Doc<"projects">, "statuses">) => new Map(project.statuses.map((s) => [s.key, s.category]));

/** The first status of a category, e.g. the project's own name for "in progress". */
export function statusIn(project: Pick<Doc<"projects">, "statuses">, category: Doc<"projects">["statuses"][number]["category"]) {
  return project.statuses.find((s) => s.category === category)?.key;
}

export const isSettled = (category: string | undefined) => category === "completed" || category === "canceled";

export const acceptanceLines = (s: string) => s.split("\n").filter((l) => l.trim()).length;

/** Why a top-level row cannot leave the backlog yet, or null when it is ready. */
export function notReady(row: Pick<Doc<"tasks">, "type" | "milestoneId" | "acceptance">) {
  const lines = acceptanceLines(row.acceptance);
  const min = row.type === "feature" ? 2 : 1;
  if (lines < min) return `It needs ${min}–${LIMITS.acceptanceLines} acceptance lines (where → action → expected result) before it can start.`;
  if (lines > LIMITS.acceptanceLines) return `It has more than ${LIMITS.acceptanceLines} acceptance lines. Split it into two features.`;
  if (row.type !== "bug" && !row.milestoneId) return "It needs a milestone before it can start.";
  return null;
}

/** Agents keep titles short; the origin, a parent key or a date belong in their own fields. */
export function checkTitle(actor: Actor, type: Doc<"tasks">["type"], title: string) {
  if (actor.kind !== "agent") return;
  const max = isNote({ type }) ? LIMITS.note : LIMITS.title;
  if (title.trim().length > max) {
    fail("invalid", `Title is ${title.trim().length} characters; the limit is ${max}. Say the outcome, and put the why in the description.`);
  }
}

export function checkType(type: Doc<"tasks">["type"]) {
  if (type === "requirement" || type === "decision") {
    fail("invalid", "Requirements and decisions live in documents in the repository. Link the document from the feature.");
  }
}

/** An agent may mark only a bug urgent: the serious-bug rule. Everything else is a person's call. */
export function checkPriority(actor: Actor, type: Doc<"tasks">["type"], priority: Doc<"tasks">["priority"]) {
  if (priority !== "none" && priority !== "urgent") fail("invalid", "Priority here is urgent or none. Order is set by rank inside the milestone.");
  if (priority === "urgent" && actor.kind === "agent" && type !== "bug") {
    fail("forbidden", "Only a person marks work urgent. An agent may do it for a bug that touches money, client data, security or data loss.");
  }
}

/** The tier a session needs to take a feature: the highest among its open tasks, or its own. */
const TIER_RANK = { routine: 0, standard: 1, critical: 2 } as const;
export type Tier = keyof typeof TIER_RANK;
export const tierRank = (t: Tier | undefined) => TIER_RANK[t ?? "standard"];
export function tierOf(feature: Doc<"tasks">, openTasks: Doc<"tasks">[]): Tier {
  const all = openTasks.length ? openTasks.map((t) => t.tier ?? "standard") : [feature.tier ?? "standard"];
  return all.reduce((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a));
}
