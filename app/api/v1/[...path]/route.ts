/**
 * REST adapter for agents. Every route forwards to a Convex function in
 * `convex/agent/api.ts` with the caller's bearer token; Convex decides.
 * See /api/v1/openapi.json for the reference.
 */
import { api } from "@/convex/_generated/api";
import { admit, agentClient, bearer, describeError, type AgentClient } from "@/lib/api/convex";
import { openapi } from "@/lib/api/openapi";

type Handler = (c: AgentClient, p: string[], q: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>;

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const bool = (v: string | null) => (v === null ? undefined : v === "true");
const num = (v: string | null) => (v === null ? undefined : Number(v));

// [method, pattern, handler]. `:x` segments are passed in order as `p`.
const ROUTES: [string, string, Handler][] = [
  ["GET", "me", (c) => c.query(api.agent.api.whoami, {})],
  ["GET", "projects", (c) => c.query(api.agent.api.listProjects, {})],
  ["POST", "projects", (c, _p, _q, b) => c.mutation(api.agent.api.createProject, b as never)],
  ["GET", "projects/:key", (c, [key]) => c.query(api.agent.api.projectStatus, { projectKey: key })],
  ["PATCH", "projects/:key", (c, [key], _q, b) => c.mutation(api.agent.api.updateProject, { ...(b as object), projectKey: key })],
  ["POST", "projects/:key/milestones", (c, [key], _q, b) => c.mutation(api.agent.api.setMilestone, { ...(b as { key: string }), projectKey: key })],
  ["DELETE", "projects/:key/milestones/:milestone", (c, [key, milestone]) => c.mutation(api.agent.api.deleteMilestone, { projectKey: key, key: milestone })],
  ["GET", "members", (c, _p, q) => c.query(api.agent.api.listMembers, { projectKey: q.get("project") ?? undefined })],
  ["POST", "projects/:key/members", (c, [key], _q, b) => c.mutation(api.agent.api.setProjectMember, { ...(b as { kind: "user"; id: string; role: null }), projectKey: key })],
  ["POST", "projects/:key/tasks/batch", (c, [key], _q, b) => c.mutation(api.agent.api.createTasks, { projectKey: key, items: (b.items ?? []) as never })],
  ["DELETE", "projects/:key/tasks/:ref", (c, [key, ref]) => c.mutation(api.agent.api.deleteTask, { projectKey: key, ref })],
  ["POST", "projects/:key/tasks/:ref/dependencies", (c, [key, ref], _q, b) => c.mutation(api.agent.api.setDependencies, { projectKey: key, ref, dependsOn: (b.dependsOn ?? []) as string[] })],
  ["POST", "projects/:key/tasks/:ref/first", (c, [key, ref]) => c.mutation(api.agent.api.rankFirst, { projectKey: key, ref })],
  [
    "GET",
    "projects/:key/tasks",
    (c, [key], q) =>
      c.query(api.agent.api.listTasks, {
        projectKey: key,
        status: list(q.get("status")),
        type: q.get("type") ?? undefined,
        assignee: q.get("assignee") ?? undefined,
        parent: q.get("parent") ?? undefined,
        managed: bool(q.get("managed")),
        limit: num(q.get("limit")),
      }),
  ],
  ["POST", "projects/:key/tasks", (c, [key], _q, b) => c.mutation(api.agent.api.createTask, { ...(b as { title: string }), projectKey: key })],
  ["GET", "projects/:key/tasks/:ref", (c, [key, ref]) => c.query(api.agent.api.getTask, { projectKey: key, ref })],
  [
    "PATCH",
    "projects/:key/tasks/:ref",
    (c, [key, ref], _q, b) =>
      c.mutation(api.agent.api.updateTask, {
        projectKey: key,
        ref,
        patch: (b.patch ?? {}) as never,
        note: b.note as string | undefined,
        ifVersion: b.ifVersion as number | undefined,
      }),
  ],
  [
    "GET",
    "projects/:key/next",
    (c, [key], q) => c.query(api.agent.api.next, { projectKey: key, label: q.get("label") ?? undefined, maxTier: (q.get("maxTier") ?? undefined) as never, limit: num(q.get("limit")) }),
  ],
  ["POST", "projects/:key/tasks/:ref/finish", (c, [key, ref], _q, b) => c.mutation(api.agent.api.finish, { projectKey: key, ref, summary: String(b.summary ?? "") })],
  ["POST", "projects/:key/tasks/:ref/block", (c, [key, ref], _q, b) => c.mutation(api.agent.api.block, { projectKey: key, ref, on: String(b.on ?? ""), what: String(b.what ?? "") })],
  ["GET", "needs-you", (c, _p, q) => c.query(api.agent.api.needsYou, { projectKey: q.get("project") ?? undefined })],
  ["POST", "projects/:key/tasks/:ref/recommend", (c, [key, ref], _q, b) => c.mutation(api.agent.api.recommend, { projectKey: key, ref, verdict: b.verdict as never, reason: String(b.reason ?? "") })],
  ["POST", "projects/:key/tasks/:ref/decide", (c, [key, ref], _q, b) => c.mutation(api.agent.api.decide, { projectKey: key, ref, verdict: b.verdict as never, reason: String(b.reason ?? "") })],
  ["POST", "projects/:key/commits", (c, [key], _q, b) => c.mutation(api.agent.api.commits, { projectKey: key, commits: (b.commits ?? []) as never })],
  ["GET", "projects/:key/sync", (c, [key]) => c.query(api.agent.api.syncStatus, { projectKey: key })],
  ["POST", "projects/:key/sync", (c, [key], _q, b) => c.mutation(api.agent.api.syncPush, { ...(b as { items: never[] }), projectKey: key })],
  ["GET", "sync/changes", (c, _p, q) => c.query(api.agent.api.syncChanges, { projectKey: q.get("project") ?? undefined, cursor: num(q.get("cursor")), limit: num(q.get("limit")) })],
  ["GET", "tickets", (c, _p, q) => c.query(api.agent.api.listTickets, { projectKey: q.get("project") ?? undefined, status: (q.get("status") ?? undefined) as never, open: bool(q.get("open")) })],
  ["POST", "tickets", (c, _p, _q, b) => c.mutation(api.agent.api.createTicket, b as never)],
  ["GET", "tickets/:ref", (c, [ref]) => c.query(api.agent.api.getTicket, { ref })],
  ["PATCH", "tickets/:ref", (c, [ref], _q, b) => c.mutation(api.agent.api.updateTicket, { ...(b as object), ref })],
  ["POST", "tickets/:ref/links", (c, [ref], _q, b) => c.mutation(api.agent.api.linkTicket, { ...(b as { projectKey: string; taskRef: string; relation: "relates" }), ref })],
  ["POST", "comments", (c, _p, _q, b) => c.mutation(api.agent.api.addComment, b as never)],
  ["GET", "ingest/pending", (c, _p, q) => c.query(api.agent.api.ingestPending, { projectKey: q.get("project") ?? undefined, limit: num(q.get("limit")) })],
  ["POST", "ingest/claim", (c, _p, _q, b) => c.mutation(api.agent.api.ingestClaim, b as never)],
  ["POST", "ingest/done", (c, _p, _q, b) => c.mutation(api.agent.api.ingestDone, b as never)],
  ["POST", "ingest/skip", (c, _p, _q, b) => c.mutation(api.agent.api.ingestSkip, b as never)],
  ["POST", "ingest/release", (c, _p, _q, b) => c.mutation(api.agent.api.ingestRelease, b as never)],
];

function match(method: string, path: string[]) {
  for (const [m, pattern, handler] of ROUTES) {
    const parts = pattern.split("/");
    if (m !== method || parts.length !== path.length) continue;
    const params: string[] = [];
    if (parts.every((seg, i) => (seg.startsWith(":") ? (params.push(decodeURIComponent(path[i])), true) : seg === path[i]))) {
      return { handler, params };
    }
  }
  return null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const MAX_BODY = 2_000_000;

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const token = bearer(req);
  // Every route, the reference included, needs a valid token within its budget.
  const refused = await admit(req, token);
  if (refused) return refused;
  if (req.method === "GET" && path.join("/") === "openapi.json") return json(200, openapi());
  const route = match(req.method, path);
  if (!route) return json(404, { error: { code: "not_found", message: "No such endpoint." } });
  let body: Record<string, unknown> = {};
  if (req.method !== "GET" && req.method !== "DELETE") {
    const text = await req.text();
    if (text.length > MAX_BODY) return json(413, { error: { code: "too_large", message: "Body over 2 MB. Send smaller batches." } });
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return json(400, { error: { code: "invalid", message: "Body must be JSON." } });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, { error: { code: "invalid", message: "Body must be a JSON object." } });
    delete body.token;
  }
  try {
    const data = await route.handler(agentClient(token!), route.params, new URL(req.url).searchParams, body);
    return json(200, data ?? { ok: true });
  } catch (e) {
    const err = describeError(e);
    return json(err.status, { error: { code: err.code, message: err.message } });
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
