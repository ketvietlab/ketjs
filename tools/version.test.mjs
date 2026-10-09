import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { producers, consumers, materializeVersion, readVersion, readJson } from './version.mjs'
import { candidateManifest, registryLock } from './version-consumers.mjs'
import {
  checkAudit,
  git,
  requiredChecks,
  sourceDigest,
  versionChanged,
  versionCommit,
} from './version-audit.mjs'
import { auditDocuments } from './version-documents.mjs'
import { stagePackage } from './release-files.mjs'

const put = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}
const execute = (cwd, executable, args) => {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}
test('release staging normalizes host permissions without changing the source checkout', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-package-permissions-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, 'source/package.json', {
    name: 'permissions-fixture',
    version: '1.0.0',
    bin: { fixture: './dist/cli.js' },
  })
  put(root, 'source/dist/index.js', 'export const value = 1\n')
  put(root, 'source/dist/cli.js', '#!/usr/bin/env node\n')
  chmodSync(join(root, 'source/dist/index.js'), 0o600)
  stagePackage(join(root, 'source'), join(root, 'staged'))
  assert.equal(statSync(join(root, 'source/dist/index.js')).mode & 0o777, 0o600)
  assert.equal(statSync(join(root, 'staged/dist/index.js')).mode & 0o777, 0o644)
  assert.equal(statSync(join(root, 'staged/dist/cli.js')).mode & 0o777, 0o755)
})
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-version-contract-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, 'VERSION', '0.4.0\n')
  const lock = { version: '0.4.0', packages: { '': { version: '0.4.0' } } }
  put(root, 'package.json', { name: 'fixture', version: '0.4.0' })
  for (const { name, directory } of producers) {
    const manifest = { name, version: '0.4.0', dependencies: { '@ketvietlab/ketjs-view': '0.4.0' } }
    put(root, `${directory}/package.json`, manifest)
    lock.packages[directory] = structuredClone(manifest)
  }
  put(root, 'package-lock.json', lock)
  for (const directory of consumers) {
    const manifest = {
      name: directory.split('/').at(-1),
      version: '0.4.0',
      dependencies: { '@ketvietlab/ketjs-view': '0.4.0' },
    }
    put(root, `${directory}/package.json`, manifest)
    put(root, `${directory}/package-lock.json`, {
      version: '0.4.0',
      packages: { '': manifest, 'node_modules/@ketvietlab/ketjs-view': { version: '0.4.0' } },
    })
    put(root, `${directory}/README.md`, '# Fixture\n')
  }
  for (const file of ['packages/ketjs/src/scaffold/index.ts', 'packages/create-view/src/index.ts'])
    put(root, file, "const VERSION = '0.4.0'\n")
  put(root, 'README.md', '# Fixture\n')
  put(root, 'AGENTS.md', '# Fixture rules\n')
  put(root, 'packages/docs/content/docs/install.md', '```bash\n# Run from: demo\nnpm ci\n```\n')
  materializeVersion({ root })
  execute(root, 'git', ['init', '-q', '-b', 'fix/version-fixture'])
  execute(root, 'git', ['config', 'user.name', 'Version Contract Test'])
  execute(root, 'git', ['config', 'user.email', 'version-test@example.invalid'])
  execute(root, 'git', ['add', '.'])
  execute(root, 'git', [
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '-m',
    'Adopt the coordinated version',
    '-m',
    'Version-Reason: Align package and document versions with audited consumer contracts.',
  ])
  return root
}
function ledger(root) {
  const { commit, reason } = versionCommit(root)
  const entry = {
    version: readVersion(root),
    versionCommit: commit,
    reason,
    auditedCommit: commit,
    sourceDigest: sourceDigest(root),
    evidence: {
      version: readVersion(root),
      mode: 'candidate',
      environment: { node: process.version, platform: process.platform },
      documents: auditDocuments(root),
      // Synthetic passing evidence belongs only to this isolated validator fixture.
      checks: requiredChecks.map((id) => ({
        id,
        command: `fixture ${id}`,
        exitCode: 0,
        logSha256: 'a'.repeat(64),
      })),
      packages: Object.fromEntries(
        producers.map(({ name }) => [
          name,
          {
            version: readVersion(root),
            shasum: 'b'.repeat(40),
            integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
          },
        ]),
      ),
    },
  }
  return { schema: 1, releases: [entry] }
}

test('VERSION validates semantic versions and rejects ambiguous or malformed values', (t) => {
  const root = fixture(t)
  for (const value of ['1.2.3\n', '1.2.3-rc.1\n']) {
    put(root, 'VERSION', value)
    assert.equal(readVersion(root), value.trim())
  }
  for (const value of ['01.2.3\n', '1.2.3-rc.01\n', '1.2\n', '1.2.3', ' 1.2.3\n', '1.2.3\n4.5.6\n']) {
    put(root, 'VERSION', value)
    assert.throws(() => readVersion(root), /one semantic version/)
  }
})

test('a version change synchronizes every mirror and detects drift without rewriting matching manifests', (t) => {
  const root = fixture(t)
  const producer = 'packages/ketjs/package.json'
  const original = readFileSync(join(root, producer), 'utf8')
  materializeVersion({ root, check: true })
  assert.equal(readFileSync(join(root, producer), 'utf8'), original)
  const base = git(root, ['rev-parse', 'HEAD'])
  assert.equal(versionChanged(root, base), false)
  put(root, 'VERSION', '0.5.0\n')
  assert.equal(versionChanged(root, base), true)
  assert.throws(() => materializeVersion({ root, check: true }), /stale generated mirrors/)
  materializeVersion({ root })
  for (const directory of ['', ...producers.map((item) => item.directory), ...consumers])
    assert.equal(readJson(join(root, directory, 'package.json')).version, '0.5.0')
  assert.ok(readFileSync(join(root, 'packages/docs/site/version.generated.ts'), 'utf8').includes("'0.5.0'"))
  assert.equal(
    readJson(join(root, 'packages/docs/tutorials/api/package-lock.json')).packages[
      'node_modules/@ketvietlab/ketjs-view'
    ].version,
    '0.5.0',
  )
  materializeVersion({ root, check: true })
  const changed = readJson(join(root, producer))
  changed.dependencies['@ketvietlab/ketjs-view'] = '^0.5.0'
  put(root, producer, changed)
  assert.throws(() => materializeVersion({ root, check: true }), /packages\/ketjs\/package.json/)
})

