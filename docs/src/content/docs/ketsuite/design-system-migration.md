---
title: Design system migration
description: Migrate KetJS and Két Việt consumers onto the governed public component system.
---

The Wave 0–6 component programme keeps the root package entry stable while moving source ownership,
adding typed components, and retiring compatibility page recipes. Merge the stacked pull requests in
order, publish from `master`, then update the private Két Việt pin to the exact released commit.

## Page patterns

Only three page patterns are canonical:

- Use `ListPage` for operational collections, worklists, analytical lists, and settings indexes.
- Use `RecordPage` for durable records, including create/edit forms that have record identity.
- Use `WorkspacePage` for master-detail, boards, schedules, timelines, and other spatial work.

`FormPage`, `DashboardPage`, and `BoardPage` remain deprecated aliases during the compatibility window.
Do not add new consumers. Move their existing slots without changing application-owned URLs, actions,
permissions, validation, or localized copy.

## Component migration order

1. Replace local overlay mechanics with `attachDesignSystemInteractions`; keep route and unsaved-change
   decisions in the application.
2. Replace raw scalar fields and local pickers with typed form exports. Pass rejected text back unchanged,
   and supply query/permission-filtered relation results.
3. Replace collection toolbars and local rows with data-operation exports. Preserve unrelated URL keys,
   version saved views, and cap grid results before considering virtualization.
4. Replace record facts, activity, audit, attachments, and media with public renderers. Pass only authorized
   and redacted results; keep storage and mutations in the application.

The public component package owns markup, `data-ui`, component CSS, tokens, accessibility semantics, and
browser mechanics. The application owns business state, persistence, permissions, validation, queries,
storage, timezones, translations, and deployment.

## Release and rollback

Run `npm run design:release:check`, the normal release check, and the full browser matrix on the merge
candidate. Publish only from a commit reachable from `master`, and record that exact SHA with the package
version. In Két Việt, update the normal `KETJS.lock` while keeping `KETJS_REF=refs/heads/master`; do not use
an override for promotion.

Rollback means restoring the previous exact pin and redeploying the affected cohort. These UI changes do
not require destructive data migration. Keep compatibility aliases until the cross-repository inventory
shows zero consumers at the released revision.
