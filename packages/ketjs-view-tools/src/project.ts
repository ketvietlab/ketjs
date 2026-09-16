import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { escapeHtml, renderToStaticString } from '@ketvietlab/ketjs-view'
import type {
  BuildResult,
  ClientIslandDefinition,
  PageDefinition,
  ResolvedViewConfig,
  ViewConfig,
} from './types.ts'

const CONFIG_NAMES = [
  'ket-view.config.ts',
  'ket-view.config.mts',
  'ket-view.config.js',
  'ket-view.config.mjs',
]
const PAGE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'])

const slash = (path: string): string => path.split(sep).join('/')

const assertInside = (root: string, path: string, label: string): void => {
  const child = relative(root, path)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error(`${label} must be inside the project root`)
}

const contains = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function importSource(path: string, root: string): Promise<Record<string, unknown>> {
  const temporary = join(root, 'node_modules', '.ket-view')
  mkdirSync(temporary, { recursive: true })
  const outfile = join(
    temporary,
    `module-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  )
  try {
    await build({
      entryPoints: [path],
      outfile,
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      target: 'node24',
      sourcemap: 'inline',
      logLevel: 'silent',
    })
    return (await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`)) as Record<string, unknown>
  } finally {
    rmSync(outfile, { force: true })
  }
}

export async function loadConfig(root = process.cwd()): Promise<ResolvedViewConfig> {
  const projectRoot = resolve(root)
  const configFile = CONFIG_NAMES.map((name) => join(projectRoot, name)).find(existsSync)
  if (!configFile) throw new Error(`missing ket-view.config.ts in ${projectRoot}`)
  const imported = await importSource(configFile, projectRoot)
  const source = imported.default
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    throw new Error(`${configFile} must export defineConfig(...) as default`)
  const config = source as ViewConfig
  const pages = resolve(projectRoot, config.pages ?? 'src/pages')
  const publicDir = resolve(projectRoot, config.publicDir ?? 'public')
  const outDir = resolve(projectRoot, config.outDir ?? 'dist')
  assertInside(projectRoot, pages, 'pages')
  assertInside(projectRoot, publicDir, 'publicDir')
  assertInside(projectRoot, outDir, 'outDir')
  if (contains(outDir, pages) || contains(pages, outDir))
    throw new Error('pages and outDir must not contain one another')
  if (contains(outDir, publicDir) || contains(publicDir, outDir))
    throw new Error('publicDir and outDir must not contain one another')
  const base = !config.base || config.base === '.' ? './' : config.base
  if (base !== './' && (!base.startsWith('/') || !base.endsWith('/')))
    throw new Error('base must be "./" or an absolute URL path ending in "/"')
  const islands = Object.fromEntries(
    Object.entries(config.islands ?? {}).map(([name, definition]) => {
      if (!/^[a-z][a-z0-9-]*$/.test(name))
        throw new Error(`invalid island name "${name}"; use lowercase kebab-case`)
      const normalized: ClientIslandDefinition =
        typeof definition === 'string' ? { entry: definition } : definition
      if (!normalized.entry) throw new Error(`island "${name}" is missing its entry module`)
      if (normalized.export && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalized.export))
        throw new Error(`island "${name}" has invalid export name "${normalized.export}"`)
      return [name, normalized]
    }),
  )
  for (const [label, path] of [
    ...(config.styles ?? []).map((path, index) => [`styles[${index}]`, resolve(projectRoot, path)] as const),
    ...Object.entries(islands).map(
      ([name, definition]) => [`islands.${name}`, resolve(projectRoot, definition.entry)] as const,
    ),
  ]) {
    assertInside(projectRoot, path, label)
    if (contains(outDir, path)) throw new Error(`${label} must not be inside outDir`)
  }
  return {
    root: projectRoot,
    configFile,
    pages,
    publicDir,
    outDir,
    base,
    styles: config.styles ?? [],
    islands,
    host: config.host ?? '127.0.0.1',
    port: config.port ?? 5173,
  }
}

const visit = (directory: string, files: string[]): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path, files)
    else if (PAGE_EXTENSIONS.has(extname(entry.name))) files.push(path)
  }
}

export function discoverPages(config: ResolvedViewConfig): string[] {
  if (!existsSync(config.pages)) throw new Error(`pages directory does not exist: ${config.pages}`)
  const files: string[] = []
  visit(config.pages, files)
  if (files.length === 0) throw new Error(`no page modules found in ${config.pages}`)
  return files.sort()
}

