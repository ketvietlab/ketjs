import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
test('MIT core has no private dependency and every product source is independent of Atlas', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.license, 'MIT')
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
    assert.ok(!name.startsWith('@repo/') && !name.includes('flow-pro'), name)
  for (const file of await readdir(new URL('client/', root))) {
    if (!file.endsWith('.mjs')) continue
    const source = await readFile(new URL('client/' + file, root), 'utf8')
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"][^'"]*(?:\/atlas\/|flow-pro)/, file)
  }
})
