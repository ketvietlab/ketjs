---
title: KetSuite list/form screen migration inventory
description: One shared-branch work item for every KetSuite backend screen considered for ListPage and FormPage migration.
---

# KetSuite list/form screen migration inventory

This is the single source of truth for migrating KetSuite server-rendered backend screens to the public
`ListPage` and `FormPage` patterns. The inventory is route-led: a screen is counted when a GET-capable
backend or self-service route renders it. POST-only commands, archive/delete endpoints, downloads, partial
fragments, and channel APIs are not separate screens.

Snapshot: 2026-08-26. Re-run the completeness checks at the end of this document whenever routes change.

## Shared-branch operating rules

All sub-agents work in the same checkout and on the same feature branch.

1. The coordinator creates and switches the shared branch. Sub-agents must not run `git checkout`,
   `git switch`, `git worktree`, `git rebase`, `git reset`, `git clean`, `git stash`, or branch commands.
2. One row is one agent assignment. A shared renderer serving several route aliases remains one row so two
   agents never redesign the same component independently.
3. Only one row per lane may be `in-progress` at a time. A lane is normally one backend module because its
   screens share a route registry, translations, fixtures, and browser evidence.
4. Before editing, the agent writes its name in `Owner`, changes `Status` to `in-progress`, and treats the
   listed renderer, route registry, module translations, focused tests, and evidence fixture as its lock.
5. Sub-agents edit but do not stage or commit. The coordinator reviews the shared worktree and creates the
   commits. This prevents concurrent writes to the Git index.
6. Shared design-system files are coordinator-owned. A screen agent proposes a contract change in its row;
   the coordinator lands the shared primitive first, then unblocks dependent rows.
7. A module that still has a monolithic `screens.tsx` is migrated incrementally to a `screens/` folder.
   The first screen agent creates `screens/index.ts` and, only when necessary, `screens/shared.tsx`; every
   agent moves exactly its assigned renderer to `screens/<screen-name>.tsx`. The final agent removes the
   empty legacy `screens.tsx`. Do not perform a mechanical module-wide split in parallel with screen work.
8. Routes import screens through `screens/index.ts`. Screen-specific types, constants and markup stay with
   their screen; only genuinely reused, domain-neutral helpers enter `screens/shared.tsx`.
9. Every migrated screen preserves locale, permissions, POST semantics, named joints, partial-save
   controllers, validation, empty/error states, responsive behavior, and existing Chatter/Activity islands.
10. Completion requires a focused render/HTTP test and desktop/mobile browser evidence. A visual change
   without behavioral coverage remains `review`.
11. Validation follows CI's affected-group planner. Module changes run their focused tests and owning group
   (`stock_backend` is `catalog`); shared UI, framework, build, tooling, workflow, or otherwise unclassified
   code expands to all groups. Do not rerun unrelated domain groups inside every wave.

Statuses: `ready`, `in-progress`, `blocked`, `review`, `done`, `keep` (intentional specialized layout).

Targets:

- `ListPage`: operational collection with identity/action row, URL-driven controls, result state and table.
- `FormPage`: create/edit/detail form with compact identity, actions, body and optional one-third context rail.
- `Split`: the current route mixes creation and collection; the same agent separates ListPage and FormPage.
- `Specialized`: dashboard, board, calendar, register, preview, portal, or other task surface that should not be
  forced into list/form. The row still receives an audit so it cannot be silently skipped.

## Inventory

The tables below are the assignment queue. `Owner` is intentionally empty until work starts.
The current snapshot contains **173 stable work-item IDs** with no duplicates.

### Accounting lane

Structure debt: `account_backend` still has root-level `*-screen.tsx` files plus `screens.tsx`; move each
assigned renderer into `screens/` and finish with a barrel. `account_partner_backend` follows the same rule.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| ACC-01 | ready | Accounting overview | `/admin/accounting` | `accountingOverviewScreen` | Specialized | no | — |
| ACC-02 | ready | Chart of accounts | `/admin/accounting/accounts` | `accountsScreen` | Split | no | — |
| ACC-03 | ready | Journals | `/admin/accounting/journals` | `journalsScreen` | Split | no | — |
| ACC-04 | ready | Taxes | `/admin/accounting/taxes` | `taxesScreen` | Split | no | — |
| ACC-05 | ready | Payment terms | `/admin/accounting/terms` | `paymentTermsScreen` | Split | no | — |
| ACC-06 | ready | Accounting defaults | `/admin/accounting/defaults` | `accountDefaultsScreen` | FormPage | no | — |
| ACC-07 | ready | Journal entries | `/admin/accounting/entries` | `journalEntriesScreen` | Split | list/new: no | — |
| ACC-08 | ready | Customer invoices | `/admin/accounting/customer-invoices` | `customerInvoicesScreen` | Split | list/new: no | — |
| ACC-09 | ready | Vendor bills | `/admin/accounting/vendor-bills` | `vendorBillsScreen` | Split | list/new: no | — |
| ACC-10 | ready | Shared accounting document detail | `/admin/accounting/entries/{id}`, `/customer-invoices/{id}`, `/vendor-bills/{id}` | `moveDetailScreen` | FormPage | `account_mail_backend` | — |
| ACC-11 | ready | Payments | `/admin/accounting/payments` | `paymentsScreen` | Split | no | — |
| ACC-12 | ready | Trial balance | `/admin/accounting/trial-balance` | `trialBalanceScreen` | Specialized | no | — |
| ACC-13 | ready | General ledger | `/admin/accounting/general-ledger` | `generalLedgerScreen` | Specialized | no | — |
| ACC-14 | ready | Partner statement | `/admin/accounting/partner-statement` | `partnerLedgerScreen` | Specialized | no | — |
| AP-01 | ready | Partner accounting terms | `/admin/partner/partners/{id}/accounting` | `accountingTermsScreen` | FormPage | no | — |

