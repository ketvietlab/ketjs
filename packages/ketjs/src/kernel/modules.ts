// Filesystem module discovery, kept entirely at the workspace boundary.
//
// the domain contract's module search paths gets one thing exactly right: a deployment may draw modules
// from several roots without teaching the application where every package lives.
// Ket keeps the useful half and rejects the dangerous half. Discovery builds a
// catalogue, explicitly selected modules and their dependency closure are loaded,
// and everything below this file still receives ordinary KetModule objects.

import { realpath, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KetError } from './errors.ts'
import { topoSort } from './graph.ts'
import type { KetModule } from '../types.ts'
import type {
  DeploymentDeclaration,
  DeploymentSpec,
  ModulePath,
  ModuleRef,
  WorkspaceDeclaration,
} from './workspace.ts'

const DESCRIPTOR = 'ket.module.json'
const NAME = /^[a-z][a-z0-9_]*$/
const ARTIFACT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const DISCOVERY_CONCURRENCY = 64

type ModuleDescriptor = {
  name: string
  entry: string
}

export type ModuleSource = {
  name: string
  descriptor: string
  entry: string
  root: string
}

export type ResolvedModuleInfo = {
  name: string
  version: string
  kind: KetModule['kind']
  source: 'workspace' | string
  deployments: string[]
}

export type ResolvedWorkspace = {
  deployments: DeploymentSpec[]
  modulePaths: string[]
  modules: ResolvedModuleInfo[]
}

export type ResolveWorkspaceOptions = {
  /** URL of the workspace file; relative string roots are resolved beside it. */
  baseUrl: URL
  /** CLI/environment roots appended to the declaration's roots. */
  extraModulePaths?: ModulePath[]
  /** Development's tsx loader may execute source. Production Node may not. */
  allowSource?: boolean
}

const fail = (code: string, message: string, hint?: string): never => {
  throw new KetError({ code, message, ...(hint ? { hint } : {}) })
}

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

const rootPath = (value: ModulePath, baseUrl: URL): string => {
  if (value instanceof URL) {
    if (value.protocol !== 'file:')
      return fail('E_MODULE_PATH_PROTOCOL', `module path must be a file URL, got "${value.protocol}"`)
    return fileURLToPath(value)
  }
  if (typeof value !== 'string' || !value.trim())
    return fail('E_MODULE_PATH', 'module path must be a non-empty path or file URL')
  if (isAbsolute(value)) return value
  if (baseUrl.protocol !== 'file:')
    return fail('E_MODULE_PATH_PROTOCOL', `workspace base URL must be file:, got "${baseUrl.protocol}"`)
  return resolve(dirname(fileURLToPath(baseUrl)), value)
}

const readDescriptor = async (path: string): Promise<ModuleDescriptor> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    return fail(
      'E_MODULE_DESCRIPTOR',
      `cannot read module descriptor at ${path}: ${(error as Error).message}`,
      `${DESCRIPTOR} must be valid JSON`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return fail('E_MODULE_DESCRIPTOR', `${path} must contain a JSON object`)
  const value = parsed as Record<string, unknown>
  const unknown = Object.keys(value).filter((key) => !['$schema', 'name', 'entry'].includes(key))
  if (unknown.length)
    return fail(
      'E_MODULE_DESCRIPTOR_KEY',
      `${path} declares unknown ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}`,
      'known keys: $schema, name, entry',
    )
  if (typeof value.name !== 'string' || !NAME.test(value.name))
    return fail(
      'E_MODULE_DESCRIPTOR_NAME',
      `${path} has invalid module name ${JSON.stringify(value.name)}`,
      'use lowercase letters, digits and underscore, starting with a letter',
    )
  if (typeof value.entry !== 'string' || !value.entry.trim())
    return fail('E_MODULE_DESCRIPTOR_ENTRY', `${path} needs a non-empty "entry"`)
  return { name: value.name, entry: value.entry }
}

