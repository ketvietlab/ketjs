// Umbrella layout: one repository, many deployments, shared modules.
//
// Elixir's umbrella works because applications declare their dependencies explicitly and
// share one build. Ket already has the first half — `depends` between modules is
// `in_umbrella` by another name. This adds the second: several deployments composed from
// overlapping module sets, each with its own routes, theme and agent surface.
//
// The classic umbrella failure is the shared database becoming an invisible
// coupling. Here it is made visible: deployments bound to the same datastore get a single
// union schema, computed and checked at build time, and any disagreement between
// two deployments about the same model is an error rather than a 3am surprise.

import { compose } from './compose.ts'
import { Diagnostics } from './errors.ts'
import { schemaFromManifest } from '../data/migrate.ts'
import type { Column, Index, Schema } from '../data/migrate.ts'
import type { KetModule, Manifest, ModulePermissionsDef, RoleTemplateDef } from '../types.ts'
import type { ServeSpec } from '../server/boot.ts'

export type WorkerSpec = {
  /** Local concurrency per queue. Several worker processes multiply it. */
  queues: Record<string, number>
  pollMinMs?: number
  pollMaxMs?: number
  tenantRefreshMs?: number
  leaseMs?: number
  shutdownGraceMs?: number
  /**
   * How often to look for a due schedule, in every tenant database.
   *
   * The sweep is one small statement per scheduled job per tenant, so the cost is
   * tenants times schedules divided by this. A deployment with many tenants and a
   * minute of tolerance should raise it.
   */
  scheduleSweepMs?: number
}

/**
 * Where a deployment says what its navigation means, as opposed to what its
 * modules happen to contain.
 *
 * `home` answers "what should this person see first". Entries are tried in
 * order and the first the viewer may call wins, so the specific sits above the
 * general. The condition is a function key rather than a role name because a
 * role is a bundle of capabilities that the framework never sees at request
 * time — the server knows what you may call, not what you are called.
 *
 * Without it `/admin` falls back to the first path in menu order, which is the
 * entry with the smallest `sequence` the viewer is permitted to see. That is an
 * accident of declaration order, not a decision about anyone's work.
 */
export type NavigationSpec = {
  home?: ReadonlyArray<{ needs: string; path: string }>
  /**
   * Function keys that mark a viewer as inspecting rather than operating.
   *
   * `MenuDef.for` narrows a sidebar to the work a person does, which is exactly
   * wrong for an auditor: their work is looking, and looking is what `for` does
   * not describe. Anyone who may call one of these keeps the whole permitted
   * tree. A function key again, for the same reason `home` uses one.
   */
  audit?: readonly string[]
  /**
   * Regroup the menu the way this product's shifts actually run.
   *
   * A module groups its screens the way the module is built — hospitality puts
   * folios and billing under "Operations" because both are hospitality code.
   * A hotel does not run that way: the person holding the folio is a cashier and
   * their shift is "Payments". Only the deployment knows this, and until now only
   * the module could say it.
   *
   * Entries named here move under the declared heading; entries left out keep the
   * heading their module gave them. Order is the order declared.
   */
  groups?: ReadonlyArray<{ id: string; label: string; icon?: string; items: readonly string[] }>
  /**
   * Menu ids to keep out of the main list regardless of `for`.
   *
   * `for` answers "is this your work". This answers "is this worth a permanent
   * row", which is the question a manager who can do everything still has.
   */
  demote?: readonly string[]
  /**
   * Whether the shell offers the list of root sections.
   *
   * `auto` shows it when this viewer has more than one root worth visiting, which
   * is the honest default. A single-domain product like a hotel sets `never`: a
   * chooser with one choice is furniture.
   */
  rootList?: 'auto' | 'always' | 'never'
}

