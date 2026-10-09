---
title: Publishing packages
description: Prepare, verify, and publish a coordinated KetJS release to npm.
group: Project evolution
order: 6
---

KetJS releases five public packages with one version:

1. `@ketvietlab/ketjs-view`
2. `@ketvietlab/ketjs-view-tools`
3. `@ketvietlab/create-view`
4. `@ketvietlab/ketjs`
5. `@ketvietlab/ketjs-postgres`

The KetSuite packages (`design-system`, `ketsuite`, `flow-ui`, `flow-client`, `website-client` and `ketspec`) are
released from the KetSuite source, not from this repository.

Internal dependencies use that exact version. Publish in this order so every dependency exists before
the package that names it.

## One-time npm setup

The `@ketvietlab` scope must belong to the npm account or organization performing the release. Configure the
GitHub `npm` environment with required reviewers and an `NPM_TOKEN` secret that can publish public packages
under that scope. Keep two-factor authentication enabled for the npm account.

The workflow requests an OIDC token and publishes with npm provenance. After the first release creates the
packages, configure npm trusted publishing for this repository and remove the long-lived token when the npm
account supports that transition.

## Prepare a version

Edit the root `VERSION` file only. It is the authoritative version for the five framework packages,
scaffolds, documentation runtime and learning labs. Manifests, npm locks and the browser-safe docs constant
are generated mirrors. The checker rejects drift rather than silently repairing it in CI.

```bash
# Run from: /path/to/ketjs
npm run version:sync
npm run version:check
```

Synchronization builds the five producers and resolves private consumer locks against their exact npm
tarballs, including versions that do not exist on npm yet. Committed locks retain public registry URLs and
the actual candidate SHA-512 integrity; temporary file dependencies never enter the published downloads.
Packing normalizes staged file permissions (0644, with executable CLI entries at 0755), so a developer's
umask cannot change the integrity between local verification and Linux CI. Source permissions are untouched.
KetSuite, Spec and the design system have independent versions and are not synchronized by this file.

Current-version Markdown names `VERSION` between doubled braces in source. The site expands it before parsing metadata,
examples and links, and while generating offline lessons. Historical releases and minimum API versions
stay literal. Review changed contracts, configuration, release notes and examples before committing.

## Mandatory CHANGE_LOG evidence

The version change must be a source commit with exactly one meaningful `Version-Reason: ...` trailer.
Finish documentation changes and generated mirrors in that commit, then run the audit from clean source:

```bash
# Run from: /path/to/ketjs
git add VERSION package.json package-lock.json packages tools .github README.md AGENTS.md
git commit -m "Prepare the coordinated release" \
  -m "Version-Reason: Ship the reviewed contracts documented in the release notes and verified learning labs."
npm run version:record
git add CHANGE_LOG
git commit -m "Record coordinated version audit evidence"
npm run version:audit
```

`CHANGE_LOG` is a JSON ledger with one entry per version. It records the exact VERSION commit and its
reason, the audited source commit, a source digest, reviewed document paths/fence coverage, environment,
tarball checksums and executed checks with exit codes and log hashes. The recording command runs those
checks itself. Logs and the full report remain under `.artifacts/version-audit/` and CI uploads them.

Two commits avoid a self-referential SHA. Merge them without squashing; rebase, squash or later source
changes require a fresh evidence record. CI fails for missing reasons, mismatched commits, missing or
failed documentation/lab checks and stale source evidence. CI also reruns the candidate consumers, so a
hand-written passing flag does not substitute for execution. Audit coverage includes rendered local links,
metadata, located examples, version expansion and downloadable projects; maintainers still review prose
and whether release notes describe the actual changes.

Only the scoped `@ketvietlab` packages are part of the supported package set. Preview releases follow semantic
versioning but do not promise API stability before 1.0.

## Verification gates

Locally, verify only the deployment being changed and its directly affected producer contracts, as
specified in `AGENTS.md`. Inspect scripts before running them; do not use the aggregate release checker
as a routine local test command. Documentation-only edits need content and diff checks.

Broad release verification belongs to promotion into `develop` and the release pull request into
`master`. The release gate performs formatter, lint, build, dependency, type and test checks. It also:

- verifies package metadata, repository links, license, exports, versions, and exact internal dependencies;
- creates the same tarballs npm will receive and enforces package-size ceilings;
- installs all tarballs into a clean consumer and imports every public entry point;
- invokes the installed `ket new` and `create-view` binaries;
- installs the local tarballs into that generated project, resolves its development CLI entry, then runs its
  check and integration test, builds the static Spec reference, and compares CLI OpenAPI output with the
  project's generator. The scaffold's pinned Spec version must already be published by KetSuite.

Version changes have an additional dedicated gate on pull requests into `integration`, `develop` and
`master`. It validates `CHANGE_LOG` and reruns the docs tests/check/build, the API lab's real HTTP,
tenant-isolation and worker checkpoints, the View lab's check/build and the same checks on the actual ZIP
downloads. These consumers use exact candidate tarballs before publishing, so an unpublished version is
tested without substituting workspace source. The broad framework suite remains at promotion/release.

The KetJS package has a 1.2 MB packed-size ceiling. Its baseline includes the three licensed Inter font faces
embedded by the deterministic PDF renderer. A release that crosses a ceiling must inspect the tarball
contents before changing the budget.

To retain inspectable tarballs under `.release/`:

```bash
# Run from: /path/to/ketjs
npm run release:pack
```

No publish command is part of either local script.

## Publish

1. Create `fix/release-<version>` from `master` and merge the verified `develop` head into it. Do not release an
   arbitrary feature branch.
2. Update `VERSION`, synchronize mirrors and commit executable `CHANGE_LOG` evidence, then open the release pull request into `master` and let the required
   checks pass. Feature pull requests are verified locally by their authors, so a failure here is fixed on
   `develop` before the release is retried.
3. Merge the release pull request into `master`. The resulting `master` commit is the immutable KetJS source
   used by downstream applications; `develop` must never be used as a production dependency pin.
4. Create and publish GitHub release `v{{VERSION}}` at that exact `master` commit.
5. Approve the protected `npm` environment when prompted.
6. Confirm all five packages and provenance attestations on npm.
   The workflow repeats docs/lab/download verification against the public registry after publishing.
7. Update each downstream repository to the released npm version, then run that repository's release
   process.
8. Run the public smoke path without local tarballs:

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@{{VERSION}} new public_smoke
cd public_smoke
npm install
npm test
```

The workflow also supports manual dispatch for an existing tag. It refuses a tag that does not exactly match
the coordinated package version.

## Failure and recovery

Do not overwrite or unpublish a released version. The workflow is resumable: it skips an existing package
only when the registry tarball checksum matches the local release tarball, and stops on any mismatch. If a
package is defective, deprecate that version and release a corrected patch.
