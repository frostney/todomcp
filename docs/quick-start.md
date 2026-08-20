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

Use `--data path` to override the local file path for commands that accept data. Todos and categories
are stored in a local SQLite database with a versioned schema and transactional writes, and
`--data <path>` selects an alternate database file.

## Command Reference

Every data-returning command accepts `--data path` to select an alternate database file and `--json`
to emit that command's raw record(s) as JSON: a Todo (or a Todo array for `list`), a Category for the
`category` commands, the full snapshot for `export`, or an import summary for `import`. Any `<id>`
argument may be given as a unique id prefix, and any `<idOrName>` argument resolves a category by
exact id or exact (unique) name.

```text
todorepl add <name> [--date YYYY-MM-DD] [--time HH:MM] [--duration min]
                    [--category name] [--emoji char] [--data path] [--json]
todorepl list [--date YYYY-MM-DD] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
              [--category name] [--status open|done] [--scheduled] [--unscheduled]
              [--include-deleted] [--data path] [--json]
todorepl show <id> [--data path] [--json]
todorepl done <id> [--data path] [--json]
todorepl edit <id> [--name text] [--time HH:MM] [--duration min]
                   [--category name] [--emoji char] [--data path] [--json]
todorepl move <id> <date> [--data path] [--json]
todorepl delete <id> [--data path] [--json]
todorepl category create <name> [--color hex] [--emoji char] [--data path] [--json]
todorepl category list [--data path] [--json]
todorepl category show <idOrName> [--data path] [--json]
todorepl category edit <idOrName> [--name text] [--color hex] [--emoji char]
                       [--data path] [--json]
todorepl category delete <idOrName> [--force] [--data path] [--json]
todorepl export [--data path] [--json]
todorepl import [--file path] [--data path] [--json]
todorepl --help
todorepl --version
```

`add` creates a todo on a date (defaulting to today). `list` filters by date, range, category, status,
and scheduling, and hides soft-deleted todos unless `--include-deleted` is set. `show` and `done`
inspect and complete a single todo, `edit` updates its fields, `move` reschedules it to another date,
and `delete` performs a soft delete. The `category` subcommands create, list, show, edit, and delete
categories, which carry a name plus optional color and emoji and are referenced by exact id or exact
(unique) name. On todo commands, `--category <name-or-id>` resolves to an existing category, and a
category that does not exist is an error. Deleting a category referenced by todos is refused unless
`--force` is given, which deletes the category and un-assigns it from those todos (their category is
cleared). `export` writes the full data set as a deterministic JSON snapshot
(`{ version, todos, categories }`) to stdout, and `import` reads such a snapshot from `--file path` or
stdin, validating the whole payload before it replaces the current data. Print machine-readable output
by adding `--json`:

```sh
bun run todorepl -- list --json
```

## Validate

```sh
bun run check
```
