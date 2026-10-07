// File: src/islands/signup.tsx
import { signal, defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'

export default function Signup(_props: Record<string, unknown>) {
  const schema = defineFormSchema({
    fields: { email: { type: 'text', required: true, trim: true, pattern: /^[^@]+@[^@]+$/ } },
    unknown: 'reject',
  })
  const message = signal('Enter an email address.')
  return () => (
    <form
      onSubmit={(event: Event) => {
        event.preventDefault()
        const form = event.currentTarget as HTMLFormElement
        const result = validateForm(schema, { email: new FormData(form).get('email') })
        message.set(
          result.valid ? 'Valid input. The server must validate it again.' : 'Please enter a valid email.',
        )
      }}
    >
      <h1>Validate a form</h1>
      <label for="email">Email</label>
      <input id="email" name="email" type="text" />
      <button type="submit">Check input</button>
      <p role="status">{message()}</p>
    </form>
  )
}
