// Form validation is browser-safe and independent of rendering. The same schema
// can therefore validate native FormData in an island and untrusted input on the
// server without shipping a second, subtly different rule set.

import { batch, computed, signal } from './signal.ts'

export type FormValues = Record<string, unknown>
export type FormFieldType =
  | 'text'
  | 'id'
  | 'ref'
  | 'int'
  | 'float'
  | 'decimal'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'json'

export type ValidationIssue = {
  /** Null identifies an error concerning the whole form rather than one control. */
  field: string | null
  code: string
  messageKey: string
  params: Readonly<Record<string, unknown>>
}

export type ValidationIssueInput = Omit<ValidationIssue, 'params'> & {
  params?: Readonly<Record<string, unknown>>
}

export type ValidationVerdict = true | ValidationIssueInput | readonly ValidationIssueInput[]

export type FormFieldRule = {
  type?: FormFieldType
  required?: boolean
  /** Trim text before constraints and before returning normalized values. */
  trim?: boolean
  /** Accept repeated FormData entries and validate each entry with this rule. */
  multiple?: boolean
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  oneOf?: readonly (string | number | boolean)[]
  validate?: (value: unknown, values: Readonly<FormValues>) => ValidationVerdict
}

export type FormSchema<TValues extends FormValues = FormValues> = {
  fields: Record<Extract<keyof TValues, string>, FormFieldRule>
  /** Unknown inputs are dropped by default, matching the changeset allow-list boundary. */
  unknown?: 'drop' | 'reject'
  validate?: (values: Readonly<Partial<TValues>>, raw: Readonly<FormValues>) => ValidationVerdict
}

type FormValidationDetails = {
  issues: ValidationIssue[]
  fieldErrors: Record<string, ValidationIssue[]>
  formErrors: ValidationIssue[]
  dropped: string[]
}

export type FormValidationResult<TValues extends FormValues = FormValues> =
  | ({ valid: true; values: TValues } & FormValidationDetails)
  | ({ valid: false; values: Partial<TValues> } & FormValidationDetails)

export type FormValidationProblem = {
  ok: false
  code: string
  message: string
  issues: ValidationIssue[]
  fieldErrors: Record<string, ValidationIssue[]>
  formErrors: ValidationIssue[]
}

export const validationIssue = (
  field: string | null,
  code: string,
  messageKey = `validation.${code}`,
  params: Readonly<Record<string, unknown>> = {},
): ValidationIssue => ({ field, code, messageKey, params })

const normalizeIssue = (held: ValidationIssueInput): ValidationIssue => ({
  ...held,
  params: held.params ?? {},
})

const issuesOf = (verdict: ValidationVerdict): ValidationIssue[] => {
  if (verdict === true) return []
  return (Array.isArray(verdict) ? verdict : [verdict]).map(normalizeIssue)
}

export const fieldErrorsOf = (issues: readonly ValidationIssue[]): Record<string, ValidationIssue[]> => {
  const grouped = new Map<string, ValidationIssue[]>()
  for (const held of issues) {
    if (held.field === null) continue
    const bucket = grouped.get(held.field) ?? []
    bucket.push(held)
    grouped.set(held.field, bucket)
  }
  return Object.fromEntries(grouped)
}

export const formErrorsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((held) => held.field === null)

export const validationProblem = (
  source: readonly ValidationIssue[] | Pick<FormValidationResult, 'issues'>,
  options: { code?: string; message?: string } = {},
): FormValidationProblem => {
  const sourceIssues = Array.isArray(source)
    ? (source as readonly ValidationIssue[])
    : (source as Pick<FormValidationResult, 'issues'>).issues
  const issues = [...sourceIssues]
  return {
    ok: false,
    code: options.code ?? 'E_FORM_INVALID',
    message: options.message ?? 'form validation failed',
    issues,
    fieldErrors: fieldErrorsOf(issues),
    formErrors: formErrorsOf(issues),
  }
}

