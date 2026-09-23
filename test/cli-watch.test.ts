import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('CLI: serve and worker expose emitted-artifact watch mode without recursive --watch forwarding', async () => {
  const source = await readFile('packages/ketjs/src/cli.ts', 'utf8')

  assert.match(source, /ket serve \[--deployment X\] \[--watch\]/)
  assert.match(source, /ket worker \[--deployment X\] \[--watch\]/)
  assert.match(source, /args\.filter\(\(item\) => item !== '--watch'\)/)
  assert.match(source, /cmd === 'serve' \|\| cmd === 'worker'\) && flag\('watch'\)/)
})
