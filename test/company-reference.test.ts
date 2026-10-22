import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Ctx, Manifest, Scope } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'

/**
 * A company's row may not point at another company's row.
 *
 * The scoped lookup a function does first usually hides the other company's row, so
 * the reference reads as missing. A caller that can read both companies, or that
 * never looked, would otherwise store a reference across a legal-entity boundary.
 */
const ledger = defineModule({
  name: 'ledger',
  models: {
    Currency: { scope: 'shared', fields: { id: 'id', code: 'text' } },
    Account: { scope: 'company', fields: { id: 'id', name: 'text' } },
    Line: {
      scope: 'company',
      fields: { id: 'id', accountId: 'ref:ledger.Account?', currencyId: 'ref:ledger.Currency?' },
    },
  },
  functions: {
    addCurrency: {
      input: { id: 'id', code: 'text' },
      effects: ['write:ledger.Currency'],
      handler: (ctx: Ctx, a) => ctx.db.insert('ledger.Currency', a),
    },
    addAccount: {
      input: { id: 'id', name: 'text' },
      effects: ['write:ledger.Account'],
      handler: (ctx: Ctx, a) => ctx.db.insert('ledger.Account', a),
    },
    addLine: {
      input: { id: 'id', accountId: 'text?', currencyId: 'text?' },
      effects: ['write:ledger.Line'],
      dryRun: true,
      handler: (ctx: Ctx, a) => ctx.db.insert('ledger.Line', a),
    },
    addLineOnce: {
      input: { id: 'id', accountId: 'text?' },
      effects: ['write:ledger.Line'],
      handler: (ctx: Ctx, a) => ctx.db.insertIfAbsent('ledger.Line', a),
    },
    moveLine: {
      input: { id: 'id', accountId: 'text' },
      effects: ['write:ledger.Line'],
      handler: (ctx: Ctx, a) => ctx.db.update('ledger.Line', { id: a.id }, { accountId: a.accountId }),
    },
    linkAcross: {
      input: { id: 'id', accountId: 'text' },
      effects: ['write:ledger.Line'],
      crossCompany: true,
      handler: (ctx: Ctx, a) => ctx.db.insert('ledger.Line', a),
    },
  },
})

const prepare = async (adapter: Adapter): Promise<Manifest> => {
  const manifest = compose([ledger])
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([ledger])
  const at = (company: string) => ({ adapter, manifest, scope: { company } })
  await callFn('ledger.addAccount', { id: 'acme-cash', name: 'Cash' }, at('acme'))
  await callFn('ledger.addAccount', { id: 'globex-cash', name: 'Cash' }, at('globex'))
  await callFn('ledger.addCurrency', { id: 'vnd', code: 'VND' }, at('acme'))
  return manifest
}

const refused = (e: unknown): boolean => {
  assert.equal((e as { code: string }).code, 'E_CROSS_COMPANY_REFERENCE')
  assert.match((e as Error).message, /ledger\.Line\.accountId = "globex-cash" in company "acme"/)
  return true
}

const exercise = async (adapter: Adapter, manifest: Manifest): Promise<void> => {
  // The caller may read both companies, so a lookup it made would have found the account.
  const both: Scope = { company: 'acme', companies: ['acme', 'globex'] }
  const as = (scope: Scope = both) => ({ adapter, manifest, scope })
  const lines = async () =>
    (await adapter.all('SELECT id, "accountId", "companyId" FROM ledger_line ORDER BY id', [])).map(
      (r) => `${String(r.id)}/${String(r.accountId)}/${String(r.companyId)}`,
    )

  await callFn('ledger.addLine', { id: 'l1', accountId: 'acme-cash', currencyId: 'vnd' }, as())
  await callFn('ledger.addLine', { id: 'l2', accountId: 'not-yet-written' }, as())
  await callFn('ledger.addLine', { id: 'l3', accountId: null }, as())

  await assert.rejects(() => callFn('ledger.addLine', { id: 'x1', accountId: 'globex-cash' }, as()), refused)
  await assert.rejects(
    () => callFn('ledger.addLineOnce', { id: 'x2', accountId: 'globex-cash' }, as()),
    refused,
  )
  await assert.rejects(() => callFn('ledger.moveLine', { id: 'l1', accountId: 'globex-cash' }, as()), refused)
  await assert.rejects(
    () => callFn('ledger.addLine', { id: 'x3', accountId: 'globex-cash' }, { ...as(), dryRun: true }),
    refused,
    'a dry run refuses what the real call would',
  )
  assert.deepEqual(
    await lines(),
    ['l1/acme-cash/acme', 'l2/not-yet-written/acme', 'l3/null/acme'],
    'nothing crossed, and ids nobody holds yet are still the caller’s business',
  )

  await callFn('ledger.linkAcross', { id: 'l4', accountId: 'globex-cash' }, as({ company: 'acme' }))
  assert.ok((await lines()).includes('l4/globex-cash/acme'), 'a declared crossCompany operation may link')
}

test('company references: a row may point only at its own company’s rows', async () => {
  const adapter = sqliteAdapter()
  try {
    await exercise(adapter, await prepare(adapter))
  } finally {
    await adapter.close()
  }
})

test('company references: the same refusal on PostgreSQL', live, async () => {
  const name = `company_ref_${randomUUID().replaceAll('-', '')}`
  const admin = postgresAdapter(adminUrl.toString())
  await admin.open()
  let adapter: Adapter | undefined
  try {
    await admin.exec(`CREATE DATABASE "${name}"`)
    const url = new URL(adminUrl)
    url.pathname = `/${name}`
    adapter = postgresAdapter(url.toString())
    await exercise(adapter, await prepare(adapter))
  } finally {
    await adapter?.close()
    await admin.exec(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.close()
  }
})
