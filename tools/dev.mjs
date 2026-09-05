// `tsx watch` reruns this entry in memory. Type checking finishes before the
// application starts, while no development command writes `.build` or `dist`.

import { spawnSync } from 'node:child_process'
import { buildBackendClients } from './build-backend-client.mjs'
import { buildBackendDesignSystem } from './build-backend-design-system.mjs'
import { buildChartClient } from './build-chart-client.mjs'
import { buildFlowClient } from './build-flow-client.mjs'

await Promise.all([buildBackendClients(), buildBackendDesignSystem(), buildChartClient(), buildFlowClient()])

const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
})
if (check.error) throw check.error
if (check.status !== 0) {
  process.exitCode = check.status ?? 1
} else {
  process.env.KET_DEV = '1'
  process.env.KET_DEV_SOURCE = '1'
  // `npm run dev -- --all` keeps this single tsx watcher and changes only the
  // process role the CLI boots; it must not start a second compiler/build loop.
  const all = process.argv.indexOf('--all')
  if (all >= 0) {
    process.argv.splice(all, 1)
    const serve = process.argv.indexOf('serve')
    if (serve >= 0) process.argv[serve] = 'all'
  }
  await import('../packages/ketjs/src/cli.ts')
}
