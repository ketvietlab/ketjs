---
title: Forms and edit sessions
description: Manage browser drafts, submission outcomes, native controls, island lifecycles, and form render subscriptions with ketjs-view.
group: ketjs-view and KTL
order: 3
---

A browser form needs a draft, validation feedback, submission state and a clear owner for DOM effects.
ketjs-view provides controllers and an adapter while the application supplies markup and domain commands.

:::note[Requires ketjs-view 0.4.0]
`createFormSession`, `attachForm` and `formActionTransport` require ketjs-view 0.4.0 or later.
The existing `createForm` controller remains supported. Install the same released framework
version on the server and client before using the session examples.
:::

Import the same [form schema or contract](/docs/form-validation/) in the client and server. Keep
schema rules pure and browser-safe. A form session cannot grant permission, establish record ownership
or make several server requests atomic; those checks and writes belong to a
[transactional form action](/docs/form-actions/).

| API | Responsibility |
| --- | --- |
| `createForm` | Low-level reactive validation, touched fields and transport-independent submission. |
| `createFormSession` | Immutable draft and baseline, revision, issues, single-flight submission and retry intent. |
| `attachForm` | Native control binding, input/change/reset/submit events, error descriptions and focus. |
| `formActionTransport` | Call an existing KetJS function with the submission's idempotency key. |

## Manage browser form state

`createForm()` adds reactive lifecycle state without owning markup or submission transport:

