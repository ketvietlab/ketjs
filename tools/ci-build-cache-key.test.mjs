import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { buildArtifactsExist } from './build-artifacts.mjs'
import { buildCacheKey } from './ci-build-cache-key.mjs'

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  /** @param {string} path @param {string} content */
  const put = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
    execFileSync('git', ['add', path], { cwd: root })
  }
  put('packages/sample/src/index.ts', 'export const value = 1')
  put('package-lock.json', '{}')
  put('tsconfig.build.json', '{}')
  put('tools/build.mjs', '// build')
  return { root, put }
}

test('identical content reuses the key independently of file timestamps and git history', (t) => {
  const { root, put } = fixture(t)
  const first = buildCacheKey(root)
  put('packages/sample/src/index.ts', 'export const value = 1')
  assert.equal(buildCacheKey(root), first)
  put('docs/notes.md', 'Documentation without build inputs')
  assert.equal(buildCacheKey(root), first)
})

for (const file of [
  'packages/sample/src/index.ts',
  'packages/sample/src/asset.svg',
  'package-lock.json',
  'tsconfig.build.json',
  'tools/build.mjs',
  'test/new.test.ts',
  '.github/actions/build/action.yml',
]) {
  test(`changing ${file} invalidates compiled artifacts`, (t) => {
    const { root, put } = fixture(t)
    const before = buildCacheKey(root)
    put(file, 'changed input')
    assert.notEqual(buildCacheKey(root), before)
  })
}

test('Node, OS and architecture cannot share artifacts', (t) => {
  const { root } = fixture(t)
  const runtime = { node: 'v26.0.0', platform: 'linux', arch: 'x64' }
  const before = buildCacheKey(root, runtime)
  for (const [field, value] of [
    ['node', 'v26.1.0'],
    ['platform', 'darwin'],
    ['arch', 'arm64'],
  ])
    assert.notEqual(buildCacheKey(root, { ...runtime, [field]: value }), before)
})

test('removing an input invalidates the key; an unreadable tracked input fails closed', (t) => {
  const { root } = fixture(t)
  const before = buildCacheKey(root)
  execFileSync('git', ['rm', '-f', 'packages/sample/src/index.ts'], { cwd: root })
  assert.notEqual(buildCacheKey(root), before)
  rmSync(join(root, 'package-lock.json'))
  assert.throws(() => buildCacheKey(root), /ENOENT/)
})

test('Website Studio built artifacts use client/server layout and require declarations', (t) => {
  const { root, put } = fixture(t)
  put('.build/ket.workspace.js', '')
  put('.types/website-client/client/index.d.ts', '')
  for (const path of ['client/index.js', 'server/extensions.js']) {
    put(`.build/packages/website-client/${path}`, '')
    put(`packages/website-client/dist/${path}`, '')
    put(`packages/website-client/dist/${path.replace(/\.js$/, '.d.ts')}`, '')
  }
  assert.equal(buildArtifactsExist(root, ['website-client']), true)
  rmSync(join(root, 'packages/website-client/dist/server/extensions.d.ts'))
  assert.equal(buildArtifactsExist(root, ['website-client']), false)
})
