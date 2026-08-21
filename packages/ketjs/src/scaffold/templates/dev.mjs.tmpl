// `tsx watch` reruns this entry in memory; production still uses built artifacts.
import { spawnSync } from 'node:child_process'

const check = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'],
  { stdio: 'inherit' },
)
if (check.error) throw check.error
if (check.status !== 0) {
  process.exitCode = check.status ?? 1
} else {
  process.env.KET_DEV = '1'
  process.env.KET_DEV_SOURCE = '1'
  await import('../node_modules/@ketvietlab/ketjs/dist/cli.js')
}