export type DeploymentSpec = {
  name: string
  modules: KetModule[]
  theme?: KetModule
  /** Themes this deployment allows sites to select. `theme` remains the fallback. */
  themes?: KetModule[]
  datastore?: string
  requires?: string[]
  /** A deployment that exposes functions but renders no pages: no theme, no region contract. */
  headless?: boolean
  /** Require exact function coverage and compile product-owned managed role templates. */
  permissions?: {
    requireCoverage?: boolean
    modules?: Record<string, ModulePermissionsDef>
    roleTemplates?: Record<string, RoleTemplateDef>
  }
  /** How the deployment runs: pages, routes, assets, datastore. Absent means it is never served. */
  serve?: ServeSpec
  /** Same deployment and manifest, a separate production process role. */
  worker?: WorkerSpec
  /** What this deployment's navigation means, over and above what its modules contain. */
  navigation?: NavigationSpec
}

/**
 * What an authored workspace may name before module paths have been resolved.
 *
 * Keeping this separate from DeploymentSpec is deliberate: composition, HTTP and workers
 * continue to receive executable KetModule objects only. A string is allowed at
 * the workspace boundary and nowhere deeper in the framework.
 */
export type ModuleRef = KetModule | string
export type DeploymentDeclaration = Omit<DeploymentSpec, 'modules' | 'theme' | 'themes'> & {
  modules: ModuleRef[]
  theme?: ModuleRef
  themes?: ModuleRef[]
}

export type ModulePath = string | URL
export type WorkspaceDeclaration = {
  deployments: DeploymentDeclaration[]
  /** the domain contract-like roots whose direct children may contain ket.module.json. */
  modulePaths?: ModulePath[]
}

export type Workspace = {
  deployments: Record<string, Manifest>
  datastores: Record<string, { schema: Schema; deployments: string[]; modules: string[] }>
  shared: string[]
  soloed: Record<string, string[]>
}

const columnContract = (column: Column): string =>
  `${column.base === 'ref' ? `ref:${column.target ?? '(missing target)'}` : column.base}${column.optional ? '?' : ''}`

const indexContract = (index: Index): string =>
  `${index.unique ? 'unique ' : ''}(${index.fields.join(', ')}) from ${index.by}`

export function defineDeployment(spec: DeploymentSpec): DeploymentSpec
export function defineDeployment(spec: DeploymentDeclaration): DeploymentDeclaration
export function defineDeployment(spec: DeploymentDeclaration): DeploymentDeclaration {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(`invalid deployment name "${spec.name}"`)
  if (spec.headless && (spec.theme || spec.themes?.length))
    throw new Error(`deployment "${spec.name}" is headless but selects a theme`)
  const themeNames = [spec.theme, ...(spec.themes ?? [])]
    .filter((theme): theme is ModuleRef => theme !== undefined)
    .map((theme) => (typeof theme === 'string' ? theme : theme.name))
  if (new Set(themeNames).size !== themeNames.length)
    throw new Error(`deployment "${spec.name}" selects the same theme more than once`)
  if (spec.headless && spec.serve?.pages)
    throw new Error(`deployment "${spec.name}" is headless but resolves pages`)
  const pageRegion = spec.serve?.pages?.region
  if (pageRegion && !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(pageRegion))
    throw new Error(`deployment "${spec.name}" declares invalid page region "${pageRegion}"`)
  for (const group of spec.navigation?.groups ?? []) {
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(group.id))
      throw new Error(`deployment "${spec.name}" has invalid navigation.groups id "${group.id}"`)
    if (!group.items.length)
      throw new Error(`deployment "${spec.name}" declares navigation group "${group.id}" with no entries`)
  }
  for (const key of spec.navigation?.audit ?? []) {
    if (!/^[a-z][a-z0-9_]*\.[A-Za-z][A-Za-z0-9_.]*$/.test(key))
      throw new Error(`deployment "${spec.name}" has invalid navigation.audit condition "${key}"`)
  }
  for (const entry of spec.navigation?.home ?? []) {
    if (!/^[a-z][a-z0-9_]*\.[A-Za-z][A-Za-z0-9_.]*$/.test(entry.needs))
      throw new Error(`deployment "${spec.name}" has invalid navigation.home condition "${entry.needs}"`)
    if (!entry.path.startsWith('/'))
      throw new Error(`deployment "${spec.name}" has invalid navigation.home path "${entry.path}"`)
  }
  if (spec.worker && !Object.keys(spec.worker.queues).length)
    throw new Error(`deployment "${spec.name}" declares a worker with no queues`)
  for (const [queue, concurrency] of Object.entries(spec.worker?.queues ?? {})) {
    if (!/^[a-z][a-z0-9_-]*$/.test(queue))
      throw new Error(`deployment "${spec.name}" has invalid queue "${queue}"`)
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error(`deployment "${spec.name}" queue "${queue}" needs concurrency >= 1`)
  }
  return spec
}

