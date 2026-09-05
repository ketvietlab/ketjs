import { KetError } from '../../kernel/errors.ts'
import type { RuntimeConfig } from '../config.ts'
import { bufferedLog } from './combinators.ts'
import { consoleLog, prettyLog } from './console.ts'
import { fileLog } from './file.ts'
import type { LogDriver } from './types.ts'
import { nullLog } from './types.ts'

export { atLeast, isLogDriverName, isLogLevel, nullLog, CORE_EVENTS, MODULE_EVENT } from './types.ts'
export type {
  CoreEvent,
  LogDriver,
  LogDriverName,
  LogError,
  LogFields,
  LogLevel,
  LogProcess,
  LogRecord,
  OpenLog,
} from './types.ts'
export { bufferedLog, isolatedLog, leveledLog, multiLog, redactLog } from './combinators.ts'
export { consoleLog, prettyLog } from './console.ts'
export type { ConsoleLogOptions } from './console.ts'
export { fileLog } from './file.ts'
export type { FileLogOptions } from './file.ts'
export { memoryLog } from './memory.ts'
export type { MemoryLog } from './memory.ts'
export { createLogger, describeError, traceOf } from './logger.ts'
export type { LogContext, LogEntry, Logger } from './logger.ts'

/**
 * The sink the framework opens when the deployment does not hand one in.
 *
 * Which driver, not which behaviour: level filtering and redaction are applied by
 * the runtime around whatever comes back from here, so a deployment's own
 * `serve.openLog` gets the same treatment as the built-ins rather than having to
 * remember to ask for it.
 */
export function logFromConfig(config: RuntimeConfig): LogDriver {
  switch (config.logDriver) {
    case 'null':
      return nullLog()
    case 'console':
      return consoleLog({ stream: config.logStream })
    case 'pretty':
      return prettyLog({ stream: config.logStream })
    case 'file': {
      if (!config.logDir)
        throw new KetError({
          code: 'E_LOG_CONFIG',
          message: 'file logging is missing KET_LOG_DIR',
          hint: 'set KET_LOG_DIR, or choose another KET_LOG driver',
        })
      // Batched, because an append per record would be an open per record.
      return bufferedLog(fileLog({ dir: config.logDir }), { max: config.logBuffer })
    }
    default:
      // A terminal gets columns; a pipe gets NDJSON. Nobody configures the obvious.
      return process.stderr.isTTY
        ? prettyLog({ stream: config.logStream })
        : consoleLog({ stream: config.logStream })
  }
}
