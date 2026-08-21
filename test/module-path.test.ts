import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  composeWorkspace,
  defineApp,
  defineModule,
  defineWorkspace,
  resolveWorkspace,
} from '@ketvietlab/ketjs'
import type { WorkspaceDeclaration } from '@ketvietlab/ketjs'

const moduleBody = (name: string, depends: string[] = [], kind: 'module' | 'theme' = 'module') => `
export default Object.freeze({
  kind: ${JSON.stringify(kind)},
  name: ${JSON.stringify(name)},
  version: '1.2.3',
  depends: Object.freeze(${JSON.stringify(depends)}),
  models: {}, extend: {}, joints: {}, fills: {}, functions: {}, jobs: {}, views: {},
  requires: Object.freeze([]), tokens: {}, templates: {}, provides: Object.freeze([]),
  assets: null, styles: Object.freeze([]), routes: {}, menus: {}, omits: Object.freeze([]),
  islands: {}, sections: {}, relations: {}, app: true, title: ${JSON.stringify(name)},
  summary: '', category: 'Custom', install: 'manual', removable: true, messages: {},
})
`

const fixture = (t: { after(fn: () => void): void }) => {
  const root = mkdtempSync(join(tmpdir(), 'ket-module-path-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    root,
    baseUrl: pathToFileURL(join(root, 'ket.workspace.js')),
    addRoot(name: string) {
      const path = join(root, name)
      mkdirSync(path, { recursive: true })
      return path
    },
    addModule(
      moduleRoot: string,
      name: string,
      options: { depends?: string[]; kind?: 'module' | 'theme'; entry?: string; body?: string } = {},
    ) {
      const path = join(moduleRoot, name)
      mkdirSync(path, { recursive: true })
      const entry = options.entry ?? 'index.mjs'
      writeFileSync(join(path, 'ket.module.json'), JSON.stringify({ name, entry }, null, 2))
      if (!entry.startsWith('../')) {
        writeFileSync(join(path, entry), options.body ?? moduleBody(name, options.depends, options.kind))
      }
      return path
    },
  }
}

const app = (modules: Array<string | ReturnType<typeof defineModule>>) =>
  defineApp({ name: 'custom', modules, headless: true })

test('module paths: relative roots resolve selected modules and their dependency closure', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  f.addModule(addons, 'custom_base')
  f.addModule(addons, 'custom_feature', { depends: ['custom_base'] })

  const declaration = defineWorkspace({
    modulePaths: ['./addons'],
    apps: [app(['custom_feature'])],
  })
  const resolved = await resolveWorkspace(declaration, { baseUrl: f.baseUrl })

  assert.deepEqual(
    resolved.apps[0]!.modules.map((module) => module.name),
    ['custom_base', 'custom_feature'],
  )
  assert.deepEqual(resolved.modulePaths, [realpathSync(addons)])
  assert.deepEqual(
    resolved.modules.map((module) => [module.name, module.version, module.apps]),
    [
      ['custom_base', '1.2.3', ['custom']],
      ['custom_feature', '1.2.3', ['custom']],
    ],
  )
  assert.equal(Object.keys(composeWorkspace(resolved.apps).apps).join(','), 'custom')
})

test('module paths: path modules may depend on explicitly imported modules', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  f.addModule(addons, 'custom_feature', { depends: ['core'] })
  const core = defineModule({ name: 'core' })

  const resolved = await resolveWorkspace(
    { modulePaths: [addons], apps: [app([core, 'custom_feature'])] },
    { baseUrl: f.baseUrl },
  )

  assert.deepEqual(
    resolved.apps[0]!.modules.map((module) => module.name),
    ['core', 'custom_feature'],
  )
  assert.equal(resolved.modules.find((module) => module.name === 'core')!.source, 'workspace')
})

test('module paths: discovery never executes an unselected module', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  f.addModule(addons, 'selected')
  f.addModule(addons, 'unused', { body: 'throw new Error("must not execute")' })

  const resolved = await resolveWorkspace(
    { modulePaths: [addons], apps: [app(['selected'])] },
    { baseUrl: f.baseUrl },
  )
  assert.deepEqual(
    resolved.apps[0]!.modules.map((module) => module.name),
    ['selected'],
  )
})

