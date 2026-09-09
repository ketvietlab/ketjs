import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @typedef {{ name: string, imported: string, kind: 'runtime' | 'type', source: string }} ExportEntry */
/** @typedef {{ owner: string, maturity?: string, decision: string, target?: string, wave?: number, gapTask: string }} ModulePolicy */
/** @typedef {{ name: string, owner: string, wave: number, gapTask: string }} PlannedComponent */
/** @typedef {{ publicModules: Record<string, ModulePolicy>, compatibilityModules: Record<string, ModulePolicy>, plannedComponents: PlannedComponent[] }} InventoryPolicy */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const designRoot = join(root, 'packages/design-system')
const compatibilityRoot = join(root, 'packages/ketsuite/src/ui')
const policyPath = join(designRoot, 'src/catalogue/inventory-policy.json')
const outputPath = join(designRoot, 'src/catalogue/inventory.generated.ts')
const check = process.argv.includes('--check')

/** @param {string} path */
const read = (path) => readFileSync(path, 'utf8')
/** @param {string} path */
const slash = (path) => path.replaceAll('\\', '/')
/** @template Value @param {Value[]} values @returns {Value[]} */
const unique = (values) => [...new Set(values)].sort()
/** @param {string} directory @param {string[]} extensions @returns {string[]} */
const walk = (directory, extensions) => {
  /** @type {string[]} */
  const files = []
  for (const name of readdirSync(directory).sort((a, b) => a.localeCompare(b, 'en'))) {
    if (name === 'node_modules' || name === 'dist' || name === '.build' || name === '.git') continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) files.push(...walk(path, extensions))
    else if (extensions.some((extension) => name.endsWith(extension))) files.push(path)
  }
  return files
}
/** @param {string} source */
const lineCount = (source) => source.split(/\r?\n/u).length - Number(source.endsWith('\n'))
/** @param {string} value */
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
/** @param {string} source @param {string} name */
const contains = (source, name) => new RegExp(`\\b${escapePattern(name)}\\b`, 'u').test(source)

/** @param {string} source @returns {ExportEntry[]} */
const parseExports = (source) => {
  /** @type {ExportEntry[]} */
  const entries = []
  for (const match of source.matchAll(/export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/gu)) {
    for (const token of match[2].split(',')) {
      const clean = token.replace(/\/\*[\s\S]*?\*\//gu, '').trim()
      if (!clean) continue
      const [imported, exported = imported] = clean.split(/\s+as\s+/u)
      entries.push({ name: exported, imported, kind: match[1] ? 'type' : 'runtime', source: match[3] })
    }
  }
  for (const match of source.matchAll(/export\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gu))
    entries.push({ name: match[1], imported: '*', kind: 'runtime', source: match[2] })
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.kind.localeCompare(b.kind, 'en'))
}

/** @type {InventoryPolicy} */
const policy = JSON.parse(read(policyPath))
const catalogueFiles = walk(join(designRoot, 'src/catalogue'), ['.ts', '.tsx']).filter(
  (path) => !path.endsWith('inventory.generated.ts'),
)
const testFiles = walk(join(root, 'test'), ['.test.ts', '.test.tsx'])
const consumerFiles = walk(join(root, 'packages/ketsuite/src/modules'), ['.ts', '.tsx'])
const publicExports = parseExports(read(join(designRoot, 'src/index.ts')))
const compatibilityExports = parseExports(read(join(compatibilityRoot, 'index.ts'))).filter((entry) =>
  entry.source.startsWith('./'),
)

/** @param {Record<string, ModulePolicy>} policies @param {string} source */
const sourcePolicy = (policies, source) =>
  policies[source] ?? policies[`${source}.ts`] ?? policies[`${source}.tsx`]
/** @param {string[]} files @param {string} name @param {string} base */
const references = (files, name, base = root) =>
  files
    .filter((path) => contains(read(path), name))
    .map((path) => slash(relative(base, path)))
    .sort()

const publicRows = publicExports.map((entry) => {
  const held = sourcePolicy(policy.publicModules, entry.source)
  if (!held) throw new Error(`Missing public inventory policy for ${entry.source} (${entry.name}).`)
  const specimens = entry.kind === 'runtime' ? references(catalogueFiles, entry.name) : []
  const tests = references(testFiles, entry.name)
  return {
    scope: 'public',
    ...entry,
    owner: held.owner,
    maturity: held.maturity,
    decision: held.decision,
    target: '@ketvietlab/design-system',
    wave: held.wave ?? 0,
    consumers: 0,
    specimen: entry.kind === 'type' ? 'not-applicable' : specimens.length ? 'present' : 'gap',
    specimenFiles: specimens,
    tests: tests.length ? 'present' : 'gap',
    testFiles: tests,
    gapTask: held.gapTask,
  }
})

