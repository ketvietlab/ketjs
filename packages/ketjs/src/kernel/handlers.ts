// Executable handlers belong to the manifest that composed them.
//
// The manifest is data: it can be printed, diffed and stored. Handlers are this
// process's code. Joining the two by manifest identity, rather than through one
// process-wide table, lets two deployments — or two tests — share a process
// without the later composition replacing the earlier one's functions and jobs.

import type { FnSpec, JobSpec, KetModule, Manifest } from '../types.ts'

type Handlers = {
  functions: ReadonlyMap<string, FnSpec>
  jobs: ReadonlyMap<string, JobSpec>
}

const bound = new WeakMap<Manifest, Handlers>()

/** Join every composed function and job of `manifest` to the module code that declared it. */
export function bindHandlers(manifest: Manifest, modules: readonly KetModule[]): void {
  const functions = new Map<string, FnSpec>()
  const jobs = new Map<string, JobSpec>()
  for (const module of modules) {
    for (const [name, spec] of Object.entries(module.functions)) {
      const key = `${module.name}.${name}`
      if (manifest.functions[key]) functions.set(key, spec)
    }
    for (const [name, spec] of Object.entries(module.jobs)) {
      const key = `${module.name}.${name}`
      if (manifest.jobs[key]) jobs.set(key, spec)
    }
  }
  bound.set(manifest, { functions, jobs })
}

/** False for a manifest that was assembled by hand or read back from JSON. */
export const hasBoundHandlers = (manifest: Manifest): boolean => bound.has(manifest)

export const functionHandler = (manifest: Manifest, key: string): FnSpec | null =>
  bound.get(manifest)?.functions.get(key) ?? null

export const jobHandler = (manifest: Manifest, key: string): JobSpec | null =>
  bound.get(manifest)?.jobs.get(key) ?? null
