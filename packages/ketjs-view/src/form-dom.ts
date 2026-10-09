import { batch, effect } from './signal.ts'
import { valuesFromFormData } from './form.ts'
import type { FormValues, ValidationIssue } from './form.ts'
import type { FormAttempt, FormSession } from './form-session.ts'

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement

const attribute = (element: Element, name: string, value: string | null) => {
  if (element.getAttribute(name) === value) return
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

const indexControls = (elements: Control[]) => {
  const index = new Map<string, Control>()
  for (const element of elements) if (!index.has(element.name)) index.set(element.name, element)
  return index
}

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
      (element): element is Control =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLButtonElement,
    )
  const resolve = (issue: ValidationIssue, index: Map<string, Control>) =>
    options.control?.(issue) ?? (issue.field === null ? null : (index.get(issue.field) ?? null))
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
    const touched = new Set(session.touched())
    const values = session.values()
    // Snapshot current controls once per pass, including dynamically replaced/associated controls.
    const elements = controls()
    const index = indexControls(elements)
    const byControl = new Set<HTMLElement>()
    const byField = new Map<string, ValidationIssue[]>()
    for (const issue of issues) {
      const control = resolve(issue, index)
      if (control) byControl.add(control)
      if (issue.field !== null) {
        const held = byField.get(issue.field) ?? []
        held.push(issue)
        byField.set(issue.field, held)
      }
    }
    const positions = new Map<string, number>()
    const submitting = session.status() === 'submitting'
    attribute(form, 'aria-busy', submitting ? 'true' : 'false')
    for (const element of elements) {
      if (!original.has(element))
        original.set(element, {
          disabled: element.disabled,
          invalid: element.getAttribute('aria-invalid'),
          described: element.getAttribute('aria-describedby'),
        })
      const submit =
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.type === 'submit'
      const disabled = (submit ? submitting : locked) || original.get(element)!.disabled === true
      if (element.disabled !== disabled) element.disabled = disabled
      if (!options.write && Object.hasOwn(session.contract.schema.fields, element.name)) {
        const value = values[element.name]
        if (
          element instanceof HTMLInputElement &&
          (element.type === 'checkbox' || element.type === 'radio')
        ) {
          const checked = Array.isArray(value)
            ? value.includes(element.value)
            : typeof value === 'boolean'
              ? value
              : value === element.value
          if (element.checked !== checked) element.checked = checked
        } else if (element instanceof HTMLSelectElement && element.multiple) {
          for (const option of element.options) {
            const selected = Array.isArray(value) && value.includes(option.value)
            if (option.selected !== selected) option.selected = selected
          }
        } else if (
          !(element instanceof HTMLButtonElement) &&
          !(
            element instanceof HTMLInputElement &&
            ['file', 'submit', 'reset', 'button', 'image'].includes(element.type)
          )
        ) {
          // Repeated scalar controls share a field, but each represents one array entry.
          const position = positions.get(element.name) ?? 0
          const held = Array.isArray(value) ? value[position] : value
          positions.set(element.name, position + 1)
          const next = held == null ? '' : String(held)
          if (element.value !== next) element.value = next
        }
      }
      const invalid = (submitted || touched.has(element.name)) && byControl.has(element)
      attribute(element, 'aria-invalid', invalid ? 'true' : original.get(element)!.invalid)
    }
    const descriptions = new Map<Control, Set<string>>()
    for (const target of form.querySelectorAll<HTMLElement>('[data-form-error]')) {
      const field = target.dataset.formError ?? ''
      const held = submitted || touched.has(field) ? (byField.get(field) ?? []) : []
      const text = held.map(options.formatIssue).join(' ')
      if (target.textContent !== text) target.textContent = text
      if (target.id) {
        const control = index.get(field)
        if (control) {
          const described =
            descriptions.get(control) ??
            new Set((original.get(control)?.described ?? '').split(/\s+/).filter(Boolean))
          if (held.length) described.add(target.id)
          descriptions.set(control, described)
        }
      }
    }
    for (const [control, described] of descriptions)
      attribute(control, 'aria-describedby', described.size ? [...described].join(' ') : null)
    const summary = form.querySelector<HTMLElement>('[data-form-summary]')
    if (summary) {
      const text = submitted ? issues.map(options.formatIssue).join(' ') : ''
      if (summary.textContent !== text) summary.textContent = text
    }
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
          const index = indexControls(controls())
          for (const issue of outcome.issues) {
            const target = resolve(issue, index)
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
      if ('disabled' in element && (element as Control).disabled !== (state.disabled ?? false))
        (element as Control).disabled = state.disabled ?? false
      for (const [name, value] of [
        ['aria-invalid', state.invalid],
        ['aria-describedby', state.described],
      ] as const) {
        attribute(element, name, value)
      }
    }
    attribute(form, 'aria-busy', busy)
    options.signal?.removeEventListener('abort', dispose)
  }
  if (options.signal?.aborted) dispose()
  else options.signal?.addEventListener('abort', dispose, { once: true })
  return dispose
}
