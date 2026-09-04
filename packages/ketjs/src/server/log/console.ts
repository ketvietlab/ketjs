// The default sink: NDJSON, one record per line, on stderr.
//
// stderr rather than stdout, and that is not a stylistic choice. `ket manifest`,
// `ket agent`, `ket permissions --json` and a dozen other commands write their
// answer to stdout, and a log line interleaved into that answer breaks
// `ket manifest | jq` for everyone downstream. stdout belongs to the program's
// output; a log is a side channel. Both are collected in a container runtime, so
// nothing is lost by being correct here.

import type { LogDriver, LogRecord } from './types.ts'

/**
 * How much may sit unwritten in the stream before records are dropped.
 *
 * Node's stdout and stderr are asynchronous when they point at a pipe, and their
 * internal buffer has no bound: a log collector that stops reading turns into
 * unbounded memory growth in the application. This is the bound.
 */
const BUFFER_MAX = 4 * 1024 * 1024

const LEVEL_COLOR: Record<string, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
}
const COLOR_OFF = '\u001b[0m'

export type ConsoleLogOptions = {
  stream?: 'stdout' | 'stderr'
  /** Human-readable columns instead of NDJSON. For `ket dev`, never for production. */
  pretty?: boolean
  color?: boolean
  bufferMax?: number
}

function target(name: 'stdout' | 'stderr'): NodeJS.WriteStream {
  return name === 'stdout' ? process.stdout : process.stderr
}

const pad = (value: string, width: number): string => value.padEnd(width)

function prettyLine(record: LogRecord, color: boolean): string {
  const time = record.at.slice(11, 23)
  const tint = color ? (LEVEL_COLOR[record.level] ?? '') : ''
  const off = tint ? COLOR_OFF : ''
  const parts: string[] = []
  if (record.fn) parts.push(`fn=${record.fn}`)
  if (record.tenant) parts.push(`tenant=${record.tenant}`)
  if (record.durationMs !== undefined) parts.push(`${record.durationMs}ms`)
  if (record.dryRun) parts.push('dry-run')
  if (record.replayed) parts.push('replayed')
  for (const [key, value] of Object.entries(record.fields ?? {})) parts.push(`${key}=${value}`)
  if (record.error) parts.push(`${record.error.code}: ${record.error.message}`)
  const message = record.message ? ` ${record.message}` : ''
  const tail = parts.length ? ` ${parts.join(' ')}` : ''
  return `${time} ${tint}${pad(record.level, 5)}${off} ${pad(record.event, 18)}${message}${tail}\n`
}

export function consoleLog(options: ConsoleLogOptions = {}): LogDriver {
  const out = target(options.stream ?? 'stderr')
  const pretty = options.pretty ?? false
  const color = options.color ?? Boolean(out.isTTY)
  const bufferMax = options.bufferMax ?? BUFFER_MAX
  let dropped = 0
  let droppedSince = Date.now()

  const line = (record: LogRecord): string =>
    pretty ? prettyLine(record, color) : `${JSON.stringify(record)}\n`

  return {
    name: pretty ? 'pretty' : 'console',
    write(records) {
      for (const record of records) {
        if (out.writableLength > bufferMax) {
          if (!dropped) droppedSince = Date.now()
          dropped++
          continue
        }
        try {
          if (dropped) {
            const count = dropped
            const sinceMs = Date.now() - droppedSince
            dropped = 0
            out.write(
              line({
                at: new Date().toISOString(),
                level: 'warn',
                event: 'log_dropped',
                deployment: record.deployment,
                process: record.process,
                tenant: null,
                trace: null,
                fields: { count, sinceMs, reason: 'stream_backpressure' },
              }),
            )
          }
          out.write(line(record))
        } catch {
          /* a closed stdio stream must not take the application with it */
        }
      }
    },
  }
}

/** `consoleLog` with columns a person can read. The development default. */
export const prettyLog = (options: Omit<ConsoleLogOptions, 'pretty'> = {}): LogDriver =>
  consoleLog({ ...options, pretty: true })
