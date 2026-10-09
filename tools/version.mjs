import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const producers = ['ketjs-view', 'ketjs-view-tools', 'create-view', 'ketjs', 'ketjs-postgres'].map(
  (name) => ({ name: `@ketvietlab/${name}`, directory: `packages/${name}` }),
)
export const consumers = ['packages/docs', 'packages/docs/tutorials/api', 'packages/docs/tutorials/view']
export const packageNames = new Set(producers.map(({ name }) => name))
const scaffolds = ['packages/ketjs/src/scaffold/index.ts', 'packages/create-view/src/index.ts']

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
export function readVersion(root = ROOT) {
  const source = readFileSync(join(root, 'VERSION'), 'utf8')
  const version = source.trim()
  if (
    source !== `${version}\n` ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+\.)*[0-9A-Za-z-]+)?$/.test(version) ||
    version
      .split('-')
      .slice(1)
      .join('-')
      .split('.')
      .some((part) => /^0\d+$/.test(part))
  )
    throw new Error('VERSION must contain one semantic version followed by a newline')
  return version
}

const pin = (manifest, version) => {
  manifest.version = version
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (packageNames.has(name)) manifest[section][name] = version
    }
  }
  return manifest
}
const generatedVersion = (version) =>
  `// Generated from /VERSION by npm run version:sync. Do not edit.\nexport const frameworkVersion = '${version}'\n`

// npm requires versions in manifests and locks. These are checked mirrors, not authoring inputs.
export function materializeVersion({ root = ROOT, check = false, producersOnly = false } = {}) {
  const version = readVersion(root)
  const failures = []
  const update = (relative, transform, json = false) => {
    const path = join(root, relative)
    let before
    try {
      before = readFileSync(path, 'utf8')
    } catch {
      before = ''
    }
    const after = json ? JSON.stringify(transform(JSON.parse(before)), null, 2) + '\n' : transform(before)
    const same = json
      ? JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after))
      : before === after
    if (same) return
    if (check) failures.push(relative)
    else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, after)
    }
  }
  for (const directory of [
    '',
    ...producers.map((item) => item.directory),
    ...(!producersOnly ? consumers : []),
  ]) {
    update(join(directory, 'package.json'), (manifest) => pin(manifest, version), true)
  }
  update(
    'package-lock.json',
    (lock) => {
      lock.version = version
      pin(lock.packages[''], version)
      for (const { directory } of producers) pin(lock.packages[directory], version)
      return lock
    },
    true,
  )
  for (const path of scaffolds) {
    update(path, (source) => {
      if (!/^const VERSION = '[^']+'$/m.test(source)) throw new Error(`${path}: missing scaffold version`)
      return source.replace(/^const VERSION = '[^']+'$/m, `const VERSION = '${version}'`)
    })
  }
  if (!producersOnly) {
    update('packages/docs/site/version.generated.ts', () => generatedVersion(version))
    for (const directory of consumers) {
      update(
        join(directory, 'package-lock.json'),
        (lock) => {
          lock.version = version
          pin(lock.packages[''], version)
          for (const [path, entry] of Object.entries(lock.packages)) {
            const name = path.split('node_modules/').at(-1)
            if (!packageNames.has(name)) continue
            pin(entry, version)
            entry.resolved = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`
          }
          return lock
        },
        true,
      )
    }
  }
  if (failures.length)
    throw new Error(
      `VERSION ${version} has stale generated mirrors: ${failures.join(', ')}. Run npm run version:sync.`,
    )
  return version
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? 'check'
  if (!['check', 'sync'].includes(command)) throw new Error('Use version.mjs check|sync')
  const version = materializeVersion({ check: command === 'check' })
  if (command === 'sync') {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./version-consumers.mjs', import.meta.url)), 'sync-locks'],
      { stdio: 'inherit' },
    )
    if (child.error) throw child.error
    if (child.status !== 0) throw new Error(`Consumer lock synchronization failed (${child.status})`)
    materializeVersion({ check: true })
  }
  console.log(
    `VERSION ${version}: ${command === 'sync' ? 'synchronized' : 'checked'} all package, scaffold and documentation mirrors`,
  )
}
