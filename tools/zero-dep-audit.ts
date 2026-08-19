// Rule 1 is a hard rule, so it gets a checker rather than a promise in a README.
//
// One exception is allowed and fenced (decision D4a): the Postgres driver. It must
// be an optionalDependency — so `npm i ketjs` still installs nothing — and exactly
// one file may import it. Widening this list is a visible diff someone has to
// justify, which is the only thing that keeps an exception from becoming the default.

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'

type Pkg = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const ALLOWED_DEV = new Set(['typescript', '@types/node'])
const ALLOWED_OPTIONAL = new Set(['postgres'])
// file -> the external specifiers it alone may import
const EXTERNAL_IMPORT_ALLOWLIST = new Map<string, Set<string>>([
  ['src/data/postgres.ts', new Set(['postgres'])],
])

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg
const problems: string[] = []

const runtimeDeps = Object.keys(pkg.dependencies ?? {})
if (runtimeDeps.length) problems.push(`package.json declares REQUIRED runtime dependencies: ${runtimeDeps.join(', ')} — these must be optionalDependencies or removed`)

const optionalDeps = Object.keys(pkg.optionalDependencies ?? {})
for (const d of optionalDeps) {
  if (!ALLOWED_OPTIONAL.has(d)) problems.push(`optionalDependency "${d}" is not in the fenced set (${[...ALLOWED_OPTIONAL].join(', ')}) — see decision D4a`)
}

const devDeps = Object.keys(pkg.devDependencies ?? {})
for (const d of devDeps) if (!ALLOWED_DEV.has(d)) problems.push(`devDependency "${d}" is not in the allowed set (${[...ALLOWED_DEV].join(', ')})`)
if (devDeps.length > 2) problems.push(`${devDeps.length} devDependencies, budget is 2`)

const IMPORT_RE = /(?:^|\s)(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

let files = 0
let fenced = 0
for await (const file of glob('src/**/*.ts')) {
  files++
  const src = readFileSync(file, 'utf8')
  const allowedHere = EXTERNAL_IMPORT_ALLOWLIST.get(file) ?? new Set<string>()

  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = (m[1] ?? m[2] ?? m[3]) as string
    if (spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')) continue
    if (allowedHere.has(spec)) { fenced++; continue }
    problems.push(
      allowedHere.size === 0
        ? `${file} imports "${spec}" — only ${[...EXTERNAL_IMPORT_ALLOWLIST.keys()].join(', ')} may import anything external`
        : `${file} imports "${spec}", which is outside its allowance (${[...allowedHere].join(', ')})`)
  }

  // The theme sandbox argument rests on these never appearing.
  if (/\bnew Function\s*\(/.test(src) || /(?<![\w.])eval\s*\(/.test(src)) {
    problems.push(`${file} uses eval/new Function — the theme sandbox argument depends on this staying absent`)
  }
}

console.log(`zero-dep audit: scanned ${files} source files`)
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`)
  process.exit(1)
}
console.log('  required runtime dependencies: 0')
console.log(`  optional (fenced, D4a): ${optionalDeps.join(', ') || '(none declared yet)'}`)
console.log(`  fenced external imports in use: ${fenced}`)
console.log(`  devDependencies: ${devDeps.join(', ') || '(none)'} (type-checking only, never loaded at runtime)`)
console.log('  eval / new Function: absent')
