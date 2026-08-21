import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agentTools,
  callFn,
  changeset,
  compose,
  defineModule,
  generateDts,
  isDateText,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  sqliteAdapter,
  validateLayout,
} from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'

const dated = defineModule({
  name: 'dated',
  models: {
    Event: {
      scope: 'shared',
      fields: { id: 'id', dueOn: 'date', finishedOn: 'date?' },
    },
  },
  functions: {
    echo: {
      input: { dueOn: 'date' },
      output: { dueOn: 'date' },
      agent: true,
      handler: (_ctx, args) => ({ dueOn: args.dueOn }),
    },
    scheduleUncheckedText: {
      input: { dueOn: 'text' },
      effects: ['enqueue:dated.remind'],
      handler: (ctx, args) => ctx.jobs.enqueue('dated.remind', { dueOn: args.dueOn }),
    },
  },
  jobs: {
    remind: {
      input: { dueOn: 'date' },
      idempotent: true,
      handler: async () => {},
    },
  },
  sections: { 'dated.deadline': { settings: { dueOn: 'date' } } },
})

test('date scalar: accepts only real canonical calendar dates', () => {
  assert.equal(isDateText('2024-02-29'), true)
  assert.equal(isDateText('2023-02-29'), false)
  assert.equal(isDateText('2026-04-31'), false)
  assert.equal(isDateText('2026-8-20'), false)
  assert.equal(isDateText('0000-01-01'), false)

  const manifest = compose([dated], { headless: true })
  assert.equal(manifest.models['dated.Event']!.fields.dueOn!.base, 'date')
  assert.deepEqual(changeset(manifest, 'dated.Event', { dueOn: '2024-02-29' }).cast(['dueOn']).changes, {
    dueOn: '2024-02-29',
  })
  assert.deepEqual(changeset(manifest, 'dated.Event', { dueOn: '2023-02-29' }).cast(['dueOn']).errors, [
    { field: 'dueOn', message: 'expected a calendar date (YYYY-MM-DD), got "2023-02-29"' },
  ])
})

test('date scalar: SQL, generated TypeScript and agent schema retain date semantics', () => {
  const manifest = compose([dated], { headless: true })
  const lite = sqliteAdapter()
  const postgres = postgresAdapter('postgres://unused')
  assert.equal(lite.columnSql({ base: 'date' }), 'TEXT')
  assert.equal(postgres.columnSql({ base: 'date' }), 'DATE')
  assert.match(
    renderSql(planMigration(null, schemaFromManifest(manifest)), postgres).join('\n'),
    /"dueOn" DATE/,
  )

  const generated = generateDts(manifest)
  assert.match(generated, /dueOn: string/)
  assert.match(generated, /"dated\.echo": \{ input: \{ dueOn: string \}/)
  const tool = agentTools(manifest).find((entry) => entry.name === 'dated__echo')!
  assert.deepEqual(tool.inputSchema.properties.dueOn, { type: 'string', format: 'date' })
})

test('date scalar: function, job and layout boundaries reject normalized or impossible dates', async () => {
  const manifest = compose([dated], { headless: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  registerFunctions([dated])
  try {
    assert.deepEqual((await callFn('dated.echo', { dueOn: '2024-02-29' }, { adapter, manifest })).value, {
      dueOn: '2024-02-29',
    })
    await assert.rejects(
      () => callFn('dated.echo', { dueOn: '2023-02-29' }, { adapter, manifest }),
      /expects a calendar date/,
    )
    await assert.rejects(
      () => callFn('dated.scheduleUncheckedText', { dueOn: '2026-02-30' }, { adapter, manifest }),
      (error: unknown) =>
        (error as { code?: string }).code === 'E_INVALID_JOB_INPUT' && /calendar date/.test(String(error)),
    )
  } finally {
    await adapter.close()
  }

  assert.equal(
    validateLayout(manifest, [{ type: 'dated.deadline', settings: { dueOn: '2026-08-20' } }]).ok,
    true,
  )
  assert.deepEqual(
    validateLayout(manifest, [{ type: 'dated.deadline', settings: { dueOn: '2026-02-30' } }]).errors,
    [{ at: 0, type: 'dated.deadline', field: 'dueOn', message: 'expects date in YYYY-MM-DD format' }],
  )
})
