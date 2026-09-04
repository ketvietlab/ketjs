// The sink a test asserts against.
//
// It exists so that a security contract can move from "the call threw" to "the
// call threw and said so": a denial nobody can observe is a denial nobody can
// alert on, and that is exactly the gap `fn_denied` and `policy_denied` close.

import type { LogDriver, LogRecord } from './types.ts'

export type MemoryLog = LogDriver & {
  records: LogRecord[]
  clear(): void
  /** Every record with this event, in order. */
  of(event: string): LogRecord[]
  /** The first record with this event, or undefined. */
  first(event: string): LogRecord | undefined
}

export function memoryLog(): MemoryLog {
  const records: LogRecord[] = []
  return {
    name: 'memory',
    records,
    write(batch) {
      records.push(...batch)
    },
    clear() {
      records.length = 0
    },
    of(event) {
      return records.filter((record) => record.event === event)
    },
    first(event) {
      return records.find((record) => record.event === event)
    },
  }
}
