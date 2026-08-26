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
| ACC-01 | keep | Accounting overview | `/admin/accounting` | `screens/overview.tsx::accountingOverviewScreen` | Specialized | no | Curie |
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
| SALE-01 | keep | Sales overview | `/admin/sales` | `screens/overview.tsx::overviewScreen` | Specialized | no | Kant |
| SALE-02 | done | Quotations | `/admin/sales/quotations`, `/admin/sales/quotations/new` | `screens/quotations-list.tsx`, `screens/quotation-create.tsx` | Split | list/new: no | Kant |
| SALE-03 | done | Sales orders | `/admin/sales/orders` | `screens/sales-orders-list.tsx::salesOrdersListScreen` | ListPage | no | Kant |
| SALE-04 | done | Quotation/order detail | `/admin/sales/quotations/{id}`, `/admin/sales/orders/{id}` | `screens/order-detail.tsx::orderDetailScreen` | FormPage | `sale_mail_backend` | Kant |
| SALE-05 | done | Invoicing policies | `/admin/sales/invoicing-policies`, `/admin/sales/invoicing-policies/new` | `screens/invoicing-policies-list.tsx`, `screens/invoicing-policy-create.tsx` | Split | no | Kant |

### Purchase lane

Structure debt resolved in Wave 10: `purchase_backend/screens.tsx` was removed after every routed renderer
moved into `purchase_backend/screens/`; shared labels, list columns and rejection/setup notices live in shared leaves.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| PUR-01 | keep | Purchase overview | `/admin/purchase` | `screens/overview.tsx::purchaseOverviewScreen` | Specialized | no | Curie |
| PUR-02 | done | Requests for quotation | `/admin/purchase/rfqs`, `/admin/purchase/rfqs/new` | `screens/rfqs-list.tsx`, `screens/rfq-create.tsx` | Split | no | Curie |
| PUR-03 | done | Purchase orders | `/admin/purchase/orders` | `screens/purchase-orders-list.tsx::purchaseOrdersListScreen` | ListPage | no | Curie |
| PUR-04 | done | RFQ/purchase-order detail | `/admin/purchase/rfqs/{id}`, `/admin/purchase/orders/{id}` | `screens/order-detail.tsx::purchaseOrderDetailScreen` | FormPage | bridge missing | Curie |
| PUR-05 | done | Vendor pricelists | `/admin/purchase/vendor-pricelists`, `/admin/purchase/vendor-pricelists/new` | `screens/vendor-pricelists-list.tsx`, `screens/vendor-pricelist-create.tsx` | Split | no | Curie |

### Stock lane

Structure debt: move the root `*-screen.tsx` files into `stock_backend/screens/`; move reusable stock-row
rendering from `screens.tsx` to `screens/shared.tsx`, then remove the old file.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| STOCK-01 | keep | Inventory adjustment and balances | `/admin/stock/inventory` | `screens/inventory.tsx` | Specialized | no | Kant |
| STOCK-02 | done | Transfers | `/admin/stock/transfers`, `/admin/stock/transfers/new` | `screens/transfers-list.tsx`, `screens/transfer-create.tsx` | Split | list/new: no | Huygens + Kant |
| STOCK-03 | done | Transfer detail | `/admin/stock/transfers/{id}` | `screens/transfer-detail.tsx` | FormPage | `stock_mail_backend` | Curie |
| STOCK-04 | done | Warehouses | `/admin/stock/warehouses`, `/admin/stock/warehouses/new` | `screens/warehouses-list.tsx`, `screens/warehouse-create.tsx` | Split | list/new: no | Huygens |
| STOCK-05 | done | Locations | `/admin/stock/locations`, `/admin/stock/locations/new` | `screens/locations-list.tsx`, `screens/location-create.tsx` | Split | list/new: no | Kant |
| STOCK-06 | done | Operation types | `/admin/stock/picking-types`, `/admin/stock/picking-types/new` | `screens/picking-types-list.tsx`, `screens/picking-type-create.tsx` | Split | list/new: no | Curie |
| STOCK-07 | done | Lots and serials | `/admin/stock/lots`, `/admin/stock/lots/new` | `screens/lots-list.tsx`, `screens/lot-create.tsx` | Split | list/new: no | Huygens + Kant |
| STOCK-08 | done | Lot/serial detail | `/admin/stock/lots/{id}` | `screens/lot-detail.tsx` | FormPage | `stock_lot_mail_backend` | Curie |
| STOCK-09 | done | Supply routes | `/admin/stock/routes`, `/admin/stock/routes/new` | `screens/stock-routes-list.tsx`, `screens/stock-route-create.tsx` | Split | list/new: no | Huygens + Kant |
| STOCK-10 | done | Supply-route detail | `/admin/stock/routes/{id}` | `screens/stock-route-detail.tsx` | FormPage | no | Curie |
| STOCK-11 | done | Replenishment rules | `/admin/stock/replenishment`, `/admin/stock/replenishment/new` | `screens/replenishment-list.tsx`, `screens/replenishment-create.tsx` | Split | list/new: no | Huygens |
| STOCK-12 | keep | Stock forecast | `/admin/stock/forecast` | `screens/forecast.tsx` | Specialized | no | Curie |

