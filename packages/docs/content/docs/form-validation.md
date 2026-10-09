---
title: Form validation
description: Share nested form contracts, preserve drafts, and commit server actions with revision checks and durable retries.
group: Request execution
order: 4
---

KetJS form validation is a browser-safe contract rather than a component convention. A schema casts native
form values, applies field and cross-field constraints, and returns machine-readable issues. The same schema
runs in `@ketvietlab/ketjs-view` and on the server through `@ketvietlab/ketjs`.

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

## Manage browser form state

`createForm()` adds reactive lifecycle state without owning markup or submission transport:

```ts
// File: src/modules/example/forms.ts
import { createForm } from '@ketvietlab/ketjs-view'

const formState = createForm(signupForm)

formState.set('email', emailInput.value, { touch: true })

const submitted = await formState.submit(async (values) => {
  const response = await fetch('/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })
  if (!response.ok) throw new Error('Signup was refused')
  return response.json()
})
```

The controller exposes read-only signals for `values`, `issues`, `touched`, `dirty`, `valid`, `submitted`,
and `submitting`. `errors(field)` hides untouched errors until that field is touched or the form is
submitted. `applyServerIssues()` replaces the displayed issues with the server's issues.
Call `dispose()` when a controller outlives its island or component.

This low-level controller treats a resolved handler as success, does not interpret a Fetch response,
and does not accept a new baseline automatically. Use the transactional form session below for edit
commands, single-flight submission, revision conflicts, and retry after an uncertain result.

The controller does not intercept DOM events and does not replace native attributes such as `required`,
`min`, or `aria-invalid`. UI packages remain responsible for markup and accessibility.

## Transactional edit forms

`defineFormContract()` is the shared declaration; `createFormSession()` owns one editor's draft;
`defineFormAction()` declares a server function with atomic database writes and a durable receipt.
The browser calls the existing `/_ket/fn/<name>` endpoint. No parallel authentication, permissions,
tenant selection, or automatic `/_ket/forms` route is introduced.

The motivating case is an attributes-and-variants editor: nested rows, stable client identities,
decimal text, archive rather than delete, and a full replacement submitted in one command. A general
product form, image upload, and creation of a shared attribute are separate save scopes even when
they appear on the same page. A successful save resets only its own scope.

### Declare nested values explicitly

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

### Commit the command and its receipt together

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

### Keep a draft until the outcome is known

```ts
// File: src/modules/catalog/client/variant-editor.ts
import { createFormSession, formActionTransport } from '@ketvietlab/ketjs-view'
import type { VariantDraft } from '../variant-form.ts'
import { variantForm } from '../variant-form.ts'

export function variantEditorState(initial: VariantDraft, recordId: string, revision: string) {
  return createFormSession(variantForm, {
    initial, recordId, revision,
    transport: formActionTransport('catalog.saveVariants'),
  })
}
```

Render `session.values()` in the editor and replace a changed top-level field with
`session.set('variants', nextRows)`. Values and submit snapshots are cloned and frozen. A new row
retains its client key in the accepted result alongside its assigned ID.

| Outcome | Session behavior |
| --- | --- |
| `committed` | Replace values and baseline with accepted values; advance revision; clear dirty state. |
| `invalid` | Preserve draft and revision; show all issues, including multiple issues per field. |
| `conflict` | Preserve draft and revision; let the application load current state and offer reconciliation. |
| `unknown` | Preserve the exact mutation ID and submitted values; lock editing until retry resolves the intent. |

Concurrent `submit()` calls share one promise. The first implementation locks edits during submission;
it does not silently merge typing over an in-flight snapshot. `retry()` sends the same intent after a
lost or unusable response. A replay returns the original receipt before executing the revision guard
again. A reused key with a different input is rejected.

`reset()` discards this scope's draft. `reset({ values, revision })` explicitly installs a reviewed
baseline, such as after conflict resolution. Both refuse while submitting or uncertain.
`receive({ values, revision })` accepts background data only when the scope is pristine and settled.
Unrelated edits retain server errors until that field is edited or the next submission starts.
`errors(path)` supports stable paths as well as indexed field names. `touch()` reveals a field before
submission; submission reveals all issues.

Do not close or refresh the whole page merely because a Promise resolved. Check `outcome.status` and
the other draft scopes. Preview/read commands are separate operations: they must not produce a
`committed` outcome or reset an editing baseline. A file upload and creation of a shared attribute
remain separately committed operations; Reset does not undo them.

