// The common process role foundation. HTTP and workers load exactly the same
// configuration, build artifact, module graph and executable registries; only
// their outer loops differ.

import { compose } from '../kernel/compose.ts'
import { readConfig } from './config.ts'
import { registerFunctions } from './fn.ts'
import { registerJobs } from './jobs.ts'
import type { AppSpec } from '../kernel/workspace.ts'
import type { KetModule, Manifest } from '../types.ts'
import type { RuntimeConfig } from './config.ts'

export type BootedRuntime = {
  spec: AppSpec
  config: RuntimeConfig
  modules: KetModule[]
  manifest: Manifest
}

export async function bootRuntime(
  spec: AppSpec,
  options: { env?: Record<string, string | undefined>; port?: number } = {},
): Promise<BootedRuntime> {
  const config = readConfig(options.env ?? process.env, {
    sqliteFile: `.ket/${spec.name}.db`,
    ...spec.serve?.defaults,
    ...(options.port === undefined ? {} : { port: options.port }),
  })
  if (options.port !== undefined) config.port = options.port
  const modules = spec.theme ? [...spec.modules, spec.theme] : [...spec.modules]
  const manifest = compose(modules, {
    appRequires: spec.requires ?? [],
    headless: spec.headless ?? false,
  })
  registerFunctions(modules)
  registerJobs(modules)
  return { spec, config, modules, manifest }
}