/** Preserve repeated controls as arrays instead of silently keeping only the last value. */
export const valuesFromFormData = (entries: Iterable<readonly [string, unknown]>): FormValues => {
  const values = new Map<string, unknown>()
  for (const [name, value] of entries) {
    if (!values.has(name)) {
      values.set(name, value)
      continue
    }
    const previous = values.get(name)
    values.set(name, Array.isArray(previous) ? [...previous, value] : [previous, value])
  }
  return Object.fromEntries(values)
}

export const defineFormSchema = <TValues extends FormValues = FormValues>(
  schema: FormSchema<TValues>,
): FormSchema<TValues> => schema

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const match = DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const held = new Date(Date.UTC(year, month - 1, day))
  return held.getUTCFullYear() === year && held.getUTCMonth() === month - 1 && held.getUTCDate() === day
}

const empty = (value: unknown): boolean => value == null || (typeof value === 'string' && value.trim() === '')

const decimalText = (value: number): string => {
  const source = String(value)
  const match = /^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(source)
  if (!match) return source
  const sign = match[1] ?? ''
  const whole = match[2] as string
  const digits = whole + (match[3] ?? '')
  const point = whole.length + Number(match[4])
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

const cast = (
  type: FormFieldType,
  raw: unknown,
  trim: boolean,
): { ok: true; value: unknown } | { ok: false } => {
  if (type === 'text' || type === 'id' || type === 'ref') {
    if (typeof raw !== 'string') return { ok: false }
    return { ok: true, value: trim ? raw.trim() : raw }
  }
  if (type === 'int') {
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
      ? { ok: true, value }
      : { ok: false }
  }
  if (type === 'float') {
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
    return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false }
  }
  if (type === 'decimal') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return { ok: true, value: decimalText(raw) }
    if (typeof raw !== 'string' || !DECIMAL.test(raw.trim())) return { ok: false }
    return { ok: true, value: raw.trim().replace(/^\+/, '') }
  }
  if (type === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw }
    if (raw === 1 || raw === '1' || raw === 'true' || raw === 'on') return { ok: true, value: true }
    if (raw === 0 || raw === '0' || raw === 'false') return { ok: true, value: false }
    return { ok: false }
  }
  if (type === 'date') return isDate(raw) ? { ok: true, value: raw } : { ok: false }
  if (type === 'datetime') {
    return typeof raw === 'string' && !Number.isNaN(Date.parse(raw))
      ? { ok: true, value: raw }
      : { ok: false }
  }
  if (typeof raw === 'string') {
    try {
      return { ok: true, value: JSON.parse(raw) }
    } catch {
      return { ok: false }
    }
  }
  return raw !== null && typeof raw === 'object' ? { ok: true, value: raw } : { ok: false }
}

const lengthOf = (value: unknown): number | null => {
  if (typeof value === 'string') return [...value].length
  if (Array.isArray(value)) return value.length
  return null
}

const checkValue = (field: string, value: unknown, rule: FormFieldRule, issues: ValidationIssue[]): void => {
  const values = Array.isArray(value) && rule.multiple ? value : [value]
  for (const held of values) {
    const numeric = typeof held === 'number' ? held : rule.type === 'decimal' ? Number(held) : null
    if (numeric !== null && rule.min !== undefined && numeric < rule.min)
      issues.push(validationIssue(field, 'min', 'validation.min', { min: rule.min }))
    if (numeric !== null && rule.max !== undefined && numeric > rule.max)
      issues.push(validationIssue(field, 'max', 'validation.max', { max: rule.max }))
    if (rule.pattern && typeof held === 'string') {
      if (!new RegExp(rule.pattern.source, rule.pattern.flags).test(held))
        issues.push(validationIssue(field, 'pattern', 'validation.pattern', { pattern: rule.pattern.source }))
    }
    if (rule.oneOf && !rule.oneOf.some((choice) => Object.is(choice, held)))
      issues.push(validationIssue(field, 'one_of', 'validation.oneOf', { choices: [...rule.oneOf] }))
  }
  const length = lengthOf(value)
  if (length !== null && rule.minLength !== undefined && length < rule.minLength)
    issues.push(validationIssue(field, 'min_length', 'validation.minLength', { min: rule.minLength }))
  if (length !== null && rule.maxLength !== undefined && length > rule.maxLength)
    issues.push(validationIssue(field, 'max_length', 'validation.maxLength', { max: rule.maxLength }))
}

