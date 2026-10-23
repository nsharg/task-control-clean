# Connecting a repository to Task Control

What to do once in a repository whose work is tracked in a Task Control
project that follows the [work contract](work-contract.md). The
[`task-control` skill](../skills/task-control/SKILL.md) carries the rules and
the `tc` script, so most of this is installing it.

## 1. Give each agent its own token

In Task Control, open **Agents & API tokens**. Create one agent per tool that
will write ("Claude Code", "Codex") and give each a token with the **Coding
agent** preset (read, comment, write). The row history then shows who did
what.

Keep each token in the macOS keychain, under the agent's name:

```bash
security add-generic-password -s task-control -a claude-code -w <tc_token>
```

```bash
security add-generic-password -s task-control -a codex -w <tc_token>
```

A Codex session sets `TASK_CONTROL_AGENT=codex`; Claude Code needs nothing.
Where there is no keychain, put the token in
`~/.config/task-control/<agent>.token` (mode 600) or in `TASK_CONTROL_TOKEN`.

## 2. Install the skill in the repository

Copy the folder `skills/task-control` from this repository to
`.claude/skills/task-control` in the other one, and commit it. Every worktree
and every teammate then has the skill and the script.

```bash
cp -R "<task-control>/skills/task-control" .claude/skills/task-control
```

To have it in every repository on one machine instead, copy it to
`~/.claude/skills/task-control`.

## 3. Ask Claude to connect the repository

> Connect this repository to Task Control project `DEMO` at
> `https://task-control.example.com`.

Claude follows the skill's [setup steps](../skills/task-control/references/setup.md):
it writes `.taskcontrol.json`, installs the two git hooks, checks the
connection, and adds a short section to `AGENTS.md` so Codex follows the same
rules. To do it by hand:

```bash
node .claude/skills/task-control/scripts/tc.mjs install-hooks
```

```bash
node .claude/skills/task-control/scripts/tc.mjs whoami
```

## 4. Add the MCP server where you want the tools (optional)

```bash
claude mcp add --transport http task-control https://task-control.example.com/api/mcp --header "Authorization: Bearer tc_…"
```

Codex takes the same address and header in its MCP settings. The server sends
the short form of the contract to every client that connects. Where MCP is
not configured, the script does the same things.

## Setting up a new project with Claude

This needs a token with the **admin** scope (the "Project manager" preset),
because creating projects and milestones is otherwise a person's job. Keep it
apart from the everyday coding token, and revoke it when the setup is done if
you prefer.

1. **Ask Claude for a plan file:** "Draft a Task Control plan for this
   repository: the milestones, and under each its features with acceptance
   lines and tasks, from the current plans and the work in flight."
2. **Claude checks it** against the contract's limits, writing nothing.
3. **You read the file and approve it.** It is a normal file in a normal
   diff: change a line, drop a feature, reorder.
4. **Claude applies it.** The project, milestones, features, tasks, backlog
   proposals and notes are created. Applying it again skips what is there, so
   a plan can grow.

The skill's [managing-projects reference](../skills/task-control/references/managing-projects.md)
has the file format and every management command.

What an agent cannot do with any token: create accounts, workspaces, agents
or tokens. Accepting a feature or sending it back needs the **decide**
scope, which no other scope implies.

## Letting an agent answer Needs you (optional)

Any coding-agent token can go through the Needs you page and leave a
suggested answer on each row, with a reason. You confirm each one, or all of
them at once from the page header.

To have an agent answer for you when you ask ("go through Needs you and close
what you can"), give it a token with the **Owner's assistant** preset (read,
comment, write, decide). It answers only when you have told it to in that
session, and the row history names it with its reason. Keep that token
apart from the everyday coding token if other people's sessions use it.

## What happens then

| You do | Task Control does |
|---|---|
| Commit `… (DEMO-12)` on any branch | DEMO-12 goes to In progress, and so does its feature; the commit is listed on both |
| Push to `main` | Every task named in the pushed commits goes to Done |
| `tc finish DEMO-10 "…"` | The feature goes to In review and appears on the owner's Needs you page |
| The owner presses Accept | Done |
| The owner presses Send back | In progress again; `tc next` shows the reason first |
