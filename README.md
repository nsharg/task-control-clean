# Task Control

Projects, tasks and tickets for small teams, and for the AI agents that work with them.

Open source under the [MIT License](LICENSE). You can use, modify, and share
Task Control, including commercially, subject to the license terms.
Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

- **No public sign-up.** The super admin (`SUPER_ADMIN_EMAILS`) creates every account in `/admin` with a one-time password, which the person must replace at first sign-in. No email is sent in the beta. Two-factor auth is off for now.
- **Workspaces** have owners, admins, members and **guests**. Guests are partners who see only the projects they are added to.
- **Tickets** (bugs, feature requests, questions) link to tasks.
- **Milestones, features and tasks.** A project that follows the [work contract](docs/work-contract.md) holds features in milestones, with tasks under them and one-line notes beside them. A feature needs a milestone and acceptance lines to start; a person accepts it or sends it back on the **Needs you** page. Progress counts features.
- **Agents** (Claude Code, Codex) use the same data over **MCP** (`/api/mcp`) or **REST** (`/api/v1`) with scoped, revocable tokens. Five calls cover their work: next, create, finish, block, and the commit itself, which a git hook reports.
- **Sync** mirrors an external tracker into a project, one way, and read-only in the app. What partners add can then be **ingested** back into that tracker on request. A mirrored project cannot also follow the work contract.

Stack: Next.js 16, React 19, Convex, Better Auth (self-hosted in Convex), Tailwind v4, Radix.

## Run it locally

```bash
npm install
npx convex dev            # first run: creates a deployment and writes .env.local
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:3200
npx convex env set SUPER_ADMIN_EMAILS you@example.com
npm run dev               # http://localhost:3200
```

The first account: open `/sign-up` (not linked anywhere) and register with the super-admin email. It works once, for that email only. Everyone else is created from `/admin`.

## Security

- Accounts: admin-created only. The sign-up endpoint refuses every email except a not-yet-existing super admin. Disabled accounts cannot start a session and are refused by every function.
- Sign-in: Better Auth per-IP limits (5/min sign-in), plus a per-account bucket (10 per 15 min) that holds even if IPs rotate. The form has a honeypot and a minimum fill time.
- Sessions: httpOnly, Secure, SameSite=Lax cookies, 7-day expiry. Password change and admin reset sign out other sessions.
- Headers: per-request nonce CSP (`strict-dynamic`, no inline scripts), HSTS preload, `X-Frame-Options: DENY`, COOP/CORP same-origin, noindex.
- Geography: pages and sign-in only from `ALLOWED_COUNTRIES` (Vercel env; configure explicitly; unset blocks page access on Vercel), by Vercel geo-IP, failing closed. `/api/v1`, `/api/mcp` and `/api/health` are open worldwide for agents (Claude Code, Codex).
- Backend: Convex auth routes refuse writes without `AUTH_PROXY_SECRET`, which only the Next.js app sends, so nobody can skip the geo rule or forge IPs by calling Convex directly.
- Agent API: every REST/MCP request (including `openapi.json`) passes `agent/gate.check`: valid token, 600 requests/min per token, and an IP that sends 10 bad tokens in 10 minutes is locked out.
- Monitoring: security events (failed, throttled and disabled sign-ins, rejected sign-ups, bad tokens, direct-backend attempts, admin actions) are kept 30 days. A cron job every 5 minutes raises alerts in `/admin`, and posts them to `ALERT_WEBHOOK_URL` (Slack or Discord JSON) when set. `/api/health` is for an external uptime monitor.
- Privacy: no analytics, no third-party scripts or fonts, no email. Agents receive human text under `untrusted_content`.

## Checks

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` runs the Convex suites in `tests/convex`. They cover access control, guest isolation, token scopes, admin-only account management, dependency cycles, idempotent sync, the read-only mirror, echo suppression, ingest leases, and the work contract: how work comes in, what the server refuses, commits moving rows, finish, accept and send back, the order of `next`, progress in features, and read-only archives. One test fails if a public Convex function skips the auth wrappers in `convex/lib/functions.ts`.

## Connect an agent

The [`task-control` skill](skills/task-control/SKILL.md) is how a Claude Code session learns to use all this: it carries the rules and the `tc` script. [docs/agent-setup.md](docs/agent-setup.md) says how to install it in a repository.

In short:

1. Go to **Agents & API tokens**, create an agent (e.g. "Claude Code") and a token with the **Coding agent** preset.
2. Copy `skills/task-control` into the other repository's `.claude/skills/`, and ask Claude to connect the repository.
3. Or add the MCP server:

   ```bash
   claude mcp add --transport http task-control https://<app>/api/mcp --header "Authorization: Bearer tc_…"
   ```

4. The script needs only Node and works in any worktree, and for Codex:

   ```bash
   node skills/task-control/scripts/tc.mjs next
   ```

   With a token that has the **admin** scope ("Project manager" preset), an agent can also set up and manage whole projects: one reviewed plan file (`skills/task-control/assets/plan.example.json` shows the shape) creates a project with its milestones, features and tasks.

5. REST reference: `/api/v1/openapi.json`.

Text written by people always reaches agents under `untrusted_content`.

## Deploy (Vercel + Convex Cloud)

Configure your own frontend and backend deployments; no shared deployment is provided.

1. Convex prod env: `BETTER_AUTH_SECRET`, `SITE_URL` (the Vercel URL), `SUPER_ADMIN_EMAILS`, `AUTH_PROXY_SECRET`, optional `ALERT_WEBHOOK_URL`.
2. `npx convex deploy` (backend), then `npx vercel deploy --prod` (web). Vercel env: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_SITE_URL`, `AUTH_PROXY_SECRET` (the same value, marked sensitive), optional `ALLOWED_COUNTRIES`.
