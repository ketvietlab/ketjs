// The adapter contract, fixed on day one so a Postgres wire-protocol driver can
// slot in later without rewriting anything above it.
import type { Adapter } from '../types.ts'

export const ADAPTER_METHODS = ['open', 'close', 'exec', 'all', 'run', 'tx', 'quoteIdent', 'columnSql', 'introspect'] as const

export function assertAdapter(a: Adapter): Adapter {
  const missing = ADAPTER_METHODS.filter(m => typeof a[m] !== 'function')
  if (missing.length) throw new Error(`adapter is missing: ${missing.join(', ')}`)
  return a
}
