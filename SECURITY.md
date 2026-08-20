# Security Policy

## Supported versions

We currently support the latest release of the `@opennest/*` packages on the
`main` branch. Releases are not versioned independently; the monorepo moves as
a single unit.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Everything else | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report vulnerabilities privately to the maintainer at
[@Zepoze](https://github.com/Zepoze) (or via GitHub's private reporting
feature if enabled on the repository).

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept.
- Affected package(s) and versions.

We aim to acknowledge reports within 48 hours and provide a fix and
coordinated disclosure as quickly as possible.

## Scope

Security reports are welcome for anything in this repository, in particular:

- The HomeDSL parser and its handling of untrusted input.
- The VM interpreter and device resolution logic.
- The SDK and its `OpenNestClient` facade.

## Disclosure

Once a fix is released, we will coordinate a public disclosure and credit the
reporter (unless they prefer to remain anonymous).
