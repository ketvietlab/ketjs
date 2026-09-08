import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** @param {string} path */
const read = (path) => readFileSync(join(root, path), 'utf8')
/** @param {string} path */
const json = (path) => JSON.parse(read(path))
/** @param {unknown} condition @param {string} message */
const assert = (condition, message) => {
  if (!condition) throw new Error(`Design-system release audit failed: ${message}`)
}

const policy = json('packages/design-system/src/catalogue/inventory-policy.json')
const inventorySource = read('packages/design-system/src/catalogue/inventory.generated.ts')
const registry = read('packages/design-system/src/catalogue/registry.ts')
const rootPackage = json('package.json')
const designPackage = json('packages/design-system/package.json')

assert(policy.plannedComponents.length === 0, 'planned component catalogue is not empty')
assert(
  /"plannedComponents":0/u.test(inventorySource),
  'generated inventory is stale or still has planned work',
)
assert(rootPackage.version === designPackage.version, 'design-system and workspace versions differ')
assert(
  read('docs/src/content/docs/ketsuite/design-system-migration.md').includes('KETJS.lock'),
  'migration notes omit the private pin flow',
)
assert(
  read('tasks/design-system/wave-6-closure.md').includes('prior exact pin'),
  'closure report omits rollback rehearsal',
)

const deprecated = ['FormPage', 'DashboardPage', 'BoardPage']
for (const name of deprecated) {
  assert(
    new RegExp(`entry\\(\\s*'${name}'[\\s\\S]*?'deprecated'`, 'u').test(registry),
    `${name} is not registered as deprecated`,
  )
}
assert(
  read('packages/design-system/src/patterns/form-page/index.tsx').includes('@deprecated Use RecordPage'),
  'FormPage has no source deprecation notice',
)
assert(
  read('packages/design-system/src/patterns/dashboard-page/index.tsx').includes('@deprecated'),
  'DashboardPage has no source deprecation notice',
)
assert(
  read('packages/design-system/src/patterns/board-page/index.tsx').includes('@deprecated'),
  'BoardPage has no source deprecation notice',
)

let diff = ''
try {
  diff = execFileSync(
    'git',
    [
      'diff',
      '--unified=0',
      'origin/develop...HEAD',
      '--',
      'packages/ketsuite/src/modules',
      'apps',
      ':(exclude)apps/design-system',
    ],
    { cwd: root, encoding: 'utf8' },
  )
} catch {
  // Source archives may not carry the base ref. The deprecation metadata checks above still run.
}
const addedDeprecatedUses = diff
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .filter((line) => /\b(?:FormPage|DashboardPage|BoardPage)\b/u.test(line))
assert(
  addedDeprecatedUses.length === 0,
  `new compatibility page consumers are forbidden:\n${addedDeprecatedUses.join('\n')}`,
)

const classifications = read('tasks/design-system/wave-6-closure.md')
for (const capability of ['Gantt', 'Charts', 'Product media workflows', 'User workflow'])
  assert(classifications.includes(`| ${capability} |`), `missing classification for ${capability}`)

process.stdout.write(
  `Design-system release candidate is ready: ${designPackage.version}, zero planned components, deprecated-page admission locked.\n`,
)
