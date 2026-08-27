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

Starting with Wave 25, one primary Codex agent owns the shared checkout and feature branch; the earlier
sub-agent mechanism is retired. Historical `Owner` values remain as delivery evidence for completed rows.

1. The primary agent alone edits, stages, commits, rebases and pushes the shared branch.
2. A shared renderer serving several route aliases remains one row so its behavior is reviewed as one unit.
3. Only one row per lane may be `in-progress` at a time. A lane is normally one backend module because its
   screens share a route registry, translations and fixtures.
4. Before editing, the agent changes `Status` to `in-progress` and treats the listed renderer, route registry,
   module translations and focused tests as one locked work item.
5. Shared design-system changes land before dependent screen changes in the same wave.
7. A module that still has a monolithic `screens.tsx` is migrated incrementally to a `screens/` folder.
   The first screen agent creates `screens/index.ts` and, only when necessary, `screens/shared.tsx`; every
   agent moves exactly its assigned renderer to `screens/<screen-name>.tsx`. The final agent removes the
   empty legacy `screens.tsx`. Do not perform a mechanical module-wide split in parallel with screen work.
8. Routes import screens through `screens/index.ts`. Screen-specific types, constants and markup stay with
   their screen; only genuinely reused, domain-neutral helpers enter `screens/shared.tsx`.
9. Every migrated screen preserves locale, permissions, POST semantics, named joints, partial-save
   controllers, validation, empty/error states, responsive behavior, and existing Chatter/Activity islands.
10. Through Wave 23, completion requires a focused render/HTTP test, an owner self-check, and desktop/mobile
    browser evidence. A visual change without behavioral coverage remains `review`; cross-review is requested
    only for a concrete cross-module, security, concurrency, or shared-contract risk.
11. Through Wave 23, validation follows CI's affected-group planner: screen agents run focused source tests and
    targeted static checks, then the coordinator builds once and runs each owning group once after integration.
    Starting with Wave 24, local execution is removed entirely: agents and coordinator only edit code/tests,
    commit and push, then follow the PR matrix. No local tests, build, typecheck, lint, diff check, or localhost
    browser QA runs unless the user explicitly requests it; a CI failure triggers the next diagnosis/fix push.

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

Structure debt resolved in Wave 24: every routed Accounting renderer now lives in `account_backend/screens/`;
the former root `*-screen.tsx` files no longer exist.
`account_partner_backend` follows the same rule.

| ID | Status | Screen | Route(s) | Current renderer | Target | Chatter | Owner |
|---|---|---|---|---|---|---|---|
| ACC-01 | keep | Accounting overview | `/admin/accounting` | `screens/overview.tsx::accountingOverviewScreen` | Specialized | no | Curie |
| ACC-02 | done | Chart of accounts | `/admin/accounting/accounts`, `/admin/accounting/accounts/new` | `screens/accounts-list.tsx`, `screens/account-form.tsx` | Split | no | Curie |
| ACC-03 | done | Journals | `/admin/accounting/journals`, `/admin/accounting/journals/new` | `screens/journals-list.tsx`, `screens/journal-form.tsx` | Split | no | Curie |
| ACC-04 | done | Taxes | `/admin/accounting/taxes`, `/admin/accounting/taxes/new` | `screens/taxes-list.tsx`, `screens/tax-form.tsx` | Split | no | Curie |
| ACC-05 | done | Payment terms | `/admin/accounting/terms` | `screens/payment-terms-list.tsx`, `screens/payment-term-form.tsx` | Split | no | Curie |
| ACC-06 | done | Accounting defaults | `/admin/accounting/defaults` | `screens/account-defaults.tsx::accountDefaultsScreen` | FormPage | no | Curie |
| ACC-07 | done | Journal entries | `/admin/accounting/entries` | `screens/journal-entries-list.tsx`, `screens/journal-entry-create.tsx` | Split | list/new: no | Curie |
| ACC-08 | done | Customer invoices | `/admin/accounting/customer-invoices`, `/admin/accounting/customer-invoices/new` | `screens/customer-invoices-list.tsx`, `screens/customer-invoice-form.tsx` | Split | list/new: no | Curie |
| ACC-09 | done | Vendor bills | `/admin/accounting/vendor-bills`, `/admin/accounting/vendor-bills/new` | `screens/vendor-bills-list.tsx`, `screens/vendor-bill-form.tsx` | Split | list/new: no | Curie |
| ACC-10 | done | Shared accounting document detail | `/admin/accounting/entries/{id}`, `/customer-invoices/{id}`, `/vendor-bills/{id}` | `screens/move-detail.tsx::moveDetailScreen` | FormPage | `account_mail_backend` | Curie |
| ACC-11 | done | Payments | `/admin/accounting/payments`, `/admin/accounting/payments/new` | `screens/payments-list.tsx`, `screens/payment-form.tsx` | Split | no | Curie |
| ACC-12 | done | Trial balance | `/admin/accounting/trial-balance` | `screens/trial-balance.tsx::trialBalanceScreen` | Specialized | no | Curie |
| ACC-13 | done | General ledger | `/admin/accounting/general-ledger` | `screens/general-ledger.tsx::generalLedgerScreen` | Specialized | no | Curie |
| ACC-14 | done | Partner statement | `/admin/accounting/partner-statement` | `screens/partner-statement.tsx::partnerLedgerScreen` | Specialized | no | Curie |
| AP-01 | done | Partner accounting terms | `/admin/partner/partners/{id}/accounting` | `screens/accounting-terms.tsx::accountingTermsScreen` | FormPage | no | Kant |

### Sales lane

Structure debt resolved in the modal follow-up: the remaining shared label helper moved to
`sale_backend/screens/shared.tsx`, unrouted legacy renderers were removed, and the root `screens.tsx` no
longer exists.

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
| CRM-06 | keep | CRM configuration | `/admin/crm/configuration` | `screens/configuration.tsx::configurationScreen` | Specialized | Huygens |

### Flow lane

