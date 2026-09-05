// Every message key the Flow screens ask for is a message key that exists.
//
// `flow_backend.menu.sprints` was asked for by the sprints screen and defined
// nowhere, so the subtitle rendered as the raw key — in both languages, on a
// screen anybody could open. A translator that answers with the key it was given
// is the one output a person cannot read as deliberate, and nothing in the
// suite's audits looks for it: `audit:terminology` reads the words that exist,
// not the words that were asked for and are missing.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { messages } from '../packages/ketsuite/src/modules/flow_backend/messages.ts'

const root = 'packages/ketsuite/src/modules/flow_backend'

/** Every literal `flow_backend.<key>` a screen or a route names. */
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
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/['"`]flow_backend\.([a-zA-Z][\w.]*)['"`]/g)) {
        const key = match[1] as string
        // `flow_backend.sync.*` are this module's four function keys, not
        // message keys — they share the prefix and nothing else.
        if (key.startsWith('sync.')) continue
        found.set(key, [...(found.get(key) ?? []), path])
      }
    }
  }
  walk(root)
  return found
}

test('flow_backend defines every message key its screens ask for, in both languages', () => {
  const defined = { vi: new Set(Object.keys(messages.vi ?? {})), en: new Set(Object.keys(messages.en ?? {})) }
  const missing: string[] = []
  for (const [key, files] of requested()) {
    // A prefix used to build a key at runtime is not a key; only whole ones are
    // checked, which is every key these screens actually write.
    if (!defined.vi.has(key)) missing.push(`vi ${key} — ${files.join(', ')}`)
    if (!defined.en.has(key)) missing.push(`en ${key} — ${files.join(', ')}`)
  }
  assert.deepEqual(missing, [])
})

test('flow_backend says the same things in both languages', () => {
  // A key present in one language and not the other falls back silently, which
  // reads as English leaking into a Vietnamese screen rather than as a bug.
  const vi = Object.keys(messages.vi ?? {}).sort()
  const en = Object.keys(messages.en ?? {}).sort()
  assert.deepEqual(vi, en)
})
