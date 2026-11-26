# Releasing

How the `@opennest/*` packages get from a feature branch to npm. Versions are
managed with [Changesets](https://changesets.dev); publishing is done by
[`release.yml`](../.github/workflows/release.yml), never from a local machine
(`pnpm run release` publishes for real).

Published: `@opennest/lang-core`, `@opennest/devices`, `@opennest/vm`,
`@opennest/vm-opentelemetry`, `@opennest/sdk`, `@opennest/mcp`. The
`examples/*` packages are never published.

## Branch flow

```
feat/xxx ──PR + changeset──▶ develop ──release PR──▶ main
                                                      │  push: release.yml
                                                      ▼
                               PR "chore(release): version packages"
                                                      │  merge: release.yml
                                                      ▼
                                   npm publish + git tags + GitHub Releases
                                                      │
develop ◀──────────────────PR main → develop──────────┘
```

- `develop` is where work lands; `main` is what is published.
- Every push to `main` runs `release.yml`: the `verify` job (checks only), then
  the `release` job. With pending changesets, it opens or updates the version
  pull request. Without any, it publishes the versions that are not on npm yet.

## Changesets and version bumps

In a pull request that changes a published package, run `pnpm changeset` and
commit the generated file in `.changeset/`. Changes limited to `examples/*`,
tests, CI or docs need none. The `Changeset status` CI step is only a reminder
and never fails the job.

The six packages form a `fixed` group
([config](../.changeset/config.json)): a changeset on any of them releases all
six with the same version number.

While the version is `0.x`:

| Bump    | Use for                          |
| ------- | -------------------------------- |
| `minor` | a breaking change or new feature |
| `patch` | a fix                            |

Do not pick `major`: it moves all six packages to `1.0.0`.

`pnpm run version-packages` is normally run by CI only. Running it locally
requires a `GITHUB_TOKEN` (`read:user` and `repo:status`), used by
`@changesets/changelog-github`.

## Release procedure

Merge the release and back-merge pull requests with a **merge commit**, not a
squash, so that both branches keep a shared history.

1. [ ] Optional local check: `pnpm run release:check`.
2. [ ] Open a pull request `develop` → `main`, wait for green CI, merge it.
3. [ ] Wait for `release.yml` to open or update "chore(release): version
       packages". Review the versions and changelogs.
4. [ ] Merge it. This publishes.
5. [ ] [Check what was published](#check-what-was-published).
6. [ ] Open a pull request `main` → `develop` to bring back the versions and
       changelogs. If it conflicts, resolve on a branch created from `main`.

### Check what was published

```bash
for p in lang-core devices vm vm-opentelemetry sdk mcp; do
  echo "$p $(npm view "@opennest/$p" version)"
done
```

- [ ] All six show the new version.
- [ ] Their npm pages show provenance.
- [ ] Git tags and GitHub Releases exist.

### When something goes wrong

**A publish failed partway.** Versions already on npm are skipped by the next
publish. How to run it depends on where the cause is:

- **Outside the repository** (`NPM_TOKEN`, npm settings, GitHub App
  permissions, registry or GitHub outage): fix it, then re-run the failed
  workflow run.
- **In the repository** (workflow file, manifests, code): a re-run uses the old
  commit and the old workflow file, so the fix has to reach `main`.
  - Branch from `main` and open the pull request against `main`: `develop` may
    carry pending changesets.
  - The push must carry **no changeset**, and `main` must hold no other pending
    one (`.changeset/` has no `.md` file besides `README.md`). Otherwise
    `release.yml` opens a version pull request instead of publishing, and
    merging it skips the missing versions. If `main` already has some, remove
    them in the same pull request and add them back on `develop` after the
    back-merge.
  - The push then publishes the missing versions. Finish with the pull request
    `main` → `develop`.

**A release run was superseded.** The concurrency group of `release.yml` keeps a
single pending run, so a newer push to `main` can replace it. The replaced run
shows as **cancelled** in the Actions tab. If it belonged to a merged version
pull request and the newer push carries new changesets, that version is not
published: re-run the cancelled run.

In every case, check [all six packages](#check-what-was-published) on npm before
merging any further version pull request. Neither recovery has been exercised
yet.

## First publication

The first release uses a temporary token: a package must already exist on npm
before a trusted publisher can be configured for it (see the
[`npm trust` prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust#prerequisites)).

> **Deadline:** npm has announced that granular tokens will lose
> [direct publishing in January 2027](https://docs.npmjs.com/about-access-tokens).
> Past that, this procedure needs to be revisited (verify on npmjs.com).

### Prerequisites

- [ ] Your npm account has 2FA and can create packages in the `@opennest` scope.
- [ ] The OpenNest GitHub App installation on `OpenNestHQ/core` grants
      **Contents: write** and **Pull requests: write**, and the repository
      secrets `OPENNEST_BOT_CLIENT_ID` and `OPENNEST_BOT_PRIVATE_KEY` exist.
      The release fails if the token cannot be created.
- [ ] A granular npm access token, stored as the `NPM_TOKEN` Actions secret:
      packages and scopes limited to `@opennest`, **Read and write (publish and
      stage)**, not "stage only", **Bypass 2FA** enabled, short expiry.
- [ ] `.changeset/initial-release.md` is still pending and the six versions are
      `0.0.0`.

### Publish

1. [ ] Follow the [release procedure](#release-procedure). At step 3, the six
       packages must be at `0.1.0` and CI must run on the version pull request
       (this shows the App token works).
2. [ ] After publication, [check](#check-what-was-published) that the six
       packages exist on npm.
3. [ ] [Switch to Trusted Publishing](#switch-to-trusted-publishing).
4. [ ] [Protect `main`](#protecting-main).

## Switch to Trusted Publishing

Publishing then authenticates with GitHub's OIDC token instead of `NPM_TOKEN`.
This has not been exercised on this repository yet.

Already in place: pnpm 11.7.0 (`pnpm publish` handles OIDC itself, 11.1.3 or
later is needed; the npm CLI version does not matter), Node 24,
`id-token: write` on a GitHub-hosted runner, and a `repository.url` matching the
repository.

> A new trusted publisher **expires unless a publish succeeds within 2 days**.
> Prepare the workflow change first, and configure the publishers only when you
> can release right away.

1. [ ] In a pull request to `develop`, edit the `release` job of
       [`release.yml`](../.github/workflows/release.yml), add a `patch`
       changeset, and merge it:
   - remove `registry-url` and its comment from the "Set up Node.js" step;
   - remove `NODE_AUTH_TOKEN` and its comment from the "Version pull request or
     publish" step;
   - keep `id-token: write` and `PNPM_CONFIG_PROVENANCE`
     (`NPM_CONFIG_PROVENANCE` has no effect with pnpm 11 and may go).

   Remove **both** `registry-url` and `NODE_AUTH_TOKEN`. If both stay, a failed
   OIDC exchange only logs `Skipped OIDC: ...` and publishes with the token,
   which proves nothing. If only `registry-url` stays, `actions/setup-node`
   exports a placeholder `NODE_AUTH_TOKEN`, which pnpm uses only if OIDC fails:
   the registry error is then misleading.

2. [ ] On npmjs.com, for **each of the six packages**, open Settings → Trusted
       publishing and add a GitHub Actions publisher:

   | Field                | Value                                        |
   | -------------------- | -------------------------------------------- |
   | Organization or user | `OpenNestHQ`                                 |
   | Repository           | `core`                                       |
   | Workflow filename    | `release.yml`                                |
   | Environment name     | leave empty                                  |
   | Allowed actions      | enable `npm publish` (default is stage only) |

   npm does not validate these values when saving, and a publisher cannot be
   edited: delete it and create it again.

3. [ ] Right away, follow the [release procedure](#release-procedure). The
       `patch` changeset releases all six, so every publisher gets exercised.
4. [ ] Check that all six were published, with provenance.
5. [ ] Delete the `NPM_TOKEN` secret and revoke the token on npm.
6. [ ] Recommended, per package: Settings → Publishing access → "Require
       two-factor authentication and disallow tokens".

If the publish fails because of a publisher, fix it on npmjs.com (delete and
create it again) and re-run the workflow run. Falling back to the token means
restoring the two lines on `main` as a
[repository fix](#when-something-goes-wrong), and only works while npm accepts
direct publishing with it.

Reference: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers).

## Protecting `main`

Apply once the first release is validated. In GitHub, Settings → Rules →
Rulesets, create a branch ruleset targeting `main`:

- [ ] Require a pull request before merging, with **0** required approvals.
- [ ] Require status checks to pass: `ci` (the job of
      [`ci.yml`](../.github/workflows/ci.yml)).
- [ ] Add the OpenNest GitHub App to the bypass list. **Verify whether this is
      needed:** `release.yml` pushes the version branch and tags, not `main`,
      and a bypass widens what the App can do.

## Accepted residual risk

The `release` job runs dependency code while `id-token: write` is available:
dependency install scripts (those allowed in
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml)) and the build of every
workspace package, examples included. Until the switch to Trusted Publishing,
that build also runs in the step that holds `NODE_AUTH_TOKEN`. The other checks
run in the `verify` job, which has no publishing permission and no secret.