`flow_backend/screens/` exists. Waves 18–25 moved the project tree, pages, epics and Gantt surfaces to focused
leaves; the former `pages.tsx` and `epics.tsx` no longer exist. Generated Live Doc endpoints belong to the
detail renderer that consumes them.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| FLOW-01 | done | Projects | `/admin/flow/projects`, `/admin/flow/projects/new` | `screens/projects-list.tsx`, `screens/project-create.tsx` | Split | Huygens |
| FLOW-02 | keep | Project board | `/admin/flow/projects/{id}/board` | `screens/board.tsx::boardScreen` | Specialized | Huygens |
| FLOW-03 | done | My/all cross-project issues | `/admin/flow/mine`, `/admin/flow/issues` | `screens/my-work.tsx::crossProjectScreen` | ListPage | Huygens |
| FLOW-04 | done | Project issues | `/admin/flow/projects/{id}/issues` | `screens/issues.tsx::issuesScreen` | Split | Huygens |
| FLOW-05 | done | Issue detail | `/admin/flow/issues/{id}` | `screens/issue-detail.tsx::issueDetailScreen` | FormPage/Specialized | Huygens |
| FLOW-06 | done | Project page tree | `/admin/flow/projects/{id}/pages` | `screens/project-pages.tsx::pagesScreen` | Specialized | Huygens |
| FLOW-07 | done | All pages | `/admin/flow/pages` | `screens/all-pages.tsx::allPagesScreen` | ListPage | Huygens |
| FLOW-08 | done | Page live editor | `/admin/flow/pages/{id}` | `screens/page-detail.tsx::pageDetailScreen` | FormPage/Specialized | Huygens |
| FLOW-09 | done | Project epics | `/admin/flow/projects/{id}/epics` | `screens/project-epics.tsx::epicsScreen` | Specialized | Huygens |
| FLOW-10 | done | All epics | `/admin/flow/epics` | `screens/all-epics.tsx::allEpicsScreen` | ListPage | Huygens |
| FLOW-11 | done | Epic detail | `/admin/flow/epics/{id}` | `screens/epic-detail.tsx::epicDetailScreen` | FormPage/Specialized | Huygens |
| FLOW-12 | done | Epic dependency map | `/admin/flow/projects/{id}/epics/{epicId}/map` | `screens/map.tsx::mapScreen` | Specialized | Huygens |
| FLOW-13 | done | Project Gantt | `/admin/flow/projects/{id}/gantt` | `screens/gantt.tsx::ganttScreen` | Specialized | Codex |
| FLOW-14 | done | Project sprints | `/admin/flow/projects/{id}/sprints` | `screens/sprints.tsx::sprintsScreen` | Split/Specialized | Codex |
| FLOW-15 | done | Project settings | `/admin/flow/projects/{id}/settings` | `screens/project-settings.tsx::settingsScreen` | Specialized | Codex |

### Manufacturing lane

Structure debt resolved in Wave 16: every routed renderer now lives in `manufacturing_backend/screens/`,
the barrel owns public exports, and the empty root `screens.tsx` no longer exists.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| MFG-01 | done | Manufacturing orders | `/admin/manufacturing`, `/admin/manufacturing/new` | `screens/orders-list.tsx`, `screens/order-create.tsx` | Split | Kant |
| MFG-02 | done | Manufacturing order execution | `/admin/manufacturing/orders/{id}` | `screens/order-execution.tsx::orderScreen` | FormPage/Specialized | Kant |
| MFG-03 | done | Bills of materials | `/admin/manufacturing/boms`, `/admin/manufacturing/boms/new` | `screens/boms-list.tsx`, `screens/bom-create.tsx` | Split | Kant |
| MFG-04 | done | Work centers | `/admin/manufacturing/work-centers` | `screens/work-centers-list.tsx`, `screens/work-center-form.tsx` | Split | Kant |

### HR and attendance lanes

Structure debt resolved in Wave 19: every HR backend renderer now lives in `hr_backend/screens/`, and the
legacy root `screens.tsx` no longer exists. Waves 20–22 created `attendance_backend/screens/` leaves for My Work,
Attendance Period and Credential Issuance; only the intentional public kiosk remains in the root `screens.tsx`.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| HR-01 | hr | done | Employees | `/admin/hr` | `screens/employees-list.tsx`, `screens/employee-form.tsx` | Split | Kant |
| HR-02 | hr | done | Weekly roster | `/admin/hr/roster` | `screens/roster.tsx::rosterScreen` | Specialized | Kant |
| HR-03 | hr | done | Leave approvals | `/admin/hr/leaves` | `screens/leaves-list.tsx::leavesListScreen` | ListPage | Kant |
| ATT-01 | attendance | done | My work | `/my/work` | `screens/my-work.tsx::myWorkScreen` | Specialized | Kant |
| ATT-02 | attendance | keep | Attendance kiosk | `/attendance/kiosk/{secret}` | `kioskScreen` | Specialized public kiosk | — |
| ATT-03 | attendance | done | Attendance period | `/admin/attendance` | `screens/period.tsx::periodScreen` | Specialized | Kant |
| ATT-04 | attendance | done | Credential issuance | `/admin/attendance/credentials` | `screens/credentials.tsx::credentialScreen` | FormPage/Specialized | Kant |

### Company lane

Structure debt resolved in Wave 27: active-context configuration moved into `screens/context.tsx`; every
routed Company renderer now lives in `company_backend/screens/` and the former root `screens.tsx` is gone.

| ID | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|
| COMPANY-01 | done | Companies | `/admin/companies` | `screens/companies-list.tsx::companiesScreen` | ListPage | Kant |
| COMPANY-02 | done | Company create/detail | `/admin/companies/new`, `/admin/companies/{id}` | `screens/company-form.tsx::companyFormScreen` | FormPage | Kant |
| COMPANY-03 | done | Branch create/detail | `/admin/companies/{id}/branches/new`, `/admin/companies/{companyId}/branches/{id}` | `screens/branch-form.tsx::branchFormScreen` | FormPage | Codex |
| COMPANY-04 | done | Company hierarchy | `/admin/companies/hierarchy` | `screens/hierarchy.tsx::hierarchyScreen` | Specialized | Codex |
| COMPANY-05 | done | Active company/branch context | `/admin/context` | `screens/context.tsx::contextScreen` | FormPage/Specialized | Codex |

### User and authentication lanes

