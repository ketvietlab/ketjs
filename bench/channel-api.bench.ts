import { performance } from 'node:perf_hooks'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { openApiDocument } from '@ketvietlab/ketsuite'
import { ketsuite } from '@ketvietlab/ketsuite/app'

const CONTRACT_RUNS = 250
const REPLAY_RUNS = 1_000

const composeStarted = performance.now()
const manifest = compose(ketsuite.modules, { headless: true })
const composeMs = performance.now() - composeStarted

const contractStarted = performance.now()
let operations = 0
for (let run = 0; run < CONTRACT_RUNS; run += 1)
  operations = Object.keys(openApiDocument(manifest, 'customer').paths).length
const contractMs = performance.now() - contractStarted

const command = defineModule({
  name: 'channel_bench',
  models: { Entry: { scope: 'shared', fields: { id: 'id', value: 'text' } } },
  functions: {
    save: {
      input: { id: 'id', value: 'text' },
      output: { id: 'id', value: 'text' },
      effects: ['write:channel_bench.Entry'],
      idempotent: true,
      handler: async (ctx, args) => {
        await ctx.db.insert('channel_bench.Entry', args)
        return args
      },
    },
  },
})
const commandManifest = compose([command], { headless: true })
const adapter = sqliteAdapter()
await adapter.open()
await migrateOne(adapter, commandManifest)
registerFunctions([command])
const options = {
  adapter,
  manifest: commandManifest,
  idempotencyKey: 'same-command',
  idempotencyNamespace: 'customer:benchmark:account',
}
await callFn('channel_bench.save', { id: 'entry', value: 'stable' }, options)
const replayStarted = performance.now()
for (let run = 0; run < REPLAY_RUNS; run += 1) {
  const replay = await callFn('channel_bench.save', { id: 'entry', value: 'stable' }, options)
  if (replay.replayed !== true) throw new Error('idempotency benchmark did not replay')
}
const replayMs = performance.now() - replayStarted
await adapter.close()

console.log(`channel routes       : ${operations}`)
console.log(`deployment compose  : ${composeMs.toFixed(2)} ms`)
console.log(`OpenAPI generation  : ${(contractMs / CONTRACT_RUNS).toFixed(3)} ms/op`)
console.log(`idempotency replay  : ${(replayMs / REPLAY_RUNS).toFixed(3)} ms/op`)
