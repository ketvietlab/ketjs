// Every message key the Hospitality screens ask for is a message key that exists.
//
// `hospitality_core.screen.frontDesk.unassigned` was asked for by the arrivals
// table and defined nowhere: it had been added, then removed when the metric
// cards were rewritten, then asked for again when rooms became holdable. The
// column rendered the raw key, three times, on the landing screen of the whole
// module — and every audit in the suite was green, because they read the words
// that exist rather than the words that were asked for and are missing.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { messages } from '../packages/ketsuite/src/modules/hospitality_core/messages.ts'

const root = 'packages/ketsuite/src/modules/hospitality_core'

/**
 * Every literal `hospitality_core.<key>` the module names.
 *
 * Only whole keys: a prefix a screen completes at runtime, like
 * `hospitality_core.stayState.${row.state}`, is not a key and cannot be checked
 * from the source. The states behind those are covered by the language test.
 */
const requested = (): Map<string, string[]> => {
  const found = new Map<string, string[]>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (entry.name === 'messages.ts') continue
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/['"`]hospitality_core\.([a-zA-Z][\w.]*)['"`]/g)) {
        const key = match[1] as string
        // Function keys and model names share the prefix and nothing else: they
        // are what `ctx.call`, `ctx.table` and an effects list name.
        if (/^[A-Z]/.test(key.split('.')[1] ?? '')) continue
        if (!key.includes('.')) continue
        found.set(key, [...(found.get(key) ?? []), path])
      }
    }
  }
  walk(root)
  return found
}

test('hospitality_core defines every message key its screens ask for, in both languages', () => {
  const defined = {
    vi: new Set(Object.keys(messages.vi ?? {})),
    en: new Set(Object.keys(messages.en ?? {})),
  }
  const missing: string[] = []
  for (const [key, files] of requested()) {
    if (!defined.vi.has(key) && !defined.en.has(key)) continue
    if (!defined.vi.has(key)) missing.push(`vi ${key} — ${[...new Set(files)].join(', ')}`)
    if (!defined.en.has(key)) missing.push(`en ${key} — ${[...new Set(files)].join(', ')}`)
  }
  assert.deepEqual(missing, [], 'a key defined in one language only falls back silently')
})

test('hospitality_core screens never name a message key nothing defines', () => {
  const defined = new Set([...Object.keys(messages.vi ?? {}), ...Object.keys(messages.en ?? {})])
  const screens = `${root}/screens`
  const unknown: string[] = []
  for (const entry of readdirSync(screens)) {
    if (!/\.tsx?$/.test(entry)) continue
    const source = readFileSync(join(screens, entry), 'utf8')
    // Only what is passed to the translator: `_('hospitality_core.…')`. A key
    // inside an href or an id is not a message.
    for (const match of source.matchAll(/_\(\s*['"`]hospitality_core\.([a-zA-Z][\w.]*)['"`]/g)) {
      const key = match[1] as string
      if (!defined.has(key)) unknown.push(`${entry}: ${key}`)
    }
  }
  assert.deepEqual(unknown, [], 'a translator answering with the key it was given is unreadable')
})
