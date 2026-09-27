# UI refactor review evidence

Date: 2026-09-27. Target: `develop`. This is review evidence, not a release or production rollout.

## Completed scope

- SearchFilter P0/P1 and the independent review fixes: typed suggestions, settled-state rollback,
  retrying the attempted draft, localized errors, desktop Filter/Group/Saved controls, a separate
  facet row, and a mobile sheet. Inline favorite forms open explicitly and keep focus in the menu.
- Shared rule labels and localized date grouping intervals; unsupported empty editors are hidden.
  Existing `search-filter-toggle`, `disclosure-summary`, `menu-item`, `search-filter-facet` and input
  hooks remain. Group chips are distinguished by `data-facet-kind="group"`.
- Shared compact collection styling, sentence-case headings, plain product classifications, muted
  negative values and 24px media labels. Imageless pages do not reserve an empty image column;
  mixed pages align names. Mobile tables retain every column in a labeled scrolling region.
- Public AppTopbar, NavigationToggle, Text and MediaLabel contracts, catalogue ownership and tests.
  KetSuite uses a 48px indigo topbar with the existing supplied logo, native global search and company
  context. Sidebar identity/search duplication is removed. Only Product list suppresses breadcrumbs.
- Global search returns permitted menu destinations and bounded product/partner results through
  checked, company-scoped functions. It supports native GET links and Ctrl/Cmd+K. Cross-collection
  fragment navigation opens the destination record without resetting an already open draft.
- Mobile navigation restores focus after Escape; unrelated closed dropdowns no longer steal it.
  Mobile primary controls, navigation controls and table selection targets are at least 44px.

## Contract changes to review

`searchFilterHref` clearing filters removes `favorite=` and retains an explicit empty `q=` when
needed to prevent Product from reapplying the default favorite. Clear preserves the current keyword,
grouping and sort while removing presets, custom rules and the favorite. SSR and client rule labels
share one formatter. New labels are optional with English defaults; direct consumers must supply
their locale, as the dependent KetViet PR does.

The shell adds the `backend.global-topbar` fragment slot and retains the existing three slots. Global
search intentionally covers installed permitted menus, products and partners; it does not claim to
search every domain. Existing record-search matching semantics are preserved. SKU remains optional
future domain work, not a condition for this UI refactor.

## Verification

- `npm run verify`: full format/lint, inventory/governance/release contracts, terminology, build,
  dependency/UI/staff/API audits, TypeScript, complete Node suite and type assertions.
- `npm --prefix docs run check:snippets`: 348 snippets in 70 files.
- KetViet integration: 37 modules build, 52 customer-care HTTP/contract tests and 5 follow-up filter
  tests pass against this tree. The dependent PR records an exact reachable framework commit.
- Real Chromium through KetPlus, Vietnamese, reduced motion: 1440x900, 1024x900 and 390x844 in both
  themes. The captures below show the actual Product fixture, not mockups. Topbar is 48px; desktop
  rows are 40px; mobile selection and primary control targets are 44px.
- Browser: global search opens a Product record from its results; mobile navigation Escape returns
  focus to its trigger; mobile filters focus the visible close control; failure rollback and a
  successful retry after removing an injected 503 preserve the attempted query.
- CRM browser: assignment/query clearing, date range, column choices, all nine configuration record
  links, lazy program creation and milestone gating, draft retention across tabs, fixed modal
  actions, date/batch validation refusals, follow-up creation, mobile batch confirmation, postponing
  from the Call tab, product feedback completion, routine editing and the configured portal link.
  Mobile dark filter controls use Vietnamese labels and omit empty Group/Saved/custom editors.

The 11 legacy Playwright browser cases were not launched from the shell: this session only permits
KetPlus for browser control. The browser rehearsals above are separate evidence, not a claim of
63 automated tests passing. CI/independent review should run the complete customer-care suite.
The fixture batch confirmation reaches its queued state; worker execution is covered by HTTP tests.
Full-suite conditional skips and lint warnings are recorded in the PR rather than hidden.

## Screenshots

| Viewport | Light | Dark |
| --- | --- | --- |
| 1440x900 | [Desktop light](screenshots/product-1440-light.png) | [Desktop dark](screenshots/product-1440-dark.png) |
| 1024x900 | [Tablet light](screenshots/product-1024-light.png) | [Tablet dark](screenshots/product-1024-dark.png) |
| 390x844 | [Mobile light](screenshots/product-390-light.png) | [Mobile dark](screenshots/product-390-dark.png) |

[Retry failure](screenshots/cap-retry-error.png) and [successful retry](screenshots/cap-retry-success.png).

## Deployment boundary

KetViet is a dependent review branch with a committed exact-SHA `KETJS.override`. Its normal gate must
keep blocking merge until this framework change is reviewed, merged and released, then the override
is replaced by a released `KETJS.lock` pin. No merge, framework release or production deployment is
part of this handoff. Original Product prototype and preview worktrees are preserved.