### Product lane

`product_backend/screens/` already exists. Move the remaining `create-screen.tsx` and
`attributes-screen.tsx` into it when their rows start.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| PROD-01 | done | Product list | `/admin/product/templates` | `screens/list.tsx::productsScreen` | ListPage | no | — |
| PROD-02 | done | Save favorite filter | `/admin/product/templates/favorites/new` | `screens/favorite.tsx::favoriteScreen` | FormPage | no | Huygens |
| PROD-03 | done | Product create | `/admin/product/templates/new` | `screens/create.tsx::newProductScreen` | FormPage | no | Kant |
| PROD-04 | keep | Attributes and values | `/admin/product/attributes` | `screens/attributes.tsx::attributesScreen` | Specialized | no | Curie |
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
| CRM-01 | keep | Pipeline | `/admin/crm/pipeline` | `screens/pipeline.tsx::pipelineScreen` | Specialized | Huygens |
| CRM-02 | done | Cases list/create | `/admin/crm/cases`, `/admin/crm/cases/new` | `screens/cases-list.tsx`, `screens/case-create.tsx` | Split | Huygens |
| CRM-03 | keep | Case detail | `/admin/crm/cases/{id}` | `screens/case-detail.tsx::caseDetailScreen`, `permissionScreen` | Specialized | Huygens |
| CRM-04 | keep | Activity planner | `/admin/crm/activities` | `screens/activity-planner.tsx::plannerScreen` | Specialized | Huygens |
| CRM-05 | done | Leaderboard | `/admin/crm/leaderboard` | `screens/leaderboard.tsx::leaderboardScreen` | ListPage | Huygens |
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

### Wave 4 — STOCK-04, STOCK-05 and STOCK-06

- Warehouses, Locations and Operation Types now use dedicated `ListPage` collection screens and dedicated
  `/new` `FormPage` screens; all three lists have localized create actions and no inline form.
- Existing POST endpoints remain compatible while the new forms post to their locale-aware `/new` routes.
- All warehouse step radios, location hierarchy/options, and operation-type flow/backorder/default-location
  controls are preserved. The operation-type form avoids repeating its page title inside the body.
- Desktop evidence contains no horizontal overflow or Chatter. At 390 px the six-field operation-type form
  retains a 194 px control column next to its labels and has no document overflow.
- Validation scope: nine focused renderer tests, the affected stock HTTP scenario, six targeted browser E2E
  flows, Biome on changed files, build/typecheck, and Astro docs validation.

![Wave 4 warehouse list evidence](/assets/inventory-warehouse-list/warehouse-list-browser-skill.png)

![Wave 4 warehouse create evidence](/assets/inventory-warehouse-list/warehouse-create-browser-skill.png)

![Wave 4 location list evidence](/assets/inventory-location-list/location-list-browser-skill.png)

![Wave 4 location create evidence](/assets/inventory-location-list/location-create-browser-skill.png)

![Wave 4 operation-type list evidence](/assets/inventory-operation-type-list/operation-type-list-browser-skill.png)

