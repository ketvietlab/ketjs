# Design system Wave 6 closure

## Public KetJS result

- The generated inventory reports zero planned components.
- Every public runtime component has one registry owner and an existing catalogue specimen.
- Selector ownership covers primitives, interactions, forms, data operations, data display, record,
  layout, and pattern directories.
- `FormPage`, `DashboardPage`, and `BoardPage` remain deprecated compatibility recipes; new uses are
  rejected by the release-readiness audit.
- Desktop/mobile evidence covers inventory, catalogue families, canonical pages in English/Vietnamese,
  and the connected Vietnamese demo.

## Optional and deferred classification

| Capability | Classification | Owner | Re-entry gate |
| --- | --- | --- | --- |
| Board, schedule, timeline | `WorkspacePage` canvas recipe | Design system | Promote a component only after two independent consumers share a domain-neutral data contract. |
| Gantt | Domain/defer | Flow application | Two independent consumers plus keyboard, mobile overflow, and bounded-data evidence. |
| Charts | Public optional candidate | Data visualization | Stable SSR fallback, accessible table equivalent, bundle budget, and benchmark. |
| Product media workflows | Domain | Product application | Keep public `MediaGallery`; promote workflow only if storage/permission behavior becomes generic. |
| User workflow | Domain | Identity application | Independent non-identity consumer and a permission-neutral renderer contract. |

## Merge, release, and private rollout handoff

The stacked KetJS pull requests are merge candidates, not a published release. After they merge in order:

1. Run `npm run design:release:check`, `npm run release:check`, and the browser matrix on the final commit.
2. Merge/release only from `master`; record the package version and exact reachable SHA in release notes.
3. In the private Két Việt repository, update `KETJS.lock` through its normal pin flow with no override.
4. Migrate collection, record/form, and workspace cohorts by module owner; retain typed values, URL state,
   permission boundaries, validation text, and localized desktop/mobile evidence.
5. Re-run both inventories. Remove old implementation/CSS only where the released inventory proves zero
   consumers.
6. Rehearse rollback by restoring the prior exact pin. No destructive data migration is part of this UI
   rollout.

Package publication, the exact `master` SHA, private pinning, and production rollout are deliberately
post-merge operations; claiming them inside an unmerged public PR would create false release evidence.
