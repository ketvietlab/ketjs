// A rotating file, for a deployment with nowhere to send stderr.
//
// In a container runtime this driver is the wrong answer: the runtime already
// captures stderr, and a file inside a pod is deleted with the pod. It is here for
// the deployment that runs under a service manager on a host it owns.
//
// One `appendFileSync` per batch rather than a managed stream. A synchronous
// append is durable the moment it returns, which removes rotation races, partial
// lines on crash, and the question of what `flush` means — and `bufferedLog` in
// front of it amortises the open/close across a whole second of records.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogDriver, LogRecord } from './types.ts'

export type FileLogOptions = {
  dir: string
  file?: string
  /** Rotate once the active file passes this size. */
  maxBytes?: number
  /** How many rotated generations to keep beside the active file. */
  keep?: number
}

const sizeOf = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function fileLog(options: FileLogOptions): LogDriver {
  const maxBytes = Math.max(1, options.maxBytes ?? 32 * 1024 * 1024)
  const keep = Math.max(1, options.keep ?? 5)
  const path = join(options.dir, options.file ?? 'ket.log')
  mkdirSync(options.dir, { recursive: true })

  const rotate = (): void => {
    // Downwards, so a generation is never overwritten before it has moved. rename
    // replaces its destination, which is what retires the oldest generation.
    for (let index = keep - 1; index >= 1; index--) {
      try {
        renameSync(`${path}.${index}`, `${path}.${index + 1}`)
      } catch {
        /* that generation does not exist yet */
      }
    }
    try {
      renameSync(path, `${path}.1`)
    } catch {
      /* nothing written yet */
    }
  }

  return {
    name: 'file',
    write(records: readonly LogRecord[]) {
      if (!records.length) return
      const payload = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      try {
        appendFileSync(path, payload)
        if (sizeOf(path) >= maxBytes) rotate()
      } catch {
        /* a full or read-only disk must not take the application with it */
      }
    },
  }
}
