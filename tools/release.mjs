// Release preparation is executable evidence, not a checklist someone can forget.
// It verifies the four public workspaces, packs exactly what npm would receive,
// installs those tarballs into a clean consumer, and boots a generated project.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const node = process.execPath
const command = process.argv[2] ?? 'check'

const workspaces = [
  { name: '@ketvietlab/ketjs-view', dir: 'packages/ketjs-view', maxPackedBytes: 100_000 },
  { name: '@ketvietlab/ketjs', dir: 'packages/ketjs', maxPackedBytes: 500_000 },
  { name: '@ketvietlab/ketjs-postgres', dir: 'packages/ketjs-postgres', maxPackedBytes: 50_000 },
  { name: '@ketvietlab/ketsuite', dir: 'packages/ketsuite', maxPackedBytes: 2_000_000 },
]

/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Error(`release check failed: ${message}`)
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, capture?: boolean }} [options]
 */
const run = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`)
    fail(`${basename(executable)} ${args.join(' ')} exited with ${result.status}`)
  }
  return result.stdout ?? ''
}

/** @param {unknown} value @returns {string[]} */
const exportedPaths = (value) => {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(/** @type {Record<string, unknown>} */ (value)).flatMap(exportedPaths)
}

const verifyMetadata = () => {
  const rootPackage = readJson(join(ROOT, 'package.json'))
  const version = rootPackage.version
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`invalid root version ${version}`)
  const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8')

  for (const workspace of workspaces) {
    const directory = join(ROOT, workspace.dir)
    const manifest = readJson(join(directory, 'package.json'))
    if (manifest.name !== workspace.name) fail(`${workspace.dir} declares name ${manifest.name}`)
    if (manifest.version !== version)
      fail(`${workspace.name} is ${manifest.version}; all public packages must be ${version}`)
    if (manifest.private === true) fail(`${workspace.name} is private`)
    if (manifest.license !== 'MIT') fail(`${workspace.name} does not declare the MIT license`)
    if (manifest.engines?.node !== '>=24.0.0') fail(`${workspace.name} must retain the Node >=24 contract`)
    if (manifest.publishConfig?.access !== 'public') fail(`${workspace.name} is not configured public`)
    if (manifest.publishConfig?.provenance !== true) fail(`${workspace.name} does not require provenance`)
    if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/')
      fail(`${workspace.name} does not pin the public npm registry`)
    if (manifest.repository?.url !== 'git+https://github.com/ketvietlab/ketjs.git')
      fail(`${workspace.name} has the wrong repository URL`)
    if (manifest.repository?.directory !== workspace.dir)
      fail(`${workspace.name} has the wrong repository directory`)
    if (!manifest.files?.includes('dist')) fail(`${workspace.name} does not restrict files to dist`)
    if (manifest.scripts?.prepack !== 'npm run build --prefix ../..')
      fail(`${workspace.name} does not build before packing`)
    if (!existsSync(join(directory, 'README.md'))) fail(`${workspace.name} has no package README`)
    if (readFileSync(join(directory, 'LICENSE'), 'utf8') !== license)
      fail(`${workspace.name} does not carry the repository license`)
    for (const target of exportedPaths(manifest.exports)) {
      const path = join(directory, target)
      if (!existsSync(path)) fail(`${workspace.name} export ${target} does not exist; run the build first`)
    }
    for (const target of Object.values(manifest.bin ?? {})) {
      const path = join(directory, target)
      if (!existsSync(path)) fail(`${workspace.name} bin ${target} does not exist`)
    }
  }

  const byName = new Map(
    workspaces.map((workspace) => [workspace.name, readJson(join(ROOT, workspace.dir, 'package.json'))]),
  )
  for (const [name, manifest] of byName) {
    for (const [dependency, wanted] of Object.entries(manifest.dependencies ?? {})) {
      if (byName.has(dependency) && wanted !== version)
        fail(`${name} must depend on ${dependency}@${version}, not ${wanted}`)
    }
  }

  const scaffold = readFileSync(join(ROOT, 'packages/ketjs/src/scaffold/index.ts'), 'utf8')
  if (!scaffold.includes(`const VERSION = '${version}'`))
    fail(`ket new does not scaffold the release version ${version}`)
  const lock = readJson(join(ROOT, 'package-lock.json'))
  if (lock.version !== undefined && lock.version !== version) fail(`package-lock root is ${lock.version}`)
  for (const workspace of workspaces) {
    const locked = lock.packages?.[workspace.dir]
    if (locked?.version !== version)
      fail(`package-lock has ${workspace.name}@${locked?.version ?? 'missing'}`)
  }
  return version
}

/** @param {string} destination @param {string} version */
const pack = (destination, version) => {
  mkdirSync(destination, { recursive: true })
  /** @type {Map<string, string>} */
  const tarballs = new Map()
  for (const workspace of workspaces) {
    const stdout = run(
      npm,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', destination, join(ROOT, workspace.dir)],
      { capture: true },
    )
    const start = stdout.indexOf('[')
    const result =
      /** @type {{ name: string, version: string, size: number, unpackedSize: number, entryCount: number, filename: string, files: Array<{ path: string }> }} */ (
        JSON.parse(start >= 0 ? stdout.slice(start) : stdout)[0]
      )
    if (result.name !== workspace.name || result.version !== version)
      fail(`npm packed ${result.name}@${result.version} from ${workspace.name}`)
    if (result.size > workspace.maxPackedBytes)
      fail(`${workspace.name} grew to ${result.size} packed bytes (limit ${workspace.maxPackedBytes})`)
    const paths = new Set(result.files.map((file) => file.path))
    for (const required of ['LICENSE', 'README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts'])
      if (!paths.has(required)) {
        fail(`${workspace.name} tarball omitted ${required}`)
      }
    const tarball = join(destination, result.filename)
    if (!existsSync(tarball)) fail(`${workspace.name} tarball was not written`)
    tarballs.set(workspace.name, tarball)
    console.log(
      `packed ${workspace.name}@${version}: ${result.size} bytes, ${result.unpackedSize} unpacked, ${result.entryCount} files`,
    )
  }
  return tarballs
}

/** @param {Map<string, string>} tarballs @param {string} version @param {string} parent */
const smoke = (tarballs, version, parent) => {
  /** @param {string} name @returns {string} */
  const tarball = (name) => {
    return tarballs.get(name) ?? fail(`missing tarball for ${name}`)
  }
  const consumer = join(parent, 'consumer')
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'ket-release-smoke', private: true, type: 'module' }, null, 2)}\n`,
  )
  run(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      ...workspaces.map((workspace) => tarball(workspace.name)),
    ],
    { cwd: consumer },
  )
  run(
    node,
    [
      '--input-type=module',
      '--eval',
      `await Promise.all([import('@ketvietlab/ketjs-view'), import('@ketvietlab/ketjs'), import('@ketvietlab/ketjs/theme'), import('@ketvietlab/ketjs/testing'), import('@ketvietlab/ketjs-postgres'), import('@ketvietlab/ketsuite'), import('@ketvietlab/ketsuite/ui'), import('@ketvietlab/ketsuite/backend')])`,
    ],
    { cwd: consumer },
  )

  const generated = join(parent, 'generated')
  run(node, [
    join(consumer, 'node_modules/@ketvietlab/ketjs/dist/cli.js'),
    'new',
    'release_smoke',
    '--dir',
    generated,
  ])
  const generatedPackage = readJson(join(generated, 'package.json'))
  if (generatedPackage.dependencies?.['@ketvietlab/ketjs'] !== `^${version}`)
    fail(
      `ket new generated @ketvietlab/ketjs dependency ${generatedPackage.dependencies?.['@ketvietlab/ketjs']}`,
    )
  run(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--no-save',
      tarball('@ketvietlab/ketjs-view'),
      tarball('@ketvietlab/ketjs'),
    ],
    { cwd: generated },
  )
  run(npm, ['run', 'check'], { cwd: generated })
  run(npm, ['test'], { cwd: generated })
  console.log('tarball consumer imports and generated application smoke test passed')
}

