---
title: Form validation
description: Define shared schemas, cast native values, report nested issues, and revalidate inputs on the server.
group: Request execution
order: 4
---

KetJS form validation is a browser-safe contract rather than a component convention. A schema casts native
form values, applies field and cross-field constraints, and returns machine-readable issues. The same schema
runs in `@ketvietlab/ketjs-view` and on the server through `@ketvietlab/ketjs`.

:::note[Development APIs]
Nested contracts, edit sessions and transactional form actions documented on this branch are pending
a framework release. Published KetJS 0.3.0 includes the legacy schema/controller APIs, but does not
include `defineFormContract`, `createFormSession`, `attachForm` or `defineFormAction`. Adopt a released
version containing those exports before using the new examples in an npm consumer.
:::

This guide covers shared schemas and issues. For browser drafts, submit state, native controls and
render subscriptions, read [Forms and edit sessions](/docs/view-forms/) in the ketjs-view section.
For atomic server writes, revision checks and durable receipts, read
[Transactional form actions](/docs/form-actions/).

Client validation improves feedback but is never an authorization boundary. Validate again on the server
before calling a function or writing data.

## Define one schema

```ts
// File: src/modules/example/forms.ts
import { defineFormSchema, validationIssue } from '@ketvietlab/ketjs-view'

type Signup = {
  email: string
  age: number
  password: string
  confirmation: string
}

export const signupForm = defineFormSchema<Signup>({
  fields: {
    email: {
      type: 'text',
      required: true,
      trim: true,
      pattern: /^[^@]+@[^@]+$/,
    },
    age: { type: 'int', required: true, min: 18 },
    password: { type: 'text', required: true, minLength: 8 },
    confirmation: { type: 'text', required: true },
  },
  unknown: 'reject',
  validate: (values) =>
    values.password === values.confirmation
      ? true
      : validationIssue(
          'confirmation',
          'confirmation',
          'signup.passwordConfirmation',
        ),
})
```

Field types are `text`, `id`, `ref`, `int`, `float`, `decimal`, `bool`, `date`, `datetime`, `json`,
`object`, `array`, and `record`.
Constraints include `required`, `min`, `max`, `minLength`, `maxLength`, `pattern`, and `oneOf`. Set
`multiple: true` for repeated controls such as a multi-select. Optional empty values are omitted from the
normalized result.

Unknown fields are dropped by default, matching the allow-list behavior of changesets. Use
`unknown: 'reject'` at boundaries where an unexpected control should be reported as an error.

## Validate and inspect issues

```ts
// File: src/modules/example/forms.ts
import { validateForm, valuesFromFormData } from '@ketvietlab/ketjs-view'

const raw = valuesFromFormData(new FormData(form))
const result = validateForm(signupForm, raw)

if (!result.valid) {
  console.log(result.fieldErrors.email)
  console.log(result.formErrors)
}
```

`valuesFromFormData()` preserves repeated names as arrays instead of silently discarding entries.
`validateForm()` returns normalized `values`, flat `issues`, grouped `fieldErrors`, form-level
`formErrors`, and the names of dropped inputs.

Every issue has a stable transport shape:

```ts
// File: src/modules/example/forms.ts
type ValidationIssue = {
  field: string | null
  code: string
  messageKey: string
  params: Record<string, unknown>
}
```

`field: null` identifies a whole-form error. Render `messageKey` through the application's translator and
use `params` for interpolation. Do not branch on translated text.

## Declare nested values explicitly

```ts
// File: src/modules/catalog/variant-form.ts
import { defineFormContract } from '@ketvietlab/ketjs-view'

export type VariantDraft = {
  variants: Array<{
    rowKey: string
    id: string | null
    weight: string
    active: boolean
  }>
}

export const variantForm = defineFormContract<VariantDraft>('catalog.variants.v1', {
  fields: {
    variants: {
      type: 'array', required: true, key: 'rowKey', maxItems: 500,
      items: {
        type: 'object',
        fields: {
          rowKey: { type: 'id', required: true },
          id: { type: 'id', required: true, nullable: true },
          weight: { type: 'decimal', required: true, min: 0 },
          active: { type: 'bool', required: true },
        },
      },
    },
  },
})
```

- `object.fields` validates a fixed object; `array.items` validates every item; `record.entries`
  validates dictionary values, such as an attribute-ID to selected-value-ID map.
- A malformed list is rejected. It never becomes `[]`. An explicitly submitted `[]` is valid unless
  `minItems` forbids it; deciding whether it archives existing records belongs to the command.
- `key` requires unique, nonempty string row identities. Keep `rowKey` stable when a new row receives
  its database `id`. Neither a row key nor a submitted ID establishes ownership or permission.
- Unknown fields are rejected by default in a contract, including nested objects. A nested rule can
  explicitly override `unknown`. Legacy `defineFormSchema()` retains its drop-by-default behavior.
- `nullable: true` preserves explicit null. `empty: 'null'` with nullable converts an empty string
  to null; `empty: 'keep'` preserves an optional empty string. `default` applies only when absent.
  Missing, null, false, and an empty list are distinct. Do not clear disabled or omitted fields by accident.
- Structured fields default to at most 1,000 entries. `minItems` and `maxItems` bound arrays, objects
  and dictionaries. Validation also bounds recursive depth and total field visits. Domain code must
  separately bound combination generation before allocating the Cartesian product.
- Use the contract's `validate` callback for shared, pure cross-field rules. It receives normalized
  partial values; malformed structured fields prevent that callback from running. Database uniqueness,
  record ownership, permissions and current business state remain server checks.

