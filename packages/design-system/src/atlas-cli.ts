#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToString } from '@ketvietlab/ketjs-view'
import { AppShell, ListPage, Metric, RecordPage, Section, Surface, WorkspacePage } from './index.ts'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = [
  resolve(sourceDirectory, '../package.json'),
  resolve(sourceDirectory, '../../../../packages/design-system/package.json'),
].find((candidate) => existsSync(candidate))
if (!packageJsonPath) throw new Error('Cannot locate @ketvietlab/design-system package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  name: string
  version: string
  repository?: { url?: string }
}
const profile = JSON.parse(readFileSync(join(sourceDirectory, 'atlas/profile.json'), 'utf8')) as {
  schemaVersion: string
  id: string
  materializer: { lockFile: string }
  assets: Array<{ kind: string; path: string; load: string }>
  composition: {
    global: string
    templatesProperty: string
    attachProperty: string
    slotPattern: string
  }
}
const inventory = JSON.parse(
  readFileSync(join(sourceDirectory, 'catalogue/inventory.generated.json'), 'utf8'),
) as { summary: { registeredComponents: number } }

const marker = (name: string): string => profile.composition.slotPattern.replace('{NAME}', name.toUpperCase())
const markers = {
  actions: marker('actions'),
  aside: marker('aside'),
  asideLabel: marker('aside_label'),
  body: marker('body'),
  context: marker('context'),
  controls: marker('controls'),
  description: marker('description'),
  detail: marker('detail'),
  label: marker('label'),
  main: marker('main'),
  meta: marker('meta'),
  navigation: marker('navigation'),
  sidebar: marker('sidebar'),
  status: marker('status'),
  title: marker('title'),
  value: marker('value'),
} as const

const assetPath = (kind: string, name: string): string => {
  const asset = profile.assets.find((candidate) => candidate.kind === kind && candidate.path.includes(name))
  if (!asset) throw new Error(`Két adapter profile is missing its ${name} ${kind} asset`)
  return asset.path
}

const sha256 = (source: string): string => createHash('sha256').update(source).digest('hex')
const normalizedRepository = (value: string | undefined): string | null =>
  value?.replace(/^git\+/u, '').replace(/\.git$/u, '') ?? null

const bundleCss = (path: string, ancestors: readonly string[] = []): string => {
  const absolute = resolve(path)
  if (ancestors.includes(absolute))
    throw new Error(`Circular design-system CSS import: ${[...ancestors, absolute].join(' -> ')}`)
  const source = readFileSync(absolute, 'utf8')
  return source.replace(/^@import\s+["']([^"']+)["'];\s*$/gmu, (_statement, request: string) => {
    if (!request.startsWith('.')) throw new Error(`External CSS import is not materializable: ${request}`)
    const imported = resolve(dirname(absolute), request)
    const label = relative(sourceDirectory, imported).replaceAll('\\', '/')
    return `/* inlined: ${label} */\n${bundleCss(imported, [...ancestors, absolute]).trimEnd()}`
  })
}

const renderContracts = (): string => {
  const templates = {
    list: renderToString(
      ListPage({
        title: markers.title,
        context: markers.context,
        description: markers.description,
        actions: markers.actions,
        controls: markers.controls,
        status: markers.status,
        body: markers.body,
        variant: 'operational',
      }),
    ),
    record: renderToString(
      RecordPage({
        title: markers.title,
        context: markers.context,
        description: markers.description,
        status: markers.status,
        actions: markers.actions,
        meta: markers.meta,
        navigation: markers.navigation,
        body: markers.body,
        aside: markers.aside,
        asideLabel: markers.asideLabel,
        variant: 'operational',
      }),
    ),
    'record-solo': renderToString(
      RecordPage({
        title: markers.title,
        context: markers.context,
        description: markers.description,
        status: markers.status,
        actions: markers.actions,
        meta: markers.meta,
        navigation: markers.navigation,
        body: markers.body,
        variant: 'operational',
      }),
    ),
    flow: renderToString(
      WorkspacePage({
        title: markers.title,
        context: markers.context,
        description: markers.description,
        status: markers.status,
        actions: markers.actions,
        controls: markers.controls,
        body: markers.body,
        layout: 'flow',
        variant: 'operational',
      }),
    ),
    canvas: renderToString(
      WorkspacePage({
        title: markers.title,
        context: markers.context,
        description: markers.description,
        status: markers.status,
        actions: markers.actions,
        controls: markers.controls,
        body: markers.body,
        layout: 'canvas',
        variant: 'operational',
      }),
    ),
    shell: renderToString(AppShell({ sidebar: markers.sidebar, main: markers.main, mode: 'viewport' })),
    surface: renderToString(Surface({ body: markers.body })),
    'surface-none': renderToString(Surface({ body: markers.body, padding: 'none' })),
    section: renderToString(
      Surface({
        body: Section({
          title: markers.title,
          description: markers.description,
          actions: markers.actions,
          body: markers.body,
        }),
      }),
    ),
    metric: renderToString(Metric({ label: markers.label, value: markers.value, detail: markers.detail })),
  }
  const revision = process.env.KET_DESIGN_SYSTEM_REVISION ?? packageJson.version
  const global = JSON.stringify(profile.composition.global)
  const property = JSON.stringify(profile.composition.templatesProperty)
  return `/* Generated by ${packageJson.name}@${packageJson.version} (${revision}). Do not edit. */\nwindow[${global}] = window[${global}] || {};\nwindow[${global}][${property}] = ${JSON.stringify(templates)};\n`
}