![Wave 4 operation-type create evidence](/assets/inventory-operation-type-list/operation-type-create-browser-skill.png)

![Wave 4 operation-type mobile evidence](/assets/inventory-operation-type-list/operation-type-create-mobile-browser-skill.png)

### Wave 5 — STOCK-01, STOCK-11 and STOCK-12

- Replenishment is now a dedicated `ListPage` plus `/new` `FormPage`, preserving all nine operational
  columns, per-row Run actions, eight create fields, product filtering, UoM/route options and validation.
- Inventory Adjustment remains Specialized: the one-shot adjustment command, configuration gate, applied
  result, live balances and summary must remain together for safe counting. Its renderer moved unchanged to
  `screens/inventory.tsx`.
- Forecast remains Specialized: it is a filter → calculation → single report flow rather than collection or
  record editing. Its renderer moved unchanged to `screens/forecast.tsx`.
- Browser evidence confirms all four surfaces have no Chatter or horizontal overflow. The mobile
  Replenishment form preserves all eight fields with a 194 px control column at 390 px.
- Validation scope: seven focused renderer tests, the affected stock HTTP scenario, four targeted browser
  E2E flows, Biome on changed files, build/typecheck, and Astro docs validation.

![Wave 5 inventory specialized evidence](/assets/inventory-adjustment/inventory-browser-skill.png)

![Wave 5 forecast specialized evidence](/assets/inventory-forecast/forecast-browser-skill.png)

![Wave 5 replenishment list evidence](/assets/inventory-replenishment/replenishment-list-browser-skill.png)

![Wave 5 replenishment create evidence](/assets/inventory-replenishment/replenishment-create-browser-skill.png)

![Wave 5 replenishment mobile evidence](/assets/inventory-replenishment/replenishment-create-mobile-browser-skill.png)

### Wave 6 — PROD-02, PROD-03 and PROD-04

- Save Favorite is now a compact `FormPage` with an external Save action, locale-aware cancel link and
  preserved `returnTo` list state. It retains the name/default controls and validation without adding
  record-only Chatter.
- Product Create is now a public `FormPage`: the three commercial/stock toggles remain visible in header
  metadata, all seven product fields and relation controls preserve their order and defaults, and stock-only
  controls still disappear when Stock is disabled.
- Attributes and Values remains Specialized. Its parent attribute-create form, configured attribute cards
  and one child value form per card are a single configuration workflow; splitting them into list/form
  pages would hide the relationship the operator is editing. Both root-level renderers moved into
  `product_backend/screens/` and routes now consume the barrel.
- Browser evidence confirms both FormPages and the specialized Attributes surface have no Chatter or
  horizontal overflow. At 390 px, Product Create retains all seven fields, all three toggles and a control
  column wider than its labels.
- Validation scope: six focused renderer tests, three affected Product i18n tests, the owning Product HTTP
  scenario, three targeted browser E2E flows, Biome on changed files, build/typecheck, and Astro docs
  validation. Unrelated domain groups were not rerun in this wave.

![Wave 6 favorite FormPage evidence](/assets/product-favorite/product-favorite-browser-skill.png)

![Wave 6 product create evidence](/assets/product-create/product-create-browser-skill.png)

![Wave 6 product create mobile evidence](/assets/product-create/product-create-mobile-browser-skill.png)

![Wave 6 product attributes specialized evidence](/assets/product-attributes/product-attributes-browser-skill.png)

### Wave 7 — CRM-01, SALE-02 and PUR-05

- CRM Pipeline remains Specialized. Its metrics, list chrome and route-owned Kanban island form one
  operational board; forcing it into `ListPage` or `FormPage` would remove drag/move and per-stage creation
  affordances. The renderer moved alone into `crm_backend/screens/pipeline.tsx` while the monolithic file
  keeps the other CRM screens.
- Quotations now have a dedicated `ListPage` and `/new` `FormPage`. State/list query values survive
  create/cancel/redirect, all seven dynamic relation-backed fields remain intact, the legacy list POST stays
  compatible, and the Sales overview now links directly to the new create route.
