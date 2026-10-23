# Connecting a repository to Task Control

Read this when a session cannot reach Task Control, when rows do not move on
commit, or when the user asks you to connect a repository to a project.

## What a connected repository has

| Piece | Where | Who provides it |
|---|---|---|
| The address and project | `.taskcontrol.json` at the repository root, committed | You, from what the user tells you |
| A token | The keychain, or a private file | The user. Never you. |
| The two git hooks | The repository's shared hooks folder | `tc install-hooks` |
| This skill | `.claude/skills/task-control/` in the repository, or `~/.claude/skills/task-control/` | Whoever installed it |

Check with `tc whoami`. It prints the agent, the workspace, the token's scopes
and the project. An error from it names the piece that is missing.

## 1. `.taskcontrol.json`

```json
{ "url": "https://task-control.example.com", "project": "DEMO", "main": "main" }
```

- `url`: the Task Control address. Ask the user; do not guess it.
- `project`: the project key. Rows are numbered `KEY-1`, `KEY-2`, …
- `main`: the branch that counts as shipped. Leave it out when it is `main`.
- `agent`: optional. Which stored token to use when it is not `claude-code`.

Commit the file. It holds no secret.

## 2. The token

Tokens are made by a workspace admin in Task Control, under **Agents & API
tokens**: one agent per tool ("Claude Code", "Codex"), with the **Coding
agent** preset (read, comment, write). Ask the user to create it and to store
it themselves:

```bash
security add-generic-password -s task-control -a claude-code -w <tc_token>
```

- Codex uses `-a codex` and runs with `TASK_CONTROL_AGENT=codex`.
- Where there is no keychain, the token goes in
  `~/.config/task-control/<agent>.token` with mode 600, or in
  `TASK_CONTROL_TOKEN`.

Do not ask the user to paste a token into the chat, and never write one into
a file in the repository, a commit, a comment or a reply. If you are shown one
by accident, say so and suggest revoking it.

## 3. The hooks

```bash
node <this skill's folder>/scripts/tc.mjs install-hooks
```

It writes `post-commit` and `pre-push` into the repository's shared hooks
folder, so every worktree gets them.

- `post-commit` reports each commit whose subject names a row. The first one
  moves the row to In progress.
- `pre-push` reports what is pushed to the main branch. Those commits close
  their tasks. A commit made on a local `main` and not pushed has not landed.

Neither can fail or delay a commit. If a hook of the same name already exists
and is not ours, the command prints the one line to add to it instead of
overwriting. Add that line; do not use `--force` on a hook you did not write
without asking.

A skill installed inside the repository is found from every worktree. One
installed in the home folder is found by its full path, on this machine only.

## 4. The MCP server (optional)

```bash
claude mcp add --transport http task-control <url>/api/mcp --header "Authorization: Bearer tc_…"
```

The user runs this, since it carries the token. With it, the tools appear in
the session; without it, `tc` does the same things.

## 5. Tell other agents

Codex does not load skills. Give it the same rules by adding a short section
to the repository's `AGENTS.md`, which Claude Code also reads when `CLAUDE.md`
imports it:

```markdown
## Task Control

Work is tracked in Task Control, project `KEY`, as milestones > features >
tasks. Claude Code: use the `task-control` skill. Other agents: run
`node .claude/skills/task-control/scripts/tc.mjs help` and follow
`.claude/skills/task-control/SKILL.md`.

- Start of a session: `tc next`. Build what it lists, in that order.
- End every commit subject with the row's key: `fix(area): … (KEY-12)`.
- When a feature's tasks are closed and its commits are on `main`:
  `tc finish KEY-10 "what a person can do now; what was not verified"`.
- No progress comments, no statuses by hand, no evidence text.
```

Remove older instructions in the repository that describe another way of
reporting work, so two sets of rules do not compete. Ask before deleting
anything you did not write.

## When rows do not move

| What you see | Likely cause | Check |
|---|---|---|
| A commit with a key leaves the row in To do | The hooks are not installed, or the hook has no token | `ls "$(git rev-parse --git-common-dir)/hooks"`, then `TC_DEBUG=1 node …/tc.mjs commit` |
| The row starts but its task never closes | The commit has not been pushed to the main branch, or it got there without a push from this machine (a merge on a server) | `git branch -r --contains <sha>`; after a merge elsewhere, report it by hand with the `report_commits` tool |
| `tc` says the project is archived | The repository points at an old project | Ask the user which project is current, then fix `.taskcontrol.json` |
| "Invalid or expired token" | The token was revoked or has expired | Ask the user for a new one |
| The key in the subject is ignored | The key is not this project's (`ABC-12` in project `DEMO`), or it is not written as `KEY-number` | Fix the subject on the next commit; do not rewrite history for it |

Until the hooks work, `tc start KEY` moves a row to In progress by hand.
