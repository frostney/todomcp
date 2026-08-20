# todorepl implementation plan

## Executive Summary

- Build the product in six slices: storage, todo commands, category commands, REPL, agent workflow surface, and release readiness.
- Keep PlanStack as a data-shape reference, not a backend or UI source.
- Keep REPL and command mode on shared application services.
- Re-run `grill-with-docs` before adding sync, recurrence, category schedules, or calendar concepts.

This plan was produced after defining and reading the project-local `grill-with-docs` skill, then
checking the current todorepl scaffold, Herakles' Bun/TypeScript/Stricli conventions, and
PlanStack's source-backed todo model.

## Settled Product Decisions

- todorepl has two equal entry modes:
  - `todorepl` opens an interactive REPL shell.
  - `todorepl <command>` runs a single command for scripts and agents.
- Command mode and REPL mode must call the same application services. The REPL is a shell over the
  command model, not a second implementation.
- The product is local-first. The first durable store is a local file; sync is out of scope until a
  later issue explicitly introduces it.
- Every data-returning command should support stable human output and `--json` output for agentic
  workflows.
- Todos are date-centric, following the PlanStack shape:
  - `date` is a required `YYYY-MM-DD` anchor.
  - `scheduledTime` is optional minutes from midnight, with any minute of the day allowed.
  - `duration` is optional and starts with PlanStack-compatible `15 | 30 | 60` minute values.
  - `categoryId` is optional.
  - `emoji` is optional.
  - `deletedAt` is reserved for soft delete once deletion exists.
- Categories are first-class records with `name`, optional `emoji`, and optional `color`.

## Implementation Slices

### 1. Local Persistence Foundation

Build a file-backed store with atomic read/write helpers, schema versioning, deterministic IDs, and
safe default location handling. The store should be usable from tests through temporary paths and
from the CLI through a `--data <path>` override.

Acceptance shape:

- A repository interface owns todos and categories.
- The default data path is documented and overridable.
- Missing data files bootstrap cleanly.
- Corrupt or incompatible files fail with actionable errors.
- Writes avoid partial-file corruption.

### 2. Todo CRUD Commands

Implement `add`, `list`, `show`, `done`, `edit`, `move`, and `delete` against the shared repository.
`delete` should soft-delete. `list` should filter by date range, category, completion state, and
scheduled/unscheduled state.

Acceptance shape:

- `add` accepts name, date, optional time, duration, category, and emoji.
- `list --json` returns stable machine-readable records.
- Human list output is compact and deterministic.
- Commands return non-zero with useful messages for invalid input.
- Domain validation is shared with the REPL.

### 3. Category Commands

Implement category creation, listing, update, and delete/archive semantics. The first version should
not require category schedules, but it should leave the data model able to grow toward them later.

Acceptance shape:

- Users can create categories with name, emoji, and color.
- Todo filters can resolve category names or IDs consistently.
- Removing a category has an explicit behavior for existing todos.

### 4. REPL Shell

Turn the placeholder shell into a real command loop over the same command handlers used by Stricli.
The shell should support help, history-friendly output, and graceful exit.

Acceptance shape:

- `todorepl` opens the shell.
- REPL commands cover the same MVP commands as command mode.
- Errors do not crash the shell.
- The shell can print command help without leaving the session.

### 5. Agent Workflow Surface

Harden automation affordances: JSON output, predictable exit codes, import/export, and examples for
agents that need to create or inspect todos during a larger workflow.

Acceptance shape:

- JSON output has documented shapes.
- Exit code rules are documented.
- Export writes all active data in a stable format.
- Import validates before mutating existing data.
- README includes agent workflow examples.

### 6. Quality, Packaging, and Release Readiness

Finish the project foundation for day-to-day contribution and eventual package publication.

Acceptance shape:

- `bun run check` remains the real local gate.
- GitHub Actions run install, tests, Biome, TypeScript, and Fallow.
- The package binary is executable as `todorepl`.
- README and docs cover install, usage, data location, and command reference.

## Implementation-Time Checks

- Re-run `grill-with-docs` before adding sync, recurrence, category schedules, or calendar concepts.
- Keep PlanStack as a data-shape reference, not a backend/UI migration source.
- Do not add a UI layer.
- Do not duplicate command behavior between REPL and command mode.
