import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineDeployment,
  defineModule,
  from,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Ctx, JobContext, KetModule, Manifest } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'

// Each module answers with the deployment it was built for, so a handler that
// leaked from another composition is visible in the value rather than only in
// which functions exist.
const answering = (name: string, answer: string): KetModule =>
  defineModule({
    name,
    models: { Mark: { scope: 'shared', fields: { id: 'id', by: 'text' } } },
    functions: {
      who: { output: { who: 'text' }, effects: [], handler: () => ({ who: answer }) },
      mark: {
        input: { id: 'id' },
        effects: [`enqueue:${name}.record`],
        handler: (ctx: Ctx, args) => ctx.jobs.enqueue(`${name}.record`, args),
      },
      marks: {
        output: { id: 'id', by: 'text' },
        effects: [`read:${name}.Mark`],
        handler: (ctx: Ctx) => ctx.db.all(from(ctx.table(`${name}.Mark`))),
      },
    },
    jobs: {
      record: {
        queue: 'default',
        input: { id: 'id' },
        effects: [`write:${name}.Mark`],
        idempotent: true,
        handler: async (ctx: JobContext, args) => {
          await ctx.db.insert(`${name}.Mark`, { id: args.id, by: answer })
        },
      },
    },
  })

const deployment = (name: string, module: KetModule) =>
  defineDeployment({ name, modules: [module], headless: true, worker: { queues: { default: 1 } } })

test('runtime isolation: callFn executes the handler bound to the manifest it is given', async () => {
  const first = compose([answering('shared', 'first')], { headless: true })
  const second = compose([answering('shared', 'second')], { headless: true })
  // The deprecated registration returns a map and selects nothing.
  assert.equal(registerFunctions([answering('shared', 'registered')]).size, 3)
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    assert.deepEqual((await callFn('shared.who', {}, { adapter, manifest: first })).value, { who: 'first' })
    assert.deepEqual((await callFn('shared.who', {}, { adapter, manifest: second })).value, { who: 'second' })

    // Data read back from JSON describes functions but carries no code to run.
    const copied = JSON.parse(JSON.stringify(first)) as Manifest
    await assert.rejects(
      () => callFn('shared.who', {}, { adapter, manifest: copied }),
      (error: { code?: string; hint?: string }) =>
        error.code === 'E_UNKNOWN_FUNCTION' && /no bound handlers/.test(error.hint ?? ''),
    )
  } finally {
    await adapter.close()
  }
})

test('runtime isolation: deployments booted in one process keep their own functions and jobs', async () => {
  const alpha = await createTestDeployment(deployment('isolation_alpha', answering('alpha', 'alpha')))
  const beta = await createTestDeployment(deployment('isolation_beta', answering('beta', 'beta')))
  const c = await createTestDeployment(deployment('isolation_c', answering('shared', 'from c')))
  const d = await createTestDeployment(deployment('isolation_d', answering('shared', 'from d')))
  try {
    // Booting beta must not remove the functions alpha serves.
    assert.deepEqual((await alpha.client.call('alpha.who')).value, { who: 'alpha' })
    assert.deepEqual((await beta.client.call('beta.who')).value, { who: 'beta' })

    // One qualified name runs each deployment's own code.
    assert.deepEqual((await c.client.call('shared.who')).value, { who: 'from c' })
    assert.deepEqual((await d.client.call('shared.who')).value, { who: 'from d' })

    await c.client.call('shared.mark', { id: 'm1' })
    await d.client.call('shared.mark', { id: 'm1' })
    assert.equal(await c.drainJobs(), 1)
    assert.equal(await d.drainJobs(), 1)
    assert.deepEqual((await c.client.call('shared.marks')).value, [{ id: 'm1', by: 'from c' }])
    assert.deepEqual((await d.client.call('shared.marks')).value, [{ id: 'm1', by: 'from d' }])
  } finally {
    for (const e2e of [alpha, beta, c, d]) await e2e.close()
  }
})