### Attach native controls or a custom editor

`attachForm(form, session, options)` owns submit/input/change/reset listeners, pending controls,
`aria-invalid`, error descriptions, and focus on the first refused control. Supply `formatIssue` using
the application's translator. Optional `[data-form-error="field"]` elements receive translated text;
give them IDs so the adapter can link `aria-describedby`. `[data-form-summary]` receives the summary.
The application supplies status/retry copy using `session.status()` or `onOutcome`.

The default reader preserves repeated controls, unchecked boolean checkboxes and empty selections.
The default writer assigns array entries to repeated text, textarea, or single-select controls in
form order. Submit buttons keep their declared values: the clicked submitter's name and value enter
the draft during submission rather than being overwritten by the current session value.
Disabled controls are not interpreted as clear operations. Set `read` and `write` for a custom editor
whose state is not represented by the form's named controls, and `control` to resolve nested issues to
focusable controls. Existing descriptions and disabled states are restored on detach.

Attach effects only in `mount({ root, lifetime })`; pass `lifetime` as `options.signal` and call
`session.dispose()` on abort. Return an island controller with `view` and `mount`, not a cleanup function
from `mount`. Server props contain only serializable initial values, IDs, revision and labels; transport
functions and callbacks are constructed in the browser module.

Native action/method routes remain application-owned. A route must decode and bound its native body,
validate CSRF, preserve submitted values when re-rendering, and invoke the same action through
`ctx.call` with the viewer's request and a stable idempotency key. It passes
`{ contractId, recordId, expectedRevision, values }`; a successful response may redirect, while
`invalid` and `conflict` re-render the relevant scope. Preserve a native hidden intent token across a
retry and generate a new one for a corrected, definitively refused submission. Native forms do not
POST URL-encoded data directly to the JSON-only function endpoint. Adding an `action` attribute to an
empty editor form cannot serialize its signal state or provide a no-JavaScript editing experience.

### Render subscriptions and cost

`session.values()` is one immutable signal for the complete draft. Every field effect that reads
it directly subscribes to every draft replacement. For an independent preview, select a primitive
with `computed` so unchanged values do not execute that preview's effect again. Keep this wiring
in the client runtime and dispose both the effect and selector with its lifetime.

```ts
// File: src/modules/catalog/client/title-preview.ts
import { computed, effect } from '@ketvietlab/ketjs-view'
import type { FormSession } from '@ketvietlab/ketjs-view'

export function attachTitlePreview(
  session: FormSession<{ title: string }>,
  preview: HTMLOutputElement,
  lifetime: AbortSignal,
) {
  const title = computed(() => session.values().title)
  const stop = effect(() => { preview.textContent = title() })
  const dispose = () => { stop(); title.dispose() }
  if (lifetime.aborted) dispose()
  else lifetime.addEventListener('abort', dispose, { once: true })
}
```

This isolates view effects, not all work: every selector still depends on the whole draft,
`set()` copies the draft, validation traverses the whole schema, and dirty comparison revalidates
the baseline. The current native adapter also visits all controls and error targets. Its default
issue lookup repeats control-list searches for each control; large forms with errors can become
particularly expensive. A custom structured editor can supply an indexed `control(issue)` lookup
and equality-guarded `write` implementation, but those do not eliminate the other adapter loops.

The [browser form benchmark](/docs/benchmarks/#browser-form-sessions) compares the current session
and adapter with RHF and Formik using shared validation and isolated field views. At revision
`756efdf9`, one invalid field in a 500-field default-adapter form takes **64.05 ms median** on the
recorded desktop environment. Treat this as a known performance gap when adopting large forms;
the benchmark is not a KetSuite editor, paint/INP or mobile performance sign-off.

### Migrate a complex editor

Keep its existing layout and domain command. Move pure normalization and cross-field checks into the
shared contract; replace its hand-written draft/submitting/issues lifecycle with a form session. Add
the revision guard to every writer, then adopt `defineFormAction` and verify lost-response retry,
refusal after a write, malformed replacement arrays, foreign IDs and concurrent editors. Translate
legacy domain issues to `ValidationIssue` without dropping `messageKey` or multiple field errors.
Only then replace a client-side multi-command save with a server command when the product promises
one atomic save. Framework changes must be released and adopted by version before a KetSuite consumer
can use these exports; this guide does not imply that existing KetSuite forms have already migrated.

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
