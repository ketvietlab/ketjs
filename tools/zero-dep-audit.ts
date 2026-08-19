// The dependency rules, enforced per package.
//
// Splitting into a monorepo turned the fence from a rule into a shape: the
// Postgres driver is not "allowed in one file" any more, it lives in the one
// package that declares it, and every other package is structurally incapable of
// reaching it. This checks that the shape is still what it claims to be.
//
// It also enforces the rule that keeps the framework honest: KetSuite may only use
// the public entry point, the same one a third-party module has. If the suite needs
// a deep import, so does everyone else — and it should be exported, not smuggled.

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'

type Pkg = {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

type Rule = {
  /** Packages this one may depend on and import. */
  allow: string[]
  /** External packages it may declare as an optional peer, and import. */
  optionalPeers?: string[]
  /** Only the package's own entry point may be imported, never a path inside it. */
  publicOnly?: boolean
}

const RULES: Record<string, Rule> = {
  'ketjs-view': { allow: [] },
  'ketjs': { allow: ['ketjs-view'] },
  'ketjs-postgres': { allow: ['ketjs'], optionalPeers: ['postgres'] },
  'ketsuite': { allow: ['ketjs'], publicOnly: true },
}
const ALLOWED_DEV = new Set(['typescript', '@types/node', 'postgres'])

const problems: string[] = []
const IMPORT_RE = /(?:^|\s)(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

const root = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg
if (!root.private) problems.push('the workspace root must be private so it is never published')
if (Object.keys(root.dependencies ?? {}).length) problems.push(`the workspace root declares dependencies: ${Object.keys(root.dependencies!).join(', ')}`)

const summary: string[] = []

for (const [name, rule] of Object.entries(RULES)) {
  const dir = `packages/${name}`
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as Pkg

  const deps = Object.keys(pkg.dependencies ?? {})
  for (const d of deps) if (!rule.allow.includes(d)) problems.push(`${name}: depends on "${d}", which is outside its allowance (${rule.allow.join(', ') || 'nothing'})`)

  const stillOptional = Object.keys(pkg.optionalDependencies ?? {})
  if (stillOptional.length) problems.push(`${name}: optionalDependencies are installed by npm anyway — use peerDependenciesMeta.optional (${stillOptional.join(', ')})`)

  const peers = Object.keys(pkg.peerDependencies ?? {})
  for (const p of peers) {
    if (!(rule.optionalPeers ?? []).includes(p)) problems.push(`${name}: declares peer "${p}", which only ${Object.entries(RULES).filter(([, r]) => r.optionalPeers?.includes(p)).map(([n]) => n).join('/') || 'no package'} may`)
    if (!pkg.peerDependenciesMeta?.[p]?.optional) problems.push(`${name}: peer "${p}" is not optional, so npm installs it for every consumer`)
  }
  for (const d of Object.keys(pkg.devDependencies ?? {})) {
    if (!ALLOWED_DEV.has(d)) problems.push(`${name}: devDependency "${d}" is outside the allowed set`)
  }

  let files = 0
  let external = 0
  for await (const file of glob(`${dir}/src/**/*.ts`)) {
    files++
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3]) as string
      if (spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')) continue

      const target = spec.split('/')[0] as string
      const isSibling = rule.allow.includes(target)
      const isPeer = (rule.optionalPeers ?? []).includes(target)
      if (!isSibling && !isPeer) {
        problems.push(`${file} imports "${spec}" — ${name} may only reach ${[...rule.allow, ...(rule.optionalPeers ?? [])].join(', ') || 'node: builtins'}`)
        continue
      }
      if (isSibling && rule.publicOnly && spec !== target) {
        problems.push(`${file} imports "${spec}" — ${name} must use the public entry "${target}" alone. If the suite needs it, export it; do not reach past the contract everyone else has.`)
        continue
      }
      external++
    }
    if (/\bnew Function\s*\(/.test(src) || /(?<![\w.])eval\s*\(/.test(src)) {
      problems.push(`${file} uses eval/new Function — the theme sandbox argument depends on this staying absent`)
    }
  }
  summary.push(`  ${name.padEnd(16)} ${String(files).padStart(2)} files  deps: ${deps.join(', ') || 'none'}${peers.length ? `  optional peer: ${peers.join(', ')}` : ''}  cross-package imports: ${external}`)
}

console.log('dependency audit, per package:')
for (const line of summary) console.log(line)
if (problems.length) {
  console.log('')
  for (const p of problems) console.error(`  FAIL  ${p}`)
  process.exit(1)
}
console.log('')
console.log('  the only package that may touch a driver is ketjs-postgres, and it does so as an optional peer')
console.log('  ketsuite reaches the framework only through its public entry, exactly as a third-party module would')
console.log('  eval / new Function: absent')
