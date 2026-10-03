import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { runTask, taskKey, taskEnvironment } from './ci-task-cache.mjs'

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-task-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  /** @param {string} path @param {string} content */
  const put = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  put('.gitignore', '.task-cache/\nnode_modules/\n')
  put('source.ts', 'export const value = 1')
  put('package-lock.json', '{}')
  execFileSync('git', ['add', '.'], { cwd: root })
  return { root, put }
}

test('success is reused across runs; force executes again', (t) => {
  const { root } = fixture(t)
  let executions = 0
  const execute = () => {
    executions++
    return 0
  }
  assert.equal(runTask(root, 'lint', { execute }).hit, false)
  assert.equal(runTask(root, 'lint', { execute }).hit, true)
  assert.equal(executions, 1)
  assert.equal(runTask(root, 'lint', { execute, force: true }).hit, false)
  assert.equal(executions, 2)
})

for (const path of [
  'source.ts',
  'new-file.ts',
  'package-lock.json',
  'tsconfig.json',
  'biome.json',
  '.github/actions/task-cache/action.yml',
  'node_modules/typescript/package.json',
]) {
  test(`dirty, untracked or toolchain input ${path} invalidates success`, (t) => {
    const { root, put } = fixture(t)
    const key = taskKey(root, 'lint')
    put(path, 'changed')
    assert.notEqual(taskKey(root, 'lint'), key)
    put(path, 'another change')
    let calls = 0
    runTask(root, 'lint', {
      execute: () => {
        calls++
        return 0
      },
    })
    put(path, 'yet another change')
    runTask(root, 'lint', {
      execute: () => {
        calls++
        return 0
      },
    })
    assert.equal(calls, 2)
  })
}

test('deleted tracked input invalidates cache without relying on index state', (t) => {
  const { root } = fixture(t)
  const before = taskKey(root, 'lint')
  rmSync(join(root, 'source.ts'))
  assert.notEqual(taskKey(root, 'lint'), before)
})

test('failure is never cached and failed forced rerun removes previous success', (t) => {
  const { root } = fixture(t)
  runTask(root, 'lint', { execute: () => 0 })
  assert.equal(runTask(root, 'lint', { force: true, execute: () => 7 }).status, 7)
  assert.equal(runTask(root, 'lint', { execute: () => 7 }).status, 7)
  assert.equal(runTask(root, 'lint', { execute: () => 0 }).hit, false)
})

test('corrupted receipt is a miss', (t) => {
  const { root, put } = fixture(t)
  const { key } = runTask(root, 'lint', { execute: () => 0 })
  put(`.task-cache/lint/${key}.json`, '{invalid')
  assert.equal(runTask(root, 'lint', { execute: () => 0 }).hit, false)
})

test('inputs changing during execution fail without saving success', (t) => {
  const { root, put } = fixture(t)
  assert.equal(
    runTask(root, 'lint', {
      execute: () => {
        put('source.ts', 'changed')
        return 0
      },
    }).status,
    1,
  )
  assert.equal(runTask(root, 'lint', { execute: () => 0 }).hit, false)
})

test('task and runtime are isolated; mtimes and result files do not affect hash', (t) => {
  const { root, put } = fixture(t)
  const runtime = { node: 'v26.0.0', platform: 'linux', arch: 'x64' }
  const key = taskKey(root, 'lint', runtime)
  assert.notEqual(taskKey(root, 'format', runtime), key)
  for (const [field, value] of [
    ['node', 'v26.1.0'],
    ['platform', 'darwin'],
    ['arch', 'arm64'],
  ])
    assert.notEqual(taskKey(root, 'lint', { ...runtime, [field]: value }), key)
  put('source.ts', 'export const value = 1')
  put('.task-cache/lint/ignored.json', '{}')
  assert.equal(taskKey(root, 'lint', runtime), key)
})

test('controlled environment excludes credentials and behavior overrides', () => {
  const env = taskEnvironment({
    PATH: '/bin',
    HOME: '/home/test',
    NODE_OPTIONS: '--require bad.js',
    DATABASE_URL: 'secret',
    NPM_TOKEN: 'secret',
    TZ: 'Pacific/Honolulu',
    CI: 'false',
  })
  assert.deepEqual(env, {
    PATH: '/bin',
    HOME: '/home/test',
    CI: 'true',
    TZ: 'UTC',
    LANG: 'C.UTF-8',
    NO_COLOR: '1',
  })
})

test('DB, browser, publication and arbitrary commands cannot be cached', (t) => {
  const { root } = fixture(t)
  for (const task of ['postgres', 'e2e', 'publish', '../lint', 'constructor'])
    assert.throws(() => runTask(root, task), /not cacheable/)
})

test('types include generated ignored declarations and JS', (t) => {
  const { root, put } = fixture(t)
  put('.gitignore', '.task-cache/\nnode_modules/\npackages/*/dist/\n.types/\n')
  const before = taskKey(root, 'types')
  put('packages/sample/dist/index.d.ts', 'export declare const changed: number')
  assert.notEqual(taskKey(root, 'types'), before)
  const next = taskKey(root, 'types')
  put('.types/sample/index.d.ts', 'export declare const value: number')
  assert.notEqual(taskKey(root, 'types'), next)
})
