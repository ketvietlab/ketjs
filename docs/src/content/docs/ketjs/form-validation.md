---
title: Form validation
description: Share form schemas between server and browser, manage field state, and return structured HTTP 422 errors.
---

KetJS form validation is a browser-safe contract rather than a component convention. A schema casts native
form values, applies field and cross-field constraints, and returns machine-readable issues. The same schema
runs in `@ketvietlab/ketjs-view` and on the server through `@ketvietlab/ketjs`.

Client validation improves feedback but is never an authorization boundary. Validate again on the server
before calling a function or writing data.

## Define one schema

```ts
import { defineFormSchema, validationIssue } from '@ketvietlab/ketjs'

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

Field types are `text`, `id`, `ref`, `int`, `float`, `decimal`, `bool`, `date`, `datetime`, and `json`.
Constraints include `required`, `min`, `max`, `minLength`, `maxLength`, `pattern`, and `oneOf`. Set
`multiple: true` for repeated controls such as a multi-select. Optional empty values are omitted from the
normalized result.

Unknown fields are dropped by default, matching the allow-list behavior of changesets. Use
`unknown: 'reject'` at boundaries where an unexpected control should be reported as an error.

## Validate and inspect issues

```ts
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
type ValidationIssue = {
  field: string | null
  code: string
  messageKey: string
  params: Record<string, unknown>
}
```

`field: null` identifies a whole-form error. Render `messageKey` through the application's translator and
use `params` for interpolation. Do not branch on translated text.

## Manage browser form state

`createForm()` adds reactive lifecycle state without owning markup or submission transport:

```ts
import { createForm } from '@ketvietlab/ketjs-view'

const formState = createForm(signupForm)

formState.set('email', emailInput.value, { touch: true })

const submitted = await formState.submit(async (values) => {
  return fetch('/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })
})
```

The controller exposes read-only signals for `values`, `issues`, `touched`, `dirty`, `valid`, `submitted`,
and `submitting`. `errors(field)` hides untouched errors until that field is touched or the form is
submitted. `applyServerIssues()` merges the authoritative server outcome into the same presentation path.
Call `dispose()` when a controller outlives its island or component.

The controller does not intercept DOM events and does not replace native attributes such as `required`,
`min`, or `aria-invalid`. UI packages remain responsible for markup and accessibility.

## Validate on the server

Use `assertForm()` when a route should stop immediately on invalid input:

```ts
import { assertForm, json } from '@ketvietlab/ketjs'

const values = assertForm(signupForm, rawBody)
await createAccount(values)
return json({ ok: true })
```

`FormValidationError` is serialized by the KetJS HTTP server with status `422`, code
`E_FORM_INVALID`, and the same `issues`, `fieldErrors`, and `formErrors` shape used in the browser.

Use `invalidForm(result)` when a route prefers to return rather than throw:

```ts
const result = validateForm(signupForm, rawBody)
if (!result.valid) return invalidForm(result)
```

Function signature failures also return HTTP `422` with code `E_INVALID_INPUT` and structured field
issues. Authentication, authorization, unknown routes, and other request failures keep their existing
status codes.

## Changesets and business validation

Form schemas validate presentation input. Changesets still own model casting, mass-assignment protection,
and persistence validation. Convert existing changeset errors when a route needs the shared transport shape:

```ts
const changes = ctx.change('sales.Order', values).cast(['number']).required(['number'])

if (!changes.valid) {
  return invalidForm(issuesFromFieldErrors(changes.errors))
}
```

Database-backed checks such as uniqueness, current inventory, or permissions remain server-only. Return
their outcome as `ValidationIssue` values and call `formState.applyServerIssues(problem)` in an enhanced
browser flow.
