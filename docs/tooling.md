# Tooling

## Executive Summary

- Bun is the runtime and package manager.
- `bun run check` is the full local gate.
- Biome, TypeScript, Fallow, markdownlint, link checks, duplication checks, and drift checks are wired into validation.
- Lefthook runs staged-file autofix for TypeScript, JSON, and project-authored Markdown.

## Commands

Install dependencies:

```sh
bun install
```

Run the CLI:

```sh
bun run todomcp -- --help
```

Run tests:

```sh
bun test
```

Run the full local gate:

```sh
bun run check
```

Validate the package binary from another Bun project:

```sh
bun install /path/to/todomcp
./node_modules/.bin/todomcp --help
```

## Tool Choices

- Bun is the runtime and package manager.
- TypeScript is strict and runs with `moduleResolution: "Bundler"`.
- Stricli powers command routing.
- Biome owns formatting and linting.
- Fallow provides repository quality evidence.
- Lefthook runs staged-file autofix on commit.

## GitHub Actions

CI uses `oven-sh/setup-bun` with Bun 1.3.14, installs with `bun install --frozen-lockfile`, and runs
`bun run check`. The local check script remains the source of truth for tests, Biome, TypeScript,
Markdown, link checks, duplication checks, drift checks, and Fallow.

## Documentation Checks

Project-authored Markdown is linted with `markdownlint-cli2`.

Generated skill files under `.agents/skills` are excluded from markdownlint because they are
materialized by `bunx skills`; update them with the skills tool instead of editing them by hand.

Internal Markdown links are checked by `scripts/check-links.ts`. External links are intentionally
out of scope for the fast local gate until the project needs network-mode documentation checks.

## Duplication Check

`jscpd` checks copy-paste duplication across source, scripts, docs, and root Markdown using
`.jscpd.json`. The threshold starts at 3% to keep the young codebase honest without treating
generated skills as authored source.

## Drift Check

`scripts/check-drift.ts` checks that the documented project structure matches the actual repository.
It verifies governance files, docs template files, agent symlinks, Bun-only lockfiles, required
package scripts, CI presence, package binary wiring, and generated-skill handling.