async function scanModulePaths(
  paths: readonly ModulePath[],
  options: Pick<ResolveWorkspaceOptions, 'baseUrl' | 'allowSource'>,
): Promise<{ roots: string[]; catalog: Map<string, ModuleSource> }> {
  const roots: string[] = []
  const catalog = new Map<string, ModuleSource>()

  for (const configured of paths) {
    const raw = rootPath(configured, options.baseUrl)
    let root = raw
    try {
      root = await realpath(raw)
      if (!(await stat(root)).isDirectory())
        fail('E_MODULE_PATH_NOT_DIRECTORY', `module path is not a directory: ${raw}`)
    } catch (error) {
      if (error instanceof KetError) throw error
      fail('E_MODULE_PATH_MISSING', `module path does not exist: ${raw}`)
    }
    if (roots.includes(root)) continue
    roots.push(root)

    const children = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    // Filesystem latency, not graph work, dominates a broad catalogue. Probe the
    // sorted children concurrently, then consume settled results in that same
    // order so an invalid catalogue still reports deterministically.
    const probe = async (child: (typeof children)[number]): Promise<ModuleSource | null> => {
      if (!child.isDirectory() && !child.isSymbolicLink()) return null
      const moduleDir = resolve(root, child.name)
      let moduleRoot: string
      try {
        moduleRoot = await realpath(moduleDir)
        if (!(await stat(moduleRoot)).isDirectory()) return null
      } catch {
        return null
      }
      const descriptorPath = resolve(moduleRoot, DESCRIPTOR)
      try {
        if (!(await stat(descriptorPath)).isFile()) return null
      } catch {
        return null
      }

      const descriptor = await readDescriptor(descriptorPath)
      const unresolvedEntry = resolve(moduleRoot, descriptor.entry)
      let entry = unresolvedEntry
      try {
        entry = await realpath(unresolvedEntry)
        if (!(await stat(entry)).isFile())
          fail(
            'E_MODULE_ENTRY_NOT_FILE',
            `module "${descriptor.name}" entry is not a file: ${unresolvedEntry}`,
          )
      } catch (error) {
        if (error instanceof KetError) throw error
        fail('E_MODULE_ENTRY_MISSING', `module "${descriptor.name}" entry does not exist: ${unresolvedEntry}`)
      }
      if (!inside(moduleRoot, entry))
        fail(
          'E_MODULE_ENTRY_ESCAPE',
          `module "${descriptor.name}" entry escapes its module directory: ${descriptor.entry}`,
        )
      const extension = extname(entry).toLowerCase()
      if (!ARTIFACT_EXTENSIONS.has(extension) && !(options.allowSource && SOURCE_EXTENSIONS.has(extension)))
        fail(
          'E_MODULE_ENTRY_EXTENSION',
          `module "${descriptor.name}" entry ${descriptor.entry} is not an executable JavaScript artifact`,
          options.allowSource
            ? 'use .js/.mjs/.cjs, or .ts/.tsx/.mts/.cts through the development loader'
            : 'build the module first and point entry at .js, .mjs or .cjs',
        )

      return { name: descriptor.name, descriptor: descriptorPath, entry, root: moduleRoot }
    }
    for (let offset = 0; offset < children.length; offset += DISCOVERY_CONCURRENCY) {
      const discovered = await Promise.allSettled(
        children.slice(offset, offset + DISCOVERY_CONCURRENCY).map(probe),
      )
      for (const result of discovered) {
        if (result.status === 'rejected') throw result.reason
        const source = result.value
        if (!source) continue
        const existing = catalog.get(source.name)
        if (existing)
          fail(
            'E_MODULE_NAME_CLASH',
            `module "${source.name}" is provided by both ${existing.root} and ${source.root}`,
            'module roots never shadow each other; rename one module or remove one root',
          )
        catalog.set(source.name, source)
      }
    }
  }
  return { roots, catalog }
}