- Vendor Pricelists now have a dedicated `ListPage` and `/new` `FormPage`. The list retains its invoicing
  policy form, setup/rejection notices and six price columns; the create form preserves all 13 fields,
  defaults, company/currency context, legacy POST compatibility and invalid-field redirect semantics.
  Shared Purchase setup/rejection helpers moved into `screens/shared.tsx` instead of creating a dependency
  back to the legacy `screens.tsx`.
- Browser evidence confirms all five surfaces have no unexpected Chatter or horizontal overflow. Mobile
  evidence at 390 px retains every Quotation/Vendor Pricelist field and keeps Pipeline metrics readable.
- Validation scope: eight focused renderer/route tests, the affected Sales HTTP scenario, three CRM
  Pipeline HTTP scenarios, five targeted browser E2E flows, Biome on changed files, build/typecheck, and
  Astro docs validation. Only CI owners `orders` and `crm-loyalty` were exercised locally.

![Wave 7 quotation list evidence](/assets/sales-quotation-list/quotation-list-browser-skill.png)

![Wave 7 quotation create evidence](/assets/sales-quotation-create/quotation-create-browser-skill.png)

![Wave 7 quotation create mobile evidence](/assets/sales-quotation-create/quotation-create-mobile-browser-skill.png)

![Wave 7 vendor pricelist list evidence](/assets/purchase-vendor-pricelists/vendor-pricelist-list-browser-skill.png)

![Wave 7 vendor pricelist create evidence](/assets/purchase-vendor-pricelists/vendor-pricelist-create-browser-skill.png)

![Wave 7 vendor pricelist create mobile evidence](/assets/purchase-vendor-pricelists/vendor-pricelist-create-mobile-browser-skill.png)

![Wave 7 CRM Pipeline evidence](/assets/crm-pipeline/crm-pipeline-browser-skill.png)

![Wave 7 CRM Pipeline mobile evidence](/assets/crm-pipeline/crm-pipeline-mobile-browser-skill.png)

### Wave 8 — CRM-02, SALE-01 and PUR-01

- CRM Cases is now a dedicated `ListPage` plus `/new` `FormPage`. The list keeps parseListState search,
  facets, grouping, pager and all seven columns without loading create-only references. The create form
  preserves all 15 fields, five relation islands, stage/kind presets, validation values, locale and a safe
  `returnTo` restricted to the Cases list or Pipeline. Both legacy and new POST routes retain cross-site
  protection and detail redirects.
- Sales Overview remains Specialized: four KPI cards, the four-step sales pipeline and recent-order task
  table are one dashboard hierarchy rather than a collection or record form. Its root renderer moved into
  `sale_backend/screens/overview.tsx` and the obsolete root file was removed.
- Purchase Overview remains Specialized: five operational queues and setup guidance form a workflow
  dashboard. Its renderer moved out of the legacy monolith into `purchase_backend/screens/overview.tsx`.
- Visual QA caught and fixed the missing Vietnamese/English CRM Cancel message before evidence was accepted.
  Browser evidence confirms no unexpected Chatter or horizontal overflow; mobile 390 px retains all create
  fields and keeps both dashboards' KPI hierarchy readable.
- Validation scope: nine focused renderer/route tests, one affected CRM Pipeline UX scenario, one Sales and
  one Purchase HTTP scenario, one CRM i18n parity test, four targeted browser E2E flows, Biome on changed
  files, build/typecheck, and Astro docs validation. Only CI owners `orders` and `crm-loyalty` were exercised
  locally.

![Wave 8 CRM cases list evidence](/assets/crm-cases/crm-cases-list-browser-skill.png)

![Wave 8 CRM case create evidence](/assets/crm-cases/crm-case-create-browser-skill.png)

![Wave 8 CRM case create mobile evidence](/assets/crm-cases/crm-case-create-mobile-browser-skill.png)

![Wave 8 Sales overview evidence](/assets/sales-overview/sales-overview-browser-skill.png)

![Wave 8 Sales overview mobile evidence](/assets/sales-overview/sales-overview-mobile-browser-skill.png)

