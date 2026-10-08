import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const cli = resolve('packages/ketjs/dist/cli.js')
const entry = pathToFileURL(resolve('packages/ketjs/dist/index.js')).href
const fixture = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-openapi-cli-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', version: '1.2.3' }))
    writeFileSync(
      join(dir, 'ket.workspace.mjs'),
      `import { defineDeployment, defineModule, defineWorkspace, httpRoutes } from ${JSON.stringify(entry)}
const module = (name, auth) => defineModule({
  name,
  functions: { list: { anonymous: true, output: { id: 'id' }, returns: 'many', handler: async () => [] } },
  routes: httpRoutes({ profile: name, auth }, { 'GET /items': { call: name + '.list' } }),
})
export default defineWorkspace({ deployments: [
  defineDeployment({ name: 'public_docs', headless: true, modules: [module('public_docs', 'public')], serve: { openStore: async () => { throw new Error('document generation must not boot storage') } } }),
  defineDeployment({ name: 'private_docs', headless: true, modules: [module('private_docs', 'required')], serve: { openStore: async () => { throw new Error('document generation must not boot storage') } } }),
] })
`,
    )
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const command = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [cli, 'openapi', '--workspace', 'ket.workspace.mjs', ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 10000,
  })

test('openapi CLI prints the selected deployment contract without booting its store', () => {
  fixture((dir) => {
    const result = command(dir, '--deployment', 'public_docs')
    assert.equal(result.status, 0, result.stderr)
    const doc = JSON.parse(result.stdout)
    assert.equal(doc.openapi, '3.1.0')
    assert.deepEqual(doc.info, { title: 'public_docs API', version: '1.2.3' })
    assert.deepEqual(doc.paths['/items'].get.security, [])
    assert.equal(doc.paths['/items'].get.operationId, 'public_docs.public_docs.list')
    assert.equal(existsSync(join(dir, '.ket/public_docs.db')), false)
  })
})

test('openapi CLI writes deterministic nested output and applies an explicit profile over options', () => {
  fixture((dir) => {
    writeFileSync(
      join(dir, 'options.json'),
      JSON.stringify({ profile: 'unused', info: { title: 'Public API', version: '7.0' } }),
    )
    const args = ['--deployment', 'public_docs', '--profile', 'public_docs', '--options', 'options.json']
    const printed = command(dir, ...args)
    assert.equal(printed.status, 0, printed.stderr)
    const output = 'generated/contracts/public.json'
    const written = command(dir, ...args, '--out', output)
    assert.equal(written.status, 0, written.stderr)
    assert.equal(readFileSync(join(dir, output), 'utf8'), printed.stdout)
    assert.deepEqual(JSON.parse(printed.stdout).info, { title: 'Public API', version: '7.0' })
    assert.ok(JSON.parse(printed.stdout).paths['/items'])
  })
})

test('openapi CLI refuses omitted security and accepts the caller-owned scheme definition', () => {
  fixture((dir) => {
    const missing = command(dir, '--deployment', 'private_docs', '--out', 'protected.json')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /E_OPENAPI_SECURITY/)
    assert.equal(existsSync(join(dir, 'protected.json')), false)
    const options = {
      info: { title: 'Private API', version: '2' },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      security: [{ bearer: [] }],
    }
    writeFileSync(join(dir, 'options.json'), JSON.stringify(options))
    const result = command(dir, '--deployment', 'private_docs', '--options', 'options.json')
    assert.equal(result.status, 0, result.stderr)
    const doc = JSON.parse(result.stdout)
    assert.deepEqual(doc.paths['/items'].get.security, options.security)
    assert.deepEqual(doc.components.securitySchemes, options.securitySchemes)
  })
})

test('openapi CLI rejects invalid metadata and incomplete option values before writing a document', () => {
  fixture((dir) => {
    writeFileSync(join(dir, 'options.json'), JSON.stringify({ info: { title: 'API', version: false } }))
    const invalid = command(
      dir,
      '--deployment',
      'public_docs',
      '--options',
      'options.json',
      '--out',
      'invalid.json',
    )
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /info.*title.*version/)
    assert.equal(existsSync(join(dir, 'invalid.json')), false)
    for (const option of ['out', 'profile', 'options', 'deployment']) {
      const missing = command(dir, `--${option}`)
      assert.equal(missing.status, 1)
      assert.match(missing.stderr, new RegExp(`--${option} requires a value`))
    }
    for (const options of [
      { info: null },
      { profile: false },
      { servers: [{ url: 42 }] },
      { securitySchemes: [] },
      { security: [{ bearer: 'wrong-scope-list' }] },
    ]) {
      writeFileSync(join(dir, 'options.json'), JSON.stringify(options))
      const rejected = command(dir, '--options', 'options.json', '--out', 'invalid.json')
      assert.equal(rejected.status, 1, rejected.stderr)
      assert.match(rejected.stderr, /--options/)
      assert.equal(existsSync(join(dir, 'invalid.json')), false)
    }
  })
})
