# @ketvietlab/design-system

Public server-rendered components for dense operational applications.

The package depends only on `@ketvietlab/ketjs-view`. It does not know about
KetSuite routes, translators, models, functions, sessions, or deployments.

```ts
// File: src/ui/orders.tsx
import { AppShell, Button, DataTable, FormPage, ListPage, Page, Section, Surface } from '@ketvietlab/design-system'
```

Load `@ketvietlab/design-system/styles.css` and put `data-kv-design-system` on the
application root. Components own their markup and `data-ui` hooks; applications
provide business data and translated labels.

The catalogue is isolated behind `@ketvietlab/design-system/catalogue`, so the
production entry point does not load its specimen data or catalogue chrome.

Run the component catalogue from the repository root:

```bash
npm run design:system
```

Then open `http://127.0.0.1:4100`.

The contract is intentionally strict:

- Inter is the only UI typeface;
- sidebar, main application region, and context right rail use `--kv-radius-app-region` (`0`);
- independent objects such as KPI cards use the shared 3–12px radius scale;
- a page is never wrapped in one large card;
- record sections and rail sections use low-contrast separators instead of nested cards;
- component CSS consumes semantic/component roles, not numbered palette swatches.

The public entry exports actions, status and feedback objects, fields, navigation,
tabs, progress, layout primitives, the three-region app shell, page/record layouts,
the canonical list-page and form-page compositions, data tables, forms, and modal sheets. Use
`ListPage` for operational collections: applications provide translated identity,
URL-driven controls and result content while the pattern keeps header, controls,
status, body and footer in one stable order. The primary action stays beside the
title, while result status and controls share one command bar. Use `FormPage` for
create and edit screens: the primary decision stays beside record identity, the
business form keeps one reading column, and durable facts may occupy the optional
context rail. Form fields keep labels on the left and controls on the right at
every viewport; responsive layouts tighten those columns instead of changing the
reading direction. Every supported state appears in the catalogue.
