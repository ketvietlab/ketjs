---
title: Transactional form actions
description: Validate shared contracts on the server and commit domain writes, revision checks, and durable form receipts in one transaction.
group: Request execution
order: 5
---

`defineFormAction()` declares a server function for one atomic edit command. It validates the shared
contract, runs the domain handler and records an accepted result in one database transaction.
It does not infer which records form an aggregate, replace permission checks or create a form route.

:::note[Development API]
`defineFormAction` is pending a framework release and is not part of published KetJS 0.3.0. The
example below targets this development branch; npm consumers need a release containing this API.
:::

Define the browser-safe schema with [Form validation](/docs/form-validation/), then connect the browser
with [Forms and edit sessions](/docs/view-forms/). Only a `committed` outcome acknowledges a durable save;
a resolved Fetch promise or a completed preview/read is not that acknowledgement.

This guide uses `VariantDraft` and `variantForm` from
[Declare nested values explicitly](/docs/form-validation/#declare-nested-values-explicitly).
The command saves one template's variants, including new row IDs and archive operations, as a unit.
Other product details, file uploads and shared attributes keep their own save scopes.

## Commit the command and its receipt together

The example assumes an existing `catalog.Template` with `id` and `revision` and a `catalog.Variant`
with `id`, `templateId`, `weight` and `active`. Both models use the deployment's ordinary scope.
Creation of the template is a separate command.

```ts
// File: src/modules/catalog/save-variants.ts
import { randomUUID } from 'node:crypto'
import { defineFormAction, formConflict, validationIssue } from '@ketvietlab/ketjs'
import { variantForm } from './variant-form.ts'

export const saveVariants = defineFormAction(variantForm, {
  effects: [
    'read:catalog.Template', 'write:catalog.Template',
    'read:catalog.Variant', 'write:catalog.Variant',
  ],
  handler: async (ctx, { recordId, expectedRevision, values }) => {
    const revision = randomUUID()
    const guard = await ctx.db.compareAndSet(
      'catalog.Template', { id: recordId },
      { revision: expectedRevision }, { revision },
    )
    if (!('matched' in guard) || !guard.matched) return formConflict()

    const existing = await ctx.db.select('catalog.Variant', { templateId: recordId })
    const accepted = []
    const submittedIds = new Set<string>()
    for (const [index, row] of values.variants.entries()) {
      if (row.id && (submittedIds.has(row.id) || !existing.some((held) => held.id === row.id))) {
        return {
          status: 'invalid',
          issues: [validationIssue(`variants.${index}.id`, 'ownership')],
        }
      }
      const id = row.id ?? randomUUID()
      submittedIds.add(id)
      const fields = { weight: row.weight, active: row.active }
      if (row.id) await ctx.db.update('catalog.Variant', { id }, fields)
      else await ctx.db.insert('catalog.Variant', { id, templateId: recordId, ...fields })
      accepted.push({ ...row, id })
    }
    for (const row of existing) {
      if (!submittedIds.has(String(row.id)))
        await ctx.db.update('catalog.Variant', { id: row.id }, { active: false })
    }
    return {
      status: 'committed', accepted: { variants: accepted }, revision,
      value: { id: recordId },
    }
  },
})
```

Register `saveVariants` in the module's `functions`. The action validates again on the server, requires
an idempotency key, and runs the handler and receipt write in **one database transaction**. It disables
dry runs. The supplied `ctx` already owns the transaction: use it directly instead of starting another
`ctx.tx()` or invoking another function through HTTP. Compose domain helpers that accept this context.

A returned `invalid` or `conflict` unwinds the transaction before it becomes an outcome. This includes
the revision change and any earlier row writes. A thrown error or invalid accepted projection also rolls
back. On success, the receipt contains the accepted projection, generated IDs, and revision produced
inside that transaction. Avoid a post-commit reread that could pick up a different writer's changes.
Both committed and refused outcomes pass through the function's declared output projection;
undeclared properties on a domain outcome are not returned to the caller.

`ctx.notify()` uses the root adapter's listeners and publishes only after a successful commit.
Rollback discards notifications, and receipt replay does not publish them again. PostgreSQL carries
notifications in the database transaction; SQLite buffers them until the transaction commits.

The domain handler owns the revision guard. Every other writer affecting the same aggregate must use
the same guard and advance its revision. This API does not infer aggregate boundaries or make an
existing series of client requests atomic. In-process callers must also supply `idempotencyKey` to
`callFn` or `ctx.call`; permission and scope checks still run before receipt replay.

The underlying opt-in function flag is `transactional: true` with `idempotent: true`. Legacy idempotent
functions retain their existing execution order. Atomic receipts cover database effects; external
uploads, emails and other network effects need staging or a transactional outbox. Receipt retention
must cover the supported retry window; replay is not promised after a receipt is swept.

## Native routes and fallback

Native action/method routes remain application-owned. A route must decode and bound its native body,
validate CSRF, preserve submitted values when re-rendering, and invoke the same action through
`ctx.call` with the viewer's request and a stable idempotency key. It passes
`{ contractId, recordId, expectedRevision, values }`; a successful response may redirect, while
`invalid` and `conflict` re-render the relevant scope. Preserve a native hidden intent token across a
retry and generate a new one for a corrected, definitively refused submission. Native forms do not
POST URL-encoded data directly to the JSON-only function endpoint. Adding an `action` attribute to an
empty editor form cannot serialize its signal state or provide a no-JavaScript editing experience.

An island using `attachForm` prevents the native submit and calls its transport. Without JavaScript,
the browser uses the form's `action` and `method`; the application must supply that route and a complete
named-control representation of the draft. Nested editors need an explicit decoder that produces the
same contract values. The JSON function endpoint is not that decoder.

For client locking, refusal presentation and conflict recovery, see
[Keep a draft until the outcome is known](/docs/view-forms/#keep-a-draft-until-the-outcome-is-known).
