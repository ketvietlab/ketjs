import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { sqliteAdapter } from '@ketvietlab/ketjs'
import { verifyPassword } from '@ketvietlab/ketsuite'
import { ensureDevelopmentAdmin } from '../packages/ketsuite/src/development.ts'
import { scaffoldKetsuite } from '../packages/ketsuite/src/scaffold/index.ts'

test('KetSuite scaffold writes the packaged app and safe development scripts', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ketsuite-scaffold-'))
  const target = join(parent, 'my-suite')
  try {
    const output = scaffoldKetsuite('my_suite', target)
    assert.ok(output.some((line) => line.includes('npm install && npm run dev')))
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies['@ketvietlab/ketsuite'], '^0.1.3')
    assert.equal(pkg.scripts.dev, 'ketsuite serve --dev-admin')
    assert.equal(pkg.scripts.start, 'ketsuite serve')
    assert.equal(
      await readFile(join(target, 'ket.workspace.mjs'), 'utf8'),
      "export { apps } from '@ketvietlab/ketsuite/app'\n",
    )
    assert.throws(() => scaffoldKetsuite('my_suite', target), /refusing to overwrite/)
    assert.throws(() => scaffoldKetsuite('My-Suite', join(parent, 'invalid')), /invalid app name/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('development bootstrap creates admin/admin once on an empty SQLite database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ketsuite-dev-admin-'))
  const database = join(dir, 'ketsuite.db')
  const env = {
    ...process.env,
    KET_SQLITE: database,
    KET_STORAGE_DIR: join(dir, 'storage'),
  }
  try {
    assert.equal(await ensureDevelopmentAdmin(undefined, env), 'created')
    assert.equal(await ensureDevelopmentAdmin(undefined, env), 'exists')

    const adapter = sqliteAdapter(database)
    await adapter.open()
    try {
      const rows = await adapter.all('SELECT login, "passwordHash", superuser FROM user_user')
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.login, 'admin')
      assert.equal(rows[0]?.superuser, 1)
      assert.equal(await verifyPassword('admin', String(rows[0]?.passwordHash)), true)
    } finally {
      await adapter.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
