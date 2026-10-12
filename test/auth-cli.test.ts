import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))

test('auth CLI: optional auth values preserve the project name and directory in either order', async () => {
  const cases = [
    { args: ['--auth', 'notes'], directory: 'notes', authenticated: true },
    { args: ['--auth', '--dir', 'out', 'notes'], directory: 'out', authenticated: true },
    { args: ['notes', '--dir', 'out', '--auth'], directory: 'out', authenticated: true },
    { args: ['--auth', 'session', 'notes'], directory: 'notes', authenticated: true },
    { args: ['--auth=none', 'notes'], directory: 'notes', authenticated: false },
    { args: ['notes', '--auth', 'none'], directory: 'notes', authenticated: false },
  ]
  for (const example of cases) {
    const dir = await mkdtemp(join(tmpdir(), 'ket-auth-cli-'))
    try {
      const result = spawnSync(process.execPath, [cli, 'new', ...example.args], {
        cwd: dir,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, `${example.args.join(' ')}: ${result.stderr}`)
      const target = join(dir, example.directory)
      const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
      assert.equal(manifest.name, 'notes')
      assert.equal(existsSync(join(target, 'modules/auth.ts')), example.authenticated)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test('auth CLI: malformed options and extra positional arguments fail before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-auth-cli-invalid-'))
  try {
    for (const args of [
      ['notes', '--auth='],
      ['notes', '--auth=invalid'],
      ['notes', '--auth', 'invalid'],
      ['notes', '--dir'],
      ['notes', '--dir', '--auth'],
      ['notes', 'extra'],
      ['notes', '--typo'],
    ]) {
      const result = spawnSync(process.execPath, [cli, 'new', ...args], { cwd: dir, encoding: 'utf8' })
      assert.notEqual(result.status, 0, args.join(' '))
      assert.equal(existsSync(join(dir, 'notes')), false)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
