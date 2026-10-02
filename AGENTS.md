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
- Run focused tests and `npm run check` before handoff; use `npm run verify` for
  changes spanning shared components/runtime. Design-specific checks live in the skill.
