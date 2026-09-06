import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

/** @typedef {'framework' | 'identity' | 'collaboration' | 'catalog' | 'orders' | 'accounting' | 'crm-loyalty' | 'hospitality' | 'website' | 'manufacturing'} TestGroup */
/** @typedef {readonly [RegExp, TestGroup]} GroupRule */

/** @type {readonly TestGroup[]} */
export const GROUPS = [
  'framework',
  'identity',
  'collaboration',
  'catalog',
  'orders',
  'accounting',
  'crm-loyalty',
  'hospitality',
  'website',
  'manufacturing',
]

/** @type {readonly GroupRule[]} */
const MODULE_GROUPS = [
  [/^account(?:_|$)/, 'accounting'],
  [/^(?:activity|calendar|flow|livedoc|mail)(?:_|$)/, 'collaboration'],
  [/^(?:address|attendance|company|hr|oauth|partner|user)(?:_|$)/, 'identity'],
  [/^(?:catalog|inventory|pricing|product|stock|uom)(?:_|$)/, 'catalog'],
  [/^(?:checkout|pos|purchase|sale)(?:_|$)/, 'orders'],
  [/^(?:crm|loyalty)(?:_|$)/, 'crm-loyalty'],
  [/^hospitality(?:_|$)/, 'hospitality'],
  [/^website(?:_|$)/, 'website'],
  [/^manufacturing(?:_|$)/, 'manufacturing'],
]

/** @type {readonly GroupRule[]} */
const TEST_GROUPS = [
  [/^(?:account|accounting|staff-accounting)(?:-|$)/, 'accounting'],
  [/^(?:activity|collaboration|flow|mail|staff-notification)(?:-|$)/, 'collaboration'],
  [
    /^(?:address|authui|company-branch|customer-token|hr-attendance|identity|oauth|partner|staff-attendance|user-auth|user-provision)(?:-|$)/,
    'identity',
  ],
  [/^(?:product|staff-inventory|staff-stock|uom)(?:-|$)/, 'catalog'],
  [/^(?:pos|purchase|sale|staff-purchasing|staff-sales)(?:-|$)/, 'orders'],
  [/^(?:crm|loyalty|staff-crm)(?:-|$)/, 'crm-loyalty'],
  [/^(?:hospitality|staff-hospitality)(?:-|$)/, 'hospitality'],
  [/^(?:retail-channel|website)(?:-|$)/, 'website'],
  [/^manufacturing(?:-|$)/, 'manufacturing'],
]

const TEST_SOURCE = /^test\/[^/]+\.test\.tsx?$/
const MODULE_SOURCE = /^packages\/ketsuite\/src\/modules\/([^/]+)\//
const DOCUMENTATION = /^(?:docs\/|.*\.md$)/

/** @param {string} name @param {readonly GroupRule[]} rules @returns {TestGroup} */
function groupFromRules(name, rules) {
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? 'framework'
}

/** @param {string} moduleName @returns {TestGroup} */
export function groupForModule(moduleName) {
  return groupFromRules(moduleName, MODULE_GROUPS)
}

/** @param {string} testPath @returns {TestGroup} */
export function groupForTest(testPath) {
  const name = basename(testPath).replace(/\.test\.tsx?$/, '')
  return groupFromRules(name, TEST_GROUPS)
}

/** @param {TestGroup} group @param {string} [testDirectory] */
export function discoverTests(group, testDirectory = 'test') {
  return readdirSync(testDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.match(/\.test\.tsx?$/))
    .map((entry) => join(testDirectory, entry.name))
    .filter((testPath) => groupForTest(testPath) === group)
    .sort()
}

/** @param {readonly string[]} files @returns {TestGroup[]} */
export function groupsForChanges(files) {
  /** @type {Set<TestGroup>} */
  const selected = new Set()
  for (const file of files) {
    if (!file || DOCUMENTATION.test(file)) continue
    if (TEST_SOURCE.test(file)) {
      selected.add(groupForTest(file))
      continue
    }
    const moduleMatch = file.match(MODULE_SOURCE)
    if (moduleMatch) {
      const moduleGroup = MODULE_GROUPS.find(([pattern]) => pattern.test(moduleMatch[1]))?.[1]
      if (!moduleGroup) return [...GROUPS]
      selected.add(moduleGroup)
      continue
    }

    // Framework, shared UI, build, tooling, and workflow changes can affect every
    // domain. Unknown code follows the same safe fallback instead of skipping CI.
    return [...GROUPS]
  }
  return GROUPS.filter((group) => selected.has(group))
}

