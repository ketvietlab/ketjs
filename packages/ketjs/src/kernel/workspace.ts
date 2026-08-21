// Umbrella layout: one repository, many deployable apps, shared modules.
//
// Elixir's umbrella works because apps declare their dependencies explicitly and
// share one build. Ket already has the first half — `depends` between modules is
// `in_umbrella` by another name. This adds the second: several apps composed from
// overlapping module sets, each with its own routes, theme and agent surface.
//
// The classic umbrella failure is the shared database becoming an invisible
// coupling. Here it is made visible: apps bound to the same datastore get a single
// union schema, computed and checked at build time, and any disagreement between
// two apps about the same model is an error rather than a 3am surprise.

import { compose } from './compose.ts'
import { Diagnostics } from './errors.ts'
import { schemaFromManifest } from '../data/migrate.ts'
import type { Schema } from '../data/migrate.ts'
import type { KetModule, Manifest } from '../types.ts'
import type { ServeSpec } from '../server/boot.ts'

export type WorkerSpec = {
  /** Local concurrency per queue. Several worker processes multiply it. */
  queues: Record<string, number>
  pollMinMs?: number
  pollMaxMs?: number
  tenantRefreshMs?: number
  leaseMs?: number
  shutdownGraceMs?: number
}

export type AppSpec = {
  name: string
  modules: KetModule[]
  theme?: KetModule
  /** Themes this deployment allows sites to select. `theme` remains the fallback. */
  themes?: KetModule[]
  datastore?: string
  requires?: string[]
  /** An app that exposes functions but renders no pages: no theme, no region contract. */
  headless?: boolean
  /** How the app runs: pages, routes, assets, datastore. Absent means it is never served. */
  serve?: ServeSpec
  /** Same app and manifest, a separate production process role. */
  worker?: WorkerSpec
}

/**
 * What an authored workspace may name before module paths have been resolved.
 *
 * Keeping this separate from AppSpec is deliberate: composition, HTTP and workers
 * continue to receive executable KetModule objects only. A string is allowed at
 * the workspace boundary and nowhere deeper in the framework.
 */
export type ModuleRef = KetModule | string
export type AppDeclaration = Omit<AppSpec, 'modules' | 'theme' | 'themes'> & {
  modules: ModuleRef[]
  theme?: ModuleRef
  themes?: ModuleRef[]
}

export type ModulePath = string | URL
export type WorkspaceDeclaration = {
  apps: AppDeclaration[]
  /** the domain contract-like roots whose direct children may contain ket.module.json. */
  modulePaths?: ModulePath[]
}

export type Workspace = {
  apps: Record<string, Manifest>
  datastores: Record<string, { schema: Schema; apps: string[]; modules: string[] }>
  shared: string[]
  soloed: Record<string, string[]>
}

export function defineApp(spec: AppSpec): AppSpec
export function defineApp(spec: AppDeclaration): AppDeclaration
export function defineApp(spec: AppDeclaration): AppDeclaration {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(`invalid app name "${spec.name}"`)
  if (spec.headless && (spec.theme || spec.themes?.length))
    throw new Error(`app "${spec.name}" is headless but installs a theme`)
  const themeNames = [spec.theme, ...(spec.themes ?? [])]
    .filter((theme): theme is ModuleRef => theme !== undefined)
    .map((theme) => (typeof theme === 'string' ? theme : theme.name))
  if (new Set(themeNames).size !== themeNames.length)
    throw new Error(`app "${spec.name}" selects the same theme more than once`)
  if (spec.headless && spec.serve?.pages) throw new Error(`app "${spec.name}" is headless but resolves pages`)
  const pageRegion = spec.serve?.pages?.region
  if (pageRegion && !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(pageRegion))
    throw new Error(`app "${spec.name}" declares invalid page region "${pageRegion}"`)
  if (spec.worker && !Object.keys(spec.worker.queues).length)
    throw new Error(`app "${spec.name}" declares a worker with no queues`)
  for (const [queue, concurrency] of Object.entries(spec.worker?.queues ?? {})) {
    if (!/^[a-z][a-z0-9_-]*$/.test(queue)) throw new Error(`app "${spec.name}" has invalid queue "${queue}"`)
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error(`app "${spec.name}" queue "${queue}" needs concurrency >= 1`)
  }
  return spec
}

export function defineWorkspace<T extends WorkspaceDeclaration>(spec: T): T {
  if (!spec || typeof spec !== 'object') throw new Error('defineWorkspace() expects an object')
  if (!Array.isArray(spec.apps)) throw new Error('workspace apps must be an array')
  if (spec.modulePaths !== undefined && !Array.isArray(spec.modulePaths))
    throw new Error('workspace modulePaths must be an array')
  return spec
}

