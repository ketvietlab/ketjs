// Rule 1 is a hard rule, so it gets a checker rather than a promise in a README.
// Runtime dependencies must be zero, and framework source may only import from
// `node:` or from itself.

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const problems: string[] = []

const runtimeDeps = Object.keys(pkg.dependencies ?? {})
if (runtimeDeps.length) problems.push(`package.json declares runtime dependencies: ${runtimeDeps.join(', ')}`)

const devDeps = Object.keys(pkg.devDependencies ?? {})
const ALLOWED_DEV = new Set(['typescript', '@types/node'])
for (const d of devDeps) if (!ALLOWED_DEV.has(d)) problems.push(`devDependency "${d}" is not in the allowed set (${[...ALLOWED_DEV].join(', ')})`)
if (devDeps.length > 2) problems.push(`${devDeps.length} devDependencies, budget is 2`)

const IMPORT_RE = /(?:^|\s)(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

let files = 0
for await (const file of glob('src/**/*.ts')) {
  files++
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = (m[1] ?? m[2] ?? m[3]) as string
    const ok = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')
    if (!ok) problems.push(`${file} imports "${spec}" — only node: builtins and relative paths are allowed`)
  }
}

// Nothing in src/ may reach for a bundler, a transpiler or a runtime shim.
for await (const file of glob('src/**/*.ts')) {
  const src = readFileSync(file, 'utf8')
  if (/\bnew Function\s*\(/.test(src) || /(?<![\w.])eval\s*\(/.test(src)) {
    problems.push(`${file} uses eval/new Function — the theme sandbox argument depends on this staying absent`)
  }
}

console.log(`zero-dep audit: scanned ${files} source files`)
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`)
  process.exit(1)
}
console.log('  runtime dependencies: 0')
console.log(`  devDependencies: ${devDeps.join(', ') || '(none)'} (type-checking only, never loaded at runtime)`)
console.log('  imports: node: builtins and relative paths only')
console.log('  eval / new Function: absent')