const renderRuntime = (): string => {
  const moduleSource = readFileSync(join(sourceDirectory, 'runtime/index.js'), 'utf8')
  const classicSource = moduleSource.replace(
    'export const attachDesignSystemInteractions',
    'const attachDesignSystemInteractions',
  )
  if (classicSource === moduleSource || /\bexport\s/u.test(classicSource))
    throw new Error('Design-system runtime can no longer be converted to a classic KetAtlas script')
  const global = JSON.stringify(profile.composition.global)
  const property = JSON.stringify(profile.composition.attachProperty)
  return `${classicSource.trimEnd()}\n\nwindow[${global}] = window[${global}] || {};\nwindow[${global}][${property}] = attachDesignSystemInteractions;\nif (document.readyState === 'loading') {\n  document.addEventListener('DOMContentLoaded', () => attachDesignSystemInteractions(), { once: true })\n} else {\n  attachDesignSystemInteractions()\n}\n`
}

type MaterializedFile = { path: string; content: string }

const expectedMaterialization = (): { files: MaterializedFile[]; lock: string } => {
  const css = `${bundleCss(join(sourceDirectory, 'styles.css')).trimEnd()}\n`
  const contracts = renderContracts()
  const runtime = renderRuntime()
  const files = [
    { path: assetPath('stylesheet', 'design-system'), content: css },
    { path: assetPath('script', 'contracts'), content: contracts },
    { path: assetPath('script', 'runtime'), content: runtime },
  ]
  const lock = {
    schemaVersion: 'ketatlas.design-system-lock.v1',
    adapterSchemaVersion: profile.schemaVersion,
    adapter: profile.id,
    source: packageJson.name,
    version: packageJson.version,
    revision: process.env.KET_DESIGN_SYSTEM_REVISION ?? packageJson.version,
    repository: normalizedRepository(packageJson.repository?.url),
    materialization:
      'Exact public CSS with local imports inlined; canonical SSR contracts; no token overrides.',
    registeredComponents: inventory.summary.registeredComponents,
    files: files.map((file) => ({ path: file.path, sha256: sha256(file.content) })),
  }
  return { files, lock: `${JSON.stringify(lock, null, 2)}\n` }
}

const requireAtlas = (directory: string): string => {
  const target = resolve(directory)
  if (!existsSync(join(target, 'atlas.json')))
    throw new Error(`KetAtlas project not found: ${join(target, 'atlas.json')}`)
  return target
}

export const materializeAtlasDesignSystem = (
  directory: string,
  mode: 'materialize' | 'check' = 'materialize',
): void => {
  const target = requireAtlas(directory)
  const expected = expectedMaterialization()
  const files = [...expected.files, { path: profile.materializer.lockFile, content: expected.lock }]
  if (mode === 'check') {
    const stale = files.filter(({ path, content }) => {
      const destination = join(target, path)
      return !existsSync(destination) || readFileSync(destination, 'utf8') !== content
    })
    if (stale.length)
      throw new Error(
        `KetAtlas design-system materialization is stale: ${stale.map((file) => file.path).join(', ')}`,
      )
    process.stdout.write(
      `KetAtlas design system is current (${packageJson.version}, ${files.length} files).\n`,
    )
    return
  }
  for (const { path, content } of files) {
    const destination = join(target, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
  }
  process.stdout.write(`Materialized ${packageJson.name}@${packageJson.version} into ${target}.\n`)
}

const help = `ket-design-system-atlas — materialize the Két design system for self-contained HTML mockups

  ket-design-system-atlas materialize <atlas-directory>
  ket-design-system-atlas check <atlas-directory>
`

const main = (): void => {
  const [, , command = 'help', directory] = process.argv
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(help)
    return
  }
  if ((command !== 'materialize' && command !== 'check') || !directory) {
    process.stderr.write(help)
    process.exitCode = 1
    return
  }
  materializeAtlasDesignSystem(directory, command)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
