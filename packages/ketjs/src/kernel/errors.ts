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
