// Map authored test paths to emitted JavaScript so even a focused test run keeps
// the same build boundary as the full suite.
import { spawnSync } from 'node:child_process'
import { extname, join, normalize } from 'node:path'

const requested = process.argv.slice(2)
if (!requested.length) {
  console.error('usage: npm run test:one -- test/name.test.ts')
  process.exit(1)
}

const artifacts = requested.map((input) => {
  const source = normalize(input).replace(/^\.\//, '')
  if (!source.startsWith('test/')) throw new Error(`test path must be under test/: ${input}`)
  const extension = extname(source)
  if (extension !== '.ts' && extension !== '.tsx') {
    throw new Error(`expected a TypeScript test path, received: ${input}`)
  }
  return join('.build', source.slice(0, -extension.length) + '.js')
})

const result = spawnSync(process.execPath, ['--test', ...artifacts], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