test('module paths: two roots may not silently shadow the same module', async (t) => {
  const f = fixture(t)
  const first = f.addRoot('first')
  const second = f.addRoot('second')
  f.addModule(first, 'duplicate')
  f.addModule(second, 'duplicate')

  await assert.rejects(
    resolveWorkspace({ modulePaths: [first, second], apps: [app(['duplicate'])] }, { baseUrl: f.baseUrl }),
    (error: Error & { code?: string }) => error.code === 'E_MODULE_NAME_CLASH' && /both/.test(error.message),
  )
})

test('module paths: production rejects source entries', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  f.addModule(addons, 'source_only', { entry: 'index.ts' })

  await assert.rejects(
    resolveWorkspace({ modulePaths: [addons], apps: [app(['source_only'])] }, { baseUrl: f.baseUrl }),
    (error: Error & { code?: string }) => error.code === 'E_MODULE_ENTRY_EXTENSION',
  )
})

test('module paths: descriptor identity must match the executable module', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  f.addModule(addons, 'expected', { body: moduleBody('different') })

  await assert.rejects(
    resolveWorkspace({ modulePaths: [addons], apps: [app(['expected'])] }, { baseUrl: f.baseUrl }),
    (error: Error & { code?: string }) => error.code === 'E_MODULE_IDENTITY_MISMATCH',
  )
})

test('module paths: an entry may not escape its module directory', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  writeFileSync(join(addons, 'outside.mjs'), moduleBody('escape'))
  f.addModule(addons, 'escape', { entry: '../outside.mjs' })

  await assert.rejects(
    resolveWorkspace({ modulePaths: [addons], apps: [app(['escape'])] }, { baseUrl: f.baseUrl }),
    (error: Error & { code?: string }) => error.code === 'E_MODULE_ENTRY_ESCAPE',
  )
})

test('module paths: a theme reference resolves to AppSpec.theme', async (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  f.addModule(addons, 'base')
  f.addModule(addons, 'custom_theme', { depends: ['base'], kind: 'theme' })
  const declaration: WorkspaceDeclaration = {
    modulePaths: [addons],
    apps: [defineApp({ name: 'site', modules: ['base'], theme: 'custom_theme' })],
  }

  const resolved = await resolveWorkspace(declaration, { baseUrl: f.baseUrl })
  assert.equal(resolved.apps[0]!.theme!.name, 'custom_theme')
  assert.deepEqual(
    resolved.apps[0]!.modules.map((module) => module.name),
    ['base'],
  )
})

test('module graph: duplicate inline names fail instead of last-one-wins', () => {
  const first = defineModule({ name: 'duplicate', version: '1.0.0' })
  const second = defineModule({ name: 'duplicate', version: '2.0.0' })
  assert.throws(
    () => composeWorkspace([defineApp({ name: 'bad', modules: [first, second], headless: true })]),
    /E_MODULE_NAME_CLASH|more than one module is named/,
  )
})

test('module paths: CLI resolves workspace roots and reports module provenance', (t) => {
  const f = fixture(t)
  const addons = f.addRoot('addons')
  const moduleRoot = f.addModule(addons, 'from_cli')
  const workspace = join(f.root, 'workspace.mjs')
  writeFileSync(
    workspace,
    `export default {
      modulePaths: ['./addons'],
      apps: [{ name: 'cli_app', modules: ['from_cli'], headless: true }],
    }`,
  )

  const cli = join(process.cwd(), 'packages/ketjs/dist/cli.js')
  const result = spawnSync(process.execPath, [cli, 'modules', '--workspace', workspace], {
    cwd: f.root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /from_cli\s+1\.2\.3\s+module\s+apps=cli_app/)
  assert.match(result.stdout, new RegExp(realpathSync(moduleRoot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('module paths: repeatable CLI path supplements the workspace declaration', (t) => {
  const f = fixture(t)
  const addons = f.addRoot('external')
  f.addModule(addons, 'from_flag')
  const workspace = join(f.root, 'workspace.mjs')
  writeFileSync(
    workspace,
    `export const apps = [{ name: 'cli_app', modules: ['from_flag'], headless: true }]`,
  )

  const cli = join(process.cwd(), 'packages/ketjs/dist/cli.js')
  const result = spawnSync(
    process.execPath,
    [cli, 'check', '--workspace', workspace, '--module-path', addons],
    { cwd: f.root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /all contracts hold/)
})