const assertModule = (value: unknown, source: ModuleSource): KetModule => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('E_MODULE_EXPORT', `${source.entry} must default-export a module created by defineModule()`)
  const module = value as Partial<KetModule>
  if (module.name !== source.name)
    return fail(
      'E_MODULE_IDENTITY_MISMATCH',
      `${source.descriptor} names module "${source.name}" but ${source.entry} exports ${JSON.stringify(module.name)}`,
    )
  if (module.kind !== 'module' && module.kind !== 'theme')
    return fail('E_MODULE_EXPORT', `module "${source.name}" has invalid kind ${JSON.stringify(module.kind)}`)
  if (typeof module.version !== 'string')
    return fail('E_MODULE_EXPORT', `module "${source.name}" must declare a string version`)
  if (!Array.isArray(module.depends) || module.depends.some((name) => typeof name !== 'string'))
    return fail('E_MODULE_EXPORT', `module "${source.name}" must declare a string dependency list`)
  for (const key of ['requires', 'provides', 'styles', 'omits'] as const) {
    const field = module[key]
    if (!Array.isArray(field) || field.some((value) => typeof value !== 'string'))
      return fail('E_MODULE_EXPORT', `module "${source.name}" has invalid "${key}"; export defineModule(...)`)
  }
  for (const key of [
    'models',
    'extend',
    'joints',
    'fills',
    'functions',
    'jobs',
    'views',
    'tokens',
    'templates',
    'routes',
    'menus',
    'islands',
    'sections',
    'relations',
    'messages',
  ] as const) {
    const field = module[key]
    if (!field || typeof field !== 'object' || Array.isArray(field))
      return fail('E_MODULE_EXPORT', `module "${source.name}" has invalid "${key}"; export defineModule(...)`)
  }
  return value as KetModule
}

const moduleName = (ref: ModuleRef): string => (typeof ref === 'string' ? ref : ref.name)

