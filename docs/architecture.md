# Architecture

## Executive Summary

- todorepl is a Bun-first TypeScript CLI with no UI layer.
- Stricli owns command routing and generated help.
- REPL mode and command mode share the same domain and application behavior.
- Todos are date-centric and follow the PlanStack-inspired data shape.
- Local file-backed storage is the first durable persistence target.

## Product Shape

todorepl is a local-first command-line todo app for humans and agents. It has two entry modes:

- `todorepl` starts an interactive shell that reads commands from a `todo>` prompt.
- `todorepl <command>` runs a single automation-friendly command.

The interactive shell is a thin layer: it tokenizes each input line (honoring quotes so values with
spaces stay intact) and dispatches the tokens through the SAME Stricli app and `src/app/` application
services as command mode, so there is no duplicated command logic and no behavior drift between the
two modes. `help` shows command help and `exit` or `quit` ends the session. Command errors are
non-fatal in the shell: an unknown or invalid command prints an error and the prompt stays open.

Todos are date-centric by default, following the PlanStack model: a todo may belong to a `YYYY-MM-DD`
date and may also have a scheduled minute-of-day, duration, category, kind, and emoji. A kind's date
policy can make that date required, optional, or forbidden.

## Runtime Shape

- Bun runs the CLI directly from TypeScript.
- Stricli owns command routing and generated help.
- Domain validation lives outside the CLI so the REPL and command mode share behavior.
- Command mode and the REPL call the same application services in `src/app/`, so both entry modes
  share one behavior path over the domain and storage layers.
- Storage will be local-first and file-backed before any sync concept exists.

## Source Boundaries

- `src/cli/` handles Stricli routing, output, and the REPL shell.
- `src/app/` holds UI-agnostic application services (for example `todo-service.ts`) shared by command
  mode and the REPL; they orchestrate domain validation and storage so both entry modes share one
  code path. It sits between `src/domain/` and `src/storage/`, and `src/cli/` adapts it to Stricli
  and the REPL.
- `src/domain/` owns domain types and validation.
- `src/storage/` owns persistence contracts and implementations.
- `scripts/` owns project checks and one-off automation.

## Persistence

- All todos, categories, and kinds live in a single local SQLite database file (`todos.db`), opened through
  Bun's built-in `bun:sqlite` so no extra dependency is required.
- Data is split across `todos`, `categories`, and `kinds` tables, with indexes on `(date, status)`,
  `category_id`, and `kind_id` so those filters run as indexed SQL rather than scanning every row in
  memory.
- The schema is versioned through SQLite's `PRAGMA user_version`. Opening a newer or unsupported
  version fails with an actionable error; older local databases migrate forward (schema `1`→`2`
  added rollover columns; schema `2`→`3` adds `caused_by` and stops using the follow-up mark;
  schema `3`→`4` adds user-defined kinds, optional dates, and assigns existing todos a default kind).
- Writes that touch many rows (for example, import and forced category deletion) run inside an ACID
  transaction, so an interrupted write never leaves a half-applied state behind.
- A missing database bootstraps cleanly: the file and schema are created on first open.
- Corrupt or unreadable files fail with an actionable error that points the user at the file to
  inspect or remove.
- The repository exposes a query-shaped contract (`listTodos(filter)`, `getTodo` / `putTodo`,
  `listCategories` / `getCategory` / `putCategory`, atomic category deletion, kind CRUD with the same
  delete semantics, and `exportSnapshot` / `importSnapshot`) shared by REPL and command mode; it is
  defined in `src/storage/repository.ts` and implemented in `src/storage/sqlite-store.ts`.

## Categories

- Categories are first-class records with a name and optional color and emoji; they have no schedules
  in the MVP.
- Todos reference a category through `categoryId`, and category arguments resolve by exact id or
  exact (unique) name, so `--category <name-or-id>` on todo commands must point at an existing
  category or the command fails.
- Deleting a category that is referenced by todos is refused unless `--force` is given; with `--force`
  the category is removed and un-assigned from those todos, clearing their category.

## Kinds

- Kinds are first-class records, like categories, not a hardcoded enum of consumer names. Each kind
  has a name, a date policy (`required`, `optional`, or `none`), a rollover policy (`on` or `off`),
  an agenda placement (`day-grid`, `undated-strip`, or `hidden`), and optional color and emoji.