export function composeWorkspace(apps: AppSpec[]): Workspace {
  const diag = new Diagnostics()
  const manifests: Record<string, Manifest> = {}
  const usedBy = new Map<string, string[]>()

  for (const app of apps) {
    const mods = [...app.modules, ...(app.theme ? [app.theme] : []), ...(app.themes ?? [])]
    try {
      manifests[app.name] = compose(mods, {
        appRequires: app.requires ?? [],
        headless: app.headless ?? false,
      })
    } catch (e) {
      diag.add({
        code: 'E_APP_COMPOSE_FAILED',
        module: app.name,
        message: `app "${app.name}" failed to compose: ${(e as Error).message}`,
      })
      continue
    }
    const configured = app.worker?.queues ?? {}
    for (const [job, meta] of Object.entries(manifests[app.name]!.jobs)) {
      if (configured[meta.queue]) continue
      diag.add({
        code: 'E_APP_JOB_QUEUE_UNCONFIGURED',
        module: app.name,
        message: `app "${app.name}" ships job "${job}" on queue "${meta.queue}" but does not configure that worker queue`,
        hint: `add worker.queues.${meta.queue}, or remove the module that contributes the job`,
      })
    }
    for (const m of mods) {
      const list = usedBy.get(m.name) ?? []
      list.push(app.name)
      usedBy.set(m.name, list)
    }
  }
  diag.throwIfAny()

  // One union schema per datastore, so the coupling is explicit and checkable.
  const datastores: Workspace['datastores'] = {}
  for (const app of apps) {
    const store = app.datastore ?? 'main'
    const manifest = manifests[app.name] as Manifest
    const schema = schemaFromManifest(manifest)
    const slot = (datastores[store] ??= { schema: { version: 1, tables: {} }, apps: [], modules: [] })
    slot.apps.push(app.name)
    for (const m of manifest.order) if (!slot.modules.includes(m)) slot.modules.push(m)

    for (const [tname, table] of Object.entries(schema.tables)) {
      const existing = slot.schema.tables[tname]
      if (!existing) {
        slot.schema.tables[tname] = structuredClone(table)
        continue
      }
      if (existing.model !== table.model) {
        diag.add({
          code: 'E_DATASTORE_MODEL_CLASH',
          module: app.name,
          message: `datastore "${store}": table "${tname}" is "${existing.model}" in another app but "${table.model}" in "${app.name}"`,
          hint: 'rename one of the models, or bind the apps to different datastores',
        })
        continue
      }
      for (const [cname, col] of Object.entries(table.columns)) {
        const before = existing.columns[cname]
        if (!before) {
          existing.columns[cname] = { ...col }
          continue
        }
        if (before.base !== col.base || before.by !== col.by) {
          diag.add({
            code: 'E_DATASTORE_COLUMN_CLASH',
            module: app.name,
            message: `datastore "${store}": column "${tname}.${cname}" is ${before.base} (from ${before.by}) elsewhere but ${col.base} (from ${col.by}) in "${app.name}"`,
            hint: 'both apps must install the same version of the contributing module',
          })
        }
      }
    }
  }
  diag.throwIfAny()

  const shared: string[] = []
  const soloed: Record<string, string[]> = {}
  for (const [mod, list] of usedBy) {
    if (list.length > 1) shared.push(mod)
    else (soloed[list[0] as string] ??= []).push(mod)
  }

  return { apps: manifests, datastores, shared: shared.sort(), soloed }
}

export function explainWorkspace(ws: Workspace): string {
  const lines: string[] = []
  lines.push('apps:')
  for (const [name, m] of Object.entries(ws.apps)) {
    lines.push(
      `  ${name.padEnd(14)} modules=${m.order.length}  fns=${Object.keys(m.functions).length}  jobs=${Object.keys(m.jobs).length}  regions=${m.regions.required.length}`,
    )
  }
  lines.push('datastores:')
  for (const [name, ds] of Object.entries(ws.datastores)) {
    lines.push(
      `  ${name.padEnd(14)} tables=${Object.keys(ds.schema.tables).length}  shared by: ${ds.apps.join(', ')}`,
    )
  }
  lines.push(`shared modules: ${ws.shared.join(', ') || '(none)'}`)
  for (const [app, mods] of Object.entries(ws.soloed)) lines.push(`  only in ${app}: ${mods.join(', ')}`)
  return lines.join('\n')
}