Structure debt: Waves 25–28 created `user_backend/screens/` with shared types, users/roles lists and forms, and
shared session leaves. Move presets and profile incrementally; USER-06 reuses
`screens/sessions.tsx`. The public login renderer is a separate user module surface and is intentionally not
forced into FormPage.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| USER-01 | user-backend | done | Users | `/admin/users` | `screens/users-list.tsx::usersScreen` | ListPage | Codex |
| USER-02 | user-backend | done | User create/detail/access | `/admin/users/new`, `/admin/users/{id}` | `screens/user-form.tsx::userFormScreen`, `screens/sessions.tsx::sessionsScreen` | FormPage | Codex |
| USER-03 | user-backend | done | Roles | `/admin/roles` | `screens/roles-list.tsx::rolesScreen` | ListPage | Codex |
| USER-04 | user-backend | done | Role create/detail | `/admin/roles/new`, `/admin/roles/{id}` | `screens/role-form.tsx::roleScreen` | FormPage | Codex |
| USER-05 | user-backend | ready | Permission presets | `/admin/permission-presets` | `presetsScreen` | FormPage/Specialized | — |
| USER-06 | user-backend | ready | Profile/security/preferences | `/admin/profile` | `profileScreen`, `sessionsScreen` | FormPage | — |
| AUTH-01 | user | keep | Login | `/login` | `user/screens.tsx::loginScreen` | Specialized public auth | — |

### Address, activity, and calendar lanes

Wave 28 removed the Activity root `screens.tsx` and started the Address split. The country browser remains in
the Address root until ADDRESS-02 moves; Calendar still needs its first module-local screen leaf.

| ID | Lane | Status | Screen | Route(s) | Current renderer | Target | Owner |
|---|---|---|---|---|---|---|---|
| ADDRESS-01 | address | done | Address catalogs | `/admin/addresses` | `screens/catalogs-list.tsx::catalogsScreen` | ListPage | Codex |
| ADDRESS-02 | address | ready | Country/division browser | `/admin/addresses/{countryCode}` | `countryScreen` | Specialized | — |
| ACTIVITY-01 | activity | done | Activities/to-do queue | `/admin/activities` | `screens/activities-list.tsx::activitiesScreen` | ListPage | Codex |
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
- Form labels stay in the left column and controls in the right column from 768px; below it, every field
  stacks the label above a full-width control.
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
- Validation scope followed the CI ownership policy: 40 focused Accounting, CRM and Sales renderer/HTTP
  tests passed, together with Biome on changed files, build/typecheck and Astro docs validation. The next
  coordinator pass also ran the planner-selected owning groups `orders`, `accounting` and `crm-loyalty`; no
  unrelated domain group was added because this wave did not change shared UI, framework or global code.

![Wave 11 Accounting overview evidence](/assets/accounting-overview/accounting-overview-browser-skill.png)

![Wave 11 Accounting overview mobile evidence](/assets/accounting-overview/accounting-overview-mobile-browser-skill.png)

![Wave 11 CRM leaderboard evidence](/assets/crm-leaderboard/crm-leaderboard-browser-skill.png)

![Wave 11 CRM leaderboard mobile evidence](/assets/crm-leaderboard/crm-leaderboard-mobile-browser-skill.png)

![Wave 11 Sales invoicing policies evidence](/assets/sales-invoicing-policies/sales-invoicing-policies-list-browser-skill.png)

![Wave 11 Sales invoicing policy create evidence](/assets/sales-invoicing-policies/sales-invoicing-policies-create-browser-skill.png)

![Wave 11 Sales invoicing policy create mobile evidence](/assets/sales-invoicing-policies/sales-invoicing-policies-create-mobile-browser-skill.png)

### Wave 12 — ACC-02, AP-01 and CRM-06

- Chart of Accounts is now a dedicated `ListPage` plus `/new` `FormPage` under
  `account_backend/screens/`. Search, active/family filters, grouping, paging, summary counts, all account
  fields, reconciliation/archive semantics, validation values, locale, safe return targets and legacy
  edit/POST compatibility remain. The old root renderer was removed.
- The helper-only `account_backend/screens.tsx` was replaced by `screens/shared.tsx`. Seven existing accounting
  renderers only changed their import path for the same three pure helpers; their markup and behavior did not
  change.
- Partner Accounting Terms moved to `account_partner_backend/screens/accounting-terms.tsx` and now uses the
  public `FormPage` without Chatter. Payment term, receivable/payable defaults, unset choices, validation,
  locale and redirects remain; cross-site POSTs are now refused consistently with the parent Partner module.
- CRM Configuration moved out of the final legacy monolith into `screens/configuration.tsx`. It intentionally
  remains Specialized: six configuration tabs, create/edit flows, archive/restore, membership/tag rules,
  assignment and scoring are one dense administration workspace. Locale and all route actions remain intact.
- Browser QA verified all three surfaces at desktop and 390 px with no horizontal overflow. The two FormPages
  keep label/control alignment on mobile, and CRM's configuration tabs retain a horizontally scrollable
  navigation without widening the document.
- Validation followed CI's affected-group planner. Build/typecheck passed; owning groups passed with Orders
  80/80 (Wave 11 follow-through), Accounting 62/62, Identity 99 passed/1 environment skip, and CRM/Loyalty
  60 passed/1 environment skip. Biome and Astro docs validation also passed; no unrelated groups were run.

![Wave 12 Chart of Accounts list evidence](/assets/accounting-chart-of-accounts/chart-of-accounts-list-wave12-browser-skill.png)

![Wave 12 Chart of Accounts create evidence](/assets/accounting-chart-of-accounts/chart-of-accounts-create-wave12-browser-skill.png)

![Wave 12 Chart of Accounts create mobile evidence](/assets/accounting-chart-of-accounts/chart-of-accounts-create-mobile-wave12-browser-skill.png)

![Wave 12 Partner Accounting Terms evidence](/assets/partner-accounting-terms/partner-accounting-terms-wave12-browser-skill.png)

![Wave 12 Partner Accounting Terms mobile evidence](/assets/partner-accounting-terms/partner-accounting-terms-mobile-wave12-browser-skill.png)

![Wave 12 CRM Configuration evidence](/assets/crm-configuration/crm-configuration-wave12-browser-skill.png)

![Wave 12 CRM Configuration mobile evidence](/assets/crm-configuration/crm-configuration-mobile-wave12-browser-skill.png)

