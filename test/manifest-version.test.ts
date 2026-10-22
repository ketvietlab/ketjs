import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compose, defineModule } from '@ketvietlab/ketjs'

/**
 * manifest.ket said 0.0.0 in every release, so the agent descriptor reported a
 * framework version that never existed and the /_ket/fn build id ignored it.
 */
// The repository root, wherever the compiled copy of this test runs from.
const rootVersion = (): string => {
  for (let directory = new URL('./', import.meta.url); ; directory = new URL('../', directory)) {
    try {
      return readFileSync(new URL('VERSION', directory), 'utf8').trim()
    } catch (error) {
      if (new URL('../', directory).href === directory.href) throw error
    }
  }
}

test('manifest: ket is the coordinated framework version', () => {
  const version = rootVersion()
  assert.match(version, /^\d+\.\d+\.\d+/)
  assert.equal(compose([defineModule({ name: 'app' })], { headless: true }).ket, version)
})
