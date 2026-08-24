// @ts-nocheck -- this runtime deliberately composes emitted package artifacts.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { compose } from '../packages/ketjs/dist/index.js'
import { ketsuite } from '../packages/ketsuite/dist/deployment.js'
import { openApiDocument } from '../packages/ketsuite/dist/index.js'

// Every channel profile publishes its own document. Generating only the customer
// one left the staff routes with no contract for native clients to build on and,
// worse, no check that could ever notice them drifting.
const profileIndex = process.argv.indexOf('--profile')
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : 'customer'
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined

if (profileIndex >= 0 && !profile) {
  console.error('Missing profile after --profile')
  process.exit(2)
}

if (outputIndex >= 0 && !output) {
  console.error('Missing path after --output')
  process.exit(2)
}

const document = openApiDocument(compose(ketsuite.modules, { headless: true }), profile)
const rendered = `${JSON.stringify(document, null, 2)}\n`

if (process.argv.includes('--check')) {
  if (!output) {
    console.error('--check requires --output <path>')
    process.exit(2)
  }
  const target = resolve(output)
  const current = await readFile(target, 'utf8').catch(() => '')
  let matches = false
  try {
    matches = JSON.stringify(JSON.parse(current)) === JSON.stringify(document)
  } catch {
    matches = false
  }
  if (!matches) {
    console.error(`Channel API ${profile} document is stale: ${target}`)
    process.exit(1)
  }
} else if (output) {
  const target = resolve(output)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, rendered)
  console.log(`generated ${target}`)
} else {
  process.stdout.write(rendered)
}
