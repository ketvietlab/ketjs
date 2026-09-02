import { createHash } from 'node:crypto'
import { Diagnostics } from './errors.ts'
import type {
  CompiledPermissionBundle,
  CompiledRoleTemplate,
  KetModule,
  Manifest,
  PermissionCatalogue,
  PermissionExemptionReason,
  PermissionFunctionDef,
  PermissionPosture,
  PermissionRisk,
  RoleTemplateDef,
} from '../types.ts'

const RISKS = new Set<PermissionRisk>(['read', 'operate', 'approve', 'configure', 'sensitive', 'security'])
const HIGH_RISKS = new Set<PermissionRisk>(['approve', 'configure', 'sensitive', 'security'])
const POSTURES = new Set<PermissionPosture>([
  'permission-bearing',
  'projection/bridge',
  'session/device',
  'internal/headless',
])
const EXEMPTION_REASONS = new Set<PermissionExemptionReason>([
  'anonymous',
  'bootstrap-only',
  'internal-route',
  'worker',
  'service-boundary',
  'projection-only',
  'non-grantable',
])

const sorted = <T>(values: Iterable<T>): T[] =>
  [...values].sort((left, right) => String(left).localeCompare(String(right)))

const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export const permissionDigest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex')

const bundleOwner = (key: string): string => key.split('.')[0] ?? ''

export type CompilePermissionOptions = {
  requireCoverage?: boolean
  roleTemplates?: Record<string, RoleTemplateDef>
}

