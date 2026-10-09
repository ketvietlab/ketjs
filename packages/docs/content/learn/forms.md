---
title: "Validate a form with a shared schema"
description: "Cast and validate form values, present useful errors, and retain the server validation boundary."
stage: "Build the frontend"
duration: 30
lab: "Browser playground"
order: 6
---

Before you start: complete [Grow the counter into a todo list](/learn/todo/), or make sure you can pass its checkpoint.

## Try the validation preset

Select **Form · shared validation** in the [playground](/playground/). Submit an empty email, an invalid string, and then `learner@example.com`. The live status should explain the result without reloading the page.

The reference island uses a schema that is safe to share between browser and server:

```tsx
// File: learn-view/src/islands/validation.tsx
import { signal, defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'

export default function Signup(_props: Record<string, unknown>) {
  const schema = defineFormSchema({ fields: { email: { type: 'text', required: true, trim: true, pattern: /^[^@]+@[^@]+$/ } }, unknown: 'reject' })
  const message = signal('Enter an email address.')
  return () => <form onSubmit={(event: Event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const result = validateForm(schema, { email: new FormData(form).get('email') })
    message.set(result.valid ? 'Valid input. The server must validate it again.' : 'Please enter a valid email.')
  }}>
    <h1>Validate a form</h1>
    <label for="email">Email</label>
    <input id="email" name="email" type="text" />
    <button type="submit">Check input</button>
    <p role="status">{message()}</p>
  </form>
}
```

## Read the schema as a contract

`required` rejects an absent value. `trim` normalizes surrounding spaces. `pattern` applies a small exercise-specific check; this example is not a complete email deliverability validator. `unknown: 'reject'` makes unexpected fields visible instead of silently accepting them.

A native form sends strings, repeated values, and missing controls. Use the schema to normalize those inputs before consuming them. For a larger form, `valuesFromFormData()` preserves repeated names, and `validateForm()` exposes field errors and form errors separately.

## Preserve useful browser behavior

The submit handler prevents navigation only after the browser enhancement owns the flow. Labels remain associated with controls. A status region announces feedback. Keep the user's input after an error so they can correct it.

For a production form with a server action, retain a native action/method fallback and validate again in the server boundary. A user can call the endpoint directly or modify the page; browser validation is assistance, not permission to write data.

## Add a second field

Add a display name with a maximum length. Put the error beside its input rather than returning only a generic failure. When moving the schema into a shared file, import its browser-safe contract from ketjs-view and avoid importing backend modules into the browser bundle.

## Checkpoint

Invalid input stays on screen, valid input produces normalized values, and you can explain why the server still needs validation.

## Practice on your own

Add a confirmation field and a cross-field check. Verify that correcting one field clears the corresponding error without clearing unrelated draft values.

## Reference

For the complete API contract, read [Form Validation](/docs/form-validation/).

When the exercise becomes an editable record with nested rows and server writes, continue with
[Transactional edit forms](/docs/form-validation/#transactional-edit-forms). Use a form session to
retain a draft after refusal, share one in-flight submit, and retry an uncertain result with the same
intent. A resolved Fetch promise alone does not prove that the record was saved.