### Wave 13 — ACC-03, FLOW-01 and MFG-01

- Accounting Journals is now a dedicated `ListPage` plus `/new` `FormPage` under
  `account_backend/screens/`. Search, status/type filters, pager, summary counts, default-account relation,
  sequence preservation, edit/archive semantics, locale, validation, CSRF, safe return targets and legacy
  POST/edit compatibility remain; the root renderer was removed.
- Flow Projects is now a dedicated `ListPage` plus `/new` `FormPage`. Metrics, all/mine visibility tabs,
  state/progress columns, templates, custom columns, validation values, locale, CSRF, safe redirects and
  backward-compatible list POST remain. Recent Activity moved from the old frame aside into a final named
  section below the collection; browser QA confirms it reads as part of the project overview without crowding
  the list.
- Manufacturing Orders is now a dedicated `ListPage` plus `/new` `FormPage` in the new incremental
  `manufacturing_backend/screens/` folder. BOM, quantity/UoM, source/production/destination locations,
  scheduled start, status and detail workflow links/actions remain. The legacy monolith keeps only the
  Manufacturing renderers not yet assigned to later waves.
- Browser QA verified the six routed surfaces at desktop and the three create forms at 390 px. All labels,
  controls and actions stay within the viewport; no Chatter was invented.
- Validation followed CI's affected-group planner. Build/typecheck passed; Accounting 66/66,
  Collaboration 81/81 and Manufacturing 11/11 tests passed. Biome and Astro docs validation also passed;
  no unrelated domain group was run.

![Wave 13 Accounting Journals list evidence](/assets/accounting-journals-wave13/journals-list-browser-skill.png)

![Wave 13 Accounting Journal create evidence](/assets/accounting-journals-wave13/journal-create-browser-skill.png)

![Wave 13 Accounting Journal create mobile evidence](/assets/accounting-journals-wave13/journal-create-mobile-browser-skill.png)

![Wave 13 Flow Projects list evidence](/assets/flow-projects-wave13/flow-projects-list-browser-skill.png)

![Wave 13 Flow Project create evidence](/assets/flow-projects-wave13/flow-project-create-browser-skill.png)

![Wave 13 Flow Project create mobile evidence](/assets/flow-projects-wave13/flow-project-create-mobile-browser-skill.png)

![Wave 13 Manufacturing Orders list evidence](/assets/manufacturing-orders-wave13/manufacturing-orders-list-browser-skill.png)

![Wave 13 Manufacturing Order create evidence](/assets/manufacturing-orders-wave13/manufacturing-order-create-browser-skill.png)

![Wave 13 Manufacturing Order create mobile evidence](/assets/manufacturing-orders-wave13/manufacturing-order-create-mobile-browser-skill.png)

### Wave 14 — ACC-04, FLOW-02 and MFG-02

- Accounting Taxes is now a dedicated `ListPage` plus `/new` `FormPage` under `account_backend/screens/`.
  Tax use, fixed/percent/division computation, amount, account relation, price/base inclusion, sequence,
  active/edit/archive behavior, validation, locale, CSRF, safe returns and legacy POST/edit compatibility
  remain. The root renderer was removed.
- Flow Project Board remains Specialized. The kanban columns, cards, counts, moves and project navigation are
  an execution surface rather than a record form or flat collection. The audit found that locale was dropped
  from card links, no-JS move actions, load-more links and project navigation; those URLs now retain `lang`
  without changing the board layout or interaction model.
- Manufacturing Order Execution now uses `FormPage` for record identity, state, quantity and lifecycle actions,
  while work-order controls and component/move tables remain specialized body sections. All workflow actions,
  optimistic versions, locale and validation remain; no Chatter was added because no Manufacturing mail or
  activity bridge exists.
- Browser QA verified Taxes list/create, a populated Flow board and a real Manufacturing order at desktop and
  390 px. The board keeps horizontal column navigation inside its own viewport, and no document overflows.
- Because the Flow locale fix touches the shared UI client, validation expanded to the complete local suite:
  1,205 tests, 1,177 passed, 28 skipped, 0 failed. Build/typecheck, Biome and Astro docs validation also passed.

![Wave 14 Accounting Taxes list evidence](/assets/accounting-taxes-wave14/taxes-list-browser-skill.png)

![Wave 14 Accounting Tax create evidence](/assets/accounting-taxes-wave14/tax-create-browser-skill.png)

![Wave 14 Accounting Tax create mobile evidence](/assets/accounting-taxes-wave14/tax-create-mobile-browser-skill.png)

![Wave 14 Flow Project Board evidence](/assets/flow-project-board-wave14/flow-project-board-browser-skill.png)

![Wave 14 Flow Project Board mobile evidence](/assets/flow-project-board-wave14/flow-project-board-mobile-browser-skill.png)

![Wave 14 Manufacturing Order Execution evidence](/assets/manufacturing-order-execution-wave14/manufacturing-order-execution-browser-skill.png)

![Wave 14 Manufacturing Order Execution mobile evidence](/assets/manufacturing-order-execution-wave14/manufacturing-order-execution-mobile-browser-skill.png)

### Wave 15 — ACC-05, FLOW-03 and MFG-03

- Accounting Payment Terms is now a `ListPage` with URL-driven search, status filter and pagination. Creating
  or editing a term and creating or editing one milestone opens a URL-addressable sheet over the collection;
  locale, list state, rejected values, `editLine`, archive state, CSRF and legacy POST semantics remain intact.
  The root renderer moved into dedicated `screens/payment-terms-list.tsx` and `screens/payment-term-form.tsx`.
- Flow My Work and All Issues now share the public `ListPage` hierarchy. Their metrics, progress, overdue rail,
  active scope tab, grouped/list states, search, filters and pager remain URL-driven. Issue, project and tab links
  preserve locale, and `/mine` now selects the Mine tab rather than inheriting the All default.
- Manufacturing Bills of Materials is now a list-only `ListPage`; its ten-field create workflow opens in a large
  URL-owned sheet. `/admin/manufacturing/boms/new` is a compatibility route, while the original collection POST,
  locale, CSRF, validation errors, submitted values and domain payload remain supported. Only the BOM renderer
  moved out of the legacy `screens.tsx`, leaving Work Centers for its assigned wave.
