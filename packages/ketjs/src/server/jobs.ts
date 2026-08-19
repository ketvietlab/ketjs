// Job declarations are data in the manifest and executable handlers in this
// process. Keeping the two joined by one qualified key mirrors server functions
// while allowing `ket worker` to load the same AppSpec without booting HTTP.

import { KetError } from '../kernel/errors.ts'
import type { JobSpec, KetModule } from '../types.ts'

const registry = new Map<string, JobSpec>()

export function defineJob(spec: JobSpec): JobSpec {
  if (spec.idempotent !== true)
    throw new KetError({
      code: 'E_JOB_NOT_IDEMPOTENT',
      message: 'defineJob() requires idempotent: true because delivery is at-least-once',
    })
  if (typeof spec.handler !== 'function')
    throw new KetError({ code: 'E_JOB_NO_HANDLER', message: 'defineJob() requires a handler' })
  return spec
}

export function registerJobs(modules: KetModule[]): Map<string, JobSpec> {
  registry.clear()
  for (const module of modules)
    for (const [name, spec] of Object.entries(module.jobs)) registry.set(`${module.name}.${name}`, spec)
  return registry
}

export const jobDefinition = (key: string): JobSpec | null => registry.get(key) ?? null
