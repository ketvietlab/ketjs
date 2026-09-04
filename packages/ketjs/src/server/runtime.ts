// The common process role foundation. HTTP and workers load exactly the same
// configuration, build artifact, module graph and executable registries; only
// their outer loops differ.

import { fingerprintAssets } from './assets.ts'
import { compose } from '../kernel/compose.ts'
import { readConfig } from './config.ts'
import { registerFunctions } from './fn.ts'
import { registerJobs } from './jobs.ts'
import { createLogger, leveledLog, logFromConfig, redactLog } from './log/index.ts'
import type { LogDriver, LogProcess, Logger, OpenLog } from './log/index.ts'
import type { DeploymentSpec } from '../kernel/workspace.ts'
import type { KetModule, Manifest } from '../types.ts'
import type { RuntimeConfig } from './config.ts'

export type BootedRuntime = {
  spec: DeploymentSpec
  config: RuntimeConfig
  modules: KetModule[]
  manifest: Manifest
  /** The sink, already level-filtered and redacted. Closed last on shutdown. */
  log: LogDriver
  /** Carries this deployment and process role; narrow it with `child`. */
  logger: Logger
}

export async function bootRuntime(
  spec: DeploymentSpec,
  options: {
    env?: Record<string, string | undefined>
    port?: number
    /** Which process role this is. A low-cardinality field on every record. */
    role?: LogProcess
    /**
     * Override the deployment's sink for this process.
     *
     * A host that boots a deployment it did not author — a test harness, an
     * embedding process — can redirect records without editing the spec, the same
     * way it already overrides the port.
     */
    openLog?: OpenLog
  } = {},
): Promise<BootedRuntime> {
  const config = readConfig(options.env ?? process.env, {
    sqliteFile: `.ket/${spec.name}.db`,
    ...spec.serve?.defaults,
    ...(options.port === undefined ? {} : { port: options.port }),
  })
  if (options.port !== undefined) config.port = options.port

  // Redaction is applied here rather than left to whoever opened the driver, so a
  // deployment's own sink is held to the same rule as the built-in ones. The level
  // filter sits outside it, so a record nobody will keep is never redacted at all.
  const opened = await (options.openLog ?? spec.serve?.openLog ?? logFromConfig)(config)
  const log = leveledLog(redactLog(opened), config.logLevel)
  const logger = createLogger(log, { deployment: spec.name, process: options.role ?? 'http' })

  const modules = [...spec.modules, ...(spec.theme ? [spec.theme] : []), ...(spec.themes ?? [])]
  const manifest = compose(modules, {
    requiredRegions: spec.requires ?? [],
    headless: spec.headless ?? false,
    requirePermissionCoverage: spec.permissions?.requireCoverage,
    modulePermissionDeclarations: spec.permissions?.modules,
    roleTemplates: spec.permissions?.roleTemplates,
  })
  // Asset URLs carry their file's digest from here on, so a browser and
  // anything in front of it may keep them until the bytes change.
  await fingerprintAssets(manifest)
  registerFunctions(modules)
  registerJobs(modules)

  logger.info('boot', {
    driver: opened.name,
    level: config.logLevel,
    modules: modules.length,
    functions: Object.keys(manifest.functions).length,
    jobs: Object.keys(manifest.jobs).length,
    // False means correlation is hashed with a bare digest instead of a keyed one,
    // so a low-entropy command key is guessable and the web and worker processes
    // cannot derive the same trace for one request.
    traceKeyed: Boolean(config.secret),
  })

  return { spec, config, modules, manifest, log, logger }
}
