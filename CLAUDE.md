@AGENTS.md

# Task Control: notes for Claude

- **Authorization lives in Convex.** Define every public query and mutation with the wrappers in `convex/lib/functions.ts` (`userQuery`/`userMutation`, `agentQuery`/`agentMutation`), then check access with `convex/lib/access.ts` (`requireWorkspace`, `requireProject`). `tests/convex/wrappers.test.ts` enforces this. Secrets (invite and API tokens) are made in actions (`lib/random.ts`), and only their SHA-256 hash is stored.
- **One domain layer.** `convex/domain/*` holds the logic that the UI functions (`convex/*.ts`) and the agent API (`convex/agent/api.ts`) both call. REST (`app/api/v1`) and MCP (`app/api/mcp`) are thin adapters that pass the bearer token through.
- **The work contract is enforced in the domain layer.** A project with `contract` set follows `docs/work-contract.md`: `convex/domain/contract.ts` holds the rules, `convex/domain/tasks.ts` applies them on create and update, and `convex/domain/flow.ts` holds finish, accept and send back, block, commits and `next`. A project without the flag behaves as before; keep both paths working. Change a rule and its line in the contract document together, and the `task-control` skill (`skills/task-control/`) when the rule is one agents act on: the skill is what a session in another repository actually reads.
- **The activity log is append-only.** Never patch or delete `activity` rows.
- **Mirrored records are read-only.** Tasks, sections and milestones with `managedBy` belong to a sync source; only that source's token may change them. People can still comment on them and link to them.
- **Partner text is untrusted.** Agent-facing responses put human-written text under `untrusted_content`.
- Checks: `npm run typecheck && npm run lint && npm test`. Local dev: `npx convex dev` + `npm run dev` (port 3200).
