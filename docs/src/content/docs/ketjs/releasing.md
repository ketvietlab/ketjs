---
title: Publishing packages
description: Prepare, verify, and publish a coordinated KetJS release to npm.
---

KetJS releases four public packages with one version:

1. `ketjs-view`
2. `ketjs`
3. `ketjs-postgres`
4. `ketsuite`

Internal dependencies use that exact version. Publish in this order so every dependency exists before
the package that names it.

## One-time npm setup

The four unscoped names must belong to the npm account or organization performing the release. Configure
the GitHub `npm` environment with required reviewers and an `NPM_TOKEN` secret that can publish all four
packages. Keep two-factor authentication enabled for the npm account.

The workflow requests an OIDC token and publishes with npm provenance. After the first release creates the
packages, configure npm trusted publishing for this repository and remove the long-lived token when the npm
account supports that transition.

## Prepare a version

Update the root and all workspace package versions together. Also update every internal dependency and the
version used by `ket new`. The release checker rejects drift between any of these locations.

For the first preview release the coordinated version is `0.1.0`. Preview releases follow semantic
versioning but do not promise API stability before 1.0.

## Verify locally

```bash
npm ci
npm run release:check
```

`release:check` performs the normal formatter, lint, build, dependency audit, tests, and type proof. It then:

- verifies package metadata, repository links, license, exports, versions, and exact internal dependencies;
- creates the same tarballs npm will receive and enforces package-size ceilings;
- installs all tarballs into a clean consumer and imports every public entry point;
- invokes the installed `ket new` binary;
- installs the local tarballs into that generated project, then runs its check and integration test.

To retain inspectable tarballs under `.release/`:

```bash
npm run release:pack
```

No publish command is part of either local script.

## Publish

1. Merge the release preparation into `develop` and let required checks pass.
2. Promote the verified commit according to the repository branch policy.
3. Create and publish GitHub release `v0.1.0` at that exact commit.
4. Approve the protected `npm` environment when prompted.
5. Confirm all four packages and provenance attestations on npm.
6. Run the public smoke path without local tarballs:

```bash
npx --package ketjs@0.1.0 ket new public_smoke
cd public_smoke
npm install
npm test
```

The workflow also supports manual dispatch for an existing tag. It refuses a tag that does not exactly match
the coordinated package version.

## Failure and recovery

Do not overwrite or unpublish a released version. If publication stops part-way through, determine which
packages reached npm before retrying. A retry of an already-published version is expected to fail; publish the
remaining packages deliberately or prepare a new patch version. If a package is defective, deprecate that
version and release a corrected patch.
