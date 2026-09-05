---
title: Publishing packages
description: Prepare, verify, and publish a coordinated KetJS release to npm.
---

KetJS releases five public packages with one version:

1. `@ketvietlab/ketjs-view`
2. `@ketvietlab/ketjs`
3. `@ketvietlab/ketjs-postgres`
4. `@ketvietlab/design-system`
5. `@ketvietlab/ketsuite`

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

Update the root and all workspace package versions together. Also update every internal dependency and the
version used by `ket new`. The release checker rejects drift between any of these locations.

The first coordinated scoped release was `0.1.1`. The unscoped `ketjs-view@0.1.0` was published during the
initial bootstrap attempt and is not part of the supported package set. Preview releases follow semantic
versioning but do not promise API stability before 1.0.

## Verify locally

```bash
# Run from: /path/to/ketjs
npm ci
npm run release:check
```

`release:check` performs the normal formatter, lint, build, dependency audit, tests, and type proof. It then:

- verifies package metadata, repository links, license, exports, versions, and exact internal dependencies;
- creates the same tarballs npm will receive and enforces package-size ceilings;
- installs all tarballs into a clean consumer and imports every public entry point;
- invokes the installed `ket new` binary;
- installs the local tarballs into that generated project, resolves its development CLI entry, then runs its
  check and integration test.

The KetJS package has a 1.2 MB packed-size ceiling. Its baseline includes the three licensed Inter font faces
embedded by the deterministic PDF renderer. KetSuite has a 4 MB packed-size ceiling for its composed business
modules, address catalogues, browser clients, and source maps. Both ceilings leave limited headroom for
accidental growth. A release that crosses a ceiling must inspect the tarball contents before changing the
budget.

To retain inspectable tarballs under `.release/`:

```bash
# Run from: /path/to/ketjs
npm run release:pack
```

No publish command is part of either local script.

## Publish

1. Create `release/<version>` from the current `develop` head. Do not release an arbitrary feature branch.
2. Update the coordinated version when needed, then open the release pull request into `master` and let the
   required checks pass.
3. Merge the release pull request into `master`. The resulting `master` commit is the immutable KetJS source
   used by downstream applications; `develop` must never be used as a production dependency pin.
4. Create and publish GitHub release `v0.1.3` at that exact `master` commit.
5. Approve the protected `npm` environment when prompted.
6. Confirm all five packages and provenance attestations on npm.
7. Update each downstream repository to pin the exact released `master` commit SHA, then run that
   repository's release process. Never pin a moving branch name.
8. Run the public smoke path without local tarballs:

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@0.1.3 new public_smoke
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
