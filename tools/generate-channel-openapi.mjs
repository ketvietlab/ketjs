// @ts-nocheck -- this runtime deliberately composes emitted package artifacts.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { compose } from '../packages/ketjs/dist/index.js'
import { ketsuite } from '../packages/ketsuite/dist/app.js'
import { openApiDocument } from '../packages/ketsuite/dist/index.js'

const document = openApiDocument(compose(ketsuite.modules, { headless: true }), 'customer')
const rendered = `${JSON.stringify(document, null, 2)}\n`
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined

if (outputIndex >= 0 && !output) {
  console.error('Missing path after --output')
  process.exit(2)
}

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
    console.error(`Channel API document is stale: ${target}`)
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
