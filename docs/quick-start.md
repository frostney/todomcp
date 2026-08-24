# Quick Start

## Executive Summary

- Install dependencies with `bun install`.
- Run the CLI with `bun run todorepl -- --help`.
- Start REPL mode with `bun run todorepl`.
- Run the full local gate with `bun run check`.

## Install

```sh
bun install
```

## Run

Print command help:

```sh
bun run todorepl -- --help
```

Start the interactive shell:

```sh
bun run todorepl
```

The shell prints a `todo>` prompt and accepts the same commands as command mode, one per line:

```text
todo> add "Buy milk" --date 2026-06-24
todo> list
todo> done <id>
todo> category list
```

Arguments are tokenized the way a shell tokenizes them, so wrap any value that contains spaces in
quotes (for example `add "Buy milk"`). Type `help` for command help, and `exit` or `quit` to leave
the shell. A bad command (unknown or invalid input) prints an error but keeps the session open.

Run one command:

```sh
bun run todorepl -- list
```

Resolve a specific local data file path:

```sh
bun run todorepl -- add "Draft launch notes" --data ./local.todos.db
```

The package binary exposes the same command surface after local linking or package install:

```sh
todorepl --help
```

## Data Location

By default, todorepl resolves its local data file to:

- macOS: `~/Library/Application Support/todorepl/todos.db`
- Linux and other XDG platforms: `$XDG_DATA_HOME/todorepl/todos.db`, or
  `~/.local/share/todorepl/todos.db` when `XDG_DATA_HOME` is unset
- Windows: `%LOCALAPPDATA%\todorepl\todos.db`, or
  `~/AppData/Local/todorepl/todos.db` when `LOCALAPPDATA` is unset

Use `--data path` to override the local file path for commands that accept data. Todos, categories, and kinds
are stored in a local SQLite database with a versioned schema and transactional writes, and
`--data <path>` selects an alternate database file.

## Command Reference

Every data-returning command accepts `--data path` to select an alternate database file and `--json`
to emit that command's raw record(s) as JSON: a Todo (or a Todo array for `list`), a Category for the
`category` commands, a Kind for the `kind` commands, the full snapshot for `export`, or an import
summary for `import`. Any `<id>` argument may be given as a unique id prefix, and any `<idOrName>`
argument resolves a category or kind by exact id or exact (unique) name.

```text
todorepl add <name> [--date YYYY-MM-DD] [--time HH:MM] [--duration min]
                    [--category name] [--kind name] [--emoji char]
                    [--data path] [--json]
todorepl list [--date YYYY-MM-DD] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
              [--category name] [--kind name] [--status open|done] [--scheduled] [--unscheduled]
              [--caused-by id] [--include-deleted] [--data path] [--json]
todorepl show <id> [--data path] [--json]
todorepl done <id> [--data path] [--json]
todorepl edit <id> [--name text] [--time HH:MM] [--duration min]
                   [--category name] [--kind name] [--emoji char] [--data path] [--json]
todorepl move <id> <date> [--data path] [--json]
todorepl delete <id> [--data path] [--json]
todorepl follow-up <id> <name> [--data path] [--json]
todorepl workstream <id> [--data path] [--json]
todorepl rollover [id ...] [--data path] [--json]
todorepl category create <name> [--color hex] [--emoji char] [--data path] [--json]
todorepl category list [--data path] [--json]
todorepl category show <idOrName> [--data path] [--json]
todorepl category edit <idOrName> [--name text] [--color hex] [--emoji char]
                       [--data path] [--json]
todorepl category delete <idOrName> [--force] [--data path] [--json]
todorepl kind create <name> [--date-policy required|optional|none]
                 [--rollover on|off] [--agenda day-grid|undated-strip|hidden]
                 [--color hex] [--emoji char] [--data path] [--json]
todorepl kind list [--data path] [--json]
todorepl kind show <idOrName> [--data path] [--json]
todorepl kind edit <idOrName> [--name text] [--date-policy required|optional|none]
                 [--rollover on|off] [--agenda day-grid|undated-strip|hidden]
                 [--color hex] [--emoji char] [--data path] [--json]
todorepl kind delete <idOrName> [--force] [--data path] [--json]
todorepl export [--data path] [--json]
todorepl import [--file path] [--data path] [--json]
todorepl --help
todorepl --version
```

`add` creates a todo on a date (defaulting to today unless the chosen kind makes the date
optional or forbidden). `list` filters by
date, range, category, kind, status, scheduling, and `causedBy` parent, and hides soft-deleted todos unless
`--include-deleted` is set. `show` and `done` inspect and complete a single todo, `edit` updates its
fields, `move` reschedules it to another date, and `delete` performs a soft delete. `follow-up`
creates a new open todo dated today, caused by the resolved parent and inheriting its category.
`workstream` walks to the root via `causedBy` and reports the tree plus duration sum.
`rollover` moves unfinished (open, not done, not deleted) todos with a date before today onto today,
skipping items whose kind has rollover off. Pass one or more ids to roll only those todos. It records
`rolloverCount` plus `{ fromDate, toDate, rolledOverAt }` history. The `category` subcommands create, list, show, edit, and delete
categories, which carry a name plus optional color and emoji and are referenced by exact id or exact
(unique) name. The `kind` subcommands manage user-defined item kinds with a date policy
(`required`, `optional`, or `none`), rollover (`on` or `off`), agenda placement
(`day-grid`, `undated-strip`, or `hidden`), and optional color and emoji. On todo commands,
`--category <name-or-id>` and `--kind <name-or-id>` resolve to existing records, and a missing
name is an error. Deleting a category or kind referenced by todos is refused unless
`--force` is given, which deletes the record and un-assigns it from those todos. `export` writes the full data set as a deterministic JSON snapshot
(`{ version, todos, categories, kinds }`) to stdout, and `import` reads such a snapshot from `--file path` or
stdin, validating the whole payload before it replaces the current data. Print machine-readable output
by adding `--json`:

```sh
bun run todorepl -- list --json
```

## Validate

```sh
bun run check
```