/** Validate and compile the exact permission graph for one composed deployment. */
export function compilePermissionBundles(
  modules: readonly KetModule[],
  manifest: Pick<Manifest, 'modules' | 'functions'>,
  options: CompilePermissionOptions = {},
): PermissionCatalogue {
  const diag = new Diagnostics()
  const declarations = new Map(
    modules.filter((module) => module.permissions).map((module) => [module.name, module]),
  )
  const moduleMeta: PermissionCatalogue['modules'] = {}
  const rawBundles = new Map<
    string,
    {
      module: KetModule
      includes: string[]
      labels: { en: string; vi: string }
      summary?: { en: string; vi: string }
    }
  >()
  const classifications: Record<string, PermissionFunctionDef> = {}
  const exemptions: PermissionCatalogue['exemptions'] = {}

  for (const module of declarations.values()) {
    const declaration = module.permissions!
    if (!POSTURES.has(declaration.posture))
      diag.add({
        code: 'E_PERMISSION_CATALOG_INVALID',
        module: module.name,
        message: `unknown permission posture "${declaration.posture}"`,
      })
    if (declaration.owner !== module.name)
      diag.add({
        code: 'E_PERMISSION_CATALOG_INVALID',
        module: module.name,
        message: `permission owner must be "${module.name}"`,
      })
    moduleMeta[module.name] = { posture: declaration.posture, owner: declaration.owner }

    for (const [key, bundle] of Object.entries(declaration.bundles)) {
      const capability = key.slice(module.name.length + 1)
      if (
        !key.startsWith(`${module.name}.`) ||
        !/^[a-z][a-z0-9-]*$/.test(capability) ||
        ['all', 'manager'].includes(capability) ||
        key.includes('*')
      )
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `invalid permission bundle key "${key}"`,
        })
      if (rawBundles.has(key))
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `duplicate permission bundle "${key}"`,
        })
      if (!bundle.labels?.en?.trim() || !bundle.labels?.vi?.trim())
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `bundle "${key}" requires non-empty en/vi labels`,
        })
      const includes = [...(bundle.includes ?? [])]
      if (new Set(includes).size !== includes.length)
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `bundle "${key}" contains a duplicate include`,
        })
      rawBundles.set(key, {
        module,
        labels: bundle.labels,
        ...(bundle.summary ? { summary: bundle.summary } : {}),
        includes,
      })
    }

    for (const [key, classification] of Object.entries(declaration.functions)) {
      const fn = manifest.functions[key]
      if (!fn)
        diag.add({
          code: 'E_PERMISSION_FUNCTION_STALE',
          module: module.name,
          message: `classification references missing function "${key}"`,
        })
      else if (fn.by !== module.name)
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `module cannot classify function "${key}" owned by "${fn.by}"`,
        })
      else if (fn.anonymous || fn.exposure === 'internal' || fn.provision)
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `non-grantable function "${key}" must be exempt, not bundled`,
        })
      if (classifications[key])
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `duplicate function classification "${key}"`,
        })
      if (!RISKS.has(classification.risk))
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `function "${key}" has unknown risk "${classification.risk}"`,
        })
      if (classification.owner !== module.name)
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `function "${key}" owner must be "${module.name}"`,
        })
      if (
        !classification.bundles.length ||
        new Set(classification.bundles).size !== classification.bundles.length
      )
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `function "${key}" needs unique bundle membership`,
        })
      if (HIGH_RISKS.has(classification.risk) && !classification.policy?.trim())
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `high-risk function "${key}" requires a policy authority`,
        })
      classifications[key] = { ...classification, bundles: sorted(classification.bundles) }
    }

    for (const [key, exemption] of Object.entries(declaration.exemptions)) {
      const fn = manifest.functions[key]
      if (!fn)
        diag.add({
          code: 'E_PERMISSION_FUNCTION_STALE',
          module: module.name,
          message: `exemption references missing function "${key}"`,
        })
      else if (fn.by !== module.name)
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `module cannot exempt function "${key}" owned by "${fn.by}"`,
        })
      if (classifications[key])
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `function "${key}" is both classified and exempt`,
        })
      if (!EXEMPTION_REASONS.has(exemption.reason) || !exemption.authority?.trim())
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `function "${key}" has an invalid exemption`,
        })
      exemptions[key] = { ...exemption, owner: module.name }
    }
  }

  for (const [key, classification] of Object.entries(classifications)) {
    const module = declarations.get(classification.owner)
    for (const bundleKey of classification.bundles) {
      const bundle = rawBundles.get(bundleKey)
      if (!bundle)
        diag.add({
          code: 'E_PERMISSION_BUNDLE_UNKNOWN',
          module: classification.owner,
          message: `function "${key}" references missing bundle "${bundleKey}"`,
        })
      else if (bundle.module.name !== module?.name && !module?.depends.includes(bundle.module.name))
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: classification.owner,
          message: `function "${key}" references bundle "${bundleKey}" outside its dependency visibility`,
        })
    }
  }

  for (const [key, bundle] of rawBundles) {
    for (const include of bundle.includes) {
      const target = rawBundles.get(include)
      if (!target)
        diag.add({
          code: 'E_PERMISSION_BUNDLE_UNKNOWN',
          module: bundle.module.name,
          message: `bundle "${key}" includes missing bundle "${include}"`,
        })
      else if (
        target.module.name !== bundle.module.name &&
        !bundle.module.depends.includes(target.module.name)
      )
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: bundle.module.name,
          message: `bundle "${key}" includes "${include}" outside its dependency visibility`,
        })
    }
  }

  if (options.requireCoverage) {
    for (const [key, fn] of Object.entries(manifest.functions)) {
      if (classifications[key] || exemptions[key]) continue
      diag.add({
        code: 'E_PERMISSION_FUNCTION_UNCLASSIFIED',
        module: fn.by,
        message: `function "${key}" has no exact permission classification or exemption`,
      })
    }
    for (const module of modules)
      if (module.kind !== 'theme' && !module.permissions)
        diag.add({
          code: 'E_PERMISSION_CATALOG_INVALID',
          module: module.name,
          message: `module "${module.name}" has no permission posture`,
        })
  }

  const direct = new Map<string, string[]>()
  for (const [key, classification] of Object.entries(classifications))
    for (const bundle of classification.bundles)
      (direct.get(bundle) ?? direct.set(bundle, []).get(bundle)!).push(key)

  const compiledBundles: Record<string, CompiledPermissionBundle> = {}
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const compileBundle = (key: string, path: string[] = []): string[] => {
    if (visiting.has(key)) {
      diag.add({
        code: 'E_PERMISSION_BUNDLE_CYCLE',
        module: bundleOwner(key),
        message: `permission bundle cycle: ${[...path, key].join(' -> ')}`,
      })
      return []
    }
    if (visited.has(key)) return compiledBundles[key]?.functions ?? []
    const raw = rawBundles.get(key)
    if (!raw) return []
    visiting.add(key)
    const functions = new Set(direct.get(key) ?? [])
    for (const include of raw.includes)
      for (const fn of compileBundle(include, [...path, key])) functions.add(fn)
    visiting.delete(key)
    visited.add(key)
    const directFunctions = sorted(direct.get(key) ?? [])
    const allFunctions = sorted(functions)
    if (!allFunctions.length)
      diag.add({
        code: 'E_PERMISSION_CATALOG_INVALID',
        module: raw.module.name,
        message: `bundle "${key}" resolves to no function`,
      })
    compiledBundles[key] = {
      key,
      owner: raw.module.name,
      labels: raw.labels,
      ...(raw.summary ? { summary: raw.summary } : {}),
      includes: sorted(raw.includes),
      directFunctions,
      functions: allFunctions,
    }
    return allFunctions
  }
  for (const key of sorted(rawBundles.keys())) compileBundle(key)

  const compiledTemplates: Record<string, CompiledRoleTemplate> = {}
  for (const [key, template] of Object.entries(options.roleTemplates ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      !/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9-]*$/.test(key) ||
      !Number.isInteger(template.version) ||
      template.version < 1
    )
      diag.add({
        code: 'E_PERMISSION_CATALOG_INVALID',
        module: key.split('.')[0],
        message: `invalid role template "${key}" or version`,
      })
    if (!template.labels?.en?.trim() || !template.labels?.vi?.trim())
      diag.add({
        code: 'E_PERMISSION_CATALOG_INVALID',
        module: key.split('.')[0],
        message: `role template "${key}" requires non-empty en/vi labels`,
      })
    const bundles = sorted(new Set(template.bundles))
    if (!bundles.length || bundles.length !== template.bundles.length)
      diag.add({
        code: 'E_PERMISSION_CATALOG_INVALID',
        module: key.split('.')[0],
        message: `role template "${key}" needs unique bundles`,
      })
    const functions = new Set<string>()
    const functionPaths: Record<string, string[][]> = {}
    const addBundlePaths = (bundleKey: string, path: string[]) => {
      const bundle = compiledBundles[bundleKey]
      if (!bundle) return
      const next = [...path, bundleKey]
      for (const fn of bundle.directFunctions) (functionPaths[fn] ??= []).push(next)
      for (const include of bundle.includes) addBundlePaths(include, next)
    }
    for (const bundleKey of bundles) {
      const bundle = compiledBundles[bundleKey]
      if (!bundle) {
        diag.add({
          code: 'E_PERMISSION_BUNDLE_UNKNOWN',
          module: key.split('.')[0],
          message: `role template "${key}" references missing bundle "${bundleKey}"`,
        })
        continue
      }
      for (const fn of bundle.functions) {
        functions.add(fn)
      }
      addBundlePaths(bundleKey, [])
    }
    const base = { ...template, key, bundles, functions: sorted(functions), functionPaths }
    compiledTemplates[key] = { ...base, digest: permissionDigest(base) }
  }

  diag.throwIfAny()
  const base = {
    version: 1 as const,
    coverageRequired: options.requireCoverage === true,
    modules: Object.fromEntries(
      Object.entries(moduleMeta).sort(([left], [right]) => left.localeCompare(right)),
    ),
    bundles: Object.fromEntries(
      Object.entries(compiledBundles).sort(([left], [right]) => left.localeCompare(right)),
    ),
    functions: Object.fromEntries(
      Object.entries(classifications).sort(([left], [right]) => left.localeCompare(right)),
    ),
    exemptions: Object.fromEntries(
      Object.entries(exemptions).sort(([left], [right]) => left.localeCompare(right)),
    ),
    roleTemplates: compiledTemplates,
  }
  return { ...base, digest: permissionDigest(base) }
}