export function defineWorkspace<T extends WorkspaceDeclaration>(spec: T): T {
  if (!spec || typeof spec !== 'object') throw new Error('defineWorkspace() expects an object')
  if (!Array.isArray(spec.deployments)) throw new Error('workspace deployments must be an array')
  if (spec.modulePaths !== undefined && !Array.isArray(spec.modulePaths))
    throw new Error('workspace modulePaths must be an array')
  return spec
}

export function composeWorkspace(deployments: DeploymentSpec[]): Workspace {
  const diag = new Diagnostics()
  const manifests: Record<string, Manifest> = {}
  const usedBy = new Map<string, string[]>()

  for (const deployment of deployments) {
    const mods = [
      ...deployment.modules,
      ...(deployment.theme ? [deployment.theme] : []),
      ...(deployment.themes ?? []),
    ]
    try {
      manifests[deployment.name] = compose(mods, {
        requiredRegions: deployment.requires ?? [],
        headless: deployment.headless ?? false,
        requirePermissionCoverage: deployment.permissions?.requireCoverage,
        modulePermissionDeclarations: deployment.permissions?.modules,
        roleTemplates: deployment.permissions?.roleTemplates,
      })
    } catch (e) {
      diag.add({
        code: 'E_DEPLOYMENT_COMPOSE_FAILED',
        module: deployment.name,
        message: `deployment "${deployment.name}" failed to compose: ${(e as Error).message}`,
      })
      continue
    }
    const configured = deployment.worker?.queues ?? {}
    for (const [job, meta] of Object.entries(manifests[deployment.name]!.jobs)) {
      if (configured[meta.queue]) continue
      diag.add({
        code: 'E_DEPLOYMENT_JOB_QUEUE_UNCONFIGURED',
        module: deployment.name,
        message: `deployment "${deployment.name}" ships job "${job}" on queue "${meta.queue}" but does not configure that worker queue`,
        hint: `add worker.queues.${meta.queue}, or remove the module that contributes the job`,
      })
    }
    // A landing page that names a function this build does not serve, or a path
    // nothing routes, fails quietly at runtime: the viewer simply falls through to
    // the old first-path behaviour and nobody is told why.
    for (const key of deployment.navigation?.audit ?? []) {
      const manifest = manifests[deployment.name] as Manifest
      if (!manifest.functions[key])
        diag.add({
          code: 'E_DEPLOYMENT_NAVIGATION_AUDIT_UNKNOWN_FUNCTION',
          module: deployment.name,
          message: `deployment "${deployment.name}" treats "${key}" as an inspection capability, but that function is not in this build`,
          hint: 'name a function the composed modules serve, or drop the key',
        })
    }
    for (const entry of deployment.navigation?.home ?? []) {
      const manifest = manifests[deployment.name] as Manifest
      if (!manifest.functions[entry.needs])
        diag.add({
          code: 'E_DEPLOYMENT_NAVIGATION_HOME_UNKNOWN_FUNCTION',
          module: deployment.name,
          message: `deployment "${deployment.name}" lands on "${entry.path}" when "${entry.needs}" is permitted, but that function is not in this build`,
          hint: 'name a function the composed modules serve, or drop the entry',
        })
      if (!Object.keys(manifest.routes).includes(entry.path))
        diag.add({
          code: 'E_DEPLOYMENT_NAVIGATION_HOME_UNROUTED',
          module: deployment.name,
          message: `deployment "${deployment.name}" lands on "${entry.path}", which no composed module routes`,
          hint: 'point at a served path, or compose the module that serves it',
        })
    }
    for (const m of mods) {
      const list = usedBy.get(m.name) ?? []
      list.push(deployment.name)
      usedBy.set(m.name, list)
    }
  }
  diag.throwIfAny()

  // One union schema per datastore, so the coupling is explicit and checkable.
  const datastores: Workspace['datastores'] = {}
  for (const deployment of deployments) {
    const store = deployment.datastore ?? 'main'
    const manifest = manifests[deployment.name] as Manifest
    const schema = schemaFromManifest(manifest)
    const slot = (datastores[store] ??= {
      schema: { version: 1, tables: {} },
      deployments: [],
      modules: [],
    })
    slot.deployments.push(deployment.name)
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
          module: deployment.name,
          message: `datastore "${store}": table "${tname}" is "${existing.model}" in another deployment but "${table.model}" in "${deployment.name}"`,
          hint: 'rename one of the models, or bind the deployments to different datastores',
        })
        continue
      }
      for (const [cname, col] of Object.entries(table.columns)) {
        const before = existing.columns[cname]
        if (!before) {
          existing.columns[cname] = { ...col }
          continue
        }
        if (
          before.base !== col.base ||
          before.optional !== col.optional ||
          before.target !== col.target ||
          before.by !== col.by
        ) {
          diag.add({
            code: 'E_DATASTORE_COLUMN_CLASH',
            module: deployment.name,
            message: `datastore "${store}": column "${tname}.${cname}" is ${columnContract(before)} (from ${before.by}) elsewhere but ${columnContract(col)} (from ${col.by}) in "${deployment.name}"`,
            hint: 'both deployments must install the same version of the contributing module',
          })
        }
      }
      for (const [name, index] of Object.entries(table.indexes)) {
        const before = existing.indexes[name]
        if (!before) {
          existing.indexes[name] = { ...index, fields: [...index.fields] }
          continue
        }
        if (
          before.unique !== index.unique ||
          before.by !== index.by ||
          before.fields.join('\0') !== index.fields.join('\0')
        ) {
          diag.add({
            code: 'E_DATASTORE_INDEX_CLASH',
            module: deployment.name,
            message: `datastore "${store}": index "${tname}.${name}" is ${indexContract(before)} elsewhere but ${indexContract(index)} in "${deployment.name}"`,
            hint: 'rename one index, or make both deployments declare the same fields and uniqueness',
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

  return { deployments: manifests, datastores, shared: shared.sort(), soloed }
}

export function explainWorkspace(ws: Workspace): string {
  const lines: string[] = []
  lines.push('deployments:')
  for (const [name, m] of Object.entries(ws.deployments)) {
    lines.push(
      `  ${name.padEnd(14)} modules=${m.order.length}  fns=${Object.keys(m.functions).length}  jobs=${Object.keys(m.jobs).length}  regions=${m.regions.required.length}`,
    )
  }
  lines.push('datastores:')
  for (const [name, ds] of Object.entries(ws.datastores)) {
    lines.push(
      `  ${name.padEnd(14)} tables=${Object.keys(ds.schema.tables).length}  shared by: ${ds.deployments.join(', ')}`,
    )
  }
  lines.push(`shared modules: ${ws.shared.join(', ') || '(none)'}`)
  for (const [deployment, mods] of Object.entries(ws.soloed))
    lines.push(`  only in ${deployment}: ${mods.join(', ')}`)
  return lines.join('\n')
}