async function resolveDeployment(
  declaration: DeploymentDeclaration,
  catalog: Map<string, ModuleSource>,
  imports: Map<string, Promise<KetModule>>,
): Promise<{ spec: DeploymentSpec; sources: Map<string, ModuleSource | null> }> {
  const inline = new Map<string, KetModule>()
  const stringRefs = new Set<string>()
  const refs = [
    ...declaration.modules,
    ...(declaration.theme ? [declaration.theme] : []),
    ...(declaration.themes ?? []),
  ]

  for (const ref of refs) {
    if (typeof ref === 'string') {
      if (!NAME.test(ref))
        fail(
          'E_MODULE_REF',
          `deployment "${declaration.name}" has invalid module reference ${JSON.stringify(ref)}`,
          'use the snake_case name from ket.module.json',
        )
      if (stringRefs.has(ref))
        fail(
          'E_MODULE_DUPLICATE_REF',
          `deployment "${declaration.name}" references module "${ref}" more than once`,
        )
      stringRefs.add(ref)
      continue
    }
    const existing = inline.get(ref.name)
    if (existing)
      fail(
        'E_MODULE_NAME_CLASH',
        `deployment "${declaration.name}" contains two inline modules named "${ref.name}"`,
        'each deployment must ship exactly one implementation of a module name',
      )
    inline.set(ref.name, ref)
  }
  for (const name of stringRefs) {
    if (inline.has(name))
      fail(
        'E_MODULE_NAME_CLASH',
        `deployment "${declaration.name}" provides "${name}" inline and by module path`,
        'choose the imported module object or its string reference, not both',
      )
  }

  const resolved = new Map<string, KetModule>()
  const sources = new Map<string, ModuleSource | null>()
  const visiting = new Set<string>()

  const load = async (name: string): Promise<void> => {
    if (resolved.has(name)) return
    let module = inline.get(name)
    let source: ModuleSource | null = null
    if (!module) {
      const found = catalog.get(name)
      if (!found) {
        throw new KetError({
          code: 'E_MISSING_DEPENDENCY',
          message: `deployment "${declaration.name}" needs module "${name}", which no module path provides`,
          hint: `add a root containing "${name}" to modulePaths, or import it into the deployment`,
        })
      }
      source = found
      let pending = imports.get(found.entry)
      if (!pending) {
        pending = import(pathToFileURL(found.entry).href).then((namespace: Record<string, unknown>) =>
          assertModule(namespace.default, found),
        )
        imports.set(found.entry, pending)
      }
      module = await pending
    }
    resolved.set(name, module)
    sources.set(name, source)
    if (visiting.has(name)) return
    visiting.add(name)
    for (const dependency of module.depends) await load(dependency)
    visiting.delete(name)
  }

  for (const ref of declaration.modules) await load(moduleName(ref))
  if (declaration.theme) await load(moduleName(declaration.theme))
  for (const theme of declaration.themes ?? []) await load(moduleName(theme))

  // topoSort remains the one authority for missing dependencies and cycles. It
  // also makes registration order independent of filesystem/readdir order.
  const ordered = topoSort([...resolved.values()])
  const themeName = declaration.theme ? moduleName(declaration.theme) : null
  const theme = themeName ? resolved.get(themeName) : undefined
  const selectedThemes = [
    ...(theme ? [theme] : []),
    ...(declaration.themes ?? []).map((ref) => resolved.get(moduleName(ref))!),
  ]
  for (const selected of selectedThemes)
    if (selected.kind !== 'theme')
      fail(
        'E_DEPLOYMENT_THEME_KIND',
        `deployment "${declaration.name}" selects "${selected.name}" as a theme, but it is a ${selected.kind}`,
        'export it with defineTheme(), or move it into modules',
      )
  const selectedNames = new Set(selectedThemes.map((selected) => selected.name))
  const modules = ordered.filter((module) => !selectedNames.has(module.name))
  const { modules: _moduleRefs, theme: _themeRef, themes: _themeRefs, ...deployment } = declaration
  return {
    spec: {
      ...deployment,
      modules,
      ...(theme ? { theme } : {}),
      ...(selectedThemes.length ? { themes: selectedThemes.filter((item) => item !== theme) } : {}),
    },
    sources,
  }
}

/** Resolve an authored workspace into the object-only shape the runtime accepts. */
export async function resolveWorkspace(
  declaration: WorkspaceDeclaration,
  options: ResolveWorkspaceOptions,
): Promise<ResolvedWorkspace> {
  if (!declaration || !Array.isArray(declaration.deployments))
    fail('E_WORKSPACE_SHAPE', 'workspace must contain a deployments array')
  const configured = [...(declaration.modulePaths ?? []), ...(options.extraModulePaths ?? [])]
  const { roots, catalog } = await scanModulePaths(configured, options)
  const imports = new Map<string, Promise<KetModule>>()
  const deployments: DeploymentSpec[] = []
  const inventory = new Map<string, ResolvedModuleInfo>()

  for (const deployment of declaration.deployments) {
    const { spec, sources } = await resolveDeployment(deployment, catalog, imports)
    deployments.push(spec)
    for (const module of [...spec.modules, ...(spec.theme ? [spec.theme] : []), ...(spec.themes ?? [])]) {
      const source = sources.get(module.name)
      const label = source?.entry ?? 'workspace'
      const key = `${module.name}\0${module.version}\0${label}`
      const existing = inventory.get(key)
      if (existing) {
        if (!existing.deployments.includes(spec.name)) existing.deployments.push(spec.name)
      } else {
        inventory.set(key, {
          name: module.name,
          version: module.version,
          kind: module.kind,
          source: label,
          deployments: [spec.name],
        })
      }
    }
  }

  return {
    deployments,
    modulePaths: roots,
    modules: [...inventory.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.version.localeCompare(b.version) ||
        a.source.localeCompare(b.source),
    ),
  }
}
