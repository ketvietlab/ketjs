import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Composition order and the permission digest were sorted with the process's
 * default collation, so the same modules composed under LANG=da_DK put "kz"
 * before "kaa" (Danish reads "aa" as "å") and produced a different digest, which
 * is also stored with every idempotency record.
 */
const root = fileURLToPath(new URL('../', import.meta.url))
const probe = `
import { compose, defineModule } from '@ketvietlab/ketjs'
const module = (name) => defineModule({ name, functions: { ping: { input: {}, effects: [], handler: () => null } } })
const manifest = compose([module('kz'), module('kaa'), module('ab')], { headless: true })
console.log(JSON.stringify({ order: manifest.order, digest: manifest.permissions.digest }))
`
const composeUnder = (locale: string) =>
  JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: root,
      env: { ...process.env, LC_ALL: locale, LANG: locale },
      encoding: 'utf8',
    }),
  ) as { order: string[]; digest: string }

test('composition: module order and permission digest do not depend on the process locale', () => {
  const english = composeUnder('en_US.UTF-8')
  const danish = composeUnder('da_DK.UTF-8')
  assert.deepEqual(danish, english)
  assert.deepEqual(english.order, ['ab', 'kaa', 'kz'])
})
