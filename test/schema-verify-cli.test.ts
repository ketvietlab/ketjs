import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { compose, defineModule, migrateOne, schemaFromManifest, sqliteAdapter } from '@ketvietlab/ketjs'

const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))

const runCli = async (
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: undefined,
      KET_SQLITE: undefined,
      NODE_NO_WARNINGS: '1',
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (status) => resolve(status ?? 1))
  })
  return { code, stdout, stderr }
}

const manifestWith = (value: 'text' | 'text?') =>
  compose(
    [
      defineModule({
        name: 'schema_cli',
        models: {
          Entry: {
            scope: 'shared',
            fields: { id: 'id', value },
          },
        },
      }),
    ],
    { headless: true },
  )

const workspaceSource = (ketEntry: string, database: string): string => `
import { defineDeployment, defineModule } from ${JSON.stringify(ketEntry)}
const schema = defineModule({
  name: 'schema_cli',
  models: {
    Entry: {
      scope: 'shared',
      fields: { id: 'id', value: 'text' },
    },
  },
})
export const deployments = [defineDeployment({
  name: 'schema_app',
  modules: [schema],
  headless: true,
  serve: { defaults: { sqliteFile: ${JSON.stringify(database)} } },
})]
`

const tenantWorkspaceSource = (ketEntry: string, directory: string): string => `
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineDeployment, defineModule, sqliteAdapter } from ${JSON.stringify(ketEntry)}
const schema = defineModule({
  name: 'schema_cli',
  models: {
    Entry: {
      scope: 'shared',
      fields: { id: 'id', value: 'text' },
    },
  },
})
const file = (key) => join(${JSON.stringify(directory)}, key + '.db')
export const deployments = [defineDeployment({
  name: 'schema_fleet',
  modules: [schema],
  headless: true,
  serve: {
    tenants: {
      resolve: () => null,
      list: async () => ['present', 'missing'],
      exists: (key) => existsSync(file(key)),
      open: (key) => sqliteAdapter(file(key)),
    },
  },
})]
`

test('schema verify CLI fails on legacy nullability drift and never changes its marker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-schema-verify-cli-'))
  try {
    const database = join(dir, 'schema.db')
    const workspace = join(dir, 'workspace.mjs')
    const ketEntry = pathToFileURL(
      fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url)),
    ).href
    await writeFile(workspace, workspaceSource(ketEntry, database))

    const adapter = sqliteAdapter(database)
    await adapter.open()
    let markerBefore: Record<string, unknown>[] = []
    try {
      await migrateOne(adapter, manifestWith('text?'), {
        now: () => '2026-08-28T00:00:00.000Z',
      })
      await adapter.run('UPDATE ket_migration SET schema = ? WHERE id = 1', [
        JSON.stringify(schemaFromManifest(manifestWith('text'))),
      ])
      markerBefore = await adapter.all('SELECT schema, applied_at FROM ket_migration WHERE id = 1')
    } finally {
      await adapter.close()
    }

    const result = await runCli(dir, [
      'schema',
      'verify',
      '--deployment',
      'schema_app',
      '--workspace',
      workspace,
    ])
    assert.equal(result.code, 1, result.stdout)
    assert.match(result.stdout, /schema verification failed/)
    assert.match(result.stdout, /physical vs marker/)
    assert.match(result.stdout, /schema_cli_entry\.value is nullable; expected NOT NULL/)
    assert.equal(result.stderr, '')

    const reopened = sqliteAdapter(database)
    await reopened.open()
    try {
      assert.deepEqual(
        await reopened.all('SELECT schema, applied_at FROM ket_migration WHERE id = 1'),
        markerBefore,
      )
    } finally {
      await reopened.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('schema verify CLI refuses to create a missing SQLite datastore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-schema-verify-missing-'))
  try {
    const database = join(dir, 'missing.db')
    const workspace = join(dir, 'workspace.mjs')
    const ketEntry = pathToFileURL(
      fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url)),
    ).href
    await writeFile(workspace, workspaceSource(ketEntry, database))

    const result = await runCli(dir, ['schema', 'verify', '--workspace', workspace])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /does not exist; schema verification will not create it/)
    assert.equal(existsSync(database), false)
    assert.equal(existsSync(join(dir, '.ket')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('schema verify CLI uses tenant existence and never creates a missing tenant datastore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-schema-verify-fleet-'))
  try {
    const present = join(dir, 'present.db')
    const missing = join(dir, 'missing.db')
    const workspace = join(dir, 'workspace.mjs')
    const ketEntry = pathToFileURL(
      fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url)),
    ).href
    await writeFile(workspace, tenantWorkspaceSource(ketEntry, dir))

    const adapter = sqliteAdapter(present)
    await adapter.open()
    try {
      await migrateOne(adapter, manifestWith('text'))
    } finally {
      await adapter.close()
    }

    const one = await runCli(dir, ['schema', 'verify', '--tenant', 'present', '--workspace', workspace])
    assert.equal(one.code, 0, one.stderr)
    assert.match(one.stdout, /ok\s+present/)
    assert.equal(existsSync(join(dir, '.ket', 'schema_fleet.db')), false)

    const absent = await runCli(dir, ['schema', 'verify', '--tenant', 'missing', '--workspace', workspace])
    assert.equal(absent.code, 1)
    assert.match(absent.stderr, /tenant datastore "missing" does not exist/)
    assert.equal(existsSync(missing), false)

    const all = await runCli(dir, ['schema', 'verify', '--all', '--workspace', workspace])
    assert.equal(all.code, 1, all.stderr)
    assert.match(all.stdout, /ok\s+present/)
    assert.match(all.stdout, /FAIL\s+missing\s+datastore does not exist/)
    assert.equal(existsSync(missing), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
