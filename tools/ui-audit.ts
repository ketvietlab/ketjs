// Markup belongs to the kit.
//
// A module says which rows, which columns, which labels. What a card or a table
// looks like is one decision, and a decision made in forty screens is forty
// answers — which is how the `data-ui` contract drifted four times in one
// afternoon before `@ketvietlab/ketsuite/ui` existed.
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
  'packages/ketsuite/src/modules/website_search/islands.ts':
    'an island, so its markup is behaviour — needs kit primitives that take handlers',
  'packages/ketsuite/src/modules/backend/catalogue.ts':
    'the design harness; its own chrome is not a product screen',
  'apps/admin/serve.ts': 'the design harness page, same reason',
}

/**
 * The shell belongs to one file, for the same reason the markup belongs to one
 * directory.
 *
 * Twenty-three modules used to assemble the admin frame themselves — viewer, menu,
 * joints, and the document-or-fragment choice. Three of them answered with a plain
 * `page()`, which the browser cannot use as a navigation fragment, so every click
 * into those apps reloaded the whole document; fourteen never passed
 * `backend:sidebar.foot`, so the unread-mail and pending-activity counters vanished
 * as soon as you navigated into them. Neither failure is visible in a diff — both
 * are visible the moment a module writes its own frame.
 */
const SHELL = 'packages/ketsuite/src/modules/backend/screen.ts'

/**
 * Naming one of these is what building your own frame looks like.
 *
 * Only these three are the shell's: they belong on every screen, so a module that
 * fetches one has taken over deciding whether every screen gets it — which is how
 * fourteen of them quietly stopped. A screen-specific joint (`apps.footer`,
 * `app-card.actions`) is passed through `extras` instead and stays where it is
 * needed. *Filling* any joint is what a module is supposed to do, so only the
 * `ctx.joint(...)` call counts, never the `fills` key.
 */
const SHELL_INTERNALS: Array<[RegExp, string]> = [
  [/joint\([^)]*'backend:(?:nav\.items|topbar\.end|sidebar\.foot)'/, 'renders a shell joint itself'],
  [/x-ket-navigation/, 'tests the navigation header by hand'],
]

/**
 * Answering an `/admin` path without going through the shell. `page(` alone is
 * fine anywhere else; it is naming an `/admin` route in the same file that makes it
 * a backend screen served the wrong way.
 */
const RAW_PAGE = /\bpage\(\{/
const ADMIN_ROUTE = /'\/admin(?:\/[^']*)?'\s*:/

/**
 * Screens that are deliberately not the backend. Each is a page a signed-out or
 * shared-device visitor sees, so giving it the admin frame would leak the sidebar,
 * the menu, and whoever was signed in last.
 */
const NOT_THE_BACKEND: Record<string, string> = {
  'packages/ketsuite/src/modules/attendance_backend/routes.ts':
    'the kiosk is answered anonymously on a shared tablet, so it gets no viewer and no menu',
  'apps/admin/serve.ts': 'the design harness serves the catalogue, not a product screen',
}

/** Where the PascalCase name is not just the capitalised one. */
const JSX_NAME: Record<string, string> = { framedPage: 'Framed' }

type Finding = { file: string; line: number; what: string; text: string; fix?: string }

/** An opening/closing tag in the literal portions of html`...`. */
const TAG = /<\/?[a-z][a-z0-9-]*(?=[\s>/])/
const DATA_UI = /data-ui\s*=/
/**
 * A component the kit exports under a PascalCase name, called as a function.
 *
 * The rule is not about taste: the function form takes whatever arguments happen to
 * be there, so a screen can grow a second positional argument that the JSX form
 * cannot express and the next reader cannot see. Every name here has a PascalCase
 * export in `ui/index.ts` — there is nothing left to alias.
 */
const SCREEN_COMPONENT_CALL =
  /\b(framedPage|recordWorkspace|recordForm|recordActions|recordToggle|section|surface|contentCard|cardGrid|formCluster|notice|modalSheet|datePicker|scheduleBoard|kanbanGrid|kanbanCard|recordList|tabs|breadcrumbs|metric|mediaPanel|attachmentPanel|definitionList|appCard|cardGroups)\s*\(/g

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
    if (path.endsWith('.test.ts')) continue

    const source = readFileSync(file, 'utf8')
    const lines = source.split('\n')

    // The shell rule applies to the kit and to the pending markup list too: a file
    // may still be waiting to hand its markup over and must not meanwhile grow its
    // own frame.
    if (path !== SHELL) {
      const exempt = path in NOT_THE_BACKEND
      for (const [pattern, what] of SHELL_INTERNALS) {
        for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
          const line = source.slice(0, match.index).split('\n').length
          findings.push({
            file: path,
            line,
            what,
            text: lines[line - 1]?.trim() ?? match[0],
            fix: `compose ${SHELL}`,
          })
        }
      }
      if (!exempt && ADMIN_ROUTE.test(source)) {
        for (const match of source.matchAll(new RegExp(RAW_PAGE.source, 'g'))) {
          const line = source.slice(0, match.index).split('\n').length
          findings.push({
            file: path,
            line,
            what: 'answers an /admin path with page()',
            text: lines[line - 1]?.trim() ?? match[0],
            fix: 'use adminPage() from backend/screen.ts, or a fragment request gets a whole document',
          })
        }
      }
    }

    if (path.startsWith(KIT)) continue
    if (path in PENDING) {
      seenPending.add(path)
      continue
    }
    if (path.endsWith('.tsx')) {
      for (const match of source.matchAll(/<[a-z][a-z0-9-]*(?=[\s/>])/g)) {
        const line = source.slice(0, match.index).split('\n').length
        findings.push({ file: path, line, what: 'raw JSX tag', text: lines[line - 1]?.trim() ?? match[0] })
      }
      for (const match of source.matchAll(SCREEN_COMPONENT_CALL)) {
        const line = source.slice(0, match.index).split('\n').length
        findings.push({
          file: path,
          line,
          what: 'component function call',
          text: `${match[1]}(...) — the kit exports it as <${JSX_NAME[match[1] as string] ?? `${match[1]?.[0]?.toUpperCase()}${match[1]?.slice(1)}`} />`,
        })
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
console.log(`  the admin shell may only be assembled in ${SHELL}`)
for (const [path, why] of Object.entries(PENDING)) {
  console.log(`  pending: ${path} — ${why}`)
}
for (const [path, why] of Object.entries(NOT_THE_BACKEND)) {
  console.log(`  not the backend: ${path} — ${why}`)
}
if (stale.length) {
  console.log('')
  for (const p of stale)
    console.error(`  ✗ ${p} is on the pending list but no longer exists — remove the entry`)
}
if (findings.length) {
  console.log('')
  for (const f of findings)
    console.error(`  ✗ ${f.file}:${f.line} ${f.what} — ${f.fix ?? 'use ketsuite/ui'}\n      ${f.text}`)
}
if (findings.length || stale.length) {
  console.error(`\n${findings.length + stale.length} problem(s).`)
  process.exit(1)
}
console.log('  no module writes its own markup')
