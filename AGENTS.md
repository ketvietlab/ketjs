# KétJS agent rules

## Repository scope

This repository holds the KetJS framework only: `ketjs`, `ketjs-view`, `ketjs-postgres`,
`ketjs-view-tools` and `create-view`. KetSuite, the design system, Flow and Website clients live
in the KetSuite source and consume KetJS from npm; do not add them back here. A framework change a
consumer needs is released from this repository and then adopted by version.

## Engineering boundaries

- Keep server/shared views render-pure; client runtimes own browser state and effects.
- Preserve domain validation, permissions, tenant isolation, native routes and forms.
- Before handoff, run focused checks within the local verification scope below.

## Local verification scope

- Before running local verification, identify the deployment being worked on from the task and its application composition. For consumer work in Két Việt, use that consumer deployment as the boundary in both repositories. A feature/module name or a CI test group is not itself a deployment. Use established task context; if the deployment is still ambiguous, ask before running deployment-dependent tests.
- Run only focused tests for the changed behaviour and its directly affected dependencies within that deployment. Do not run other deployments' suites merely because they share the repository, an image, a dependency, or an aggregate test script.
- Inspect scripts before invoking them. Do not run repository-wide `npm test`, `npm run check`, `npm run verify`, or CI full-suite workflows locally by default. Select explicit test files (`npm run test:one`). Do not fall back to a full suite when a scoped command is missing.
- Scope compilation, type checks, lint, and browser verification to the same work where supported. If a tool requires a broader build or check, report that limitation and distinguish it from running tests; do not silently expand local verification to unrelated deployments.
- For shared runtime changes, run focused producer contract tests and the affected behaviour in the current deployment. Cross-deployment regression belongs to the develop gate unless the user explicitly requests broader local verification.
- Documentation-only changes need a diff/content check, not a runtime test suite. Once the scoped checks pass, do not broaden or repeat them without a new change or a specific unresolved failure in scope.
- Report the deployment, commands/checks run, results, and anything not verified. A local scoped pass is not a full-suite pass. Out-of-scope failures must be reported without turning this task into unrelated repairs.
- Preserve the existing branch policy: integration has no CI; promotion to develop owns the broad verification gate. Do not move that gate into local work or change CI to compensate for scoped local testing.
- These local verification rules apply to work spanning both KétJS and Két Việt; keep the same deployment boundary across repositories. A broader local run requires an explicit user request.