- Todos reference a kind through optional `kindId`. `--kind <name-or-id>` on `add` / `edit` / `list`
  must point at an existing kind or the command fails. Changing kind is a normal edit; if the
  destination kind requires a date and the item has none, the date defaults to today.
- Date is required only when the todo's kind says `required`. A kind with `date=none` rejects dates;
  a kind with `date=optional` allows undated items. Rollover skips kinds with rollover off.
- Opening a pre-kinds database seeds one default kind named after the existing item noun (`Todo`)
  with date required, rollover on, and day-grid placement, then assigns that kind to existing todos.
- Deleting a kind that is referenced by todos is refused unless `--force` is given; with `--force`
  the kind is removed and un-assigned from those todos, clearing their kind.

## Agent Workflow Shape

Every command that returns data supports `--json`. Human output can be pleasant, but machine-readable
output is part of the product surface, not a debug option. With `--json`, single-record commands
(`add`, `show`, `done`, `edit`, `move`, `delete`, `follow-up`) print one Todo object; `list` prints a Todo array;
`workstream` prints `{ root, duration, todos }`; `rollover` prints `{ date, count, todos }` and accepts optional todo ids to roll only those items;
the `category` subcommands print a Category object (or, for `category list`, a Category array);
the `kind` subcommands print a Kind object (or, for `kind list`, a Kind array);
`export` prints the snapshot object; and `import --json` prints an import summary.

### Todo JSON shape

A Todo object always carries these fields:

- `id` (string): stable unique id.
- `name` (string): todo text.
- `status` (string): `"open"` or `"done"`.
- `order` (number): position within its date.
- `createdAt`, `updatedAt` (string): ISO-8601 timestamps.

Optional fields are present only when set:

- `date` (string): `YYYY-MM-DD` the todo belongs to when its kind requires or allows a date.
- `categoryId` (string): id of the referenced category.
- `kindId` (string): id of the referenced kind.
- `emoji` (string).
- `scheduledTime` (number): minute of day (`0`-`1439`). CLI input uses 24-hour `HH:MM` format.
- `duration` (number): one of `15`, `30`, `60`.
- `completedAt` (string): ISO-8601 timestamp set when the todo is completed.
- `deletedAt` (string): ISO-8601 timestamp set when the todo is soft-deleted.
- `causedBy` (string): id of the parent todo that caused this one.
- `rolloverCount` (number): how many times daily rollover has moved this todo.
- `rolloverHistory` (array): `{ fromDate, toDate, rolledOverAt }` entries, oldest first.

### Category JSON shape

A Category object always carries `id`, `name`, `createdAt`, and `updatedAt`, plus optional `color`
and `emoji` when set.

### Kind JSON shape

A Kind object always carries `id`, `name`, `datePolicy`, `rollover`, `agendaPlacement`, `createdAt`,
and `updatedAt`, plus optional `color` and `emoji` when set.

### Export and import

`export` writes all active (non-soft-deleted) todos, categories, and kinds as a JSON snapshot to stdout. The snapshot is
`{ version, todos, categories, kinds }`, where `version` is the current schema version (`4`), `todos` is a
Todo array, `categories` is a Category array, and `kinds` is a Kind array. Output is deterministic: todos are ordered by
`date`, then `order`, then `id`, and categories and kinds by `name`, then `id`.

`import` reads a snapshot from `--file <path>` or, when no file is given, from stdin. It validates the
ENTIRE payload before mutating anything: malformed JSON, a missing or wrong-typed `version` / `todos`
/ `categories` (and `kinds` for schema 4), or any invalid record is rejected as a validation error, and existing data is left
unchanged. A valid import replaces the data set inside a single transaction. With `--json`, `import`
prints `{ "imported": { "todos": N, "categories": M, "kinds": K } }`; otherwise it prints a human-readable count.

### Exit codes

Commands signal outcomes through process exit codes so scripts can branch without parsing output:

- `0`: Success.
- `1`: Other or unexpected error, including an unknown command or bad flags.
- `2`: Validation or invalid input (also an ambiguous id prefix).
- `3`: Record not found.
- `4`: Storage failure (corrupt database or unsupported schema version).

## Drift Check

The project drift check in `scripts/check-drift.ts` compares documented structure claims with the
actual repo shape. It currently checks governance docs, docs template files, symlinks, required
scripts, Bun-only lockfiles, and generated-skill handling.