![Wave 8 Purchase overview evidence](/assets/purchase-overview/purchase-overview-browser-skill.png)

![Wave 8 Purchase overview mobile evidence](/assets/purchase-overview/purchase-overview-mobile-browser-skill.png)

### Wave 9 — CRM-03, SALE-03 and PUR-04

- CRM Case Detail moved out of the legacy monolith into `screens/case-detail.tsx`. It intentionally remains
  Specialized: identity, facts, four business tabs, stage/assignment/merge actions, activities, timeline,
  attachments and internal messages form one record workspace. Locale is now retained by tab, POST, upload,
  quotation and duplicate-record links.
- Sales Orders is now a dedicated `ListPage` in `screens/sales-orders-list.tsx`. It preserves the confirmed
  order constraint, customer hydration, invoice/lock status, totals, optional print report, localized detail
  links and the no-create/no-Chatter contract. Sales Overview reuses its columns from the leaf without a
  route/barrel cycle; the obsolete root renderer was removed.
- Purchase RFQ/PO Detail is now a `FormPage` in `screens/order-detail.tsx`. Its compact header contains state,
  vendor, planned date, invoice/total facts, operational actions and print; line editing, billing, receipts and
  vendor bills remain in the body. No Chatter was invented because the purchase mail bridge is still missing.
- Browser QA used real UI flows to create a CRM case and an RFQ, then verified the three migrated surfaces at
  desktop and 390 px. All layouts keep their content inside the viewport; the CRM aside follows the form with
  spacing when wrapped.
- Validation scope: 32 focused CRM/Purchase/Sales renderer and HTTP tests, Biome on changed files,
  build/typecheck, targeted browser checks for the three surfaces, and Astro docs validation. No unrelated CI
  test group was run locally because this wave changes module-owned renderers rather than shared framework UI.

![Wave 9 Sales orders evidence](/assets/sales-order-list/sales-orders-list-browser-skill.png)

![Wave 9 Sales orders mobile evidence](/assets/sales-order-list/sales-orders-list-mobile-browser-skill.png)

![Wave 9 CRM case detail evidence](/assets/crm-case-detail/crm-case-detail-browser-skill.png)

![Wave 9 CRM case detail mobile evidence](/assets/crm-case-detail/crm-case-detail-mobile-browser-skill.png)

![Wave 9 CRM wrapped aside evidence](/assets/crm-case-detail/crm-case-detail-mobile-aside-browser-skill.png)

![Wave 9 Purchase RFQ detail evidence](/assets/purchase-order-detail/purchase-rfq-detail-browser-skill.png)

![Wave 9 Purchase RFQ detail mobile evidence](/assets/purchase-order-detail/purchase-rfq-detail-mobile-browser-skill.png)

### Wave 10 — CRM-04, SALE-04, PUR-02 and PUR-03

- CRM Activity Planner moved to `screens/activity-planner.tsx` and remains Specialized. The mine/plans/calendar
  tabs, schedule controls, action tables and locale-aware links are one planning workspace rather than a
  collection or record form.
- Sales quotation/order detail moved to `screens/order-detail.tsx` and now uses the public `FormPage` with the
  operational editor in the 2/3 body and `sale_mail_backend` Chatter/activity in the 1/3 rail. All workflow,
  line, invoice, loyalty, print, fragment and validation behavior remains intact.
- Visual QA reproduced the missing space when the FormPage rail wraps. The shared design-system breakpoint now
  adds `row-gap: var(--kv-space-5)`; browser measurements at 900 px confirm a one-column layout, 20 px gap and
  no horizontal overflow between the business body and Chatter.
- Purchase RFQs are now a dedicated `ListPage` plus `/new` `FormPage`; Purchase Orders is a dedicated
  `ListPage`. Search, state/invoice filters, grouping, paging, vendor hydration, locale and backward-compatible
  safe POST/redirect behavior remain. The final legacy `purchase_backend/screens.tsx` was removed.
- Browser QA created a real RFQ through `/new` and verified RFQ list/create, Purchase Orders empty state,
  CRM Planner and Sales detail at desktop and 390 px. No surface overflows horizontally.
