import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const deprecated = ['FormPage', 'DashboardPage', 'BoardPage']

/** Count render sites, not imports or line changes. Counts are deliberately per component and file.
 * @param {string} source
 * @returns {Map<string, number>}
 */
export function compatibilityConsumers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/gu, ' ')
  const counts = new Map()
  for (const name of deprecated) {
    const names = new Set([name])
    for (const match of code.matchAll(new RegExp(`\\b${name}\\s+as\\s+(\\w+)`, 'gu'))) names.add(match[1])
    let count = 0
    for (const local of names) {
      const pattern = new RegExp(`(?:<\\s*(?:[\\w$]+\\.)*${local}\\b|\\b${local}\\s*\\()`, 'gu')
      count += [...code.matchAll(pattern)].length
    }
    counts.set(name, count)
  }
  return counts
}

/** @param {string} before @param {string} after */
export function addedCompatibilityConsumers(before, after) {
  const previous = compatibilityConsumers(before)
  return [...compatibilityConsumers(after)].flatMap(([name, count]) => {
    const added = count - (previous.get(name) ?? 0)
    return added > 0 ? [`${name}: +${added}`] : []
  })
}

/** Check both committed changes and the current checkout, including untracked source files.
 * @param {string} root @param {string} base
 */
export function auditCompatibilityConsumers(root, base) {
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const ancestor = git(['merge-base', base, 'HEAD']).trim()
  const paths = ['packages/ketsuite/src/modules', 'apps', ':(exclude)apps/design-system']
  /** @param {string} value */
  const files = (value) => value.split('\0').filter((file) => /\.[cm]?[jt]sx?$/u.test(file))
  /** @param {string} revision @param {string} file */
  const at = (revision, file) => {
    try {
      return git(['show', `${revision}:${file}`])
    } catch {
      return ''
    }
  }
  const violations = []
  for (const revision of ['HEAD', 'working tree']) {
    const changed = new Set(
      files(
        git([
          'diff',
          '--name-only',
          '-z',
          '--no-renames',
          ancestor,
          ...(revision === 'HEAD' ? ['HEAD'] : []),
          '--',
          ...paths,
        ]),
      ),
    )
    if (revision === 'working tree')
      for (const file of files(git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths])))
        changed.add(file)
    for (const file of changed) {
      let current = ''
      if (revision === 'HEAD') current = at('HEAD', file)
      else {
        try {
          current = readFileSync(join(root, file), 'utf8')
        } catch {
          /* Deleted file. */
        }
      }
      for (const added of addedCompatibilityConsumers(at(ancestor, file), current))
        violations.push(`${revision}: ${file}: ${added}`)
    }
  }
  return violations
}