Nested issues keep an indexed `field`, for example `variants.2.weight`, and add a stable `path`,
for example `['variants', { key: 'draft-42' }, 'weight']`. `formIssuePath(contract, submittedValues, field)`
maps domain errors with the submitted snapshot. Never resolve an old index against a newly sorted list.
For dictionary keys containing dots, use the explicit path rather than inventing dotted field names.

## Validate on the server

Use `assertForm()` when a route should stop immediately on invalid input:

```ts
// File: src/modules/example/forms.ts
import { assertForm, json } from '@ketvietlab/ketjs'

const values = assertForm(signupForm, rawBody)
await createAccount(values)
return json({ ok: true })
```

`FormValidationError` is serialized by the KetJS HTTP server with status `422`, code
`E_FORM_INVALID`, and the same `issues`, `fieldErrors`, and `formErrors` shape used in the browser.

Use `invalidForm(result)` when a route prefers to return rather than throw:

```ts
// File: src/modules/example/forms.ts
const result = validateForm(signupForm, rawBody)
if (!result.valid) return invalidForm(result)
```

Function signature failures also return HTTP `422` with code `E_INVALID_INPUT` and structured field
issues. Authentication, authorization, unknown routes, and other request failures keep their existing
status codes.

## Refuse a submit on a backend screen

`assertForm()` and `invalidForm()` answer a program: they end the request with `422` and a JSON body.
A KetSuite backend screen answers a person, and a person is still looking at the dialog they typed
into — so the same submit has to re-render that dialog rather than replace it.

Three things have to agree for that to read correctly, and `formRefusal()` from `ketsuite/backend`
holds all three:

```ts
// File: src/modules/example/routes.tsx
import { formRefusal, readForm, seeOther } from '@ketvietlab/ketsuite/backend'

const refused = formRefusal(_)
if (req.method === 'POST') {
  const form = await readForm(req)
  // A row's own archive control posts its identity and nothing else, so it has
  // no form to satisfy. Only an edit is checked.
  const values = form.action === 'archive' ? form : refused.check(programmeForm, form)
  if (values) {
    const result = await ctx.call('example.programme.save', values)
    if (result.ok) return seeOther(base)
    refused.add(errorsOf(result, _))
  }
}
```

Then the render asks it three questions:

```ts
// File: src/modules/example/routes.tsx
// Keep the dialog open, and keep what was typed rather than the stored row.
const modalOpen = Boolean(create || editing || refused.refused())
const selected = refused.refused() ? formValues : editing
// And put each complaint on the control that caused it.
const fields = [{ name: 'name', value: value('name'), error: refused.error('name') }]
```

`recordForm` sets `aria-invalid` on any field it is given an `error` for, so a complaint reaches a
screen reader as well as an eye.

Two details worth stating, because both have been got wrong in product code:

- **`refused()` is not `errors.length`.** When every complaint is a field mark there is no
  form-level sentence to count, so a route testing an array of sentences closes the dialog and
  throws away what was typed — the exact failure the schema was adopted to fix.
- **Keep your own copy of the raw submit.** `check()` hands back normalized values and *drops the
  invalid ones*, which is right for writing and wrong for re-rendering. What a person typed is what
  goes back into the form, including the part that was refused.

The words come from `backend.validation.*`, one sentence for each code a schema can raise. A module
adopting a schema does not define them.

## Changesets and business validation

Form schemas validate presentation input. Changesets still own model casting, mass-assignment protection,
and persistence validation. Convert existing changeset errors when a route needs the shared transport shape:

```ts
// File: src/modules/example/forms.ts
const changes = ctx.change('sales.Order', values).cast(['number']).required(['number'])

if (!changes.valid) {
  return invalidForm(issuesFromFieldErrors(changes.errors))
}
```

Database-backed checks such as uniqueness, current inventory, or permissions remain server-only. Return
their outcome as `ValidationIssue` values and call `formState.applyServerIssues(problem)` in an enhanced
browser flow.

## Browser forms and server actions

The browser and transaction guides now have their own navigation entries. Existing links to their
former sections remain available here:

<span id="manage-browser-form-state"></span>

[Manage browser form state](/docs/view-forms/#manage-browser-form-state) covers `createForm`,
reactive validation, touched fields and the low-level submit handler.

<span id="transactional-edit-forms"></span>
<span id="keep-a-draft-until-the-outcome-is-known"></span>

[Transactional edit forms](/docs/view-forms/#transactional-edit-forms) covers the form session,
accepted baselines, refusal, conflict and unknown-outcome retry.

<span id="commit-the-command-and-its-receipt-together"></span>

[Commit the command and its receipt together](/docs/form-actions/#commit-the-command-and-its-receipt-together)
covers the server action and its database transaction.

<span id="attach-native-controls-or-a-custom-editor"></span>

[Attach native controls or a custom editor](/docs/view-forms/#attach-native-controls-or-a-custom-editor)
covers DOM binding, field errors, submitters and lifecycle ownership.

<span id="render-subscriptions-and-cost"></span>

[Render subscriptions and cost](/docs/view-forms/#render-subscriptions-and-cost) covers whole-draft
subscriptions, primitive selectors, adapter work and the measured performance limits.

<span id="migrate-a-complex-editor"></span>

[Migrate a complex editor](/docs/view-forms/#migrate-a-complex-editor) describes adoption without
replacing the consumer's layout or domain commands.