- Because this wave changes shared design-system CSS, validation expanded beyond module tests: the complete
  local suite passed with 1,170 tests (1,142 passed, 28 skipped, 0 failed), together with Biome, build/typecheck
  and Astro docs validation. The full rerun also corrected a stale relation-select test that still targeted the
  old inline Sales/Purchase create forms.

![Wave 10 Sales detail evidence](/assets/sales-order-detail/sale-order-detail-browser-skill.png)

![Wave 10 Sales detail wrapped Chatter evidence](/assets/sales-order-detail/sale-order-detail-wrap-gap-browser-skill.png)

![Wave 10 Sales detail mobile evidence](/assets/sales-order-detail/sale-order-detail-mobile-browser-skill.png)

![Wave 10 CRM Activity Planner evidence](/assets/crm-activity-planner/crm-activity-planner-browser-skill.png)

![Wave 10 CRM Activity Planner mobile evidence](/assets/crm-activity-planner/crm-activity-planner-mobile-browser-skill.png)

![Wave 10 Purchase RFQ list evidence](/assets/purchase-rfq-list-create/purchase-rfq-list-browser-skill.png)

![Wave 10 Purchase RFQ list mobile evidence](/assets/purchase-rfq-list-create/purchase-rfq-list-mobile-browser-skill.png)

![Wave 10 Purchase RFQ create evidence](/assets/purchase-rfq-list-create/purchase-rfq-create-browser-skill.png)

![Wave 10 Purchase RFQ create mobile evidence](/assets/purchase-rfq-list-create/purchase-rfq-create-mobile-browser-skill.png)

![Wave 10 Purchase Orders evidence](/assets/purchase-rfq-list-create/purchase-orders-list-browser-skill.png)

### Wave 11 — ACC-01, CRM-05 and SALE-05

- Accounting Overview remains Specialized because its period controls, five financial KPIs, trend and mix
  charts, receivable/payable drilldowns and cash-flow summary form one analytical workspace. Its renderer now
  lives in `account_backend/screens/overview.tsx`; the root-level screen file was removed and a screens barrel
  now owns the export.
- CRM Leaderboard moved out of the legacy monolith into `screens/leaderboard.tsx` and now uses `ListPage`.
  Rank, user links, score, won/lost/assigned/activity metrics, refresh behavior, locale and the empty state are
  preserved.
- Sales Invoicing Policies is now a dedicated `ListPage` plus `/new` `FormPage`. The list retains bulk policy
  editing and the create form preserves the product relation picker, invoice basis choices, locale, validation,
  same-origin return target and cross-site POST protection. The obsolete root renderer was removed.
- Browser QA verified all three surfaces at desktop and 390 px with no horizontal overflow. Accounting keeps
  its dashboard hierarchy readable; the Sales create form keeps label/control alignment; CRM retains its
  refreshable empty state.
- Validation scope followed the CI ownership policy: 40 affected Accounting, CRM and Sales renderer/HTTP
  tests passed, together with Biome on changed files, build/typecheck and Astro docs validation. This wave did
  not change shared UI, framework or other global code, so unrelated test groups were not run locally.

![Wave 11 Accounting overview evidence](/assets/accounting-overview/accounting-overview-browser-skill.png)

![Wave 11 Accounting overview mobile evidence](/assets/accounting-overview/accounting-overview-mobile-browser-skill.png)

![Wave 11 CRM leaderboard evidence](/assets/crm-leaderboard/crm-leaderboard-browser-skill.png)

![Wave 11 CRM leaderboard mobile evidence](/assets/crm-leaderboard/crm-leaderboard-mobile-browser-skill.png)

![Wave 11 Sales invoicing policies evidence](/assets/sales-invoicing-policies/sales-invoicing-policies-list-browser-skill.png)

![Wave 11 Sales invoicing policy create evidence](/assets/sales-invoicing-policies/sales-invoicing-policies-create-browser-skill.png)

![Wave 11 Sales invoicing policy create mobile evidence](/assets/sales-invoicing-policies/sales-invoicing-policies-create-mobile-browser-skill.png)