- Focused Wave 15 validation passes 9/9 tests. The owning CI groups pass Accounting 74/74, Collaboration 88/88
  and Manufacturing 16/16. Desktop and 390 px browser QA confirms the ListPage hierarchy, empty/populated states,
  URL-owned sheets, stacked mobile fields and absence of document overflow.

![Wave 15 Payment Terms list evidence](/assets/accounting-payment-terms-wave15/payment-terms-list-vi.png)

![Wave 15 Payment Term milestone modal evidence](/assets/accounting-payment-terms-wave15/payment-term-milestone-modal-vi.png)

![Wave 15 Payment Term milestone mobile evidence](/assets/accounting-payment-terms-wave15/payment-term-milestone-modal-mobile-390.png)

![Wave 15 Flow My Work ListPage evidence](/assets/flow-my-work-wave15/flow-my-work-list-browser-skill.png)

![Wave 15 Flow My Work mobile evidence](/assets/flow-my-work-wave15/flow-my-work-mobile-browser-skill.png)

![Wave 15 BOM create modal evidence](/assets/manufacturing-boms-wave15/bom-create-modal-browser-skill.png)

![Wave 15 BOM create modal mobile evidence](/assets/manufacturing-boms-wave15/bom-create-modal-mobile-browser-skill.png)

### Wave 16 — ACC-06, FLOW-04 and MFG-04

- Accounting Defaults is now a stable `FormPage` with separate company-default and category-override forms.
  All six account relations, setup guidance, locale, CSRF, rejected values and the two independent write actions
  remain. Its renderer moved into `account_backend/screens/`, removing the former root-level screen file.
- Flow Project Issues is now a collection-only `ListPage`; its three-field create flow opens in a URL-owned
  modal over the filtered/grouped project issue list. Project identity, custom fields, search, filters, grouping,
  pagination, locale, CSRF, safe return state, validation and legacy collection POST remain supported.
- Manufacturing Work Centers is now a `ListPage` with URL-owned create/edit dialogs and inline archive/restore
  commands. Capacity, efficiency and hourly cost are preserved through edits, including the domain projection
  required to avoid overwriting existing values. The last monolithic `manufacturing_backend/screens.tsx` was
  removed after its renderers moved into the `screens/` folder.
- Focused Wave 16 validation passes 9/9 tests. The affected CI groups pass Accounting 77/77, Collaboration
  91/91 and Manufacturing 19/19. Build and diff validation pass. Browser QA is pending a user-side reload of
  the in-app tab because its prior localhost navigation failed while the development watcher was restarting;
  the Browser security policy correctly refused an automated return from the generated network-error page.

### Wave 17 — ACC-07, FLOW-05 and HR-01

- Accounting Journal Entries is now a `ListPage` with state/search/paging controls and lifecycle summaries.
  Its five-field create workflow opens in a URL-owned large sheet and then redirects straight to the new detail
  so lines can be added. Locale, CSRF, safe list state, rejected native/relation values, legacy collection POST
  and stable retry IDs remain; the former root renderer moved into two leaves under `account_backend/screens/`.
- Flow Issue Detail now uses `FormPage` for issue identity, primary save and attribute rail while keeping Live
  Doc, attachments, subtasks, dependencies, comments and relation controls as specialized sections. The existing
  one-field status and sprint actions are URL-owned dialogs; locale, optimistic version, permission checks,
  attachment endpoints, rejected choices and stable retry keys remain.
- HR Employees is now a `ListPage` with URL-owned large create/edit dialogs plus inline archive/restore. Partner-
  backed employee identity, employee role, user/branch/department/job relations, active state, locale, CSRF,
  rejected values, manager permissions, legacy collection POST and retry-stable create IDs remain. Employee-only
  renderers moved from `hr_backend/screens.tsx` into `hr_backend/screens/`; roster and leave stay for later waves.
- Integrated focused validation passes 12/12 tests. The affected CI groups pass Accounting 82/82,
  Collaboration 94/94 and Identity 103 passed with the existing PostgreSQL-only test skipped locally. Browser
  screenshots remain deferred with Wave 16 until the in-app tab is manually returned from its generated
  network-error page to localhost.

### Wave 18 — ACC-08, FLOW-06 and HR-02

- Customer Invoices is now a `ListPage` with URL-driven search, customer, lifecycle, payment and document-type
  filters, totals and paging. Its 17-field create workflow remains a full `/new` `FormPage` because it is a
  complete accounting document rather than a short contextual action. Locale, CSRF, safe return state,
  relation-backed values, rejected input, legacy collection POST and retry-stable invoice identity remain.
- Flow Project Pages remains a Specialized hierarchical document tree. Its two-field create action now opens
  in a URL-owned dialog over that tree, preserving parent selection, locale, CSRF, rejected values, record ID
  and idempotency key. The audit also makes unsupported PUT requests return 405 instead of falling through to
  the GET renderer. The project-tree renderer moved from the shared pages file into `screens/project-pages.tsx`.
- HR Weekly Roster remains a Specialized planning workflow: branch/week generation, timezone-aware shifts and
  draft/publish/reopen lifecycle stay together. Locale, CSRF, rejected generation values, relation labels and
  retry idempotency remain; its renderer moved into `screens/roster.tsx`, leaving only HR-03 in the legacy file.
- Integrated focused validation passes 28/28 tests. The affected CI groups pass Accounting 86/86,
  Collaboration 97/97 and Identity 107 passed with one existing PostgreSQL-only test skipped locally. Browser
  QA covers all three surfaces at desktop and 390 px: the invoice controls measure 302 px, roster inputs 308 px,
  the Flow dialog fills the 390 px viewport, and none of the pages has document-level horizontal overflow.

### Wave 19 — ACC-09, FLOW-07 and HR-03

- Vendor Bills is now a `ListPage` with URL-driven search, vendor, lifecycle, payment and document-type filters,
  totals and paging. Its 17-field create workflow remains a stable full `/new` `FormPage`; it is the same complete
  accounting-document workflow as Customer Invoices and is not compressed into a modal. Locale, CSRF, safe
  return state, bundled relation values, rejected input, legacy collection POST and retry-stable identity remain.