### Sales lane

Structure debt: move the routed dashboard and the split screen files into `sale_backend/screens/`; remove
unrouted legacy exports from the old `screens.tsx` only after confirming the route registry.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| SALE-01 | ready | Sales overview | `/admin/sales` | `dashboard` | Specialized | no | — |
| SALE-02 | ready | Quotations | `/admin/sales/quotations` | `quotationsScreen` | Split | list/new: no | — |
| SALE-03 | ready | Sales orders | `/admin/sales/orders` | `salesOrdersScreen` | ListPage | no | — |
| SALE-04 | ready | Quotation/order detail | `/admin/sales/quotations/{id}`, `/admin/sales/orders/{id}` | `orderDetailScreen` | FormPage | `sale_mail_backend` | — |
| SALE-05 | ready | Invoicing policies | `/admin/sales/invoicing-policies` | `invoicingPoliciesScreen` | Split | no | — |

### Purchase lane

Structure debt: `purchase_backend/screens.tsx` is monolithic. Each row moves its renderer into
`purchase_backend/screens/`; shared labels and rejection/setup notices belong in `screens/shared.tsx`.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| PUR-01 | ready | Purchase overview | `/admin/purchase` | `dashboard` | Specialized | no | — |
| PUR-02 | ready | Requests for quotation | `/admin/purchase/rfqs` | `ordersScreen` (RFQ variant) | Split | no | — |
| PUR-03 | ready | Purchase orders | `/admin/purchase/orders` | `ordersScreen` (order variant) | ListPage | no | — |
| PUR-04 | ready | RFQ/purchase-order detail | `/admin/purchase/rfqs/{id}`, `/admin/purchase/orders/{id}` | `orderDetail` | FormPage | bridge missing | — |
| PUR-05 | ready | Vendor pricelists | `/admin/purchase/vendor-pricelists` | `supplierInfoScreen` | Split | no | — |

### Stock lane

Structure debt: move the root `*-screen.tsx` files into `stock_backend/screens/`; move reusable stock-row
rendering from `screens.tsx` to `screens/shared.tsx`, then remove the old file.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| STOCK-01 | ready | Inventory adjustment and balances | `/admin/stock/inventory` | `inventoryScreen` | Specialized | no | — |
| STOCK-02 | done | Transfers | `/admin/stock/transfers`, `/admin/stock/transfers/new` | `screens/transfers-list.tsx`, `screens/transfer-create.tsx` | Split | list/new: no | Huygens + Kant |
| STOCK-03 | done | Transfer detail | `/admin/stock/transfers/{id}` | `screens/transfer-detail.tsx` | FormPage | `stock_mail_backend` | Curie |
| STOCK-04 | ready | Warehouses | `/admin/stock/warehouses` | `warehousesScreen` | Split | no | — |
| STOCK-05 | ready | Locations | `/admin/stock/locations` | `locationsScreen` | Split | no | — |
| STOCK-06 | ready | Operation types | `/admin/stock/picking-types` | `pickingTypesScreen` | Split | no | — |
| STOCK-07 | done | Lots and serials | `/admin/stock/lots`, `/admin/stock/lots/new` | `screens/lots-list.tsx`, `screens/lot-create.tsx` | Split | list/new: no | Huygens + Kant |
| STOCK-08 | done | Lot/serial detail | `/admin/stock/lots/{id}` | `screens/lot-detail.tsx` | FormPage | `stock_lot_mail_backend` | Curie |
| STOCK-09 | done | Supply routes | `/admin/stock/routes`, `/admin/stock/routes/new` | `screens/stock-routes-list.tsx`, `screens/stock-route-create.tsx` | Split | list/new: no | Huygens + Kant |
| STOCK-10 | done | Supply-route detail | `/admin/stock/routes/{id}` | `screens/stock-route-detail.tsx` | FormPage | no | Curie |
| STOCK-11 | ready | Replenishment rules | `/admin/stock/replenishment` | `replenishmentScreen` | Split | no | — |
| STOCK-12 | ready | Stock forecast | `/admin/stock/forecast` | `forecastScreen` | Specialized | no | — |

