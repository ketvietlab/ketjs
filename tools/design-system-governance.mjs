import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const designRoot = join(root, 'packages/design-system/src')
/** @param {string} path */
const read = (path) => readFileSync(path, 'utf8')
/** @param {string} path @returns {string[]} */
const walk = (path) => {
  /** @type {string[]} */
  const files = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (['.build', '.git', 'dist', 'node_modules'].includes(entry.name)) continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...walk(child))
    else files.push(child)
  }
  return files
}
/** @param {boolean} condition @param {string} message */
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
/** @param {string[]} values */
const duplicates = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]

const publicIndex = read(join(designRoot, 'index.ts'))
const runtimeExports = [...publicIndex.matchAll(/export\s+\{([\s\S]*?)\}\s+from\s+['"][^'"]+['"]/gu)]
  .flatMap((match) => match[1].split(',').map((name) => name.trim()))
  .filter(Boolean)
  .filter(
    (name) =>
      !['HOOKS', 'OWNERS', 'attachDesignSystemInteractions', 'initials', 'withQueryState'].includes(name),
  )
  .sort()
const publicSources = [...publicIndex.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
  .map((match) => match[1])
  .filter((source) => source.endsWith('.tsx'))
assert(
  publicSources.every((source) => source.endsWith('/index.tsx')),
  'Every public component source must use a directory entry point.',
)

const registry = read(join(designRoot, 'catalogue/registry.ts'))
const registrations = [...registry.matchAll(/entry\(([\s\S]*?)\),/gu)]
const registrationFields = registrations.map((match) =>
  [...match[1].matchAll(/'([^']+)'/gu)].map((part) => part[1]),
)
const registeredNames = registrationFields
  .map((fields) => fields[0])
  .filter(Boolean)
  .sort()
assert(
  !duplicates(registeredNames).length,
  `Duplicate component registrations: ${duplicates(registeredNames).join(', ')}`,
)
assert(
  JSON.stringify(registeredNames) === JSON.stringify(runtimeExports),
  `Public runtime exports and component registry differ.\nPublic: ${runtimeExports.join(', ')}\nRegistry: ${registeredNames.join(', ')}`,
)

const specimenSource = read(join(designRoot, 'catalogue/specimens.tsx'))
const specimenIds = new Set([...specimenSource.matchAll(/\bid:\s*'([^']+)'/gu)].map((match) => match[1]))
for (const fields of registrationFields) {
  const [name, , source, , specimenId] = fields
  assert(!!name && !!source && !!specimenId, `Malformed component registration for ${name ?? 'unknown'}.`)
  assert(statSync(join(designRoot, source)).isDirectory(), `${name} source is not a directory: ${source}`)
  assert(statSync(join(designRoot, source, 'index.tsx')).isFile(), `${name} has no index.tsx: ${source}`)
  assert(specimenIds.has(specimenId), `${name} references missing specimen #${specimenId}`)
}

const componentFiles = walk(designRoot).filter((path) => path.endsWith('/index.tsx'))
/** @type {Map<string, string>} */
const hookOwners = new Map()
for (const path of componentFiles) {
  const declaration = read(path).match(/export const HOOKS\s*=\s*\[([\s\S]*?)\]\s*as const/u)
  if (!declaration) continue
  for (const match of declaration[1].matchAll(/'([^']+)'/gu)) {
    const hook = match[1]
    const prior = hookOwners.get(hook)
    assert(!prior, `Duplicate data-ui hook ${hook}: ${prior} and ${relative(root, path)}`)
    hookOwners.set(hook, relative(root, path))
  }
}

const componentCss = walk(designRoot).filter(
  (path) =>
    path.endsWith('.css') &&
    [
      '/primitives/',
      '/interactions/',
      '/forms/',
      '/data-display/',
      '/data-operations/',
      '/record/',
      '/layouts/',
      '/patterns/',
    ].some((segment) => path.includes(segment)) &&
    !['primitives.css', 'layouts.css', 'shell.css', 'flat.css', 'grouped.css', 'patterns.css'].some(
      (legacy) => path.endsWith(`/${legacy}`),
    ),
)
for (const path of componentCss) {
  const hooks = [...read(path).matchAll(/data-ui(?:[~|^$*]?=)["']([^"']+)["']/gu)].map((match) => match[1])
  if (hooks.length)
    assert(
      /\/(?:primitives|interactions|forms|data-display|data-operations|record|layouts|patterns)\/[^/]+\/[^/]+\.css$/u.test(
        path,
      ),
      `Selectors must live below an owning component directory: ${relative(root, path)}`,
    )
}

const sourceFiles = walk(root).filter(
  (path) => /\.(?:[cm]?[jt]sx?)$/u.test(path) && !path.startsWith(join(root, 'packages/design-system')),
)
const invalidDeepImports = []
for (const path of sourceFiles) {
  for (const match of read(path).matchAll(/['"]@ketvietlab\/design-system\/([^'"]+)['"]/gu)) {
    if (!['catalogue', 'contract'].includes(match[1]))
      invalidDeepImports.push(`${relative(root, path)}: ${match[0]}`)
  }
}
assert(
  !invalidDeepImports.length,
  `Unsupported design-system deep imports:\n${invalidDeepImports.join('\n')}`,
)

process.stdout.write(
  `Design-system governance is current: ${registeredNames.length} components, ${hookOwners.size} hooks, ${componentCss.length} CSS files.\n`,
)
