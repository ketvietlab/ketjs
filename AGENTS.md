# KétJS agent rules

## Design-system authority

For UI work, read and use [Két Design System](skills/ket-design-system/SKILL.md).
It is the single repository source for component selection, typography, spacing,
surface/border levels, responsive behavior and UI verification. When invoked, it
has priority over other repository design guidance. Do not duplicate its rules here.

## Engineering boundaries

- Keep server/shared views render-pure; client runtimes own browser state and effects.
- Preserve domain validation, permissions, tenant isolation, native routes and forms.
- `packages/flow-ui` is public MIT JavaScript (`.mjs`) with JSDoc types. Its package
  AGENTS.md owns engineering/dependency constraints; its design compatibility contract
  is in the Két Design System skill. The LiveDoc dependency on ketsuite is an existing
  boundary; extract the editor into its own package before removing that dependency.
- `packages/flow-client` is the public MIT imported client. Its existing `client/`
  JavaScript is syntax/lint/runtime checked, not fully TypeScript checked. Preserve
  its package AGENTS.md and EXTENSIONS.md integration boundaries.
- Before handoff, run focused checks within the local verification scope below.
  Design-specific checks live in the skill.

## Local verification scope

- Before running local verification, identify the deployment being worked on from the task and its application composition. For consumer work in Két Việt, use that consumer deployment as the boundary in both repositories. A feature/module name or a CI test group is not itself a deployment. Use established task context; if the deployment is still ambiguous, ask before running deployment-dependent tests.
- Run only focused tests for the changed behaviour and its directly affected dependencies within that deployment. Do not run other deployments' suites merely because they share the repository, an image, a dependency, or an aggregate test script.
- Inspect scripts before invoking them. Do not run repository-wide `npm test`, `npm run check`, `npm run verify`, all-group test commands, or CI full-suite workflows locally by default. `test:group` is appropriate only when the whole group fits the task's deployment scope; otherwise select explicit test files. Do not fall back to a full suite when a scoped command is missing.
- Scope compilation, type checks, lint, and browser verification to the same work where supported. If a tool requires a broader build or check, report that limitation and distinguish it from running tests; do not silently expand local verification to unrelated deployments.
- For shared runtime/design-system changes, run focused producer contract tests and the affected behaviour in the current deployment. Keep the design inventory/governance checks in the skill when their public contract changes; they do not authorize full runtime regression. Cross-deployment regression belongs to the develop gate unless the user explicitly requests broader local verification.
- Documentation-only changes need a diff/content check, not a runtime test suite. Once the scoped checks pass, do not broaden or repeat them without a new change or a specific unresolved failure in scope.
- Report the deployment, commands/checks run, results, and anything not verified. A local scoped pass is not a full-suite pass. Out-of-scope failures must be reported without turning this task into unrelated repairs.
- Preserve the existing branch policy: integration has no CI; promotion to develop owns the broad verification gate. Do not move that gate into local work or change CI to compensate for scoped local testing.
- These local verification rules apply to work spanning both KétJS and Két Việt; keep the same deployment boundary across repositories. A broader local run requires an explicit user request.
