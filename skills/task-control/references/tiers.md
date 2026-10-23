# Tiers, models and effort

Read this when you split a feature into tasks, or when you lead other agents
and have to choose who builds what.

A row never names a model. It carries a tier, and this table maps the tier to
a model and effort. When the models change, this table changes and no row
does.

| Tier | Use when | Claude Code | Codex | Checked by |
|---|---|---|---|---|
| `routine` | The task says exactly what to change and where, the pattern already exists in the code, and the checks would catch a mistake | Configured routine model, high; xhigh across several files | Configured routine model, medium; high across several files | The checks |
| `standard` (default) | It needs judgement inside one area, following patterns the repository already has | Configured standard model, medium for screens and pattern work, high for logic across files | Configured standard model, medium for screens and pattern work, high for logic across files | The checks, and the lead reads the diff |
| `critical` | It touches a protected path, or nobody knows the cause or the design yet | Configured review model, high; xhigh for writes to an outside system and unknown-cause bugs. Never a worker. | Configured review model, high; xhigh for the same two cases | The checks, plus a review by a different model than the one that built it |

"Protected" means money, writes to an outside system, the separation of one
client's data from another's, permissions, schema changes and erasure. A
repository lists its own protected paths in its `AGENTS.md`. `critical` is a
rule, not a judgement: a one-line change to a protected path is critical.

## What each tier looks like

- **Routine:** a fix at a named file and line; user-visible strings and
  wording; style and token swaps; tests for a rule that already exists; docs
  written from existing code; renames and dead-code removal across many
  files; a scan that lists occurrences.
- **Standard:** a feature slice end to end in one area (the query or
  mutation, its screen, its tests); screens, forms, tables and editors; a bug
  with a known reproduction; a refactor inside one module.
- **Critical:** anything on a protected path; a design that crosses
  subsystems; concurrency, idempotency and reconciliation; a bug whose cause
  is unknown; merging teams' branches and gating a release.

Splitting a feature into tasks and writing its acceptance is itself work for
the strongest model. It costs few tokens and decides everything after it.

## Setting the tier

Set it per task when you split the feature, because that is when you know
which files each slice touches: `tc task PARENT "…" --tier routine`, or
`tier` on each item of `tasks` in `create_task`. A feature with no tasks
carries its own tier. Leave `standard` unset; it is the default.

## Taking work

A session cannot change its own model. Ask only for what you may take:
`tc next --tier standard` leaves out features that need `critical`, and
tells you how many it left out. Do not start one of those and hope.

## Leading other agents

Pass each worker the model and effort from the table when you start it. In
Claude Code that is the `model` and `effort` of the agent you spawn; in Codex,
`codex exec -m <model> -c model_reasoning_effort=<effort>`. Give a worker one
task, its files, and the feature's acceptance lines.

Move a task when the tier turns out wrong:

- **Routine to standard** when the worker has to make a decision the task
  does not state, needs a file the task did not name, or fails the checks
  twice.
- **Standard to critical** when the work reaches a protected path, the cause
  is not found in one attempt, or the owner sends the feature back twice.
- **Critical hands down** once the design is settled and the tasks are
  written. The strongest model does not build routine or standard tasks
  itself.

Change the row's tier when you move it (`update_task` with `tier`), so the
record shows what the work really needed. That record is how the table gets
tuned.