### Product lane

`product_backend/screens/` already exists. Move the remaining `create-screen.tsx` and
`attributes-screen.tsx` into it when their rows start.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| PROD-01 | done | Product list | `/admin/product/templates` | `screens/list.tsx::productsScreen` | ListPage | no | — |
| PROD-02 | ready | Save favorite filter | `/admin/product/templates/favorites/new` | `screens/favorite.tsx::favoriteScreen` | FormPage | no | — |
| PROD-03 | ready | Product create | `/admin/product/templates/new` | `create-screen.tsx::newProductScreen` | FormPage | no | — |
| PROD-04 | ready | Attributes and values | `/admin/product/attributes` | `attributes-screen.tsx::attributesScreen` | Specialized | no | — |
| PROD-05 | done | Product detail | `/admin/product/templates/{id}` | `screens/detail.tsx::productDetailScreen` | FormPage | `product_mail_backend` | — |
| PROD-06 | done | Product variant detail | `/admin/product/templates/{id}/variants/{variantId}` | `screens/variant.tsx::variantScreen` | FormPage | `product_variant_mail_backend` | — |

### Partner lane

`partner_backend` is the reference module: it already uses `screens/` and the public patterns.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| PARTNER-01 | done | Partner list | `/admin/partner/partners` | `screens/list.tsx::partnersScreen` | ListPage | no | — |
| PARTNER-02 | done | Partner create | `/admin/partner/partners/new` | `screens/new.tsx::newPartnerScreen` | FormPage | no | — |
| PARTNER-03 | done | Partner detail | `/admin/partner/partners/{id}` | `screens/form.tsx::partnerFormScreen` | FormPage | `partner_mail_backend` | — |

### CRM lane

Structure debt: split `crm_backend/screens.tsx` into one renderer per file. `permissionScreen` is a state of
case detail and stays with CRM-03; configuration tabs stay together until their route and loader are split.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| CRM-01 | ready | Pipeline | `/admin/crm/pipeline` | `pipelineScreen` | Specialized | — |
| CRM-02 | ready | Cases list/create | `/admin/crm/cases` | `casesScreen` | Split | — |
| CRM-03 | ready | Case detail | `/admin/crm/cases/{id}` | `caseDetailScreen`, `permissionScreen` | FormPage/Specialized | — |
| CRM-04 | ready | Activity planner | `/admin/crm/activities` | `plannerScreen` | Specialized | — |
| CRM-05 | ready | Leaderboard | `/admin/crm/leaderboard` | `leaderboardScreen` | ListPage | — |
| CRM-06 | ready | CRM configuration | `/admin/crm/configuration` | `configurationScreen` | Specialized | — |

### Flow lane

`flow_backend/screens/` exists. Before parallel work, split multi-renderer `pages.tsx` and `epics.tsx` into
leaf files; generated Live Doc endpoints belong to the detail renderer that consumes them.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| FLOW-01 | ready | Projects | `/admin/flow/projects` | `screens/projects.tsx::projectsScreen` | Split | — |
| FLOW-02 | ready | Project board | `/admin/flow/projects/{id}/board` | `screens/board.tsx::boardScreen` | Specialized | — |
| FLOW-03 | ready | My/all cross-project issues | `/admin/flow/mine`, `/admin/flow/issues` | `screens/my-work.tsx::crossProjectScreen` | ListPage | — |
| FLOW-04 | ready | Project issues | `/admin/flow/projects/{id}/issues` | `screens/issues.tsx::issuesScreen` | Split | — |
| FLOW-05 | ready | Issue detail | `/admin/flow/issues/{id}` | `screens/issue-detail.tsx::issueDetailScreen` | FormPage/Specialized | — |
| FLOW-06 | ready | Project page tree | `/admin/flow/projects/{id}/pages` | `screens/pages.tsx::pagesScreen` | Specialized | — |
| FLOW-07 | ready | All pages | `/admin/flow/pages` | `screens/pages.tsx::allPagesScreen` | ListPage | — |
| FLOW-08 | ready | Page live editor | `/admin/flow/pages/{id}` | `screens/pages.tsx::pageDetailScreen` | Specialized | — |
| FLOW-09 | ready | Project epics | `/admin/flow/projects/{id}/epics` | `screens/epics.tsx::epicsScreen` | Specialized | — |
| FLOW-10 | ready | All epics | `/admin/flow/epics` | `screens/epics.tsx::allEpicsScreen` | ListPage | — |
| FLOW-11 | ready | Epic detail | `/admin/flow/epics/{id}` | `screens/epics.tsx::epicDetailScreen` | FormPage/Specialized | — |
| FLOW-12 | ready | Epic dependency map | `/admin/flow/projects/{id}/epics/{epicId}/map` | `screens/map.tsx::mapScreen` | Specialized | — |
| FLOW-13 | ready | Project Gantt | `/admin/flow/projects/{id}/gantt` | `screens/gantt.tsx::ganttScreen` | Specialized | — |
| FLOW-14 | ready | Project sprints | `/admin/flow/projects/{id}/sprints` | `screens/sprints.tsx::sprintsScreen` | Split/Specialized | — |
| FLOW-15 | ready | Project settings | `/admin/flow/projects/{id}/settings` | `screens/settings.tsx::settingsScreen` | Specialized | — |

