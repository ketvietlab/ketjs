import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ROOT,
  consumers,
  materializeVersion,
  packageNames,
  producers,
  readJson,
  readVersion,
} from './version.mjs'
import { auditDocuments } from './version-documents.mjs'
import { stagePackage } from './release-files.mjs'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
/** @param {string | Uint8Array} bytes */
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
/** @param {string} path @param {unknown} value */
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const excluded = new Set(['node_modules', 'dist', '.build', '.ket', '.artifacts', '.learn', '.git'])

/** @param {import('./version-types.d.ts').Manifest} manifest @param {Record<string, import('./version-types.d.ts').Tarball>} tarballs @param {Record<string, import('./version-types.d.ts').Manifest>} manifests */
export function candidateManifest(manifest, tarballs, manifests) {
  const result = structuredClone(manifest)
  const names = new Set()
  /** @param {string} name */
  const add = (name) => {
    if (names.has(name) || !packageNames.has(name)) return
    names.add(name)
    for (const dependency of Object.keys(manifests[name].dependencies ?? {})) add(dependency)
  }
  for (const section of /** @type {Array<'dependencies' | 'devDependencies'>} */ ([
    'dependencies',
    'devDependencies',
  ])) {
    for (const name of Object.keys(result[section] ?? {})) add(name)
  }
  result.overrides ??= {}
  for (const name of names) {
    const section = result.devDependencies?.[name] ? 'devDependencies' : 'dependencies'
    result[section] ??= {}
    result[section][name] = `file:${tarballs[name].path}`
    result.overrides[name] = `$${name}`
  }
  return result
}

/** @param {import('./version-types.d.ts').PackageLock} lock @param {import('./version-types.d.ts').Manifest} manifest @param {Record<string, import('./version-types.d.ts').Tarball>} tarballs */
export function registryLock(lock, manifest, tarballs) {
  const result = structuredClone(lock)
  result.name = manifest.name
  result.version = manifest.version
  result.packages[''].version = manifest.version
  for (const section of /** @type {Array<'dependencies' | 'devDependencies'>} */ ([
    'dependencies',
    'devDependencies',
  ])) {
    delete result.packages[''][section]
    if (manifest[section]) result.packages[''][section] = manifest[section]
  }
  for (const [path, entry] of Object.entries(result.packages)) {
    const name = path.split('node_modules/').at(-1) ?? ''
    if (!packageNames.has(name)) continue
    entry.version = manifest.version
    entry.resolved = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${manifest.version}.tgz`
    entry.integrity = tarballs[name].integrity
  }
  return result
}

/** @param {string} logDirectory @param {import('./version-types.d.ts').Check[]} checks @param {string} [root] @param {string} [temporary] @returns {import('./version-types.d.ts').Runner} */
function runner(logDirectory, checks, root = ROOT, temporary = '') {
  mkdirSync(logDirectory, { recursive: true })
  return (id, executable, args, cwd = ROOT) => {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
    writeFileSync(join(logDirectory, `${id}.log`), log)
    if (result.error) throw result.error
    let command = [basename(executable), ...args].join(' ').replaceAll(root, '<repository>')
    if (temporary) command = command.replaceAll(temporary, '<temporary>')
    checks.push({ id, command, exitCode: result.status, logSha256: digest(log) })
    if (result.status !== 0) throw new Error(`${id} failed (${result.status}): ${log.slice(-4000)}`)
    console.log(`${id}: passed`)
    return result.stdout
  }
}

/** @param {string} root @param {string} temporary @param {import('./version-types.d.ts').Runner} run */
function packCandidates(root, temporary, run) {
  materializeVersion({ root, check: true, producersOnly: true })
  run('producer-build', npm, ['run', 'build', '--silent'], root)
  /** @type {Record<string, import('./version-types.d.ts').Tarball>} */
  const tarballs = {}
  /** @type {Record<string, import('./version-types.d.ts').Manifest>} */
  const manifests = {}
  for (const { directory, name } of producers) {
    const staged = join(temporary, 'packages', basename(name))
    stagePackage(join(root, directory), staged)
    const output = run(
      `pack-${name.split('/').at(-1)}`,
      npm,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary, staged],
      root,
    )
    const [packed] = JSON.parse(output.slice(output.indexOf('[')))
    const path = join(temporary, packed.filename)
    const actual = `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
    if (actual !== packed.integrity || packed.version !== readVersion(root))
      throw new Error(`Invalid candidate ${name}`)
    tarballs[name] = { path, integrity: actual, shasum: packed.shasum, version: packed.version }
    manifests[name] = readJson(join(root, directory, 'package.json'))
  }
  return { tarballs, manifests }
}

