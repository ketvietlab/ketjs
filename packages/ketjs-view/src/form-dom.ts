import { batch, effect } from './signal.ts'
import { valuesFromFormData } from './form.ts'
import type { FormValues, ValidationIssue } from './form.ts'
import type { FormAttempt, FormSession } from './form-session.ts'

/** Native controls are an adapter, not the source of truth for custom editors. */
export function attachForm<T extends FormValues, R>(
  form: HTMLFormElement,
  session: FormSession<T, R>,
  options: {
    signal?: AbortSignal
    read?: (form: HTMLFormElement, submitter: HTMLElement | null) => FormValues
    write?: (form: HTMLFormElement, values: Readonly<T>) => void
    control?: (issue: ValidationIssue) => HTMLElement | null
    formatIssue: (issue: ValidationIssue) => string
    onOutcome?: (outcome: FormAttempt<T, R>) => void
  },
): () => void {
  const lifetime = new AbortController()
  const original = new Map<
    Element,
    { disabled?: boolean; invalid: string | null; described: string | null }
  >()
  const busy = form.getAttribute('aria-busy')
  let disposed = false
  const controls = () =>
    Array.from(form.elements).filter(
      (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLButtonElement,
    )
  const resolve = (issue: ValidationIssue) =>
    options.control?.(issue) ?? controls().find((element) => element.name === issue.field) ?? null
  const read = (submitter: HTMLElement | null): FormValues => {
    if (options.read) return options.read(form, submitter)
    const raw = valuesFromFormData(
      new FormData(
        form,
        submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
          ? submitter
          : undefined,
      ),
    )
    for (const element of controls()) {
      if (!element.name || element.matches(':disabled')) continue
      const rule = session.contract.schema.fields[element.name]
      if (!rule) continue
      if (
        rule.type === 'bool' &&
        !rule.multiple &&
        element instanceof HTMLInputElement &&
        element.type === 'checkbox'
      )
        raw[element.name] = element.checked
      if (rule.multiple || rule.type === 'array')
        raw[element.name] = Object.hasOwn(raw, element.name)
          ? Array.isArray(raw[element.name])
            ? raw[element.name]
            : [raw[element.name]]
          : []
    }
    return raw
  }
  const capture = (submitter: HTMLElement | null) => {
    if (session.locked()) return
    const raw = read(submitter)
    batch(() => {
      for (const [name, value] of Object.entries(raw)) {
        if (Object.hasOwn(session.contract.schema.fields, name))
          session.set(name as Extract<keyof T, string>, value)
      }
    })
  }
  const stop = effect(() => {
    const locked = session.locked()
    const issues = session.issues()
    const submitted = session.submitted()
    const touched = session.touched()
    const values = session.values()
    form.setAttribute('aria-busy', session.status() === 'submitting' ? 'true' : 'false')
    for (const element of controls()) {
      if (!original.has(element))
        original.set(element, {
          disabled: element.disabled,
          invalid: element.getAttribute('aria-invalid'),
          described: element.getAttribute('aria-describedby'),
        })
      const submit =
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.type === 'submit'
      element.disabled =
        (submit ? session.status() === 'submitting' : locked) || original.get(element)!.disabled === true
      if (!options.write && Object.hasOwn(session.contract.schema.fields, element.name)) {
        const value = values[element.name]
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio'))
          element.checked = Array.isArray(value)
            ? value.includes(element.value)
            : typeof value === 'boolean'
              ? value
              : value === element.value
        else if (element instanceof HTMLSelectElement && element.multiple)
          for (const option of element.options)
            option.selected = Array.isArray(value) && value.includes(option.value)
        else if (!(element instanceof HTMLInputElement && element.type === 'file'))
          element.value = value == null ? '' : String(value)
      }
      const held = issues.filter(
        (issue) => resolve(issue) === element && (submitted || touched.includes(element.name)),
      )
      if (held.length) element.setAttribute('aria-invalid', 'true')
      else if (original.get(element)!.invalid === null) element.removeAttribute('aria-invalid')
      else element.setAttribute('aria-invalid', original.get(element)!.invalid!)
    }
    for (const target of form.querySelectorAll<HTMLElement>('[data-form-error]')) {
      const field = target.dataset.formError ?? ''
      const held = issues.filter((issue) => issue.field === field && (submitted || touched.includes(field)))
      target.textContent = held.map(options.formatIssue).join(' ')
      if (target.id) {
        const control = controls().find((element) => element.name === field)
        if (control) {
          const described = new Set((original.get(control)?.described ?? '').split(/\s+/).filter(Boolean))
          if (held.length) described.add(target.id)
          if (described.size) control.setAttribute('aria-describedby', [...described].join(' '))
          else control.removeAttribute('aria-describedby')
        }
      }
    }
    const summary = form.querySelector<HTMLElement>('[data-form-summary]')
    if (summary) summary.textContent = submitted ? issues.map(options.formatIssue).join(' ') : ''
    options.write?.(form, values)
  })
  form.addEventListener('input', () => capture(null), { signal: lifetime.signal })
  form.addEventListener('change', () => capture(null), { signal: lifetime.signal })
  form.addEventListener(
    'focusout',
    (event) => {
      const element = event.target as HTMLInputElement | null
      if (element?.name) session.touch(element.name)
    },
    { signal: lifetime.signal },
  )
  form.addEventListener(
    'reset',
    (event) => {
      event.preventDefault()
      session.reset()
    },
    { signal: lifetime.signal },
  )
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
      // The parent record controller must not submit this scope a second time.
      event.stopPropagation()
      capture(event.submitter)
      void session.submit().then((outcome) => {
        if (disposed) return
        if (outcome.status === 'invalid' || outcome.status === 'conflict') {
          for (const issue of outcome.issues) {
            const target = resolve(issue)
            if (target) {
              target.focus()
              break
            }
          }
        }
        options.onOutcome?.(outcome)
      })
    },
    { signal: lifetime.signal },
  )
  const dispose = () => {
    if (disposed) return
    disposed = true
    lifetime.abort()
    stop()
    for (const [element, state] of original) {
      if ('disabled' in element) (element as HTMLInputElement).disabled = state.disabled ?? false
      for (const [name, value] of [
        ['aria-invalid', state.invalid],
        ['aria-describedby', state.described],
      ] as const) {
        if (value === null) element.removeAttribute(name)
        else element.setAttribute(name, value)
      }
    }
    if (busy === null) form.removeAttribute('aria-busy')
    else form.setAttribute('aria-busy', busy)
    options.signal?.removeEventListener('abort', dispose)
  }
  if (options.signal?.aborted) dispose()
  else options.signal?.addEventListener('abort', dispose, { once: true })
  return dispose
}
