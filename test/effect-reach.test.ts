import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootDeployment,
  compose,
  defineDeployment,
  defineJob,
  defineModule,
  memoryLog,
} from '@ketvietlab/ketjs'
import type { KetModule } from '@ketvietlab/ketjs'

/**
 * What a declared effect may name. A job's model effects were held to its direct
 * depends; a function's were not checked at all, so a module with no relation to
 * `vault` could declare `write:vault.Secret` and write it, and a misspelt effect
 * passed. Now both are held to the depends closure plus declared optional modules.
 */
const vault = defineModule({
  name: 'vault',
  models: { Secret: { scope: 'company', fields: { id: 'id', value: 'text' } } },
  jobs: { rotate: defineJob({ idempotent: true, input: {}, effects: [], handler: async () => {} }) },
})
const party = defineModule({
  name: 'party',
  depends: ['vault'],
  models: { Party: { scope: 'company', fields: { id: 'id', name: 'text' } } },
})
const sale = defineModule({
  name: 'sale',
  models: { Order: { scope: 'company', fields: { id: 'id', total: 'decimal' } } },
  jobs: { remind: defineJob({ idempotent: true, input: {}, effects: [], handler: async () => {} }) },
})

const fn = (effects: string[]) => ({ input: {}, effects, handler: () => null })
const crm = (spec: { depends?: string[]; optional?: string[]; effects: string[]; jobEffects?: string[] }) =>
  defineModule({
    name: 'crm',
    depends: spec.depends ?? ['party'],
    ...(spec.optional ? { optional: spec.optional } : {}),
    functions: { context: fn(spec.effects) },
    ...(spec.jobEffects
      ? {
          jobs: {
            sync: defineJob({
              idempotent: true,
              input: {},
              effects: spec.jobEffects,
              handler: async () => {},
            }),
          },
        }
      : {}),
  })

const composed = (modules: KetModule[]) => compose(modules, { headless: true })
const codes = (run: () => unknown): string[] => {
  try {
    run()
    return []
  } catch (error) {
    return ((error as { items?: Array<{ code: string }> }).items ?? []).map((item) => item.code)
  }
}

test('effect reach: a function effect outside the depends closure is reported', () => {
  const manifest = composed([vault, party, sale, crm({ effects: ['read:party.Party', 'write:sale.Order'] })])
  assert.deepEqual(
    (manifest.diagnostics ?? []).map((warning) => [warning.code, warning.module]),
    [['E_FN_EFFECT_NOT_DEPENDED', 'crm']],
  )
  assert.match(manifest.diagnostics?.[0]?.hint ?? '', /optional/)
})

test('effect reach: a misspelt model in a present module is an error for functions too', () => {
  assert.deepEqual(
    codes(() => composed([vault, party, crm({ effects: ['read:party.Parties'] })])),
    ['E_FN_EFFECT'],
  )
  assert.deepEqual(
    codes(() => composed([vault, party, crm({ effects: ['read:Party'] })])),
    ['E_FN_EFFECT'],
  )
})

test('effect reach: the transitive depends closure is reachable for functions and jobs', () => {
  const manifest = composed([
    vault,
    party,
    crm({ effects: ['read:vault.Secret', 'enqueue:vault.rotate'], jobEffects: ['read:vault.Secret'] }),
  ])
  assert.deepEqual(manifest.diagnostics, [])
})

test('effect reach: an optional module is checked when present and silent when absent', () => {
  const soft = {
    optional: ['sale'],
    effects: ['read:sale.Order', 'enqueue:sale.remind'],
    jobEffects: ['read:sale.Order'],
  }
  assert.deepEqual(composed([vault, party, sale, crm(soft)]).diagnostics, [])
  assert.deepEqual(composed([vault, party, crm(soft)]).diagnostics, [], 'absent: nothing to reach')
  assert.deepEqual(
    codes(() => composed([vault, party, sale, crm({ optional: ['sale'], effects: ['read:sale.Orders'] })])),
    ['E_FN_EFFECT'],
    'present: the model must exist',
  )

  const absent = composed([vault, party, crm({ effects: ['read:sale.Order'] })])
  assert.deepEqual(
    absent.diagnostics?.map((warning) => warning.code),
    ['E_FN_EFFECT_NOT_DEPENDED'],
    'an absent module that is not declared optional is still reported',
  )
  assert.deepEqual(
    codes(() => composed([vault, party, crm({ optional: ['crm'], effects: [] })])),
    ['E_OPTIONAL_MODULE'],
  )
})

test('effect reach: jobs and enqueue outside the closure stay errors', () => {
  assert.deepEqual(
    codes(() => composed([vault, party, sale, crm({ effects: [], jobEffects: ['read:sale.Order'] })])),
    ['E_JOB_EFFECT_NOT_DEPENDED'],
  )
  assert.deepEqual(
    codes(() => composed([vault, party, sale, crm({ effects: ['enqueue:sale.remind'] })])),
    ['E_FN_EFFECT_NOT_DEPENDED'],
  )
})

test('effect reach: every boot logs the warnings it composed', async () => {
  const sink = memoryLog()
  const booted = await bootDeployment(
    defineDeployment({
      name: 'reach',
      modules: [vault, party, sale, crm({ effects: ['write:sale.Order'] })],
      headless: true,
    }),
    { env: { KET_SQLITE: ':memory:' }, port: 0, log: () => {}, openLog: () => sink },
  )
  try {
    const warning = sink.records.find((record) => record.event === 'contract_warning')
    assert.equal(warning?.level, 'warn')
    assert.equal(warning?.fields?.['code'], 'E_FN_EFFECT_NOT_DEPENDED')
  } finally {
    await booted.close()
  }
})
