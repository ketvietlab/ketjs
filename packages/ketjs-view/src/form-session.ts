import { batch, computed, signal } from './signal.ts'
import { validateForm, validationIssue } from './form.ts'
import type { FormPath, FormSchema, FormValues, ReadonlySignal, ValidationIssue } from './form.ts'

export type FormContract<T extends FormValues = FormValues> = { id: string; schema: FormSchema<T> }

/** Import the same declaration on the server and in the island; never serialize callbacks. */
export const defineFormContract = <T extends FormValues>(
  id: string,
  schema: FormSchema<T>,
): FormContract<T> => {
  if (!id.trim()) throw new TypeError('a form contract needs an id')
  return { id, schema: { ...schema, unknown: schema.unknown ?? 'reject' } }
}

export type FormSubmission<T extends FormValues = FormValues> = {
  contractId: string
  recordId: string
  expectedRevision: string | null
  mutationId: string
  values: T
}

export type FormOutcome<T extends FormValues = FormValues, R = unknown> =
  | { status: 'committed'; accepted: T; revision: string; value: R }
  | { status: 'invalid'; issues: readonly ValidationIssue[] }
  | { status: 'conflict'; issues: readonly ValidationIssue[] }

export type FormAttempt<T extends FormValues = FormValues, R = unknown> =
  | FormOutcome<T, R>
  | { status: 'unknown' }

export type FormTransport<T extends FormValues, R = unknown> = (
  submission: Readonly<FormSubmission<T>>,
  signal: AbortSignal,
) => Promise<FormOutcome<T, R>>

// A session owns JSON values, never Files, DOM nodes, or mutable application objects.
const copy = <T>(value: T): T => {
  const cloned = structuredClone(value)
  const freeze = (held: unknown): void => {
    if (!held || typeof held !== 'object' || Object.isFrozen(held)) return
    Object.freeze(held)
    for (const child of Object.values(held)) freeze(child)
  }
  freeze(cloned)
  return cloned
}

const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
    return false
  const left = Object.entries(a)
  const right = b as Record<string, unknown>
  return (
    left.length === Object.keys(b).length &&
    left.every(([key, value]) => Object.hasOwn(right, key) && equal(value, right[key]))
  )
}

const readonlySignal = <T>(state: ReadonlySignal<T>): ReadonlySignal<T> =>
  Object.assign(() => state(), { peek: () => state.peek() })

export function createFormSession<T extends FormValues, R = unknown>(
  contract: FormContract<T>,
  options: {
    recordId: string
    revision: string | null
    initial: T
    transport: FormTransport<T, R>
    mutationId?: () => string
  },
) {
  const values = signal<Readonly<T>>(copy(options.initial))
  const baseline = signal<Readonly<T>>(copy(options.initial))
  const revision = signal(options.revision)
  const status = signal<'idle' | 'submitting' | 'invalid' | 'conflict' | 'unknown' | 'committed'>('idle')
  const submitted = signal(false)
  const touched = signal<readonly string[]>([])
  const serverIssues = signal<readonly ValidationIssue[]>([])
  const validation = computed(() => {
    const result = validateForm(contract.schema, values())
    result.issues = result.issues.map((issue) => ({
      ...issue,
      ...(issue.field && !issue.path ? { path: formIssuePath(contract, values(), issue.field) } : {}),
    }))
    return result
  })
  const issues = computed(() => [...validation().issues, ...serverIssues()])
  const dirty = computed(() => {
    const current = validation()
    const initial = validateForm(contract.schema, baseline())
    return !equal(current.valid ? current.values : values(), initial.valid ? initial.values : baseline())
  })
  const locked = computed(() => status() === 'submitting' || status() === 'unknown')
  let pending: Promise<FormAttempt<T, R>> | null = null
  let attempt: Readonly<FormSubmission<T>> | null = null
  let request: AbortController | null = null
  let disposed = false
  const canEdit = () => !disposed && !locked()
  const reset = (next?: { values: T; revision: string | null }): boolean => {
    if (!canEdit()) return false
    batch(() => {
      if (next) {
        baseline.set(copy(next.values))
        revision.set(next.revision)
      }
      values.set(copy(baseline()))
      serverIssues.set([])
      touched.set([])
      submitted.set(false)
      status.set('idle')
      attempt = null
    })
    return true
  }
  const submit = (): Promise<FormAttempt<T, R>> => {
    if (pending) return pending
    if (disposed) return Promise.reject(new Error('form session is disposed'))
    submitted.set(true)
    if (!attempt) {
      const checked = validation()
      if (!checked.valid) {
        status.set('invalid')
        return Promise.resolve({ status: 'invalid', issues: checked.issues })
      }
      attempt = copy({
        contractId: contract.id,
        recordId: options.recordId,
        expectedRevision: revision(),
        mutationId: options.mutationId?.() ?? globalThis.crypto.randomUUID(),
        values: checked.values,
      })
    }
    const snapshot = attempt
    request = new AbortController()
    const signal = request.signal
    status.set('submitting')
    serverIssues.set([])
    // Defer the transport until pending has been assigned, including synchronous transports.
    pending = Promise.resolve().then(async (): Promise<FormAttempt<T, R>> => {
      try {
        const outcome = await options.transport(snapshot, signal)
        if (disposed) return { status: 'unknown' }
        if (outcome.status === 'committed') {
          const accepted = validateForm(contract.schema, outcome.accepted)
          if (!accepted.valid || typeof outcome.revision !== 'string' || !outcome.revision)
            throw new Error('invalid form receipt')
          batch(() => {
            baseline.set(copy(accepted.values))
            values.set(copy(accepted.values))
            revision.set(outcome.revision)
            touched.set([])
            status.set('committed')
            attempt = null
          })
        } else if (outcome.status === 'invalid' || outcome.status === 'conflict') {
          if (
            !Array.isArray(outcome.issues) ||
            !outcome.issues.every(
              (issue) =>
                issue &&
                (issue.field === null || typeof issue.field === 'string') &&
                typeof issue.code === 'string' &&
                typeof issue.messageKey === 'string' &&
                issue.params &&
                typeof issue.params === 'object',
            )
          )
            throw new Error('invalid form issues')
          batch(() => {
            serverIssues.set(copy(outcome.issues))
            status.set(outcome.status)
            attempt = null
          })
        } else throw new Error('unknown form outcome')
        return outcome
      } catch {
        // The write may have committed. Keep this exact intent and prohibit edits until resolved.
        if (!disposed) status.set('unknown')
        return { status: 'unknown' }
      } finally {
        pending = null
        request = null
      }
    })
    return pending
  }
  return {
    contract,
    values: readonlySignal(values),
    revision: readonlySignal(revision),
    status: readonlySignal(status),
    submitted: readonlySignal(submitted),
    touched: readonlySignal(touched),
    issues: readonlySignal(issues),
    dirty: readonlySignal(dirty),
    locked: readonlySignal(locked),
    valid: () => issues().length === 0,
    set(field: Extract<keyof T, string>, value: unknown): boolean {
      if (!canEdit()) return false
      if (equal(values()[field], value)) return true
      batch(() => {
        values.set(copy({ ...values(), [field]: value } as T))
        serverIssues.set(
          serverIssues().filter(
            (issue) => issue.field !== null && issue.field !== field && !issue.field.startsWith(`${field}.`),
          ),
        )
        status.set('idle')
      })
      return true
    },
    touch(field: string) {
      if (!touched().includes(field)) touched.set([...touched(), field])
    },
    errors(field: string | FormPath, visibleOnly = true): readonly ValidationIssue[] {
      const name = typeof field === 'string' ? field : JSON.stringify(field)
      if (visibleOnly && !submitted() && !touched().includes(name)) return []
      return issues().filter((issue) =>
        typeof field === 'string' ? issue.field === field : equal(issue.path, field),
      )
    },
    /** Refresh only a pristine, settled scope. A dirty editor keeps its draft and revision. */
    receive(next: { values: T; revision: string | null }): boolean {
      return !dirty() && reset(next)
    },
    reset,
    submit,
    retry: submit,
    dispose() {
      disposed = true
      request?.abort()
      validation.dispose()
      issues.dispose()
      dirty.dispose()
      locked.dispose()
    },
  }
}