### Manufacturing lane

Structure debt: split `manufacturing_backend/screens.tsx` incrementally into `screens/`.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| MFG-01 | ready | Manufacturing orders | `/admin/manufacturing` | `ordersScreen` | Split | — |
| MFG-02 | ready | Manufacturing order execution | `/admin/manufacturing/orders/{id}` | `orderScreen` | FormPage/Specialized | — |
| MFG-03 | ready | Bills of materials | `/admin/manufacturing/boms` | `bomsScreen` | Split | — |
| MFG-04 | ready | Work centers | `/admin/manufacturing/work-centers` | `workCentersScreen` | Split | — |

### HR and attendance lanes

Structure debt: both modules still use monolithic `screens.tsx`; each lane creates its own `screens/`
folder and moves one renderer per assignment.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| HR-01 | hr | ready | Employees | `/admin/hr` | `employeesScreen` | Split | — |
| HR-02 | hr | ready | Weekly roster | `/admin/hr/roster` | `rosterScreen` | Specialized | — |
| HR-03 | hr | ready | Leave approvals | `/admin/hr/leaves` | `leavesScreen` | ListPage | — |
| ATT-01 | attendance | ready | My work | `/my/work` | `myWorkScreen` | Specialized | — |
| ATT-02 | attendance | keep | Attendance kiosk | `/attendance/kiosk/{secret}` | `kioskScreen` | Specialized public kiosk | — |
| ATT-03 | attendance | ready | Attendance period | `/admin/attendance` | `periodScreen` | Specialized | — |
| ATT-04 | attendance | ready | Credential issuance | `/admin/attendance/credentials` | `credentialScreen` | FormPage/Specialized | — |

### Company lane

Structure debt: split `company_backend/screens.tsx` into `screens/` before running more than one company
assignment.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| COMPANY-01 | ready | Companies | `/admin/companies` | `companiesScreen` | ListPage | — |
| COMPANY-02 | ready | Company create/detail | `/admin/companies/new`, `/admin/companies/{id}` | `companyFormScreen` | FormPage | — |
| COMPANY-03 | ready | Branch create/detail | `/admin/companies/{id}/branches/new`, `/admin/companies/{companyId}/branches/{id}` | `branchFormScreen` | FormPage | — |
| COMPANY-04 | ready | Company hierarchy | `/admin/companies/hierarchy` | `hierarchyScreen` | Specialized | — |
| COMPANY-05 | ready | Active company/branch context | `/admin/context` | `contextScreen` | FormPage/Specialized | — |

### User and authentication lanes

Structure debt: split `user_backend/screens.tsx` into `screens/`. The shared session table moves once to
`screens/shared.tsx` and remains owned by USER-02/USER-06. The public login renderer is a separate user
module surface and is intentionally not forced into FormPage.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| USER-01 | user-backend | ready | Users | `/admin/users` | `usersScreen` | ListPage | — |
| USER-02 | user-backend | ready | User create/detail/access | `/admin/users/new`, `/admin/users/{id}` | `userFormScreen`, `sessionsScreen` | FormPage | — |
| USER-03 | user-backend | ready | Roles | `/admin/roles` | `rolesScreen` | ListPage | — |
| USER-04 | user-backend | ready | Role create/detail | `/admin/roles/new`, `/admin/roles/{id}` | `roleScreen` | FormPage | — |
| USER-05 | user-backend | ready | Permission presets | `/admin/permission-presets` | `presetsScreen` | FormPage/Specialized | — |
| USER-06 | user-backend | ready | Profile/security/preferences | `/admin/profile` | `profileScreen`, `sessionsScreen` | FormPage | — |
| AUTH-01 | user | keep | Login | `/login` | `user/screens.tsx::loginScreen` | Specialized public auth | — |

### Address, activity, and calendar lanes

Each of these modules still has a root `screens.tsx`; move the assigned renderer into a module-local
`screens/` folder when its row begins.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| ADDRESS-01 | address | ready | Address catalogs | `/admin/addresses` | `catalogsScreen` | ListPage | — |
| ADDRESS-02 | address | ready | Country/division browser | `/admin/addresses/{countryCode}` | `countryScreen` | Specialized | — |
| ACTIVITY-01 | activity | ready | Activities/to-do queue | `/admin/activities` | `activitiesScreen` | ListPage | — |
| CALENDAR-01 | calendar | ready | Calendar | `/admin/calendar` | `calendarScreen` | Specialized | — |

### Loyalty lane

