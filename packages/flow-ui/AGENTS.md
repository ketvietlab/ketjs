# Flow UI: public component package

Design rules live only in [Két Design System](../../skills/ket-design-system/SKILL.md),
including its [Flow compatibility reference](../../skills/ket-design-system/references/flow.md).

- This package is public MIT code published as `@ketvietlab/flow-ui`. It holds presentation only: no product data, persistence, routing, API calls, identity-provider integration or paid-feature components. Those stay in the consuming product.
- Depend only on `@ketvietlab/design-system`, `@ketvietlab/ketjs`, `@ketvietlab/ketjs-view` and `@ketvietlab/ketsuite/livedoc` (enforced by `tools/zero-dep-audit.ts`). Never import Suite page shells, list pages or record-modal internals.
- Source stays JavaScript (`.mjs`) with JSDoc types; `npm run build` type-checks it and emits `.d.mts`. This is a documented exception to the repository TypeScript default, recorded in the root `AGENTS.md`.
- Keep server rendering pure. Native dialog behavior belongs in the explicit, disposable runtime. Business data, persistence and navigation belong to consumers, never the kit.
- Update the demo and focused semantic/behavior tests with components. Demo fixtures are not production functionality.


- User-facing copy uses the `flow.` i18n catalog in `src/messages.mjs` with English, Japanese and Vietnamese entries. Products add keys through `registerFlowMessages`, never by editing this catalog.
