# KétJS agent rules

This file is the canonical repository guide for coding agents and contributors.

## Repository scope

This repository holds the KetJS framework only: `ketjs`, `ketjs-view`, `ketjs-postgres`,
`ketjs-view-tools` and `create-view`. KetSuite, the design system, Flow and Website clients live
in the KetSuite source and consume KetJS from npm; do not add them back here.
The framework marketing and documentation site lives in `packages/docs`; it is a private,
independently installed ketjs-view consumer for `ketjs.dev`, not a published framework package.
A framework change a consumer needs is released from this repository and then adopted by version.

## Language and branches

- Everything written into the repository or onto GitHub is in English: branch names, commit messages,
  pull request titles and descriptions, review comments, and issue comments. Vietnamese remains
  correct for product strings, user-facing copy, and handoff documents written for a specific team.
  Conversation with a maintainer follows whatever language they are using.
- Branch names must start with `feat/` or `fix/`. Do not use agent-specific prefixes such as
  `claude/` or `codex/`.

## Engineering boundaries

- Keep server/shared views render-pure; client runtimes own browser state and effects.
- Preserve domain validation, permissions, tenant isolation, native routes and forms.
- Develop and verify in the same deployment scope. Before handoff, run focused checks within the
  local verification scope below.

## Local verification scope

- Before running local verification, identify the deployment being worked on from the task and its application composition. For consumer work in Két Việt, use that consumer deployment as the boundary in both repositories. A feature/module name or a CI test group is not itself a deployment. Use established task context; if the deployment is still ambiguous, ask before running deployment-dependent tests.
- Run only focused tests for the changed behaviour and its directly affected dependencies within that deployment. Do not run other deployments' suites merely because they share the repository, an image, a dependency, or an aggregate test script.
- Inspect scripts before invoking them. Do not run repository-wide `npm test`, `npm run check`, `npm run verify`, or CI full-suite workflows locally by default. Select explicit test files (`npm run test:one`). Do not fall back to a full suite when a scoped command is missing.
- Scope compilation, type checks, lint, and browser verification to the same work where supported. If a tool requires a broader build or check, report that limitation and distinguish it from running tests; do not silently expand local verification to unrelated deployments.
- For shared runtime changes, run focused producer contract tests and the affected behaviour in the current deployment. Cross-deployment regression belongs to the develop gate unless the user explicitly requests broader local verification.
- Documentation-only changes need a diff/content check, not a runtime test suite. Once the scoped checks pass, do not broaden or repeat them without a new change or a specific unresolved failure in scope.
- Report the deployment, commands/checks run, results, and anything not verified. A local scoped pass is not a full-suite pass. Out-of-scope failures must be reported without turning this task into unrelated repairs.
- Preserve the existing branch policy: promotion to develop owns the broad verification gate. Integration has no broad framework CI. The explicitly required VERSION/CHANGE_LOG gate is the exception: version changes must verify documentation and labs before integration. Do not move the broad gate into local work or change CI to compensate for scoped local testing.
- These local verification rules apply to work spanning both KétJS and Két Việt; keep the same deployment boundary across repositories. A broader local run requires an explicit user request.

## Pull requests and CI

- Feature pull requests carry no broad CI; VERSION/CHANGE_LOG and their tooling have the dedicated
  `version-consumers.yml` gate. Before pushing, run the focused checks for the changed behavior
  and directly affected dependencies, including live-Postgres tests when they belong to that scope.
- Apply the quality contracts in `.github/workflows/verify.yml` (format, lint, terminology, build,
  dependency boundaries, and types) within the local scope above. Report
  tools that require broader checks rather than silently expanding verification. Documentation-only
  changes require content and diff checks, not a runtime build or test suite.
- List commands, results, the deployment boundary, and anything not verified in the pull request
  description. After review changes or a rebase, re-run checks affected by those changes.
- The full suite runs in CI on promotion from `integration` into `develop` and on release pull
  requests into `master`. Keep that broad gate in CI; do not move it into routine local work.

## Coordinated versions and audit evidence

- Root `VERSION` is the only authored framework version. Change it and run `npm run version:sync`;
  package manifests, npm locks, scaffold constants and the browser-safe docs version are generated mirrors.
  Keep independent KetSuite/Spec/design-system versions and historical/minimum-version documentation intact.
- Current-version Markdown uses `{{VERSION}}`; the docs compiler expands it before parsing and when
  generating standalone learning downloads. Do not hardcode a new current version into guides.
- Commit VERSION, generated mirrors and the completed documentation changes with exactly one meaningful
  `Version-Reason: ...` trailer. Use merge commits so the recorded SHA remains an ancestor; do not squash
  or rebase an audited version commit without regenerating its evidence.
- From a clean source commit, run `npm run version:record`. It executes the producer build, documentation
  audit/tests/check/build, both learning labs and their downloadable ZIPs against exact candidate tarballs.
  Commit the generated root `CHANGE_LOG` separately. Never fabricate successful checks or log hashes.
- `npm run version:audit` rejects a missing entry, wrong commit/reason, incomplete checks or changed source.
  CI independently reruns the consumers and uploads the report and logs. A subsequent source change in a
  version pull request requires a new audit record. Ordinary changes at the same version keep their scoped
  local checks; release preparation always requires fresh audit evidence.
- An already published version and tag remain immutable. Audit adoption at the existing VERSION does not
  permit overwriting its packages; future package changes require a new version and the release gates.

## Documentation rules

- Every behavior, public contract, configuration, workflow, or architecture change must update the
  corresponding documentation in the same change. Keep the repository overview and onboarding in
  `README.md`, agent and contribution rules in `AGENTS.md`, and package-specific contracts in the
  affected package's `README.md`.
- Every fenced code block in documentation must begin with a language-valid location comment:
  `// File: path` for TypeScript, JavaScript, TSX, and JSONC; `# Run from: path` for shell commands;
  `%% File: path` for Mermaid; `{% comment %} File: path {% endcomment %}` for Liquid/KTL;
  `<!-- File: path -->` for Markdown and HTML; and `# File: path` for text, HTTP, and other plain
  examples. Use a concrete repository or example-project path, not a vague label.
- Before documentation handoff, check the changed content, local links, fenced code blocks, and
  `git diff --check`. Documentation-only changes do not require a runtime build or test suite.
