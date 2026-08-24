// Keep KetJS and KetSuite contracts product-native. Historical implementation
// names must not leak back into code, tests, docs, filenames, or public copy.

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'

const legacyName = ['o', 'd', 'o', 'o'].join('')
const legacyConcepts = [
  ['addons', 'path'].join('_'),
  ['ir', 'model', 'access'].join('.'),
  ['db', 'filter'].join(''),
  ['commercial', 'partner', 'id'].join('_'),
  ['allowed', 'company', 'ids'].join('_'),
  ['customer', 'rank'].join('_'),
  ['supplier', 'rank'].join('_'),
  ['ir', 'property'].join('.'),
  ['sale', 'stock'].join('_'),
  ['q', 'web'].join(''),
]
const forbidden = new RegExp(
  `\\b${legacyName}\\b|${legacyName}19|${legacyName}[_-]|[_-]${legacyName}|${legacyConcepts
    .map((term) => term.replaceAll('.', '\\.'))
    .join('|')}`,
  'i',
)
const textExtensions = new Set([
  '',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.ktl',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
if (listed.error) throw listed.error
if (listed.status !== 0) throw new Error(listed.stderr)

const violations = []
for (const path of listed.stdout.split('\0').filter(Boolean)) {
  if (!existsSync(path)) continue
  if (path.includes('/dist/') || path.startsWith('.build/') || path.startsWith('.types/')) continue
  if (forbidden.test(path)) {
    violations.push(path)
    continue
  }
  if (!textExtensions.has(extname(path))) continue
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let index = 0; index < lines.length; index++)
    if (forbidden.test(lines[index])) violations.push(`${path}:${index + 1}`)
}

if (violations.length) {
  console.error(`forbidden legacy terminology:\n${violations.map((item) => `- ${item}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log('terminology audit passed')
}
