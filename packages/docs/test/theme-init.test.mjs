import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8')
test('saved light and dark preferences are applied without waiting for an island', () => {
  for (const value of ['light', 'dark']) {
    const document = { documentElement: { dataset: {} } }
    runInNewContext(source, { document, localStorage: { getItem: () => value } })
    assert.equal(document.documentElement.dataset.theme, value)
  }
})
test('invalid or blocked storage leaves the system theme in control', () => {
  for (const getItem of [
    () => 'invalid',
    () => null,
    () => {
      throw new Error('Blocked')
    },
  ]) {
    const document = { documentElement: { dataset: {} } }
    assert.doesNotThrow(() => runInNewContext(source, { document, localStorage: { getItem } }))
    assert.equal(document.documentElement.dataset.theme, undefined)
  }
})