Structure debt: split `loyalty_backend/screens.tsx` into `screens/`; do not split the membership workspace
tabs until their route/data loader is separated.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| LOYALTY-01 | ready | Loyalty overview | `/admin/loyalty` | `dashboardScreen` | Specialized | — |
| LOYALTY-02 | ready | Programs | `/admin/loyalty/programs` | `programsScreen` | Split | — |
| LOYALTY-03 | ready | Program detail | `/admin/loyalty/programs/{id}` | `programDetailScreen` | FormPage/Specialized | — |
| LOYALTY-04 | ready | Wallets | `/admin/loyalty/wallets` | `walletsScreen` | Split | — |
| LOYALTY-05 | ready | Wallet detail | `/admin/loyalty/wallets/{id}` | `walletDetailScreen` | FormPage/Specialized | — |
| LOYALTY-06 | ready | Loyalty ledger | `/admin/loyalty/ledger` | `ledgerScreen` | ListPage | — |
| LOYALTY-07 | ready | Membership configuration | `/admin/loyalty/memberships` | `membershipsScreen` | Specialized | — |
| LOYALTY-08 | ready | Sale/POS order loyalty | `/admin/loyalty/orders/{channel}/{id}` | `orderLoyaltyScreen` | Specialized | — |
| LOYALTY-09 | keep | Customer loyalty portal | `/my/loyalty` | `portalScreen` | Specialized portal | — |

### Pricing lane

Structure debt: split `pricing_backend/screens.tsx` into `screens/`.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| PRICE-01 | ready | Pricelists | `/admin/pricing/pricelists` | `pricelistsScreen` | Split | — |
| PRICE-02 | ready | Pricelist detail/items | `/admin/pricing/pricelists/{id}` | `pricelistDetailScreen` | FormPage | — |

### POS lane

Structure debt: split `pos_backend/screens.tsx` into `screens/`; the route registry remains coordinator-owned
because it is embedded in `pos_backend/index.ts`.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| POS-01 | ready | POS overview | `/admin/pos` | `dashboard` | Specialized | — |
| POS-02 | ready | POS configurations | `/admin/pos/configurations` | `configsScreen` | Split | — |
| POS-03 | ready | Payment methods | `/admin/pos/payment-methods` | `methodsScreen` | Split/Specialized | — |
| POS-04 | ready | POS sessions | `/admin/pos/sessions` | `sessionsScreen` | Split | — |
| POS-05 | ready | POS session detail | `/admin/pos/sessions/{id}` | `sessionDetail` | FormPage/Specialized | — |
| POS-06 | ready | POS register | `/admin/pos/register/{id}` | `registerScreen` | Specialized | — |
| POS-07 | ready | POS orders | `/admin/pos/orders` | `ordersScreen` | ListPage | — |
| POS-08 | ready | POS order detail | `/admin/pos/orders/{id}` | `orderDetail` | FormPage/Specialized | — |

### Website administration lane

Structure debt: split `website_backend/screens.tsx` into `screens/`. Page and post aliases currently share
renderers, so each shared family is one assignment until leaf wrappers exist. Legacy `/admin/website/content`
aliases remain owned by the page/post family and are not separate agents.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| WEB-01 | ready | Sites | `/admin/website/sites` | `sitesScreen` | ListPage | — |
| WEB-02 | ready | Site create/detail | `/admin/website/sites/new`, `/admin/website/sites/{id}` | `siteFormScreen` | FormPage | — |
| WEB-03 | ready | Pages/posts collections | `/admin/website/pages`, `/admin/website/posts` | `contentScreen` | ListPage | — |
| WEB-04 | ready | Page/post create/detail/publish | `/pages/new`, `/pages/{id}`, `/posts/new`, `/posts/{id}` | `entryFormScreen` | FormPage | — |
| WEB-05 | ready | Page/post revision history | `/pages/{id}/revisions`, `/posts/{id}/revisions` | `revisionsScreen` | ListPage | — |
| WEB-06 | ready | Page/post preview launcher | `/pages/{id}/preview`, `/posts/{id}/preview` | `previewScreen` | Specialized | — |
| WEB-07 | ready | Taxonomies | `/admin/website/taxonomies` | `taxonomyScreen` | ListPage | — |
| WEB-08 | ready | Taxonomy create/detail | `/admin/website/taxonomies/new`, `/taxonomies/{id}` | `taxonomyFormScreen` | FormPage | — |
| WEB-09 | ready | Media library | `/admin/website/media` | `mediaScreen` | ListPage | — |
| WEB-10 | ready | Media create/detail | `/admin/website/media/new`, `/media/{id}` | `mediaFormScreen` | FormPage | — |
| WEB-11 | ready | Navigation menus | `/admin/website/menus` | `menusScreen` | ListPage | — |
| WEB-12 | ready | Menu create/detail | `/admin/website/menus/new`, `/menus/{id}` | `menuFormScreen` | FormPage | — |
| WEB-13 | ready | Website forms | `/admin/website/forms` | `formsScreen` | ListPage | — |
| WEB-14 | ready | Website form create | `/admin/website/forms/new` | `formCreateScreen` | FormPage | — |
| WEB-15 | ready | Form submissions | `/admin/website/forms/{id}/submissions` | `submissionsScreen` | ListPage | — |

