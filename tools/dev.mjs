// `tsx watch` reruns this entry in memory. Type checking finishes before the
// application starts, while no development command writes `.build` or `dist`.

import { spawnSync } from 'node:child_process'

const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
})
if (check.error) throw check.error
if (check.status !== 0) {
  process.exitCode = check.status ?? 1
} else {
  process.env.KET_DEV = '1'
  process.env.KET_DEV_SOURCE = '1'
  await import('../packages/ketjs/src/cli.ts')
}
