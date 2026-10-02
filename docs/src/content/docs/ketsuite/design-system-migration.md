---
title: Design system migration
description: Migrate KetJS and Két Việt consumers onto the governed public component system.
---

The Wave 0–6 component programme keeps the root package entry stable while moving source ownership,
adding typed components, and retiring compatibility page recipes. Merge the stacked pull requests in
order, publish from `master`, then update the private Két Việt pin to the exact released commit.

## Design authority

Component selection and migration guidance now live in the [Két Design System skill](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system).
This page retains the runtime-package release and rollback procedure. The independently
versioned skill package has its own installation and release instructions.

## Release and rollback

Run `npm run design:release:check`, the normal release check, and the full browser matrix on the merge
candidate. Publish only from a commit reachable from `master`, and record that exact SHA with the package
version. In Két Việt, update the normal `KETJS.lock` while keeping `KETJS_REF=refs/heads/master`; do not use
an override for promotion.

Rollback means restoring the previous exact pin and redeploying the affected cohort. These UI changes do
not require destructive data migration. Keep compatibility aliases until the cross-repository inventory
shows zero consumers at the released revision.