### Public CRM website lane

Structure debt: if this public surface is touched, move `crm_website/screens.tsx` to
`crm_website/screens/lead.tsx` plus a barrel. It remains outside the backend ListPage/FormPage language.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| CRM-WEB-01 | keep | Public sales-contact form | `/contact/sales` | `websiteLeadScreen` | Specialized public form | — |

### Hospitality core lane

Structure debt: `hospitality_core/screens.tsx` is the largest monolith. The first assignment creates
`hospitality_core/screens/index.ts` and narrowly scoped `shared.tsx`; every later assignment extracts only
its renderer. This lane is strictly serial until the monolith is gone.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| HOSP-01 | ready | Front desk | `/admin/hospitality/front-desk` | `frontDeskScreen` | Specialized | — |
| HOSP-02 | ready | Reservations list/intake | `/admin/hospitality/reservations` | `reservationsScreen` | Split | — |
| HOSP-03 | ready | Reservation detail | `/admin/hospitality/reservations/{id}` | `reservationDetailScreen` | FormPage/Specialized | — |
| HOSP-04 | ready | Stays | `/admin/hospitality/stays` | `staysScreen` | ListPage | — |
| HOSP-05 | ready | Stay detail | `/admin/hospitality/stays/{id}` | `stayDetailScreen` | FormPage/Specialized | — |
| HOSP-06 | ready | Folios | `/admin/hospitality/folios` | `foliosScreen` | ListPage | — |
| HOSP-07 | ready | Folio detail | `/admin/hospitality/folios/{id}` | `folioDetailScreen` | FormPage/Specialized | — |
| HOSP-08 | ready | Tape chart | `/admin/hospitality/tape-chart` | `tapeChartScreen` | Specialized | — |
| HOSP-09 | ready | Properties | `/admin/hospitality/properties` | `propertiesScreen` | ListPage | — |
| HOSP-10 | ready | Property create | `/admin/hospitality/properties/new` | `newPropertyScreen` | FormPage | — |
| HOSP-11 | ready | Property detail | `/admin/hospitality/properties/{id}` | `propertyDetailScreen` | FormPage | — |
| HOSP-12 | ready | Building detail | `/admin/hospitality/buildings/{id}` | `buildingDetailScreen` | FormPage | — |
| HOSP-13 | ready | Level/floor detail | `/admin/hospitality/levels/{id}` | `floorDetailScreen` | FormPage | — |
| HOSP-14 | ready | Rooms | `/admin/hospitality/rooms` | `roomsScreen` | ListPage | — |
| HOSP-15 | ready | Room create | `/admin/hospitality/rooms/new` | `newRoomScreen` | FormPage | — |
| HOSP-16 | ready | Room detail | `/admin/hospitality/rooms/{id}` | `roomDetailScreen` | FormPage | — |
| HOSP-17 | ready | Room types | `/admin/hospitality/room-types` | `roomTypesScreen` | ListPage | — |
| HOSP-18 | ready | Room-type create | `/admin/hospitality/room-types/new` | `newRoomTypeScreen` | FormPage | — |
| HOSP-19 | ready | Room-type detail | `/admin/hospitality/room-types/{id}` | `roomTypeDetailScreen` | FormPage | — |
| HOSP-20 | ready | Rate plans | `/admin/hospitality/rate-plans` | `ratePlansScreen` | Split | — |
| HOSP-21 | ready | Hospitality inventory calendar | `/admin/hospitality/inventory` | `inventoryScreen` | Specialized | — |
| HOSP-22 | ready | Services and charges | `/admin/hospitality/services` | `servicesScreen` | Specialized | — |
| HOSP-23 | ready | Night audit | `/admin/hospitality/night-audit` | `nightAuditScreen` | Specialized | — |
| HOSP-24 | ready | Stay notices | `/admin/hospitality/stay-notices` | `stayNoticesScreen` | Specialized | — |
| HOSP-25 | ready | Housekeeping tasks | `/admin/hospitality/housekeeping` | `cleaningTasksScreen` | Split | — |
| HOSP-26 | ready | Cleaning-task detail | `/admin/hospitality/housekeeping/tasks/{id}` | `cleaningTaskDetailScreen` | FormPage/Specialized | — |
| HOSP-27 | ready | Housekeeping room status | `/admin/hospitality/housekeeping/rooms` | `housekeepingRoomsScreen` | Specialized | — |
| HOSP-28 | ready | Housekeeping room detail | `/admin/hospitality/housekeeping/rooms/{id}` | `housekeepingRoomDetailScreen` | Specialized | — |
| HOSP-29 | ready | Hospitality content/media | `/admin/hospitality/content` | `contentScreen` | Specialized | — |
| HOSP-30 | ready | Amenities | `/admin/hospitality/amenities` | `amenitiesScreen` | Split | — |
| HOSP-31 | ready | Policies | `/admin/hospitality/policies` | `policiesScreen` | Split | — |

