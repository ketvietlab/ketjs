// Changesets: casting and validation are separate from persistence.
//
// A changeset is a value. You can build one, inspect it and test it with no
// database anywhere in sight, and only then hand it to ctx to be written. Three
// things make this worth having here rather than being Ecto cosplay:
//
//   1. Casting rules come from the manifest, so field types are declared once.
//   2. Errors are structured data, which is what an agent needs — an exception
//      gives it a string it cannot act on.
//   3. `changes` is a real diff against the existing row, which is exactly what
//      dry-run wants to report.

import { KetError } from '../kernel/errors.ts'
import type { Manifest, Row, FieldBase } from '../types.ts'

export type FieldError = { field: string; message: string }
export type Validator = (value: unknown, changes: Row) => true | string

const PLAIN_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * A finite number as plain decimal text.
 *
 * `String(1e-7)` is `"1e-7"` and `String(1e21)` is `"1e+21"` — literals the decimal
 * contract refuses on the way in, so writing them out would make the round trip
 * exact in one direction only. The exponent is expanded here instead.
 */
export const decimalText = (v: number | string): string => {
  const s = String(v).trim()
  if (PLAIN_DECIMAL.test(s)) return s
  const m = /^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s)
  if (!m) return s
  const sign = m[1] ?? ''
  const digits = (m[2] as string) + (m[3] ?? '')
  const point = (m[2] as string).length + Number(m[4])
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

const castValue = (
  base: FieldBase,
  v: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } => {
  if (v === null) return { ok: true, value: null }
  switch (base) {
    case 'id':
    case 'text':
    case 'ref':
      return typeof v === 'string'
        ? { ok: true, value: v }
        : typeof v === 'number'
          ? { ok: true, value: String(v) }
          : { ok: false, message: `expected text, got ${typeof v}` }
    case 'int': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
      if (typeof n !== 'number' || !Number.isFinite(n))
        return { ok: false, message: `expected an integer, got ${JSON.stringify(v)}` }
      if (!Number.isInteger(n)) return { ok: false, message: `expected an integer, got ${n}` }
      return { ok: true, value: n }
    }
    case 'decimal': {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return { ok: false, message: `expected a decimal, got ${JSON.stringify(v)}` }
        return { ok: true, value: decimalText(v) }
      }
      if (typeof v !== 'string' || !PLAIN_DECIMAL.test(v.trim())) {
        return { ok: false, message: `expected a decimal string, got ${JSON.stringify(v)}` }
      }
      return { ok: true, value: v.trim().replace(/^\+/, '') }
    }
    case 'float': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
      if (typeof n !== 'number' || !Number.isFinite(n))
        return { ok: false, message: `expected a number, got ${JSON.stringify(v)}` }
      return { ok: true, value: n }
    }
    case 'bool':
      if (typeof v === 'boolean') return { ok: true, value: v }
      if (v === 1 || v === 0) return { ok: true, value: v === 1 }
      if (v === 'true' || v === 'false') return { ok: true, value: v === 'true' }
      return { ok: false, message: `expected a boolean, got ${JSON.stringify(v)}` }
    case 'datetime':
      if (v instanceof Date) return { ok: true, value: v.toISOString() }
      if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return { ok: true, value: v }
      return { ok: false, message: `expected a date, got ${JSON.stringify(v)}` }
    case 'json':
      return typeof v === 'object'
        ? { ok: true, value: v }
        : { ok: false, message: `expected an object, got ${typeof v}` }
  }
}

export class Changeset {
  readonly manifest: Manifest
  readonly model: string
  readonly params: Row
  readonly base: Row | null
  readonly changes: Row
  readonly errors: FieldError[]
  readonly casted: string[]

  constructor(
    manifest: Manifest,
    model: string,
    params: Row,
    base: Row | null = null,
    changes: Row = {},
    errors: FieldError[] = [],
    casted: string[] = [],
  ) {
    if (!manifest.models[model]) {
      throw new KetError({
        code: 'E_UNKNOWN_MODEL',
        message: `no model "${model}"`,
        hint: `known models: ${Object.keys(manifest.models).join(', ')}`,
      })
    }
    this.manifest = manifest
    this.model = model
    this.params = params
    this.base = base
    this.changes = changes
    this.errors = errors
    this.casted = casted
    Object.freeze(this)
  }

  private next(patch: { changes?: Row; errors?: FieldError[]; casted?: string[] }): Changeset {
    return new Changeset(
      this.manifest,
      this.model,
      this.params,
      this.base,
      patch.changes ?? this.changes,
      patch.errors ?? this.errors,
      patch.casted ?? this.casted,
    )
  }

  /**
   * Only the fields named here are allowed through. Anything else in `params` is
   * dropped — that is the mass-assignment protection, and it is the reason casting
   * is an explicit list rather than a filter you can forget to write.
   */
  cast(fields: string[]): Changeset {
    const model = this.manifest.models[this.model]!
    const changes: Row = { ...this.changes }
    const errors = [...this.errors]

    for (const f of fields) {
      const def = model.fields[f]
      if (!def) {
        errors.push({
          field: f,
          message: `no such field on ${this.model} (have: ${Object.keys(model.fields).join(', ')})`,
        })
        continue
      }
      if (!(f in this.params)) continue
      const cast = castValue(def.base, this.params[f])
      if (!cast.ok) {
        errors.push({ field: f, message: cast.message })
        continue
      }
      // Only a real difference from the existing row counts as a change.
      if (this.base && Object.is(this.base[f], cast.value)) continue
      changes[f] = cast.value
    }
    return this.next({ changes, errors, casted: [...new Set([...this.casted, ...fields])] })
  }

  required(fields: string[]): Changeset {
    const errors = [...this.errors]
    for (const f of fields) {
      const present = f in this.changes ? this.changes[f] : this.base?.[f]
      if (present == null || present === '') errors.push({ field: f, message: 'is required' })
    }
    return this.next({ errors })
  }

  validate(field: string, fn: Validator): Changeset {
    if (!(field in this.changes)) return this
    const verdict = fn(this.changes[field], this.changes)
    return verdict === true ? this : this.next({ errors: [...this.errors, { field, message: verdict }] })
  }

  /** Force a value regardless of params — for server-set fields the client must not control. */
  put(field: string, value: unknown): Changeset {
    const def = this.manifest.models[this.model]!.fields[field]
    if (!def)
      return this.next({ errors: [...this.errors, { field, message: `no such field on ${this.model}` }] })
    const cast = castValue(def.base, value)
    if (!cast.ok) return this.next({ errors: [...this.errors, { field, message: cast.message }] })
    return this.next({ changes: { ...this.changes, [field]: cast.value } })
  }

  get valid(): boolean {
    return this.errors.length === 0
  }
  get action(): 'insert' | 'update' {
    return this.base ? 'update' : 'insert'
  }
  /** Fields present in params but never cast — dropped on purpose, reported for debugging. */
  get dropped(): string[] {
    return Object.keys(this.params).filter((k) => !this.casted.includes(k))
  }

  toJSON() {
    return {
      model: this.model,
      action: this.action,
      valid: this.valid,
      changes: this.changes,
      errors: this.errors,
      dropped: this.dropped,
    }
  }
}

export const changeset = (
  manifest: Manifest,
  model: string,
  params: Row,
  base: Row | null = null,
): Changeset => new Changeset(manifest, model, params, base)
