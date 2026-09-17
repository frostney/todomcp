# Agent Instructions

## Hard Constraints

- Always validate. If source code is available, validate with source code.
- Bun is the only package manager and runtime for this repository; do not add npm, pnpm, or yarn lockfiles.
- The CLI is built with TypeScript and Stricli. Do not replace Stricli without a documented product reason.
- This is a local-first todo substrate for agent harnesses (MCP server primary, CLI secondary). Do not add a web, desktop, or mobile UI.
- SQLite is the state of record for todo status, dates, and ordering; the OKF bundle records context and rationale, never state.

## Runtime / Commands

Run the real gate before handing off:

```sh
bun install
bun run check
```

Useful focused commands:

```sh
bun run todomcp -- --help
bun test
bun run lint
bunx tsc --noEmit
```

## Code Organization

- `src/cli/` owns Stricli command routing, terminal output, and the REPL shell entrypoint.
- `src/app/` owns application services (todo/category/kind) shared by command mode and the REPL.
- `src/domain/` owns todo, category, kind, date, and time domain types and validation.
- `src/storage/` owns local persistence contracts and implementations.
- `docs/` owns architecture, tooling, and implementation planning.
- `.agents/skills/` contains generated or project-local skills used by agents.

## Testing

- Use `bun test`.
- Co-locate unit tests beside the public module they exercise, using `*.test.ts`.
- Reserve top-level test folders for future end-to-end or layer-specific suites.
- Prefer testing the domain parser/validation and CLI command behavior over implementation details.

## Safety / Boundaries

- Local todo data must stay on the local machine unless an explicit export or sync feature is implemented.
- Do not write secrets or private task content into logs, docs, examples, or test snapshots.
- Agent-facing output should support automation: stable text for humans, JSON for tools where commands return structured data.