/** @param {string} directory @param {Record<string, import('./version-types.d.ts').Tarball>} tarballs @param {Record<string, import('./version-types.d.ts').Manifest>} manifests @param {import('./version-types.d.ts').Runner} run @param {string} id @param {boolean} [install] */
function prepareCandidate(directory, tarballs, manifests, run, id, install = true) {
  const manifestPath = join(directory, 'package.json')
  const lockPath = join(directory, 'package-lock.json')
  const manifestSource = readFileSync(manifestPath, 'utf8')
  const lockSource = readFileSync(lockPath, 'utf8')
  const manifest = JSON.parse(manifestSource)
  json(manifestPath, candidateManifest(manifest, tarballs, manifests))
  run(
    `${id}-lock`,
    npm,
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    directory,
  )
  const locked = registryLock(readJson(lockPath), manifest, tarballs)
  if (install) run(`${id}-install`, npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory)
  // Tests, rendered download ZIPs and the source lock all retain the public npm contract.
  writeFileSync(manifestPath, manifestSource)
  writeFileSync(lockPath, lockSource)
  return locked
}

export async function synchronizeConsumerLocks({ root = ROOT } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'ketjs-version-locks-'))
  const run = runner(join(root, '.artifacts/version-locks'), [], root, temporary)
  try {
    const { tarballs, manifests } = packCandidates(root, temporary, run)
    for (const directory of consumers) {
      const copy = join(temporary, basename(directory))
      mkdirSync(copy, { recursive: true })
      for (const file of ['package.json', 'package-lock.json'])
        cpSync(join(root, directory, file), join(copy, file))
      const lock = prepareCandidate(copy, tarballs, manifests, run, basename(directory), false)
      json(join(root, directory, 'package-lock.json'), lock)
    }
    // Keep bundled lessons reproducible before the audit commit, without needing a website build.
    const content = join(root, 'packages/docs/content/learn')
    const { readdirSync } = await import('node:fs')
    for (const name of readdirSync(content).filter((name) => name.endsWith('.md') && name !== 'index.md')) {
      writeFileSync(
        join(root, 'packages/docs/tutorials/api/lessons', name),
        readFileSync(join(content, name), 'utf8').replaceAll('{{VERSION}}', readVersion(root)),
      )
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export async function verifyConsumers({
  root = ROOT,
  reportPath = join(root, '.artifacts/version-audit/report.json'),
  published = false,
} = {}) {
  materializeVersion({ root, check: true })
  const temporary = mkdtempSync(join(tmpdir(), 'ketjs-version-consumers-'))
  /** @type {import('./version-types.d.ts').Check[]} */
  const checks = []
  const run = runner(join(root, '.artifacts/version-audit/logs'), checks, root, temporary)
  const version = readVersion(root)
  try {
    const { tarballs, manifests } = packCandidates(root, temporary, run)
    /** @type {Record<string, string>} */
    const paths = {}
    cpSync(join(root, 'biome.json'), join(temporary, 'biome.json'))
    cpSync(join(root, '.gitignore'), join(temporary, '.gitignore'))
    const docsCopy = join(temporary, 'consumer-docs')
    cpSync(join(root, 'packages/docs'), docsCopy, {
      recursive: true,
      filter: (path) =>
        !excluded.has(basename(path)) &&
        !basename(path).startsWith('.env') &&
        !/\.(?:sqlite|db)(?:-(?:wal|shm))?$/.test(path),
    })
    for (const directory of consumers) {
      const id = basename(directory)
      const copy = join(docsCopy, directory.slice('packages/docs'.length))
      paths[id] = copy
      for (const [path, entry] of Object.entries(readJson(join(copy, 'package-lock.json')).packages)) {
        const name = path.split('node_modules/').at(-1) ?? ''
        if (
          packageNames.has(name) &&
          (entry.version !== version || entry.integrity !== tarballs[name].integrity)
        )
          throw new Error(`${directory}: stale candidate lock for ${name}; run version:sync`)
      }
      if (published) run(`${id}-install`, npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], copy)
      else prepareCandidate(copy, tarballs, manifests, run, id)
      for (const name of Object.keys(manifests).filter(
        (name) => readJson(join(copy, 'package-lock.json')).packages[`node_modules/${name}`],
      )) {
        if (readJson(join(copy, 'node_modules', name, 'package.json')).version !== version)
          throw new Error(`${id}: wrong installed ${name}`)
      }
    }
    const documents = auditDocuments(root)
    const auditLog = JSON.stringify(documents)
    writeFileSync(join(root, '.artifacts/version-audit/logs/docs-audit.log'), auditLog)
    checks.push({
      id: 'docs-audit',
      command: 'node tools/version-documents.mjs',
      exitCode: 0,
      logSha256: digest(auditLog),
    })
    run(
      'docs-tests',
      process.execPath,
      [
        '--test',
        'test/release.test.mjs',
        'test/content.test.mjs',
        'test/navigation.test.mjs',
        'test/search.test.mjs',
        'test/playground.test.mjs',
        'test/learning-data.test.mjs',
      ],
      paths.docs,
    )
    run('docs-check', npm, ['run', 'check'], paths.docs)
    run('docs-build', npm, ['run', 'build'], paths.docs)
    run('api-check', npm, ['run', 'check'], paths.api)
    run(
      'api-tests',
      process.execPath,
      ['--test', 'dist/test/deployment.test.js', 'dist/test/isolation.test.js', 'dist/test/jobs.test.js'],
      paths.api,
    )
    run('view-check', npm, ['run', 'check'], paths.view)
    run('view-build', npm, ['run', 'build'], paths.view)
    // This verifies the actual downloadable projects, not just their authoring fixtures.
    const { unzipSync } = await import(
      pathToFileURL(join(paths.docs, 'node_modules/fflate/esm/index.mjs')).href
    )
    for (const [name, id] of [
      ['learn-api', 'api'],
      ['learn-view', 'view'],
    ]) {
      const files = unzipSync(readFileSync(join(paths.docs, 'dist/learn/downloads', `${name}.zip`)))
      const target = join(temporary, `download-${id}`)
      mkdirSync(target)
      for (const [nameInZip, bytes] of Object.entries(files)) {
        const path = nameInZip.split('/').slice(1).join('/')
        if (!path || path.split('/').some((part) => part === '..') || path.startsWith('/'))
          throw new Error('Unsafe lab download path')
        mkdirSync(dirname(join(target, path)), { recursive: true })
        writeFileSync(join(target, path), bytes)
      }
      if (published)
        run(`download-${id}-install`, npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], target)
      else prepareCandidate(target, tarballs, manifests, run, `download-${id}`)
      run(`download-${id}-check`, npm, ['run', 'check'], target)
      if (id === 'api')
        run(
          'download-api-tests',
          process.execPath,
          ['--test', 'dist/test/deployment.test.js', 'dist/test/isolation.test.js', 'dist/test/jobs.test.js'],
          target,
        )
      else run('download-view-build', npm, ['run', 'build'], target)
    }
    /** @type {import('./version-types.d.ts').ConsumerReport} */
    const report = {
      version,
      mode: published ? 'published' : 'candidate',
      environment: { node: process.version, platform: process.platform },
      packages: Object.fromEntries(
        Object.entries(tarballs).map(([name, { integrity, shasum, version }]) => [
          name,
          { integrity, shasum, version },
        ]),
      ),
      documents,
      checks,
    }
    mkdirSync(dirname(reportPath), { recursive: true })
    json(reportPath, report)
    return report
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'sync-locks') await synchronizeConsumerLocks()
  else if (process.argv[2] === 'check')
    await verifyConsumers({ published: process.argv.includes('--published') })
  else throw new Error('Use version-consumers.mjs check [--published] | sync-locks')
}
