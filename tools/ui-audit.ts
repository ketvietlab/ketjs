// Markup belongs to the kit.
//
// A module says which rows, which columns, which labels. What a card or a table
// looks like is one decision, and a decision made in forty screens is forty
// answers — which is how the `data-ui` contract drifted four times in one
// afternoon before `ketsuite/ui` existed.
//
// So: no tag inside a trusted `html` template outside `packages/ketsuite/src/ui`.
// KTL fills are deliberately not included: they are the restricted extension
// language, not backend screen markup, even when their source happens to be a TS
// string. This is the same
// kind of check as tools/zero-dep-audit.ts — a rule the shape of the repo enforces
// rather than a rule people are asked to remember.

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'

/** Where markup is allowed to be written. */
const KIT = 'packages/ketsuite/src/ui/'

/** Scanned for violations. */
const PATTERNS = [
  'packages/ketsuite/src/**/*.ts',
  'packages/ketsuite/src/**/*.tsx',
  'apps/**/*.ts',
  'apps/**/*.tsx',
]

/**
 * Not yet moved, and each one is a job rather than an exception.
 *
 * Printed on every run so it cannot rot quietly: a list nobody sees is a list that
 * grows. Empty it, do not extend it.
 */
const PENDING: Record<string, string> = {
  'packages/ketsuite/src/modules/user/login.ts': 'waiting on ui/form.ts',
  'packages/ketsuite/src/modules/website_search/islands.ts':
    'an island, so its markup is behaviour — needs kit primitives that take handlers',
  'packages/ketsuite/src/modules/backend/catalogue.ts':
    'the design harness; its own chrome is not a product screen',
  'apps/admin/serve.ts': 'the design harness page, same reason',
}

type Finding = { file: string; line: number; what: string; text: string }

/** An opening/closing tag in the literal portions of html`...`. */
const TAG = /<\/?[a-z][a-z0-9-]*(?=[\s>/])/
const DATA_UI = /data-ui\s*=/
const SCREEN_COMPONENT_CALL = /\b(framed|recordWorkspace|recordForm|section|surface|formCluster)\s*\(/g

const skipQuoted = (source: string, start: number, quote: string): number => {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === quote) return i + 1
  }
  return source.length
}

const skipExpression = (source: string, start: number): number => {
  let depth = 1
  for (let i = start; i < source.length; ) {
    const ch = source[i]
    if (ch === "'" || ch === '"') {
      i = skipQuoted(source, i, ch)
      continue
    }
    if (ch === '`') {
      i = skipTemplate(source, i).end
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2)
      i = end < 0 ? source.length : end + 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 2
      continue
    }
    if (ch === '{') depth++
    if (ch === '}' && --depth === 0) return i + 1
    i++
  }
  return source.length
}

/** Literal text only; expressions are code and nested html tags are audited separately. */
const skipTemplate = (source: string, tick: number): { end: number; literal: string } => {
  let literal = ''
  for (let i = tick + 1; i < source.length; ) {
    if (source[i] === '\\') {
      literal += source.slice(i, i + 2)
      i += 2
      continue
    }
    if (source[i] === '`') return { end: i + 1, literal }
    if (source[i] === '$' && source[i + 1] === '{') {
      i = skipExpression(source, i + 2)
      literal += ' '
      continue
    }
    literal += source[i]
    i++
  }
  return { end: source.length, literal }
}

const findings: Finding[] = []
const seenPending = new Set<string>()

for (const pattern of PATTERNS) {
  for await (const file of glob(pattern)) {
    const path = file.replaceAll('\\', '/')
    if (path.startsWith(KIT)) continue
    if (path.endsWith('.test.ts')) continue
    if (path in PENDING) {
      seenPending.add(path)
      continue
    }

    const source = readFileSync(file, 'utf8')
    const lines = source.split('\n')
    if (path.endsWith('.tsx')) {
      for (const match of source.matchAll(/<[a-z][a-z0-9-]*(?=[\s/>])/g)) {
        const line = source.slice(0, match.index).split('\n').length
        findings.push({ file: path, line, what: 'raw JSX tag', text: lines[line - 1]?.trim() ?? match[0] })
      }
      if (/\/[^/]*screen[^/]*\.tsx$/.test(path)) {
        for (const match of source.matchAll(SCREEN_COMPONENT_CALL)) {
          const line = source.slice(0, match.index).split('\n').length
          findings.push({
            file: path,
            line,
            what: 'component function call',
            text: `${match[1]}(...) — use <${match[1]?.[0]?.toUpperCase()}${match[1]?.slice(1)} /> JSX`,
          })
        }
      }
    }
    for (const match of source.matchAll(/\bhtml\s*`/g)) {
      const start = match.index
      const tick = source.indexOf('`', start)
      const literal = skipTemplate(source, tick).literal
      if (!DATA_UI.test(literal) && !TAG.test(literal)) continue
      const line = source.slice(0, start).split('\n').length
      findings.push({
        file: path,
        line,
        what: DATA_UI.test(literal) ? 'data-ui' : 'raw tag',
        text: lines[line - 1]?.trim() ?? 'html`...`',
      })
    }
  }
}

const stale = Object.keys(PENDING).filter((p) => !seenPending.has(p))

console.log('ui audit')
console.log(`  markup may only be written under ${KIT}`)
for (const [path, why] of Object.entries(PENDING)) {
  console.log(`  pending: ${path} — ${why}`)
}
if (stale.length) {
  console.log('')
  for (const p of stale)
    console.error(`  ✗ ${p} is on the pending list but no longer exists — remove the entry`)
}
if (findings.length) {
  console.log('')
  for (const f of findings)
    console.error(`  ✗ ${f.file}:${f.line} writes ${f.what} — use ketsuite/ui\n      ${f.text}`)
}
if (findings.length || stale.length) {
  console.error(`\n${findings.length + stale.length} problem(s).`)
  process.exit(1)
}
console.log('  no module writes its own markup')
