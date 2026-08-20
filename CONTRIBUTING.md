# Contributing to OpenNest

Thanks for your interest in contributing! OpenNest is a monorepo exposing a
DSL runtime for smart environments. This document explains how to set up your
environment, make changes, and submit them.

## Code of Conduct

All contributors are expected to follow our
[Code of Conduct](./CODE_OF_CONDUCT.md). Please read it before participating.

## Development setup

OpenNest uses [pnpm](https://pnpm.io/) workspaces and TypeScript.

```bash
pnpm install
pnpm run build
pnpm run test
```

The monorepo contains the `@opennest/*` packages under `packages/` and the
examples (TUI playground, web playground) under `examples/`.

## Common commands

| Command | Description |
|---|---|
| `pnpm run lint` | Run ESLint on `examples/` and `packages/` |
| `pnpm run format:check` | Verify Prettier formatting |
| `pnpm run format` | Apply Prettier formatting |
| `pnpm run build` | Build all packages |
| `pnpm run test` | Run all package test suites |
| `pnpm run start` | Launch the playground REPL |

## Making changes

1. Open or find the relevant issue.
2. Create a branch off `main`.
3. Make your changes, keeping commits **atomic** (one commit per logical group
   of files).
4. Ensure `pnpm run lint` and `pnpm run format:check` pass.
5. Add or update tests for your changes.
6. Open a pull request using the template.

### Commit style

Follow the [Conventional Commits](https://www.conventionalcommits.org/)
convention (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, …) and keep each
commit focused on a single concern.

### Commit attribution

Code agents acting on behalf of the project sign their commits with the
maintainer's identity (`Zepoze`). Do not attribute commits to a generic bot or
throwaway account.

## Pull requests

- Fill in the pull request template.
- Reference the issue it closes.
- Make sure CI (lint, format check, build, tests) is green.

## Reporting bugs

Use the bug report template and include steps to reproduce, expected vs.
actual behavior, and your environment (OS, Node/pnpm versions, package).

## Questions?

Open an issue or reach out to the maintainer
[@Zepoze](https://github.com/Zepoze).