- Flow All Pages is now a flat cross-project `ListPage` with command search, 50-row paging and explicit document,
  project, preview and update columns. Page and project destinations retain locale; project hierarchy stays in
  FLOW-06 and Live Doc/page editing stays in FLOW-08. The renderer moved to `screens/all-pages.tsx`, leaving only
  page detail in the former shared file. No contextual form exists on this collection, so no modal was added.
- HR Leave Approvals is now a `ListPage` with search, state facets and 30-row paging. Request identity, employee
  relation, leave type, range, duration, reason and status remain visible. Approve/reject stay compact inline row
  commands because neither needs more fields; locale, CSRF, validation notices and safe retry semantics remain.
  The final legacy `hr_backend/screens.tsx` was removed after the renderer moved to `screens/leaves-list.tsx`.
- Integrated focused validation passes 11/11 tests. The affected groups pass Accounting 90/90, Collaboration
  100/100 and Identity 111 passed with one existing PostgreSQL-only test skipped locally. Desktop and 390 px
  browser QA confirms 302 px Vendor Bill controls, an internally scrolling All Pages table, a 390 px Leave
  Approvals main region, localized destinations and no document-level horizontal overflow.

### Wave 20 — ACC-10, FLOW-08 and ATT-01

- Shared Accounting Document Detail now uses the public `FormPage` record shell for journal entries, customer
  invoices and vendor bills. Document identity, lifecycle and print commands, editable lines, revision checks,
  rejected values and retry-stable line/reversal IDs remain. Mail Chatter and record activity occupy the native
  one-third aside rather than a separate quick-information column; the full document stays a routed form.
- Flow Page Detail now wraps its specialized Live Doc editor in `FormPage`. Title save remains the primary
  record action; add-child and move are URL-owned dialogs; reorder/archive stay compact operational commands.
  Breadcrumbs, child links, locale, CSRF, version checks, rejected values and retry identity remain. The last
  `screens/pages.tsx` renderer moved to `screens/page-detail.tsx` and the empty source file was removed.
- Attendance My Work remains a Specialized employee task surface because clock state, profile, monthly schedule,
  corrected sessions and leave history form one workflow. The five-field leave request moved to a URL-owned large
  dialog, while clock-in/out is explicit and retry-safe. Its renderer moved to
  `attendance_backend/screens/my-work.tsx`; the root file now holds only kiosk, period and credentials.
- Wave 20 starts the accelerated pipeline: each agent runs focused tests plus static checks, the coordinator runs
  each owning CI group once after integration, and the next wave may start after the quality gate while matrix CI
  continues. Cross-review remains mandatory before commit; it caught and closed retry, route-family and timezone
  edge cases before browser QA.
- Integrated focused validation passes 13/13 tests. The affected groups pass Accounting 94/94, Collaboration
  104/104 and Identity 116 passed with one existing PostgreSQL-only test skipped locally. Browser QA covers the
  populated Flow Live Doc, add-child dialog, Accounting detail with one-third Chatter/activity rail, its 900 px
  wrapped layout and Attendance leave dialog at desktop and 390 px; regular mobile fields stack label over input.

### Wave 21 — ACC-11, FLOW-09 and ATT-03

- Payments is now a public `ListPage` with search, type, partner type, state, partner and paging controls plus
  receipt, disbursement and open-item summaries. Its 11-control accounting and reconciliation workflow remains a
  stable full `/new` `FormPage`: it is too large and consequential for a modal. Locale, CSRF, safe returns,
  rejected relation values, legacy collection POST, stable retry identity and journal-entry destinations remain.
  The former root renderer was split into `screens/payments-list.tsx` and `screens/payment-form.tsx`.
- Project Epics remains a Specialized project card grid because epic briefs, backlog counts and dependency-map
  destinations are its useful operating context. The two-field create action is now a URL-owned modal over the
  grid; archive remains a compact card action. Locale, CSRF, explicit action dispatch, rejected title/color,
  project scoping and retry-safe create/archive behavior remain. Its renderer moved to
  `screens/project-epics.tsx`, leaving all-epics and epic detail for their own assignments.
- Attendance Period remains a Specialized monthly review workspace: timezone-aware month selection, lifecycle,
  status, export and attendance rows belong together. Month defaults now follow the attendance policy timezone;
  close/reopen use optimistic versions and explicit action dispatch. Locale, CSRF, PRG and CSV export remain,
  while the renderer moved to `screens/period.tsx`.
- Wave 21 applies the faster quality gate: agents run focused source tests and targeted static checks, the
  coordinator performs one integration build and one pass of each affected CI group, and browser QA follows that
  gate. Mandatory three-way cross-review is replaced by owner self-check plus targeted escalation for concrete
  shared-contract, security or concurrency risk.
- Integrated focused validation passes 12/12 tests. The affected groups pass Accounting 98/98, Collaboration
  108/108 and Identity 120 passed with one existing PostgreSQL-only test skipped locally. Typecheck, UI audit,
  Biome, docs and diff validation pass. Desktop and 390 px browser QA covers the Payments list/full form, Project
  Epic create modal and Attendance Period workspace; regular mobile controls stack and no wrap collision appears.

### Wave 22 — ACC-12, FLOW-10 and ATT-04

- Trial Balance remains a Specialized financial report: its date window, control totals, account rows and ledger
  drill-downs stay in one route rather than becoming a form record or modal. Plain accounting days now map to an
  inclusive UTC range, the same range reaches General Ledger, inverted dates produce a visible error without a
  domain read, GET submissions retain locale, and account-code ordering is stable. The renderer moved to
  `screens/trial-balance.tsx`.
- All Epics is now a public `ListPage` with URL-owned search and 50-row paging. A new company-scoped domain read
  removes the former 200-project and 80-epic caps, excludes archived projects/epics, returns an exact total and
  sorts by project, title and ID before slicing. Epic and project destinations are encoded and locale-safe. No
  create modal belongs on this cross-project read-only collection; project creation remains with FLOW-09. The
  renderer moved to `screens/all-epics.tsx`.