### Hospitality billing lane

Structure debt: split `hospitality_billing/screens.tsx` into `screens/`.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| HOSP-BILL-01 | ready | Charge rules | `/admin/hospitality/billing/rules` | `chargeRulesScreen` | Split | — |
| HOSP-BILL-02 | ready | Closed-folio billing queue | `/admin/hospitality/billing` | `billingScreen` | Specialized | — |

### Mail operations lanes

Each module has one root `screens.tsx`; its agent replaces it with `screens/index.ts` and one leaf file.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| MAIL-01 | mail | ready | Inbox | `/admin/inbox` | `inboxScreen` | ListPage | — |
| MAIL-02 | inbound-mail | ready | Inbound email events | `/admin/inbound-email` | `inboundScreen` | ListPage | — |
| MAIL-03 | mail-transport | ready | Outbox deliveries | `/admin/outbox` | `outboxScreen` | ListPage | — |

### OAuth lane

Structure debt: split `oauth_backend/screens.tsx` into `screens/`.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| OAUTH-01 | ready | OAuth providers | `/admin/oauth/providers` | `providersScreen` | ListPage | — |
| OAUTH-02 | ready | Provider create/detail | `/admin/oauth/providers/new`, `/providers/{id}` | `providerFormScreen` | FormPage | — |
| OAUTH-03 | ready | Linked identities | `/admin/oauth/identities` | `identitiesScreen` | ListPage | — |
| OAUTH-04 | ready | Identity create | `/admin/oauth/identities/new` | `identityFormScreen` | FormPage | — |
| OAUTH-05 | ready | Provider linking chooser | `/admin/oauth/link` | `linkProviderScreen` | FormPage/Specialized | — |

### Report lane

The UI currently lives inline in `report_backend/routes.tsx`; extract it to `report_backend/screens/` before
layout migration. PDF output stays with the editor owner and is not a FormPage.

| ID | Status | Screen/output | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| REPORT-01 | ready | Report definitions | `/admin/reports` | `routes.tsx::listReports` | ListPage | — |
| REPORT-02 | ready | Report editor/version history | `/admin/reports/{report}` | `routes.tsx::reportEditor` | Specialized | — |
| REPORT-03 | keep | Report PDF preview | `/admin/reports/{report}/preview` | `routes.tsx::previewReport` | Raw PDF output | — |

### Intentional exclusions and aliases

These entries were inspected and intentionally do not receive a screen agent:

- `/admin` and redirect-only aliases such as `/admin/crm`, `/admin/flow`, `/admin/flow/board`, and
  `/admin/website/content` do not render an independent screen.
- `backend/screens.tsx::pagesScreen` and `backend/catalogue.ts::cataloguePage` are not registered production
  routes; they remain catalogue/test surfaces.
- Archive, restore, delete, bulk, media movement, line mutation, Chatter, attachment, Live Doc transport,
  RSVP JSON, mail inbound, upload, download, CSV export and other POST/action endpoints belong to their
  parent screen owner.
- `sale_backend/screens.tsx::{ordersScreen, policyScreen, orderDetail}` are unrouted legacy exports; remove
  them during their lane's structural cleanup after tests prove no consumer remains.
- `stock_backend/screens/stock.tsx::stockScreen` is an unrouted compatibility surface retained only by the
  i18n catalogue; the old root `stock_backend/screens.tsx` has been removed.
- `CONFIGURATION_TABS`, `extensionLink`, `labelOf`, `missingSetup`, `moveTitle`, `optionsOf`, `pageColumns`,
  and `stockRowsTable` are helpers or constants rather than route-level screens. They move to the owning
  lane's `screens/shared.tsx` only when more than one extracted renderer still consumes them.
- Public CMS/storefront rendering, website channel APIs, staff/customer channel APIs, print documents and
  binary downloads are outside the backend ListPage/FormPage migration. `CRM-WEB-01`, `ATT-02`, `AUTH-01`,
  `LOYALTY-09`, and `REPORT-03` are retained above only as explicit boundary markers.

## Definition of done for one row

- The screen uses the target public pattern without copying its layout CSS into the module.
- If its module started with a monolithic `screens.tsx`, the assigned renderer now lives in the module's
  `screens/` folder and the barrel import remains stable.
- List state is URL-driven; create is a header action rather than an unrelated form above the table.
- Form labels stay in the left column and controls in the right column at every supported width.
- A collaboration rail is one third of content above 1023px and stacks below the body at narrower widths.
- Primary action stays beside identity; secondary/destructive actions use the compact More hierarchy.
- Partial saves preserve Chatter, Activity, relation controls, and any other island DOM.
- Vietnamese and English, light and dark themes, empty/error/loading states, keyboard use and narrow screens
  are covered in proportion to the screen's risk.
