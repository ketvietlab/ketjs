---
title: CRM modules
description: KetSuite CRM module boundaries, shared UI behavior, and scope.
---

# CRM modules

KetSuite CRM is an open-source sales application for leads and opportunities.

## Modules

- `crm`: cases, lead conversion, stages, teams, assignment, scoring, activities and timeline.
- `crm_sale`: quotation creation from opportunities.
- `crm_backend`: pipeline, record workspace, planner and core CRM configuration.
- `crm_website`: anonymous website lead submission.

All user-visible strings ship in Vietnamese and English from the first release. List screens use the
shared global search/filter/grouping chrome; they do not render a second local filter bar.

## Scope boundary

The OSS modules do not contain support tickets, SLA, complaints, knowledge base, canned responses,
post-sale fulfillment, Customer Care follow-up, outcome tracking, customer support portal or reseller
care. Deployments can provide those capabilities from a private extension without changing the public
lead/opportunity domain.

The public extension surface includes CRM domain helpers, Sale function specs for transactional
composition, and backend form/attachment/modal primitives. These are neutral extension contracts and
contain no Customer Care behavior.

## Verification

```bash
# Run from: /path/to/ketjs
npm run build
node --test .build/test/crm-e2e.test.js .build/test/crm-i18n.test.js
npm run bench:crm
KET_BENCH_DRIVER=postgres KET_BENCH_PG='postgres://USER:PASSWORD@HOST:PORT/postgres' npm run bench:crm
```

HTTP E2E covers create, conversion, optimistic stage conflict, win/loss, global grouping, planner,
configuration, locale rendering and website lead UI. The benchmark measures list/filter/count/group,
pipeline pages, record detail and scoring across 20,000 CRM records on SQLite or PostgreSQL.

The backend design harness exposes the neutral extension primitives at `/catalogue/attachments` and
`/catalogue/modal` for long-content desktop and mobile acceptance checks.
