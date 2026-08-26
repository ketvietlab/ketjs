// The common process role foundation. HTTP and workers load exactly the same
// configuration, build artifact, module graph and executable registries; only
// their outer loops differ.

import { fingerprintAssets } from './assets.ts'
import { compose } from '../kernel/compose.ts'
import { readConfig } from './config.ts'
import { registerFunctions } from './fn.ts'
import { registerJobs } from './jobs.ts'
import type { DeploymentSpec } from '../kernel/workspace.ts'
import type { KetModule, Manifest } from '../types.ts'
import type { RuntimeConfig } from './config.ts'

export type BootedRuntime = {
  spec: DeploymentSpec
  config: RuntimeConfig
  modules: KetModule[]
  manifest: Manifest
}

export async function bootRuntime(
  spec: DeploymentSpec,
  options: { env?: Record<string, string | undefined>; port?: number } = {},
): Promise<BootedRuntime> {
  const config = readConfig(options.env ?? process.env, {
    sqliteFile: `.ket/${spec.name}.db`,
    ...spec.serve?.defaults,
    ...(options.port === undefined ? {} : { port: options.port }),
  })
  if (options.port !== undefined) config.port = options.port
  const modules = [...spec.modules, ...(spec.theme ? [spec.theme] : []), ...(spec.themes ?? [])]
  const manifest = compose(modules, {
    requiredRegions: spec.requires ?? [],
    headless: spec.headless ?? false,
  })
  // Asset URLs carry their file's digest from here on, so a browser and
  // anything in front of it may keep them until the bytes change.
  await fingerprintAssets(manifest)
  registerFunctions(modules)
  registerJobs(modules)
  return { spec, config, modules, manifest }
}
