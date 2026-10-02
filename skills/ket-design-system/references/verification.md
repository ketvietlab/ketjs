# Verification

Use checks proportionate to the affected contract. Do not claim source regex checks
prove browser geometry, or a screenshot proves behavior.

## Three layers

1. **Source/API:** supported exports, hooks and catalogue coverage; pure server views;
   no private CSS overrides, raw visual values, fabricated props or copied components.
2. **Rendered composition:** page/header/controls/table/footer ordering; exactly one
   authorized create action; native links/forms; field IDs and descriptions; empty,
   loading, selected and permission-denied states; no redundant frames or wrappers.
3. **Browser:** computed font-size/line-height/weight, measured control height, gaps,
   inset and border ownership. Exercise keyboard, query state, focus, selection and
   native submission for the changed interactions. Long text must not cause page
   overflow; table-local scrolling is allowed. A checkbox must not open its row.

Review the actual consuming screen, including its compatibility stylesheets. Use
1440px and 390px at minimum, plus 767/768px when breakpoint behavior changes. Include
light/dark for token or border changes. Test longer translations when copy affects
layout. Measure box edges and computed line boxes, not apparent glyph whitespace.

For surface changes exercise canvas->Surface->Section, nested Surface, modal->Field,
modal->TabbedView->table, and Surface->object cards. Count working frames separately
from input borders and row dividers. Check a boundary/inset has exactly one owner.

## KétJS repository commands

After public component/hook edits:

```sh
npm run design:inventory
npm run design:inventory:check
npm run design:governance:check
```

Run focused tests and `npm run check`; use `npm run verify` for a PR-sized DS/runtime
change. Run `npm run test:design-system:browser` for geometry/composition changes.
The Polaris fixture at `test/fixtures/polaris-dimensions.json` pins reference values.
The catalogue runs with `npm run design:system` at port 4100, with `/primitives` and
`/layering?presentation=grouped` showing actual public components.

`auditLayoutCss` / `ket-design-system-layout-audit` currently catches owned-hook
restyling, handmade frames and revert-layer. It does not prove correct component
selection or catch every indirect CSS override. Adopt it per compliant area using
`design-system-layout.json` with an `enforce` glob list; each glob must match. Grow
coverage when migrating an area instead of removing entries to make a build pass.

In another repository inspect its scripts and supported APIs first. Do not invent
these commands or require installing the whole monorepo just to review a screen.
Record exceptions with a reason, owner and migration destination. An existing
compatibility boundary permits maintaining it, not expanding duplicate primitives.
