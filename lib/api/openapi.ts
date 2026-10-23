/** A compact OpenAPI 3.1 reference for the REST adapter. Request bodies mirror the MCP tool inputs. */
const op = (summary: string, scope: string, extra: Record<string, unknown> = {}) => ({
  summary,
  description: `Scope: \`${scope}\`.`,
  security: [{ bearer: [] }],
  responses: { "200": { description: "OK" }, "401": { description: "Missing or invalid token" }, "403": { description: "Missing scope" }, "404": { description: "Not found or not visible to this token" } },
  ...extra,
});
const path = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const query = (name: string, description = "") => ({ name, in: "query", required: false, description, schema: { type: "string" } });
const body = (description: string) => ({ requestBody: { required: true, description, content: { "application/json": { schema: { type: "object" } } } } });

export function openapi() {
  return {
    openapi: "3.1.0",
    info: { title: "Task Control agent API", version: "1.1.0", description: "Every call needs `Authorization: Bearer tc_…`. Human-written text is returned under `untrusted_content`." },
    servers: [{ url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/v1` }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    paths: {
      "/me": { get: op("Who this token is", "any") },
      "/projects": {
        get: op("Projects this token can read, with progress", "read"),
        post: op("Create a project. It follows the work contract unless `contract` is false", "admin", body("{ key, name, description?, visibility?, contract?, roadmap?: { hoursPerDay, workDays } }")),
      },
      "/members": { get: op("People and agents of the workspace with their ids; with `project`, their role in it", "read", { parameters: [query("project")] }) },
      "/projects/{key}/milestones": {
        post: op("Create the milestone with this key, or change it. `closed: true` closes it", "admin", {
          parameters: [path("key")],
          ...body("{ key, name?, newKey?, goal?, exitCriteria?, order?, track?, agentHours?, estimateNote?, unplanned?, closed? }"),
        }),
      },
      "/projects/{key}/milestones/{milestone}": { delete: op("Remove a milestone that has no rows in it", "admin", { parameters: [path("key"), path("milestone")] }) },
      "/projects/{key}/members": { post: op("Give a person or an agent a role in the project, or null to remove it", "admin", { parameters: [path("key")], ...body("{ kind: 'user' | 'agent', id, role: 'lead' | 'member' | 'viewer' | null }") }) },
      "/projects/{key}/tasks/batch": { post: op("Create up to 50 rows in order, all or nothing. Each item is a body of POST /projects/{key}/tasks", "write", { parameters: [path("key")], ...body("{ items: [...] }") }) },
      "/projects/{key}/tasks/{ref}/dependencies": { post: op("Replace what a row waits on", "write", { parameters: [path("key"), path("ref")], ...body("{ dependsOn: [ref] }") }) },
      "/projects/{key}/tasks/{ref}/first": { post: op("Move a feature to the top of its milestone's queue", "admin", { parameters: [path("key"), path("ref")] }) },
      "/projects/{key}": {
        patch: op("Change a project's name, description, visibility, roadmap capacity or contract switch; archive or restore it", "admin", { parameters: [path("key")], ...body("{ name?, description?, color?, visibility?, archived?, contract?, roadmap? }") }),
        get: op("Project roll-up: sections, milestones (with agent-hour estimates and roadmap capacity), blocked, in progress, next up", "read", { parameters: [path("key")] }) },
      "/projects/{key}/next": {
        get: op("What to build now, in order: urgent rows, features under way, then ready features by milestone and rank, with description, acceptance and open tasks", "read", {
          parameters: [path("key"), query("label", "an area label, e.g. core"), query("maxTier", "routine|standard|critical"), query("limit")],
        }),
      },
      "/projects/{key}/tasks": {
        get: op("List rows, briefly", "read", { parameters: [path("key"), query("status", "comma-separated"), query("type"), query("assignee"), query("parent", "a feature's key"), query("managed", "true|false"), query("limit")] }),
        post: op("Create a feature or bug (with its tasks), a task under a feature, or a note", "write", {
          parameters: [path("key")],
          ...body("{ title, type?, description?, acceptance?, milestone?, parent?, origin?, tier?, tasks?: [{ title, description?, tier? }], labels?, priority?, status?, assigneeIds?, estimateDays? }"),
        }),
      },
      "/projects/{key}/tasks/{ref}": {
        get: op("One row with its tasks, notes, commits and comments. `ref` is DEMO-12 or an alias like SM-01", "read", { parameters: [path("key"), path("ref")] }),
        patch: op("Update a row. `patch.milestone` is a key and `patch.parent` a ref; null clears either", "write", { parameters: [path("key"), path("ref")], ...body("{ patch: {...}, note?, ifVersion? }") }),
        delete: op("Delete a row made by mistake. Refused when it has commits or holds tasks", "write", { parameters: [path("key"), path("ref")] }),
      },
      "/projects/{key}/tasks/{ref}/finish": { post: op("A feature is ready for a person to try: moves it to review", "write", { parameters: [path("key"), path("ref")], ...body("{ summary }") }) },
      "/projects/{key}/tasks/{ref}/block": { post: op("A row waits on someone", "write", { parameters: [path("key"), path("ref")], ...body("{ on, what }") }) },
      "/needs-you": { get: op("The owner's Needs you queue: features to accept, blocked rows, proposals, stale rows, each with any suggested answer", "read", { parameters: [query("project")] }) },
      "/projects/{key}/tasks/{ref}/recommend": { post: op("Suggest an answer to a Needs you item; the owner confirms it on the page", "write", { parameters: [path("key"), path("ref")], ...body("{ verdict: accept | send_back | unblock | approve | keep | drop, reason }") }) },
      "/projects/{key}/tasks/{ref}/decide": { post: op("Answer a Needs you item for the owner, on their instruction", "decide", { parameters: [path("key"), path("ref")], ...body("{ verdict: accept | send_back | unblock | approve | keep | drop, reason }") }) },
      "/projects/{key}/commits": {
        post: op("Report commits whose subject names a row, e.g. `… (DEMO-12)`. The first starts the row; one on the main branch closes a task", "write", {
          parameters: [path("key")],
          ...body("{ commits: [{ sha, subject, branch?, model?, onMain?, at? }] }"),
        }),
      },
      "/projects/{key}/sync": {
        get: op("Sync sources and mirrored counts", "read", { parameters: [path("key")] }),
        post: op("Push up to 200 mirror items (section, milestone, task, deps, event). A milestone may carry agentHours, estimateNote and track for the roadmap, or unplanned: true to keep a parking lot off it.", "sync", { parameters: [path("key")], ...body("{ items: [...], dryRun?, logChanges?, sourceLabel? }") }),
      },
      "/sync/changes": { get: op("Change feed after a cursor, without this token's own source", "read", { parameters: [query("project"), query("cursor"), query("limit")] }) },
      "/tickets": {
        get: op("List tickets", "read", { parameters: [query("project"), query("status"), query("open", "true|false")] }),
        post: op("Open a ticket", "write", body("{ projectKey?, kind, title, body?, severity? }")),
      },
      "/tickets/{ref}": {
        get: op("Ticket detail with comments", "read", { parameters: [path("ref")] }),
        patch: op("Triage a ticket", "write", { parameters: [path("ref")], ...body("{ status?, severity? }") }),
      },
      "/tickets/{ref}/links": { post: op("Link a ticket to a task", "comment", { parameters: [path("ref")], ...body("{ projectKey, taskRef, relation }") }) },
      "/comments": { post: op("Comment on a task or ticket", "comment", body("{ target: { type: 'task', projectKey, ref } | { type: 'ticket', ref }, body }")) },
      "/ingest/pending": { get: op("Partner items waiting to be ingested", "ingest", { parameters: [query("project"), query("limit")] }) },
      "/ingest/claim": { post: op("Lease items for 15 minutes", "ingest", body("{ refs: [{ type, id }] }")) },
      "/ingest/done": { post: op("Mark an item ingested and reply to its author", "ingest", body("{ ref, upstreamRef, note?, reply? }")) },
      "/ingest/skip": { post: op("Skip an item (duplicate, noise)", "ingest", body("{ ref, reason }")) },
      "/ingest/release": { post: op("Hand claimed items back", "ingest", body("{ refs }")) },
    },
  };
}