/**
 * The two files the permission-coverage job runs, and everything that can move
 * what they read.
 */
const PERMISSION_TESTS = ['test/permission-bundles.test.ts', 'test/ketsuite-permission-catalogue.test.ts']

/**
 * Changes that cannot add, remove or reclassify a function.
 *
 * The job asks one question: does every composed production function have an
 * exact bundle or an exemption. Only a declaration can change that answer, and
 * these four kinds of file hold none:
 *
 * - a stylesheet is never part of the module graph;
 * - documentation is not either;
 * - `messages.ts` is a translations record;
 * - `packages/ketsuite/src/ui` is components, and composes nothing.
 *
 * The last two are conventions, so `ci-test-groups.test.ts` asserts them
 * against the tree rather than trusting them — the day one of those files
 * declares a function, the test says so instead of the gate quietly going
 * blind.
 *
 * A test file is inert too: one may compose a module of its own, but not the
 * production deployment this job reads. The two tests the job runs are the
 * exception, because editing them changes the question being asked.
 */
const PERMISSION_INERT = [
  /\.css$/,
  /^docs\//,
  /\.md$/,
  /^packages\/ketsuite\/src\/modules\/[^/]+\/messages\.ts$/,
  /^packages\/ketsuite\/src\/ui\//,
  /^test\//,
]

/**
 * Whether a diff could change which functions need a bundle.
 *
 * Fails safe in both directions it can: an unrecognised path runs the job, and
 * so does a diff whose base could not be resolved.
 *
 * @param {readonly string[]} files @returns {boolean}
 */
export function permissionCoverageNeeded(files) {
  // Nothing to look at is not the same as nothing to do — an empty list is
  // what a diff that could not be computed looks like.
  if (!files.length) return true
  return !files.every(
    (file) =>
      file && !PERMISSION_TESTS.includes(file) && PERMISSION_INERT.some((pattern) => pattern.test(file)),
  )
}

/** @param {string | undefined} base @param {string | undefined} head */
function gitChangedFiles(base, head) {
  if (!base || !head || /^0+$/.test(base)) return null
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRD', base, head], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git diff failed')
  return result.stdout.split('\n').filter(Boolean)
}

/** @param {string} source */
function emittedPath(source) {
  const extension = extname(source)
  return join('.build', source.slice(0, -extension.length) + '.js')
}

/** @param {string | undefined} group */
function runGroup(group) {
  if (!group || !GROUPS.includes(/** @type {TestGroup} */ (group))) {
    throw new Error(`unknown CI test group: ${group ?? ''}`)
  }
  const tests = discoverTests(/** @type {TestGroup} */ (group))
  if (!tests.length) throw new Error(`CI test group has no tests: ${group}`)
  console.log(`Running ${group}: ${tests.length} test files`)
  const result = spawnSync(process.execPath, ['--test', ...tests.map(emittedPath)], {
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

/** @param {string | undefined} base @param {string | undefined} head */
function printPlan(base, head) {
  const changed = gitChangedFiles(base, head)
  const groups = changed === null ? [...GROUPS] : groupsForChanges(changed)
  console.error(
    changed === null ? 'No usable base revision; selecting every group.' : `Changed files: ${changed.length}`,
  )
  console.error(`Selected groups: ${groups.join(', ') || 'none'}`)
  const permissions = changed === null ? true : permissionCoverageNeeded(changed)
  console.error(`Permission coverage: ${permissions ? 'needed' : 'nothing declared can have moved'}`)
  console.log(`groups=${JSON.stringify(groups)}`)
  console.log(`has_groups=${groups.length > 0}`)
  console.log(`permissions=${permissions}`)
}

if (process.argv[1]?.endsWith('ci-test-groups.mjs')) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'run') runGroup(args[0])
  else if (command === 'plan') printPlan(args[0], args[1])
  else if (command === 'list') {
    for (const group of GROUPS) console.log(`${group}: ${discoverTests(group).length}`)
  } else {
    console.error('usage: node tools/ci-test-groups.mjs <list|plan BASE HEAD|run GROUP>')
    process.exit(1)
  }
}