const inferredRoute = (config: ResolvedViewConfig, file: string): string => {
  let name = slash(relative(config.pages, file)).replace(/\.(?:[cm]?[jt]sx?)$/, '')
  if (name.split('/').some((part) => part.startsWith('[')))
    throw new Error(`dynamic page names are not supported: ${relative(config.root, file)}`)
  if (name === 'index') return '/'
  if (name.endsWith('/index')) name = name.slice(0, -'/index'.length)
  return `/${name}/`
}

const checkedRoute = (route: string, file: string): string => {
  if (!route.startsWith('/') || !route.endsWith('/') || route.includes('?') || route.includes('#'))
    throw new Error(`page route "${route}" from ${file} must start and end with "/"`)
  if (route.includes('..') || route.includes('//') || route.includes('\\'))
    throw new Error(`unsafe page route "${route}" from ${file}`)
  return route
}

async function loadPages(
  config: ResolvedViewConfig,
): Promise<Array<{ source: string; route: string; page: PageDefinition }>> {
  const loaded = []
  const routes = new Map<string, string>()
  for (const file of discoverPages(config)) {
    const imported = await importSource(file, config.root)
    const page = imported.default as PageDefinition | undefined
    if (!page || typeof page !== 'object' || typeof page.view !== 'function')
      throw new Error(`${relative(config.root, file)} must default-export definePage({ head, view })`)
    if (!page.head || typeof page.head.title !== 'string')
      throw new Error(`${relative(config.root, file)} must define head.title`)
    const route = checkedRoute(page.path ?? inferredRoute(config, file), relative(config.root, file))
    const previous = routes.get(route)
    if (previous)
      throw new Error(`duplicate page route "${route}": ${previous} and ${relative(config.root, file)}`)
    routes.set(route, relative(config.root, file))
    loaded.push({ source: file, route, page })
  }
  return loaded
}

const quoted = (value: string): string => JSON.stringify(value)

const clientSource = (config: ResolvedViewConfig): string => {
  const imports: string[] = []
  const registry: string[] = []
  for (const [index, [name, definition]] of Object.entries(config.islands).entries()) {
    const binding = `island${index}`
    const path = slash(resolve(config.root, definition.entry))
    const imported = definition.export ?? 'default'
    imports.push(
      imported === 'default'
        ? `import ${binding} from ${quoted(path)}`
        : `import { ${imported} as ${binding} } from ${quoted(path)}`,
    )
    registry.push(`${quoted(name)}: ${binding}`)
  }
  for (const style of config.styles) imports.push(`import ${quoted(slash(resolve(config.root, style)))}`)
  if (registry.length)
    imports.push(
      `import { domHost, hydrateIslands } from '@ketvietlab/ketjs-view'`,
      `hydrateIslands(domHost(document), document, { ${registry.join(', ')} })`,
    )
  return imports.join('\n')
}

const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return []
  const files: string[] = []
  const collect = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) collect(child)
      else files.push(slash(relative(directory, child)))
    }
  }
  collect(directory)
  return files.sort()
}

