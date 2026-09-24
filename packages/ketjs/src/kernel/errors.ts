// Errors are data: every failure carries a machine-readable code, the module that
// caused it, and a hint naming the fix. Humans read the message; agents read the JSON.

import type { Diagnostic } from '../types.ts'

export class KetError extends Error {
  code: string
  module: string | null
  hint: string | null
  at: string | null
  items?: Diagnostic[]

  constructor(d: Diagnostic) {
    super(d.message)
    this.name = 'KetError'
    this.code = d.code
    this.module = d.module ?? null
    this.hint = d.hint ?? null
    this.at = d.at ?? null
  }
  toJSON(): Diagnostic {
    return { code: this.code, message: this.message, module: this.module, hint: this.hint, at: this.at }
  }
}

export class Diagnostics {
  items: Diagnostic[] = []
  add(d: Diagnostic): this {
    this.items.push(d)
    return this
  }
  get ok(): boolean {
    return this.items.length === 0
  }
  throwIfAny(): void {
    if (this.ok) return
    const lines = this.items.map(
      (d) =>
        `  [${d.code}] ${d.module ? d.module + ': ' : ''}${d.message}` +
        (d.hint ? `\n      -> ${d.hint}` : ''),
    )
    const err = new KetError({
      code: 'CONTRACT_FAILED',
      message: `${this.items.length} contract violation(s):\n${lines.join('\n')}`,
    })
    err.items = this.items
    throw err
  }
}

/**
 * Codes that mean the application broke its own contract: an undeclared effect,
 * a write to a field or model that does not exist, an output of the wrong shape.
 * The caller did nothing wrong and cannot fix it, and the message names the
 * functions, models and effects inside the deployment, so the response says only
 * that something failed and the detail stays in the server log.
 */
const DEFECT_CODES: ReadonlySet<string> = new Set([
  'E_EFFECT_NOT_DECLARED',
  'E_SCOPE_FIELD_WRITTEN',
  'E_UPDATE_NEEDS_WHERE',
  'E_UNKNOWN_MODEL',
  'E_UNKNOWN_RELATION',
  'E_OUTPUT_NOT_SHAPED',
  'E_OUTPUT_FIELD_MISSING',
])

/** True when a failure is the deployment's defect rather than the caller's mistake. */
export const isDefectError = (code: string): boolean => DEFECT_CODES.has(code)