export type FormSession<T extends FormValues = FormValues, R = unknown> = ReturnType<
  typeof createFormSession<T, R>
>

/** The existing function transport owns authentication, permissions and tenant scope. */
export const formActionTransport =
  <T extends FormValues, R = unknown>(
    fn: string,
    options: {
      fetch?: typeof globalThis.fetch
    } = {},
  ): FormTransport<T, R> =>
  async (submission, signal) => {
    const { mutationId, ...input } = submission
    const response = await (options.fetch ?? globalThis.fetch)(`/_ket/fn/${encodeURIComponent(fn)}`, {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'content-type': 'application/json', 'idempotency-key': mutationId },
      body: JSON.stringify(input),
    })
    const body = (await response.json()) as {
      ok?: boolean
      value?: FormOutcome<T, R>
      issues?: ValidationIssue[]
      error?: { issues?: ValidationIssue[] }
    }
    if (response.ok && body.ok === true && body.value) return body.value
    const issues = body.error?.issues ?? body.issues
    if (response.status === 422 && Array.isArray(issues)) return { status: 'invalid', issues }
    // Authentication, unavailable endpoints and malformed responses must not reset the draft.
    throw new Error(`form transport refused (${response.status})`)
  }

/** Convert indexed server issues using the submitted snapshot, never the live row order. */
export const formIssuePath = <T extends FormValues>(
  contract: FormContract<T>,
  snapshot: FormValues,
  field: string,
): FormPath => {
  const parts = field.split('.')
  const path: (string | number | { key: string })[] = []
  let rule: import('./form.ts').FormFieldRule = { type: 'object', fields: contract.schema.fields }
  let value: unknown = snapshot
  for (const part of parts) {
    if (rule.type === 'array' && /^\d+$/.test(part)) {
      const index = Number(part)
      value = Array.isArray(value) ? value[index] : undefined
      const key = rule.key && value && typeof value === 'object' ? (value as FormValues)[rule.key] : undefined
      path.push(typeof key === 'string' ? { key } : index)
      rule = rule.items ?? {}
    } else {
      path.push(part)
      value = value && typeof value === 'object' ? (value as FormValues)[part] : undefined
      rule = rule.type === 'record' ? (rule.entries ?? {}) : (rule.fields?.[part] ?? {})
    }
  }
  return path
}

export const formConflict = (field: string | null = null): Extract<FormOutcome, { status: 'conflict' }> => ({
  status: 'conflict',
  issues: [validationIssue(field, 'conflict', 'validation.conflict')],
})
