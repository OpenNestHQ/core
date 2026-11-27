# Contributing to OpenNest

Thanks for your interest in contributing! OpenNest is a monorepo exposing a
DSL runtime for smart environments. This document explains how to set up your
environment, make changes, and submit them.

## Code of Conduct

All contributors are expected to follow our
[Code of Conduct](./CODE_OF_CONDUCT.md). Please read it before participating.

## Development setup

OpenNest uses [pnpm](https://pnpm.io/) workspaces and TypeScript. Node.js
`>=24` is required.

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
| `pnpm run lint` | Run ESLint on `examples/`, `packages/` and `scripts/` |
| `pnpm run format:check` | Verify Prettier formatting |
| `pnpm run format` | Apply Prettier formatting |
| `pnpm run build` | Build all packages |
| `pnpm run test` | Run all package test suites |
| `pnpm run test:coverage` | Run all tests with coverage (what CI runs) |
| `pnpm run test:scripts` | Test the release scripts in `scripts/` |
| `pnpm run release:check` | Build, then check that the packages can be released (needs the npm registry) |
| `pnpm changeset` | Describe a change for the next release |
| `pnpm run start` | Launch the playground REPL |

## Making changes

1. Open or find the relevant issue.
2. Create a branch off `develop`.
3. Make your changes, keeping commits **atomic** (one commit per logical group
   of files).
4. Ensure `pnpm run lint` and `pnpm run format:check` pass.
5. Add or update tests for your changes.
6. If you changed a published package (`packages/*`), run `pnpm changeset` and
   commit the generated file. See [Releasing](./docs/releasing.md) for the bump
   rules and how changes reach npm.
7. Open a pull request against `develop` (not `main`) using the template.

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
- Make sure CI is green. It runs lint, format check, build, tests with
  coverage, the release script tests, `release:check`, and checks that the
  generated prompt (`packages/lang-core/example-prompt.md`) is up to date — run
  `pnpm run build:prompt` and commit the result if you change the prompt. It
  also reports a missing changeset, without failing.

## Reporting bugs

Use the bug report template and include steps to reproduce, expected vs.
actual behavior, and your environment (OS, Node/pnpm versions, package).

## Questions?

Open an issue or reach out to the maintainer
[@Zepoze](https://github.com/Zepoze).
