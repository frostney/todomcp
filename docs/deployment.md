# Deployment

## Executive Summary

- todomcp is not deployed as a service.
- Release readiness means the package binary works as `todomcp`.
- GitHub Actions should run the same validation surfaces as local development.
- Publication should wait until the command surface is implemented beyond the scaffold.

## Package Readiness

The package exposes the `todomcp` binary from `package.json`. Before publication, verify the binary
works through a package install or link flow, not only through `bun run`.

The binary currently points at `src/cli/main.ts`, which has a Bun shebang and must remain executable
in Git. The package is not published yet; use a local package install to verify the bin path until a
release workflow exists.

## CI

CI should install with Bun and run:

```sh
bun run check
```

The GitHub Actions workflow installs dependencies with `bun install --frozen-lockfile` and then runs
the local check gate. That gate includes tests, Biome, TypeScript, documentation checks, link checks,
duplication checks, drift checks, and Fallow.

## Rollback

Until package publication exists, rollback is just a Git revert. Once releases exist, document the
package-manager-specific rollback path here.
