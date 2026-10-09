import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { frameworkVersion } from '../site/release.ts'

test('the website displays its installed npm runtime version independently of framework source', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const installed = JSON.parse(
    readFileSync(new URL('../node_modules/@ketvietlab/ketjs-view/package.json', import.meta.url), 'utf8'),
  )
  assert.equal(frameworkVersion, installed.version)
  assert.equal(frameworkVersion, manifest.dependencies['@ketvietlab/ketjs-view'])
  assert.equal(frameworkVersion, manifest.devDependencies['@ketvietlab/ketjs-view-tools'])
  assert.match(frameworkVersion, /^\d+\.\d+\.\d+$/)
})
