# UI refactor review evidence

Date: 2026-09-27. Target: `integration`. This is review evidence, not a release or production rollout.

## Completed scope

- SearchFilter P0/P1 and the independent review fixes: typed suggestions, settled-state rollback,
  retrying the attempted draft, localized errors, desktop Filter/Group/Saved controls, a separate
  facet row, and a mobile sheet. Inline favorite forms open explicitly and keep focus in the menu.
- Shared rule labels and localized date grouping intervals; unsupported empty editors are hidden.
  Existing `search-filter-toggle`, `disclosure-summary`, `menu-item`, `search-filter-facet` and input
  hooks remain. Group chips are distinguished by `data-type="groupBy"`.
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
- `npm --prefix docs run check:snippets`: 353 snippets in 71 files on the integration tree.
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

## Independent review follow-up

- F2: Escape dismisses an inline favorite form before its containing desktop menu or mobile sheet.
  Closing or switching the panel resets the form. Node tests cover native dismissal, outside clicks,
  panel switching and two-step Escape with focus restoration. KetPlus confirms desktop light and
  mobile dark behavior, including reopening without a stale form.
- F3: Partner supplies its translated table-region label. HTTP tests cover vi/en; the Vietnamese
  accessible name is also verified in Chromium.
- F4: the retired `menu` query no longer narrows sidebar navigation; unused `menuFilter` plumbing is
  removed. HTTP and browser checks retain the complete permitted sidebar with a non-matching query.
- F5/F6: correct the group-chip hook documentation, keep the saved-search empty message sentence-case
  and inset the inline form. KetViet owns the CRM assertion and spelling changes.
- Integration validation: after merging `origin/integration` at `0955dbfb` with `--no-commit`,
  `npm ci` and full `npm run verify` pass (2,516 tests passed, 38 conditional skips, 0 failures),
  all 11 type assertions and 353 documentation snippets pass. Non-failing lint warnings remain.

## Logo correction

The backend uses the two exact user-supplied KétSuite PNGs (accented Két, blue Suite, no tagline),
replacing the older lockup from `ketsuite-work`. The dark variant is used on the indigo topbar in both
themes; login retains its light/dark asset selection. The six Product captures below were refreshed
with the corrected assets. Earlier retry captures record that interaction before the logo correction.
A forced asset rebuild and byte comparison verified both emitted logo files.

## Screenshots

| Viewport | Light | Dark |
| --- | --- | --- |
| 1440x900 | [Desktop light](screenshots/product-1440-light.png) | [Desktop dark](screenshots/product-1440-dark.png) |
| 1024x900 | [Tablet light](screenshots/product-1024-light.png) | [Tablet dark](screenshots/product-1024-dark.png) |
| 390x844 | [Mobile light](screenshots/product-390-light.png) | [Mobile dark](screenshots/product-390-dark.png) |

[Retry failure](screenshots/cap-retry-error.png) and [successful retry](screenshots/cap-retry-success.png).

## Deployment boundary

Both feature PRs target remote `integration`. Test the KetJS tree after merging the current
`origin/integration`, then use a merge commit to retain provenance. After review and merge, verify
that the remote integration tree equals the tested tree. KetViet then pins the newest remote KetJS
integration tip, verifies that it contains the previous integration pin, rebuilds its bundles and
runs its affected tests. A feature-branch override is only a documented temporary review exception
while the framework PR is pending; it must not replace or rewind the integration pin.

An override is allowed on KetViet integration. Only promotion to `develop` requires a released
`KETJS.lock` pin and removal of the override. Do not regenerate release contracts under an override.
Original Product prototype and preview worktrees are preserved.