test('CHANGE_LOG rejects missing entries, mismatched commits/reasons, stale source and incomplete evidence', (t) => {
  const root = fixture(t)
  assert.throws(() => checkAudit(root), /Missing CHANGE_LOG/)
  put(root, 'CHANGE_LOG', { schema: 1, releases: [] })
  assert.throws(() => checkAudit(root), /Missing CHANGE_LOG entry/)
  const valid = ledger(root)
  put(root, 'CHANGE_LOG', valid)
  assert.equal(checkAudit(root).version, '0.4.0')
  for (const mutate of [
    (entry) => {
      entry.versionCommit = 'f'.repeat(40)
    },
    (entry) => {
      entry.reason = 'An unrelated release reason'
    },
    (entry) => {
      entry.evidence.checks = entry.evidence.checks.filter((check) => check.id !== 'docs-audit')
    },
    (entry) => {
      entry.evidence.checks.find((check) => check.id === 'api-tests').exitCode = 1
    },
    (entry) => {
      entry.evidence.packages['@ketvietlab/ketjs'].integrity = 'invented'
    },
    (entry) => {
      entry.evidence.documents.files = []
    },
  ]) {
    const invalid = structuredClone(valid)
    mutate(invalid.releases[0])
    put(root, 'CHANGE_LOG', invalid)
    assert.throws(() => checkAudit(root))
  }
  put(root, 'CHANGE_LOG', valid)
  put(root, 'README.md', '# Changed after audit\n')
  assert.throws(() => checkAudit(root), /Stale CHANGE_LOG evidence/)
})

test('the version commit requires a meaningful reason and an audit of the current source', (t) => {
  const root = fixture(t)
  put(root, 'VERSION', '0.5.0\n')
  materializeVersion({ root })
  execute(root, 'git', ['add', '.'])
  execute(root, 'git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'Bump without a reason'])
  assert.throws(() => versionCommit(root), /Version-Reason/)
})

test('the document audit rejects unlocated fenced examples', (t) => {
  const root = fixture(t)
  assert.equal(auditDocuments(root).fences, 1)
  put(root, 'packages/docs/content/docs/install.md', '```ts\nawait install()\n```\n')
  assert.throws(() => auditDocuments(root), /lacks a location comment/)
})

test('a new version retains the commit and reason of every earlier VERSION change', (t) => {
  const root = fixture(t)
  const previous = ledger(root)
  put(root, 'CHANGE_LOG', previous)
  execute(root, 'git', ['add', 'CHANGE_LOG'])
  execute(root, 'git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'Record the fixture audit'])
  put(root, 'VERSION', '0.5.0\n')
  materializeVersion({ root })
  execute(root, 'git', ['add', '.'])
  execute(root, 'git', [
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '-m',
    'Ship the next fixture version',
    '-m',
    'Version-Reason: Extend the verified contract and update its documented learning exercises.',
  ])
  const current = ledger(root)
  put(root, 'CHANGE_LOG', current)
  assert.throws(() => checkAudit(root), /Missing historical VERSION commit\/reason/)
  current.releases.unshift(previous.releases[0])
  put(root, 'CHANGE_LOG', current)
  assert.equal(checkAudit(root).version, '0.5.0')
})

test('unpublished versions install entirely offline through the exact candidate dependency closure', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-unpublished-contract-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const version = '987.654.321'
  const manifests = {
    '@ketvietlab/ketjs-view': {
      name: '@ketvietlab/ketjs-view',
      version,
      type: 'module',
      exports: './index.js',
    },
    '@ketvietlab/ketjs': {
      name: '@ketvietlab/ketjs',
      version,
      type: 'module',
      exports: './index.js',
      dependencies: { '@ketvietlab/ketjs-view': version },
    },
  }
  const tarballs = {}
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  for (const [name, manifest] of Object.entries(manifests)) {
    const directory = join(root, name.split('/').at(-1))
    put(directory, 'package.json', manifest)
    put(directory, 'index.js', `export const version = '${version}'\n`)
    const output = execute(root, npm, [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      root,
      directory,
    ])
    const [pack] = JSON.parse(output.slice(output.indexOf('[')))
    tarballs[name] = { path: join(root, pack.filename), integrity: pack.integrity }
  }
  const consumer = join(root, 'consumer')
  const manifest = {
    name: 'offline-fixture',
    version,
    private: true,
    dependencies: { '@ketvietlab/ketjs': version },
  }
  put(consumer, 'package.json', candidateManifest(manifest, tarballs, manifests))
  execute(consumer, npm, [
    'install',
    '--offline',
    '--cache',
    join(root, 'empty-cache'),
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ])
  for (const name of Object.keys(manifests))
    assert.equal(readJson(join(consumer, 'node_modules', name, 'package.json')).version, version)
  const lock = registryLock(readJson(join(consumer, 'package-lock.json')), manifest, tarballs)
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies)
  assert.ok(!JSON.stringify(lock).includes('file:'))
  for (const name of Object.keys(manifests))
    assert.equal(lock.packages[`node_modules/${name}`].integrity, tarballs[name].integrity)
})