const importsByFile = consumerFiles.map((path) => {
  /** @type {string[]} */
  const names = []
  const source = read(path)
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"][^'"]*\/ui\/index\.(?:ts|js)['"]/gu,
  )) {
    for (const token of match[1].split(',')) {
      const clean = token.replace(/^type\s+/u, '').trim()
      if (clean) names.push(clean.split(/\s+as\s+/u)[0])
    }
  }
  return { file: slash(relative(root, path)), names: unique(names) }
})
/** @type {Map<string, string[]>} */
const compatibilityNamesBySource = new Map()
for (const entry of compatibilityExports) {
  const names = compatibilityNamesBySource.get(entry.source) ?? []
  names.push(entry.name)
  compatibilityNamesBySource.set(entry.source, names)
}
const compatibilityRows = compatibilityExports.map((entry) => {
  const held = sourcePolicy(policy.compatibilityModules, entry.source)
  if (!held) throw new Error(`Missing compatibility inventory policy for ${entry.source} (${entry.name}).`)
  const moduleNames = compatibilityNamesBySource.get(entry.source) ?? []
  const moduleConsumers = importsByFile.filter((consumer) =>
    consumer.names.some((name) => moduleNames.includes(name)),
  )
  return {
    scope: 'compatibility',
    ...entry,
    owner: held.owner,
    maturity: 'compatibility',
    decision: held.decision,
    target: held.target,
    wave: held.wave,
    consumers: moduleConsumers.length,
    specimen: 'not-applicable',
    specimenFiles: [],
    tests: references(testFiles, entry.name).length ? 'present' : 'gap',
    testFiles: references(testFiles, entry.name),
    gapTask: held.gapTask,
  }
})

const plannedRows = policy.plannedComponents
  .map((entry) => ({
    scope: 'planned',
    name: entry.name,
    imported: entry.name,
    kind: 'runtime',
    source: `planned/${entry.name}.tsx`,
    owner: entry.owner,
    maturity: 'planned',
    decision: 'build',
    target: '@ketvietlab/design-system',
    wave: entry.wave,
    consumers: 0,
    specimen: 'gap',
    specimenFiles: [],
    tests: 'gap',
    testFiles: [],
    gapTask: entry.gapTask,
  }))
  .sort((a, b) => a.wave - b.wave || a.name.localeCompare(b.name, 'en'))

const cssFiles = [
  ...walk(join(designRoot, 'src'), ['.css']).map((path) => ({ layer: 'public', path })),
  ...walk(join(root, 'packages/ketsuite/src/modules/backend/design'), ['.css']).map((path) => ({
    layer: 'compatibility',
    path,
  })),
].map(({ layer, path }) => {
  const source = read(path)
  return {
    layer,
    file: slash(relative(root, path)),
    lines: lineCount(source),
    hooks: unique([...source.matchAll(/data-ui(?:[~|^$*]?=)["']([^"']+)["']/gu)].map((match) => match[1])),
  }
})

const packageJson = JSON.parse(read(join(designRoot, 'package.json')))
const rows = [...publicRows, ...compatibilityRows, ...plannedRows]
const payload = {
  schemaVersion: 'ketjs.design-system-inventory.v1',
  version: packageJson.version,
  generatedFrom: [
    'packages/design-system/src/index.ts',
    'packages/design-system/src/catalogue/inventory-policy.json',
    'packages/ketsuite/src/ui/index.ts',
  ],
  summary: {
    publicExports: publicRows.length,
    runtimeExports: publicRows.filter((row) => row.kind === 'runtime').length,
    compatibilityExports: compatibilityRows.length,
    compatibilityModules: new Set(compatibilityRows.map((row) => row.source)).size,
    plannedComponents: plannedRows.length,
    publicGaps: publicRows.filter((row) => row.specimen === 'gap' || row.tests === 'gap').length,
    cssFiles: cssFiles.length,
    cssLines: cssFiles.reduce((total, file) => total + file.lines, 0),
  },
  rows,
  cssFiles,
}

const serialized = JSON.stringify(payload)
const unformattedOutput = `// Generated by tools/design-system-inventory.mjs. Do not edit.\n\nexport type DesignSystemInventoryRow = {\n  scope: 'public' | 'compatibility' | 'planned'\n  name: string\n  imported: string\n  kind: 'runtime' | 'type'\n  source: string\n  owner: string\n  maturity: 'stable' | 'deprecated' | 'compatibility' | 'planned'\n  decision: 'keep' | 'refactor' | 'promote' | 'build' | 'recipe' | 'domain' | 'defer'\n  target: string\n  wave: number\n  consumers: number\n  specimen: 'present' | 'gap' | 'not-applicable'\n  specimenFiles: string[]\n  tests: 'present' | 'gap'\n  testFiles: string[]\n  gapTask: string\n}\n\nexport type DesignSystemInventory = {\n  schemaVersion: string\n  version: string\n  generatedFrom: string[]\n  summary: {\n    publicExports: number\n    runtimeExports: number\n    compatibilityExports: number\n    compatibilityModules: number\n    plannedComponents: number\n    publicGaps: number\n    cssFiles: number\n    cssLines: number\n  }\n  rows: DesignSystemInventoryRow[]\n  cssFiles: Array<{ layer: 'public' | 'compatibility'; file: string; lines: number; hooks: string[] }>\n}\n\nexport const designSystemInventory: DesignSystemInventory = JSON.parse(\n  ${JSON.stringify(serialized)},\n)\n`
const output = execFileSync(
  join(root, 'node_modules/.bin/biome'),
  ['format', '--stdin-file-path', outputPath],
  {
    input: unformattedOutput,
    encoding: 'utf8',
  },
)
if (check) {
  if (read(outputPath) !== output)
    throw new Error('Design-system inventory is stale; run npm run design:inventory.')
  process.stdout.write('Design-system inventory is current.\n')
} else {
  writeFileSync(outputPath, output)
  process.stdout.write(`Wrote ${slash(relative(root, outputPath))}.\n`)
}