- Credential Issuance is now a Specialized action hub with three URL-owned short dialogs for kiosk, PIN and QR.
  Branch scope is server-owned, employees use relation options, PIN uses PRG, and kiosk/QR secrets appear only in
  the immediate POST result dialog. Explicit action dispatch, Origin CSRF, server validation, digest-only storage
  and stable request keys prevent unknown actions, generic function calls, refresh or replay from silently issuing
  another secret. A non-secret management capability preserves the normal manager permission path while secret
  mutation functions remain internal. The renderer moved to `screens/credentials.tsx`.
- Integrated focused validation passes 14/14 tests. The affected groups pass Accounting 102/102, Collaboration
  112/112 and Identity 126 passed with one existing PostgreSQL-only test skipped locally. Build, typecheck, UI
  audit, Biome and diff validation pass. Browser QA at 1440×1000 and 390×844 covers the Trial Balance report, All
  Epics ListPage and Credential hub/kiosk dialog; fields stack cleanly and full-screen mobile dialogs do not wrap
  into their background content.

### Wave 23 — ACC-13, FLOW-11 and COMPANY-01

- General Ledger remains a Specialized report with one filter/totals/table workspace. The route no longer caps
  the source at 200 rows: it computes exact matching totals, then applies localized search and 30-row paging to
  the table. Inclusive accounting days, inverted-range errors, locale-safe GET state, unavailable account
  fallback and encoded entry links remain consistent with Trial Balance. Its loader now requests only the four
  capabilities it uses, and the renderer moved to `screens/general-ledger.tsx`.
- Epic Detail now uses the public `FormPage` identity/navigation shell while retaining the Live Doc editor and
  related issues as specialized body sections. Project breadcrumb, dependency-map action and issue links are
  encoded and locale-safe. The route scopes issues by project and epic, shows an exact total plus 50-row preview
  and links the full result to the filtered project collection, avoiding the former silent 100-row cap. The last
  `screens/epics.tsx` leaf became `screens/epic-detail.tsx`; Live Doc read/write permissions remain separate.
- Companies is now a public `ListPage` with localized search, exact 30-row paging, create/hierarchy actions and
  an archive-inclusion toggle. The existing `archived=1` contract still means active plus archived, domain code
  order remains stable, and all list state/row links retain locale. Wave 23 starts the incremental company split
  with `screens/types.ts`, `screens/companies-list.tsx` and `screens/index.ts`; create/detail stays a full route
  for COMPANY-02 rather than being pulled into this collection.
- Integrated focused validation passes 11/11 tests. The affected groups pass Accounting 106/106, Collaboration
  115/115 and Identity 126 passed with one existing PostgreSQL-only test skipped locally. Build, typecheck, UI
  audit, Biome, docs and diff validation pass. Browser QA at desktop and 390 px covers General Ledger, populated
  Companies and a real Epic Detail with Live Doc; filters stack, tables contain their own overflow, and the editor
  remains usable on mobile.
- This is the final wave with local validation. Starting in Wave 24, the shared branch only edits code/tests,
  pushes the wave and follows CI; local test, build, lint, typecheck, diff and browser runs are skipped unless the
  user requests them explicitly.

### Wave 24 — ACC-14, FLOW-12 and COMPANY-02

- Partner Statement remains a Specialized receivable/payable movement report. It now computes exact totals over
  the full matching result, then applies localized search and paging; partner, account, date and locale state stay
  URL-owned. Inclusive date windows align overview drill-downs with the statement, invalid ranges remain visible,
  unavailable relations stay bundled, entry links are encoded and the route requests only its actual read
  capabilities. The last root Accounting renderer moved to `screens/partner-statement.tsx`.
- Epic Dependency Map remains a Specialized graph workspace. Exact epic lookup removes the former false 404 after
  80 records; issue and dependency reads now page/chunk beyond 200, aggregate complete edges and filter both ends
  against the full epic node set. Project/epic return actions and node destinations are encoded and locale-safe;
  the existing permission keys, archived compatibility and cycle guard remain.
- Company create/detail remains a full-route `FormPage`, not a modal: legal-entity identity, archive lifecycle and
  branches need stable context. Detail reuses the backing Partner collaboration thread in the one-third aside;
  create has no Chatter before identity exists. Origin CSRF, explicit save/archive/restore actions, stable create
  identity, safe return state, rejected relation values and locale PRG are preserved. Company version/CAS prevents
  stale save/archive writes while compatible no-op replay remains safe; the renderer moved to
  `screens/company-form.tsx`.
- Wave 24 initially contained source and focused test changes only. CI then exposed formatting and two build
  type errors; after fixing them, the exception path ran a local build and 25 focused tests without opening a
  browser, all passing. Final PR run 33046685448 passed quality contracts and all 20 SQLite/Postgres jobs.

### Wave 25 — FLOW-13, COMPANY-03 and USER-01

- Project Gantt remains Specialized. It now reads every project issue in bounded batches, sorts the complete
  result and presents 200-row URL-owned pages instead of silently truncating the chart. Pager totals are exact;
  issue destinations, locale and project navigation are encoded and preserved.
- Branch create/detail now uses a full-route `FormPage`. Stable create IDs survive rejected POSTs, rejected
  parents remain selectable, command allowlists and Origin CSRF remain explicit, and branch lookup is scoped by
  both company and branch IDs rather than scanning every company or accepting a mismatched URL. The renderer
  moved to `screens/branch-form.tsx`; branch pages intentionally have no Chatter rail.
- Users is now a public `ListPage` with URL-owned search, exact 30-row paging, archive inclusion and encoded row
  navigation. Search covers name, login, email and access kind before paging; stable locale-aware ordering keeps
  page boundaries deterministic. Wave 25 starts the incremental `user_backend/screens/` split with shared types
  and `screens/users-list.tsx`.
- Wave 25 contains source and focused test changes only. No local test, build, typecheck, lint, formatter, diff
  check or browser QA was run before the first push. The first PR run exposed formatting only; the exception
  path applied the formatter, built successfully and passed all 12 Wave 25 tests without opening a browser
  before the follow-up push.

### Wave 26 — FLOW-14, COMPANY-04 and USER-02

- Project Sprints remains a Specialized lifecycle collection while its three-field create workflow moves into
  a URL-addressable modal over the collection. Rejected creation preserves the record ID, idempotency key and
  submitted values; start/close transitions carry stable keys, unknown commands are rejected, locale survives
  PRG and the collection stays mounted behind the dialog.