export function validateForm<TValues extends FormValues = FormValues>(
  schema: FormSchema<TValues>,
  input: Readonly<FormValues>,
): FormValidationResult<TValues> {
  const values: FormValues = {}
  const issues: ValidationIssue[] = []
  const invalid = new Set<string>()
  const fields = Object.keys(schema.fields)
  const dropped = Object.keys(input).filter((field) => !Object.hasOwn(schema.fields, field))

  if (schema.unknown === 'reject')
    for (const field of dropped)
      issues.push(validationIssue(field, 'unknown', 'validation.unknown', { accepted: fields }))

  for (const field of fields) {
    const rule = schema.fields[field]!
    const raw = input[field]
    const rawValues = rule.multiple
      ? (Array.isArray(raw) ? raw : empty(raw) ? [] : [raw]).filter((held) => !empty(held))
      : empty(raw)
        ? []
        : [raw]
    if (!rawValues.length) {
      if (rule.required) {
        issues.push(validationIssue(field, 'required'))
        invalid.add(field)
      }
      continue
    }

    const casted: unknown[] = []
    for (const rawValue of rawValues) {
      const held = cast(rule.type ?? 'text', rawValue, rule.trim === true)
      if (!held.ok) {
        issues.push(
          validationIssue(field, 'type', 'validation.type', {
            expected: rule.type ?? 'text',
            actual: typeof rawValue,
          }),
        )
        invalid.add(field)
        break
      }
      casted.push(held.value)
    }
    if (invalid.has(field)) continue
    const value = rule.multiple ? casted : casted[0]
    values[field] = value
    const before = issues.length
    checkValue(field, value, rule, issues)
    if (issues.length !== before) invalid.add(field)
  }

  for (const field of fields) {
    const rule = schema.fields[field]!
    if (!rule.validate || invalid.has(field) || !Object.hasOwn(values, field)) continue
    const held = issuesOf(rule.validate(values[field], values))
    issues.push(...held.map((item) => (item.field === null ? { ...item, field } : item)))
  }
  if (schema.validate) issues.push(...issuesOf(schema.validate(values as Partial<TValues>, input)))

  const details = {
    issues,
    fieldErrors: fieldErrorsOf(issues),
    formErrors: formErrorsOf(issues),
    dropped,
  }
  return issues.length
    ? { valid: false, values: values as Partial<TValues>, ...details }
    : { valid: true, values: values as TValues, ...details }
}

export type ReadonlySignal<T> = { (): T; peek(): T }

export type FormController<TValues extends FormValues = FormValues> = {
  values: ReadonlySignal<Readonly<Partial<TValues>>>
  issues: ReadonlySignal<readonly ValidationIssue[]>
  touched: ReadonlySignal<readonly string[]>
  submitted: ReadonlySignal<boolean>
  submitting: ReadonlySignal<boolean>
  dirty: ReadonlySignal<boolean>
  valid: ReadonlySignal<boolean>
  set(field: Extract<keyof TValues, string>, value: unknown, options?: { touch?: boolean }): void
  touch(field: Extract<keyof TValues, string>): void
  errors(field: Extract<keyof TValues, string>, visibleOnly?: boolean): ValidationIssue[]
  formErrors(visibleOnly?: boolean): ValidationIssue[]
  validate(): FormValidationResult<TValues>
  applyServerIssues(source: readonly ValidationIssue[] | Pick<FormValidationProblem, 'issues'>): void
  reset(values?: Readonly<FormValues>): void
  submit<TResult>(
    handler: (values: TValues) => TResult | Promise<TResult>,
  ): Promise<{ ok: false; validation: FormValidationResult<TValues> } | { ok: true; value: TResult }>
  dispose(): void
}