/** @param {string} name @param {string} version */
const publishedShasum = (name, version) => {
  const result = spawnSync(npm, ['view', `${name}@${version}`, 'dist.shasum', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status === 0) return JSON.parse(result.stdout)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (output.includes('E404')) return undefined
  process.stderr.write(output)
  fail(`could not inspect ${name}@${version} on npm`)
}

/** @param {Map<string, string>} tarballs @param {string} version */
const publish = (tarballs, version) => {
  if (process.env.GITHUB_ACTIONS !== 'true') fail('publish is restricted to GitHub Actions')
  if (process.env.RELEASE_TAG !== `v${version}`)
    fail(`release tag ${process.env.RELEASE_TAG ?? 'missing'} does not match v${version}`)

  for (const workspace of workspaces) {
    const tarball = tarballs.get(workspace.name) ?? fail(`missing tarball for ${workspace.name}`)
    const localShasum = createHash('sha1').update(readFileSync(tarball)).digest('hex')
    const remoteShasum = publishedShasum(workspace.name, version)
    if (remoteShasum !== undefined) {
      if (remoteShasum !== localShasum)
        fail(`${workspace.name}@${version} exists with different contents; refusing to continue`)
      console.log(`already published ${workspace.name}@${version} with matching contents; skipping`)
      continue
    }
    run(npm, ['publish', tarball, '--access', 'public', '--provenance'])
  }
}

if (!['check', 'pack', 'publish'].includes(command)) fail('usage: node tools/release.mjs check|pack|publish')
const version = verifyMetadata()
const temporary = mkdtempSync(join(tmpdir(), 'ketjs-release-'))
const destination = command === 'pack' ? join(ROOT, '.release') : join(temporary, 'tarballs')
if (command === 'pack') {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
}
try {
  const tarballs = pack(destination, version)
  if (command === 'publish') publish(tarballs, version)
  else smoke(tarballs, version, temporary)
  if (command === 'pack') console.log(`release tarballs are ready in ${destination}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