- Company Hierarchy remains Specialized. Its renderer moved to `screens/hierarchy.tsx` with encoded row
  navigation, lifecycle state, count and collection/create actions. Route traversal now guards revisits and
  includes disconnected legacy nodes instead of recursing forever or silently omitting them.
- User create/detail/access now uses `FormPage`. The main identity form and access controls occupy the body;
  security integrations and sessions use the one-third detail rail, while create has no empty aside. Stable
  create IDs, safe list return state, rejected values, locale PRG and explicit command allowlists cover identity,
  membership, role, token and session actions. Same-ID create replay is idempotent; conflicting reuse is refused.
  The renderer and shared session table moved to `screens/user-form.tsx` and `screens/sessions.tsx`.
- Wave 26 follows the CI-first rule: source and focused tests are committed without local execution or browser
  QA. A CI failure activates the exception path—fix, build and relevant tests without a browser—before repush.

### Wave 27 — FLOW-15, COMPANY-05 and USER-03

- Project Settings remains a Specialized multi-collection workspace. Column, issue-type, custom-field and tag
  create/edit forms now open as URL-addressable modals over their collections; rejected saves preserve record
  IDs, idempotency keys and submitted values. Route-owned create/edit links preserve locale, commands remain
  explicit and the project brief stays mounted behind every editor.
- Working Context now uses `FormPage` with one external primary action and responsive shared form controls.
  The route preserves submitted company, branch and readable-set choices after validation, requires an explicit
  save command and keeps locale through PRG. Extracting `screens/context.tsx` removes the final Company root
  `screens.tsx`.
- Roles is now a public `ListPage` with exact count, encoded row navigation, locale-preserving create/preset
  actions and a focused `screens/roles-list.tsx` leaf. Role create/detail remains USER-04 and is intentionally
  unchanged in this wave.
- Wave 27 follows the CI-first rule: source and focused tests are committed without local execution, formatter
  or browser QA. CI failures activate only the targeted no-browser exception path before a follow-up push.

### Wave 28 — USER-04, ADDRESS-01 and ACTIVITY-01

- Role create/detail now uses `FormPage` with a single external save action and module-grouped permission
  sections. Stable create identity survives rejected saves; submitted identity values remain visible, commands
  are explicit while legacy detail/permission clients remain compatible, identifiers are encoded and locale is
  preserved through actions and PRG. The renderer moved to `screens/role-form.tsx` with its types.
- Address Catalogs now uses `ListPage` with whole-row country navigation, install state/count and an install
  action only where needed. Route-owned destinations are encoded and locale-safe. The list renderer and catalog
  types started the incremental `address_backend/screens/` split; the specialized country browser remains intact.
- Activities now uses `ListPage` as an operational queue while retaining its task cards and inline complete,
  reschedule and cancel controls. Target destinations are encoded and locale-safe; action URLs and post-action
  redirects preserve locale, date and the closed-activity filter. The root renderer was replaced by
  `screens/activities-list.tsx`.
- Wave 28 follows the CI-first rule: source and focused test changes are pushed without local execution,
  formatter or browser QA. Only a CI failure activates the targeted no-browser exception path.

### Modal consolidation through Wave 14 — PR 253

The follow-up audit keeps long operational workflows as routes and moves short, contextual configuration
forms into URL-addressable modals. The list or detail screen remains mounted underneath, `/new` stays as a
compatibility redirect, and validation returns to the same modal state.

| Work item | Modalized workflow | Background context | Presentation |
|---|---|---|---|
| STOCK-04 | Warehouse create | Warehouse list | large dialog |
| STOCK-05 | Location create | Location list | dialog |
| STOCK-06 | Operation-type create | Operation-type list | large sheet |
| STOCK-07 | Lot/serial create | Lot/serial list | dialog |
| STOCK-09 | Supply-route create | Supply-route list | dialog |
| PROD-02 | Save favorite filter | Product list with current query state | dialog |
| SALE-05 | Invoicing-policy create | Invoicing-policy list | dialog |
| ACC-02 | Account create/edit | Chart of accounts | large sheet |
| ACC-03 | Journal create/edit | Journal list | large sheet |
| AP-01 | Partner accounting terms | Partner detail with Chatter | large dialog |
| CRM-06 | Create/edit on all configuration tabs | Active configuration tab and table | dialog or large sheet by field count |
| FLOW-01 | Project create | Project list and selected tab | large sheet |

The audit intentionally keeps Stock transfers and replenishment, Product creation, Sales/Purchase documents,
Accounting taxes, CRM cases, Manufacturing orders/execution, record details, dashboards, boards and reports as
full routes. Those workflows either have enough fields, cross-record work, lifecycle actions, or Chatter/task
context to justify a stable page rather than a transient modal.

The shared modal contract owns focus entry, focus trapping, Escape/backdrop close, scroll containment,
responsive full-screen fallback and immutable client bundling. Because this is shared UI/runtime code, CI
selection expands to every group even though the business-route changes stop at Wave 14.

Browser QA also caught the public design-system stylesheet resolving to an unversioned 404 in source-mode
development. The canonical CSS entry is now bundled into the backend asset root before both `dev` and `build`,
served from the same fingerprinted URL in both modes, and only rewritten when its bytes change so the watcher
does not loop. Login verification loaded all 22 stylesheets with zero failures.

Nested relation-select QA verifies that the first Escape closes only the relation dialog and preserves the
route modal URL; the second Escape closes the route modal and returns to its background list.

The shared form contract was also verified at its exact responsive boundary: at `767px` every regular
field stacks its label above a full-width control, while `768px` restores the compact ERP inline layout.

![PR 253 journal modal at 1440 px](/assets/modal-consolidation-pr253/journal-modal-desktop-1440.png)

![PR 253 journal modal at 390 px](/assets/modal-consolidation-pr253/journal-modal-mobile-390.png)

![PR 253 partner accounting modal over detail and Chatter](/assets/modal-consolidation-pr253/partner-accounting-modal-chatter.png)

![PR 253 login font and controls after design-system bundling fix](/assets/modal-consolidation-pr253/login-font-fixed.png)

![PR 253 Partner form controls stacked at 767 px](/assets/modal-consolidation-pr253/form-controls-stacked-767.png)