async function bundleAssets(config: ResolvedViewConfig, write: boolean): Promise<string[]> {
  const hasIslands = Object.keys(config.islands).length > 0
  if (!hasIslands && config.styles.length === 0) return []
  const temporary = write ? null : mkdtempSync(join(tmpdir(), 'ket-view-check-'))
  const outdir = temporary ?? config.outDir
  const source = hasIslands
    ? { contents: clientSource(config), sourcefile: 'ket-view-client.ts', loader: 'ts' as const }
    : {
        contents: config.styles
          .map((style) => `@import ${quoted(slash(resolve(config.root, style)))};`)
          .join('\n'),
        sourcefile: 'ket-view-client.css',
        loader: 'css' as const,
      }
  try {
    await build({
      stdin: {
        resolveDir: config.root,
        ...source,
      },
      outdir,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      entryNames: 'assets/app-[hash]',
      assetNames: 'assets/[name]-[hash]',
      minify: write,
      sourcemap: write,
      logLevel: 'silent',
      write,
    })
    return write ? listFiles(config.outDir).filter((file) => file.startsWith('assets/')) : []
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}

const assetUrl = (config: ResolvedViewConfig, htmlFile: string, asset: string): string => {
  if (config.base !== './') return `${config.base}${asset}`
  const path = slash(relative(dirname(htmlFile), join(config.outDir, asset)))
  return path.startsWith('.') ? path : `./${path}`
}

const documentHtml = (
  config: ResolvedViewConfig,
  page: PageDefinition,
  htmlFile: string,
  body: string,
  assets: readonly string[],
  reload: boolean,
): string => {
  const css = assets.filter((file) => file.endsWith('.css'))
  const js = assets.find((file) => file.endsWith('.js'))
  const head = page.head
  const hasIslands = body.includes(' data-island="')
  const tags = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(head.title)}</title>`,
    ...(head.description ? [`<meta name="description" content="${escapeHtml(head.description)}">`] : []),
    ...(head.meta ?? []).map(
      (meta) => `<meta name="${escapeHtml(meta.name)}" content="${escapeHtml(meta.content)}">`,
    ),
    ...(head.links ?? []).map(
      (link) =>
        `<link rel="${escapeHtml(link.rel)}" href="${escapeHtml(link.href)}"${link.type ? ` type="${escapeHtml(link.type)}"` : ''}>`,
    ),
    ...css.map((file) => `<link rel="stylesheet" href="${assetUrl(config, htmlFile, file)}">`),
  ]
  const scripts = [
    ...(js && hasIslands ? [`<script type="module" src="${assetUrl(config, htmlFile, js)}"></script>`] : []),
    ...(reload
      ? [
          `<script>new EventSource('/__ket_view_events').onmessage=function(event){if(event.data==='reload')location.reload()}</script>`,
        ]
      : []),
  ]
  return `<!doctype html>\n<html lang="${escapeHtml(head.lang ?? 'en')}">\n<head>\n  ${tags.join('\n  ')}\n</head>\n<body>\n${body}\n${scripts.map((tag) => `  ${tag}`).join('\n')}\n</body>\n</html>\n`
}

const outputFile = (config: ResolvedViewConfig, route: string): string =>
  route === '/' ? join(config.outDir, 'index.html') : join(config.outDir, route.slice(1), 'index.html')

const validateIslands = (config: ResolvedViewConfig, body: string): void => {
  for (const match of body.matchAll(/\sdata-island="([^"]+)"/g)) {
    const name = match[1] as string
    if (!(name in config.islands))
      throw new Error(`page uses island "${name}", but ket-view.config.ts does not register it`)
  }
}

export async function checkProject(root = process.cwd()): Promise<BuildResult> {
  const config = await loadConfig(root)
  const pages = await loadPages(config)
  await bundleAssets(config, false)
  for (const { page } of pages) validateIslands(config, renderToStaticString(page.view()))
  return { outDir: config.outDir, pages: pages.map(({ route }) => ({ route, file: '' })), assets: [] }
}

export async function buildProject(
  root = process.cwd(),
  options: { reload?: boolean } = {},
): Promise<BuildResult> {
  const config = await loadConfig(root)
  const pages = await loadPages(config)
  const stage = mkdtempSync(join(config.root, '.ket-view-stage-'))
  const backup = `${config.outDir}.ket-view-backup-${process.pid}`
  const stagedConfig = { ...config, outDir: stage }
  try {
    if (existsSync(config.publicDir)) cpSync(config.publicDir, stage, { recursive: true })
    const assets = await bundleAssets(stagedConfig, true)
    const output = []
    for (const { route, page } of pages) {
      const file = outputFile(stagedConfig, route)
      const body = renderToStaticString(page.view())
      validateIslands(config, body)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, documentHtml(stagedConfig, page, file, body, assets, options.reload ?? false))
      output.push({ route, file: join(config.outDir, relative(stage, file)) })
    }
    rmSync(backup, { recursive: true, force: true })
    if (existsSync(config.outDir)) renameSync(config.outDir, backup)
    try {
      renameSync(stage, config.outDir)
      rmSync(backup, { recursive: true, force: true })
    } catch (error) {
      if (!existsSync(config.outDir) && existsSync(backup)) renameSync(backup, config.outDir)
      throw error
    }
    return { outDir: config.outDir, pages: output, assets }
  } catch (error) {
    rmSync(stage, { recursive: true, force: true })
    if (!existsSync(config.outDir) && existsSync(backup)) renameSync(backup, config.outDir)
    throw error
  }
}

export function readProjectFile(path: string): Uint8Array {
  return readFileSync(path)
}