This excerpt imports `signupForm` from [Define one schema](/docs/form-validation/#define-one-schema);
`emailInput` is the native control owned by the editor's mounted runtime.

```ts
// File: src/modules/example/client/signup-form.ts
import { createForm } from '@ketvietlab/ketjs-view'
import { signupForm } from '../forms.ts'

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
and does not accept a new baseline automatically. Use the transactional form session in the next
section for edit commands, single-flight submission, revision conflicts, and retry after an uncertain result.

The controller does not intercept DOM events and does not replace native attributes such as `required`,
`min`, or `aria-invalid`. UI packages remain responsible for markup and accessibility.

## Transactional edit forms

Use `createFormSession()` when editing must retain a draft until a durable save outcome is known.
`defineFormContract()` supplies the shared declaration; `defineFormAction()` supplies the server
command. The browser uses the existing `/_ket/fn/<name>` endpoint and its authentication, permissions
and tenant scope. See [the server action guide](/docs/form-actions/) for registration and commit rules.

The example below imports `VariantDraft` and `variantForm` from
[Declare nested values explicitly](/docs/form-validation/#declare-nested-values-explicitly), and calls
`catalog.saveVariants` from [the server example](/docs/form-actions/#commit-the-command-and-its-receipt-together).

The motivating case is an attributes-and-variants editor: nested rows, stable client identities,
decimal text, archive rather than delete, and a full replacement submitted in one command. A general
product form, image upload, and creation of a shared attribute are separate save scopes even when
they appear on the same page. A successful save resets only its own scope.

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

Attach effects only in `mount({ root, lifetime })`; pass `lifetime` as `options.signal` and dispose
the session through the controller's `dispose()` or the aborting lifetime. Return an island controller with `view` and `mount`, not a cleanup function
from `mount`. Server props contain only serializable initial values, IDs, revision and labels; transport
functions and callbacks are constructed in the browser module.

For an application-owned action/method route and no-JavaScript fallback, follow
[Native routes and fallback](/docs/form-actions/#native-routes-and-fallback).


## Mount a native form

Create the shared declaration in a browser-safe module:

```ts
// File: src/modules/profile/contact-form.ts
import { defineFormContract } from '@ketvietlab/ketjs-view'

export const contactForm = defineFormContract<{ email: string }>('profile.contact.v1', {
  fields: { email: { type: 'text', required: true, trim: true } },
})
```

The island factory creates state for one editor. Its view only reads state; `mount` attaches DOM
behavior after hydration. Register `profile.saveContact` as a server action using `contactForm`,
and pass serializable initial values, revision and translated labels from the server.
The example maps messages for a rule without interpolation parameters; a production formatter also
translates `issue.params` when a rule supplies them.

```tsx
// File: src/modules/profile/client/contact-editor.tsx
import {
  attachForm, computed, createFormSession, formActionTransport,
  type IslandFactory,
} from '@ketvietlab/ketjs-view'
import { contactForm } from '../contact-form.ts'

type ContactProps = {
  recordId: string
  revision: string
  initial: { email: string }
  labels: Record<'email' | 'save' | 'reset' | 'retry' | 'unknown' | 'validation', string>
  messages: Record<string, string>
}

export const contactEditor: IslandFactory<ContactProps> = (props) => {
  const session = createFormSession(contactForm, {
    recordId: props.recordId,
    revision: props.revision,
    initial: props.initial,
    transport: formActionTransport('profile.saveContact'),
  })
  const email = computed(() => session.values().email)

  return {
    view: () => (
      <section>
        <form data-contact-form novalidate>
          <label for="contact-email">{props.labels.email}</label>
          <input id="contact-email" name="email" type="text" required value={email()} />
          <p id="contact-email-error" data-form-error="email" />
          <p data-form-summary role="alert" />
          <button type="submit">{props.labels.save}</button>
          <button type="reset">{props.labels.reset}</button>
        </form>
        <button
          type="button"
          disabled={session.status() !== 'unknown'}
          onClick={() => { void session.retry() }}
        >
          {props.labels.retry}
        </button>
        <output role="status">
          {session.status() === 'unknown' ? props.labels.unknown : ''}
        </output>
      </section>
    ),
    mount({ root, lifetime }) {
      const [form] = root.querySelectorAll('form[data-contact-form]')
      if (!(form instanceof HTMLFormElement)) throw new Error('Contact editor form is missing')
      attachForm(form, session, {
        signal: lifetime,
        formatIssue: (issue) => props.messages[issue.messageKey] ?? props.labels.validation,
      })
    },
    dispose() {
      email.dispose()
      session.dispose()
    },
  }
}
```

This example needs JavaScript for editing and submission; it does not declare a native action route.
Its Retry control sits outside the form because the adapter locks ordinary form controls while an
outcome is unknown. `novalidate` sends validation feedback through the shared schema and adapter;
the sample schema checks required text and trimming, not email-address syntax.
If multiple editors can coexist, derive control and error IDs from a stable instance key rather than
reusing the sample IDs. Register the factory with the module's island declaration as described in
[Interactive islands](/docs/rendering/#interactive-islands).

The returned `attachForm` disposer can detach the adapter early. Aborting the island lifetime also
detaches it; the controller's `dispose` then releases its session and selector. Detaching only the
adapter does not dispose the session. Do not bind a second submit handler to the same scope.

For a nested/custom editor, pass `read`, `write` and `control` to `attachForm`. Dotted native names do
not reconstruct an arbitrary nested object. Keep arrays and dictionaries in the session, replace a
changed top-level collection through `session.set`, and resolve issues with their stable paths.
Do not mutate `session.values()` or rebuild row identity from the current array index.

## Render subscriptions and cost

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
`set()` copies the draft and validation traverses the whole schema. Dirty comparison caches the
baseline's validation result until `reset(next)`, an accepted `receive(next)`, a committed receipt
or a tracked rule dependency changes it. Cross-field draft constraints still run on every edit.
The native adapter snapshots current controls once per update and resolves each issue once through
the custom resolver or an index of the first native control with its name. It groups errors by field
and guards native property, attribute and text writes. This removes repeated control-list searches
and unchanged DOM writes, while still visiting all controls and error targets. Structured editors
continue to supply their own reader/writer and may use an indexed `control(issue)` callback.

The [browser form benchmark](/docs/benchmarks/#browser-form-sessions) compares the current session
and adapter with RHF and Formik using shared validation and isolated field views. At revision
`756efdf9`, the earlier default lookup took **64.05 ms median** for one invalid field in a 500-field
form; the indexed adapter at `d7af51c5` takes **2.35 ms median / 3.00 ms p95** with the same harness
and recorded desktop environment. The guide retains both revisions for comparison. Neither the fixture
nor render isolation constitutes a KetSuite editor, paint/INP or mobile performance sign-off.

## Migrate a complex editor

Keep its existing layout and domain command. Move pure normalization and cross-field checks into the
shared contract; replace its hand-written draft/submitting/issues lifecycle with a form session. Add
the revision guard to every writer, then adopt `defineFormAction` and verify lost-response retry,
refusal after a write, malformed replacement arrays, foreign IDs and concurrent editors. Translate
legacy domain issues to `ValidationIssue` without dropping `messageKey` or multiple field errors.
Only then replace a client-side multi-command save with a server command when the product promises
one atomic save. Framework changes must be released and adopted by version before a KetSuite consumer
can use these exports; this guide does not imply that existing KetSuite forms have already migrated.
