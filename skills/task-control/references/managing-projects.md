# Setting up and managing a project

Read this when the user asks you to create a project, plan or change
milestones, load a plan into Task Control, archive a project, set the order,
or give someone access.

## Who may do this

Projects and milestones are the owner's. You act on them only when both are
true:

1. The session's token has the `admin` scope (`tc whoami` lists the scopes).
   A workspace admin grants it with the **Project manager** preset.
2. The owner asked for this change, in this conversation.

Without the scope, say what you would do and ask the user to do it in the app
or to provide such a token. With it, still treat the structure as theirs:
propose, get a yes, then write.

Some things stay a person's with any token: accepting a feature or sending it
back, and creating accounts, workspaces, agents or tokens.

## Setting up a project from a plan file

This is the way to load more than a handful of rows. The plan is a file the
owner can read and change before anything exists.

1. **Write the plan** as JSON in the repository (for example
   `docs/plans/task-control-plan.json`). `assets/plan.example.json` in this
   skill shows the shape. Build it from what the user gives you: plan
   documents, the work in flight, an old tracker.
2. **Check it:** `tc plan FILE --check`. It tests every title, acceptance
   count and task count against the limits and writes nothing. Fix what it
   reports.
3. **Show the user the file and wait for their approval.** Tell them the
   counts (milestones, features, tasks) and anything you were unsure of. This
   step is the point of the file: it is much cheaper to change a line now
   than a hundred rows later.
4. **Apply it:** `tc plan FILE`. It creates the project if the plan names one
   that does not exist, then the milestones, features with their tasks,
   backlog proposals and notes.
5. **Running it again is safe.** Milestones are updated; rows whose title
   already exists are skipped. So a plan can grow and be re-applied.

### The plan file

| Field | Meaning |
|---|---|
| `project` | `{ key, name, description? }`. Left out, the plan goes into the project in `.taskcontrol.json`. |
| `origin` | Who approved the plan and when. Every feature gets it, so they start ready. |
| `milestones[]` | `key`, `name`, `goal`, `exitCriteria` (a list of lines), and optionally `track`, `agentHours`, `order`. Order in the file is build order. |
| `milestones[].features[]` | `title`, `why`, `acceptance` (a list of 2–5 lines), and optionally `type` (`bug`), `label`, `tier`, `days`, `tasks`, `urgent`. |
| `…features[].tasks[]` | A title, or `{ title, tier }`. Seven at most, in build order. |
| `backlog[]` | Features with no milestone yet: proposals for the owner to place. |
| `notes[]` | A line, or `{ title, type: "finding" | "idea" }`. |

### Sizing a plan

- **A milestone** is an outcome that ships, with three to seven exit lines a
  person can check. It holds 5 to 15 features. Over 20, it is two milestones.
- **A feature** is one thing a person can do afterwards, 0.5 to 3 agent-days.
  If you cannot write its acceptance in five lines, split it.
- **Do not turn every bullet of a plan document into a row.** A plan's steps
  are usually tasks under a few features, and its background is the `why`.
  When you carry over an old tracker, group its small rows under the features
  they belong to instead of copying them one for one.
- **What is already built is not planned work.** Leave it out, or it will sit
  in the queue asking to be built again.

## One change at a time

| You want to | `tc` | MCP tool |
|---|---|---|
| Create a project | `tc project create KEY "Name"` | `create_project` |
| Rename, change capacity | `tc project set --name "…" --hours-per-day 4` | `update_project` |
| Archive or restore | `tc project set --archive` / `--restore` | `update_project` |
| Create or change a milestone | `tc milestone M2 "Name" --goal "…" --exit "…" --exit "…"` | `set_milestone` |
| Close a milestone | `tc milestone M2 --close` | `set_milestone` with `closed: true` |
| Load many rows | `tc plan FILE` | `create_tasks` (50 per call) |
| "Do this next" | `tc first KEY` | `rank_first` |
| Say what waits on what | `tc deps KEY --on OTHER` | `set_dependencies` |
| See people and their ids | `tc members` | `list_members` |
| Give someone access | | `set_project_member` |
| Remove a row made by mistake | `tc delete KEY` | `delete_task` |

Things worth knowing before you use them:

- **Archiving makes a project read-only for everyone**, agents included.
  Nothing is deleted and its keys still open. It is how an old project is
  retired when work moves to a new one. Do it only when the owner says the
  move is complete, because agents still pointed at it will be refused.
- **A milestone closes only when** every feature in it is done or dropped and
  every note under those features has been decided. The refusal says how many
  are left.
- **Only an empty milestone can be deleted.** Move its rows first.
- **`tc first` changes the owner's order.** Use it when they say "do this
  next", not to bring forward what you would rather build.
- **Delete is for mistakes**: a duplicate, a row in the wrong project. A row
  with commits, or one that holds tasks, cannot be deleted; drop it with
  `tc drop KEY "reason"` so the record stays.
- **A new project needs its own key.** An archived project keeps its key,
  because old commits and documents point at it.

## Moving a repository to a new project

1. Create the new project and load the plan (above).
2. Point the repository at it: change `project` in `.taskcontrol.json` and
   commit.
3. Carry over what is in flight: features being built, and features waiting
   for the owner's acceptance. Ask the owner how to treat the second group.
4. When the owner confirms nothing is left behind, archive the old project.
