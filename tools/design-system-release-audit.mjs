import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

/** @typedef {{ scope: string, kind: string, name: string, specimen: string, tests: string }} InventoryRow */

const policy = json('packages/design-system/src/catalogue/inventory-policy.json')
/** @type {{ summary: { plannedComponents: number, typeGaps: number }, rows: InventoryRow[] }} */
const inventory = json('packages/design-system/src/catalogue/inventory.generated.json')
const registry = read('packages/design-system/src/catalogue/registry.ts')
const rootPackage = json('package.json')
const designPackage = json('packages/design-system/package.json')

assert(policy.plannedComponents.length === 0, 'planned component catalogue is not empty')
assert(inventory.summary.plannedComponents === 0, 'generated inventory is stale or still has planned work')
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

const registeredNames = [...registry.matchAll(/entry\(\s*'([^']+)'/gu)].map((match) => match[1])
assert(
  registeredNames.length === 105,
  `component registry has ${registeredNames.length} entries, expected 105`,
)
for (const name of registeredNames) {
  const row = inventory.rows.find(
    (candidate) => candidate.scope === 'public' && candidate.kind === 'runtime' && candidate.name === name,
  )
  if (!row)
    throw new Error(
      `Design-system release audit failed: ${name} is registered but absent from the public runtime inventory`,
    )
  assert(row.specimen === 'present', `${name} has no catalogue specimen`)
  assert(row.tests === 'present', `${name} has no test evidence`)
}

const infrastructureAllowlist = new Set([
  'HOOKS',
  'OWNERS',
  'attachDesignSystemInteractions',
  'initials',
  'withQueryState',
])
const runtimeGaps = inventory.rows.filter(
  (row) =>
    row.scope === 'public' && row.kind === 'runtime' && (row.specimen === 'gap' || row.tests === 'gap'),
)
assert(
  runtimeGaps.every((row) => infrastructureAllowlist.has(row.name)),
  `unclassified runtime evidence gaps: ${runtimeGaps
    .filter((row) => !infrastructureAllowlist.has(row.name))
    .map((row) => row.name)
    .join(', ')}`,
)
assert(
  [...infrastructureAllowlist].every((name) => runtimeGaps.some((row) => row.name === name)),
  'runtime infrastructure allowlist is stale',
)

let diff = ''
if (existsSync(join(root, '.git'))) {
  const base = process.env.DESIGN_SYSTEM_AUDIT_BASE ?? 'origin/develop'
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  diff = execFileSync(
    'git',
    [
      'diff',
      '--unified=0',
      `${base}...HEAD`,
      '--',
      'packages/ketsuite/src/modules',
      'apps',
      ':(exclude)apps/design-system',
    ],
    { cwd: root, encoding: 'utf8' },
  )
} else {
  process.stdout.write('Source archive detected; skipped the Git consumer-admission check.\n')
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
  `Design-system release gate passed: ${designPackage.version}, ${registeredNames.length} registered components with specimens and tests, ${inventory.summary.typeGaps} type-evidence gaps reported, deprecated-page admission locked.\n`,
)
