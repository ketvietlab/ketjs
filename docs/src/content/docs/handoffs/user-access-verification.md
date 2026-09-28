---
title: User access review verification
---

This review covers the shared user record, managed roles, automatic access rules and record-modal runtime. Changes are identified by `USR-N02` through `USR-N17` in their commit bodies. Deployment-owned identity delivery belongs to the consumer repository.

## Database and authorization checks (USR-N16)

Build first with `npm run build`. Run the following focused lanes on the same tree:

```sh
# Run from: /path/to/ketjs
KET_TEST_PG=postgres://USER@127.0.0.1:PORT/postgres node --test \
  .build/test/user-access-policy.test.js \
  .build/test/user-permission-postgres.test.js \
  .build/test/user-permission-framework.test.js \
  .build/test/user-access-workflow.test.js \
  .build/test/user-modal-context.test.js \
  .build/test/user-role-modal.test.js
```

Use a disposable PostgreSQL server: these tests create and drop their own scratch databases. A skipped PostgreSQL lane is not a passing production-storage check.

The focused tests exercise transaction rollback, authorization revision CAS, replay, scope and workplace membership, self/security guards, break-glass expiry, automatic audit and immediate permission resolution. Policy tests additionally verify directory-value validation, reviewed preview digests, separate rule ownership, union with manual assignments, reconciliation after directory changes, and pausing an outdated role without permitting its reactivation. Denied-action telemetry is actor-bound and unavailable to a profile reader without audit access.

Directory import is an internal integration contract (`user.replaceDirectoryFacts`) for a trusted, tenant-bound adapter. This change does not configure a tenant's HR or identity-provider directory connector. Until an adapter supplies facts, the rule picker has no invented options. The periodic reconciler refreshes existing facts against current role health and workplace membership.

## Shared UI checks (USR-N17)

```sh
# Run from: /path/to/ketjs
node --test \
  .build/test/ui-record-modal.test.js \
  .build/test/user-access-surfaces-view.test.js \
  .build/test/user-modal-access-view.test.js \
  .build/test/user-modal-messages.test.js \
  .build/test/user-roles-list-http.test.js \
  .build/test/user-lists-search-http.test.js
```

Browser review uses the consumer's native KetAtlas renderer with this built checkout explicitly selected for an isolated preview. The renderer uses real shared components, islands and HTTP transport with fixture business operations. It is not a deployment or provider smoke test. Desktop dialogs measure the tallest visited tab; mobile dialogs remain fullscreen with only the panel scrolling. Record changes reset measurements; nested dialogs preserve the parent and restore opener focus.

Both temporary-password and email controls can be supplied by an external credential adapter. Provider acceptance of an email must not imply delivery, activation, or termination of SSO sessions. Unknown server refusal codes use friendly language; known field errors keep their specific guidance.

Before handoff run `npm run check`, design inventory/governance/release checks and the repository's applicable quality gates. Production rollout, provider delivery and release-pin evidence are separate consumer gates.