const same = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((held, index) => same(held, right[index]))
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    if (left instanceof Date || right instanceof Date)
      return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
    if (Object.getPrototypeOf(left) !== Object.prototype || Object.getPrototypeOf(right) !== Object.prototype)
      return false
    const leftEntries = Object.entries(left as FormValues)
    const rightRecord = right as FormValues
    return (
      leftEntries.length === Object.keys(rightRecord).length &&
      leftEntries.every(([key, held]) => Object.hasOwn(rightRecord, key) && same(held, rightRecord[key]))
    )
  }
  return false
}

export function createForm<TValues extends FormValues = FormValues>(
  schema: FormSchema<TValues>,
  initial: Readonly<FormValues> = {},
): FormController<TValues> {
  let baseline: FormValues = { ...initial }
  const valuesState = signal<Readonly<Partial<TValues>>>({ ...initial } as Partial<TValues>)
  const initialValidation = validateForm(schema, initial)
  const issuesState = signal<readonly ValidationIssue[]>(initialValidation.issues)
  const touchedState = signal<readonly string[]>([])
  const submittedState = signal(false)
  const submittingState = signal(false)
  const dirtyState = computed(() => !same(valuesState(), baseline))
  const validState = computed(() => issuesState().length === 0)

  const validate = (): FormValidationResult<TValues> => {
    const result = validateForm(schema, valuesState() as Readonly<FormValues>)
    issuesState.set(result.issues)
    return result
  }

  return {
    values: valuesState,
    issues: issuesState,
    touched: touchedState,
    submitted: submittedState,
    submitting: submittingState,
    dirty: dirtyState,
    valid: validState,
    set(field, value, options = {}) {
      batch(() => {
        valuesState.set({ ...valuesState.peek(), [field]: value })
        if (options.touch && !touchedState.peek().includes(field))
          touchedState.set([...touchedState.peek(), field])
        validate()
      })
    },
    touch(field) {
      if (!touchedState.peek().includes(field)) touchedState.set([...touchedState.peek(), field])
      validate()
    },
    errors(field, visibleOnly = true) {
      if (visibleOnly && !submittedState.peek() && !touchedState.peek().includes(field)) return []
      return issuesState.peek().filter((held) => held.field === field)
    },
    formErrors(visibleOnly = true) {
      if (visibleOnly && !submittedState.peek()) return []
      return formErrorsOf(issuesState.peek())
    },
    validate,
    applyServerIssues(source) {
      const held = Array.isArray(source)
        ? (source as readonly ValidationIssue[])
        : (source as Pick<FormValidationProblem, 'issues'>).issues
      batch(() => {
        submittedState.set(true)
        issuesState.set(held.map((item) => ({ ...item, params: item.params ?? {} })))
      })
    },
    reset(next) {
      if (next) baseline = { ...next }
      const target = { ...baseline }
      const result = validateForm(schema, target)
      batch(() => {
        valuesState.set(target as Partial<TValues>)
        issuesState.set(result.issues)
        touchedState.set([])
        submittedState.set(false)
        submittingState.set(false)
      })
    },
    async submit(handler) {
      submittedState.set(true)
      const validation = validate()
      if (!validation.valid) return { ok: false, validation }
      submittingState.set(true)
      try {
        return { ok: true, value: await handler(validation.values) }
      } finally {
        submittingState.set(false)
      }
    },
    dispose() {
      dirtyState.dispose()
      validState.dispose()
    },
  }
}
