import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, defineModule, defineFn, from } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { currentCompanyContext } from '../packages/ketsuite/src/modules/backend/current-company.ts'
const app = defineDeployment({
  name: 'current_company_contract',
  modules: [
    defineModule({
      name: 'probe',
      version: '1.0.0',
      models: { Record: { scope: 'company', fields: { id: 'id', name: 'text' } } },
      functions: {
        seed: defineFn({
          input: { id: 'id', name: 'text' },
          effects: ['write:probe.Record'],
          handler: (ctx, args) => ctx.db.insert('probe.Record', args),
        }),
        list: defineFn({
          input: {},
          effects: ['read:probe.Record'],
          handler: (ctx) => currentCompanyContext(ctx).db.all(from(ctx.table('probe.Record'))),
        }),
        change: defineFn({
          input: { id: 'id' },
          effects: ['read:probe.Record', 'write:probe.Record'],
          handler: (ctx) =>
            currentCompanyContext(ctx).tx(async (tx) => {
              const rows = await tx.db.select('probe.Record')
              const updated = await tx.db.update('probe.Record', { id: 'b' }, { name: 'corrupted' })
              return { rows, updated }
            }),
        }),
      },
    }),
  ],
})
test('current company context narrows membership reads and transactional writes without changing caller scope', async (t) => {
  const e2e = await createTestDeployment(app, { worker: false })
  t.after(() => e2e.close())
  for (const company of ['a', 'b'])
    await e2e.fixture.call(
      'probe.seed',
      { id: company, name: company },
      { scope: { company, companies: [company] } },
    )
  const scope = { company: 'a', companies: ['a', 'b'], branches: null }
  const rows = (await e2e.fixture.call<Array<{ id: string }>>('probe.list', {}, { scope })).value
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a'],
  )
  assert.deepEqual(scope.companies, ['a', 'b'])
  const result = (
    await e2e.fixture.call<{ rows: Array<{ id: string }>; updated: { changes: number } }>(
      'probe.change',
      { id: 'b' },
      { scope },
    )
  ).value
  assert.deepEqual(
    result.rows.map((row) => row.id),
    ['a'],
  )
  assert.equal(result.updated.changes, 0)
  const other = (
    await e2e.fixture.call<Array<{ name: string }>>(
      'probe.list',
      {},
      { scope: { company: 'b', companies: ['a', 'b'] } },
    )
  ).value
  assert.equal(other[0]?.name, 'b')
  await assert.rejects(
    () => e2e.fixture.call('probe.list', {}, { scope: { company: null, companies: ['a', 'b'] } }),
    (error: unknown) => (error as { code: string }).code === 'E_NO_COMPANY_IN_SCOPE',
  )
})
