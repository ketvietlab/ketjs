// A staff route answers within the permissions its session carries.
//
// The framework knows which functions a session may call and enforces it in
// ctx.call. ctx.callUnchecked exists for the one caller that cannot go through
// that check — the permission resolver itself — and reaching for it anywhere
// else on the staff profile turns the channel into a way around the roles every
// other surface obeys. Nothing about that is visible at a glance in a diff, so
// it is checked here.

import { readFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'

/** @type {string[]} */
const offenders = []
let scanned = 0

for await (const file of glob('packages/ketsuite/src/modules/**/*.ts')) {
  const source = await readFile(file, 'utf8')
  if (!source.includes("profile: 'staff'")) continue
  scanned += 1
  source.split('\n').forEach((line, index) => {
    // The word in prose is how the rule gets explained; the call is the problem.
    if (/\bcallUnchecked\s*\(/.test(line)) offenders.push(`${file}:${index + 1}`)
  })
}

if (offenders.length) {
  console.error('staff routes must call through ctx.call, not ctx.callUnchecked:')
  for (const at of offenders) console.error(`  ${at}`)
  process.exit(1)
}

console.log(`staff channel audit passed (${scanned} file${scanned === 1 ? '' : 's'} declaring staff routes)`)