- Focused tests pass, browser evidence is recorded, the row becomes `review`, and only the coordinator commits.

## Completeness checks

Run these read-only checks from the repository root and reconcile every new result into this file:

```sh
# Run from: /path/to/ketjs
rg -n "^\\s*'/[^']*':" packages/ketsuite/src/modules --glob '*.ts' --glob '*.tsx'
rg -n "^\\s*'/(admin|my)/[^']*':" packages/ketsuite/src/modules --glob '*.ts' --glob '*.tsx'
rg -n '^export (const|function) [A-Za-z0-9_]+' packages/ketsuite/src/modules \
  --glob '*screen*.tsx' --glob 'screens.tsx' --glob 'routes.tsx'
rg -l '\\bFramed\\b|\\bRecordWorkspace\\b|\\bListPage\\b|\\bFormPage\\b' \
  packages/ketsuite/src/modules --glob '*.tsx'
```

Expected exclusions must be documented in the audit section: action-only routes, exports not reached by a
route, public storefronts, channel APIs, print/download responses, and fragment-only handlers.

## Wave evidence

### Wave 1 — STOCK-07 and STOCK-08

- List: dedicated `ListPage`; create action routes to `/admin/stock/lots/new`; no inline create form or
  Chatter.
- Create: dedicated `FormPage`; at 1280 px the standard controls measure 280 px against 120 px labels.
- Detail: dedicated `FormPage`; Chatter measures exactly one third of the 1920 px content layout and stacks
  below the form at 390 px. Partial saves replace only `stock.lot-header` and `stock.lot-body`, preserving
  editor, Chatter, Activity and sidebar DOM identity.
- Automated coverage: focused render tests, `product-stock-e2e`, and targeted browser E2E for `lot-list`,
  `lot-create`, and `lot-detail-chatter`.

![Wave 1 lot list evidence](/assets/inventory-lot-list/lot-list-browser-skill.png)

![Wave 1 lot create evidence](/assets/inventory-lot-list/lot-create-browser-skill.png)

![Wave 1 lot detail evidence](/assets/inventory-lot-list/lot-detail-browser-skill.png)

![Wave 1 lot detail mobile evidence](/assets/inventory-lot-list/lot-detail-mobile-browser-skill.png)

### Wave 2 — STOCK-02 and STOCK-03

- List: dedicated `ListPage`; create action routes to `/admin/stock/transfers/new`; no inline create form or
  Chatter.
- Create: dedicated `FormPage`; at 1280 px each control measures 264 px against a 120 px label.
- Detail: dedicated `FormPage`; all operational forms and print actions remain intact. Chatter measures one
  third of the 1920 px content layout, stacks below the body at 390 px, and retains 20 px top padding.
- Partial actions return only `stock.transfer-header` and `stock.transfer-body`, preserving editor, Chatter,
  Activity and sidebar DOM identity.
- Structural cleanup: `stock_backend/screens.tsx`, `transfers-screen.tsx`, and `transfer-screen.tsx` were
  replaced by leaf files plus `screens/shared.tsx` and the barrel.

![Wave 2 transfer list evidence](/assets/inventory-transfer-list/transfer-list-browser-skill.png)

![Wave 2 transfer create evidence](/assets/inventory-transfer-list/transfer-create-browser-skill.png)

![Wave 2 transfer detail evidence](/assets/inventory-transfer-list/transfer-detail-browser-skill.png)

![Wave 2 transfer detail mobile evidence](/assets/inventory-transfer-list/transfer-detail-mobile-browser-skill.png)

### Wave 3 — STOCK-09 and STOCK-10

- List: dedicated `ListPage` with row-wide detail links and a localized create action to
  `/admin/stock/routes/new`; the inline create form was removed.
- Create: dedicated `FormPage` preserving name, sequence, validation and cancel semantics. At 1280 px the
  standard input measures 280 px, with no horizontal overflow.
- Detail: dedicated `FormPage` preserving route editing, the complete rules table, and all seven add-rule
  fields. Summary stays compact in header metadata; there is no redundant quick-info rail or Chatter for a
  domain without a mail bridge.
- Responsive evidence: at 390 px the route name input measures 250 px inside a 358 px form row, both forms
  remain rendered, and the document has no horizontal overflow.
- Validation scope: six focused renderer tests, the affected stock-route HTTP scenario, three targeted
  browser E2E flows, Biome on changed files, build/typecheck, and Astro docs validation.

![Wave 3 route list evidence](/assets/inventory-route-list/route-list-browser-skill.png)

![Wave 3 route create evidence](/assets/inventory-route-list/route-create-browser-skill.png)

![Wave 3 route detail evidence](/assets/inventory-route-detail/route-detail-browser-skill.png)

![Wave 3 route detail mobile evidence](/assets/inventory-route-detail/route-detail-mobile-browser-skill.png)
