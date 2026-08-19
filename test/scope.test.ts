import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineModule,
  defineFn,
  from,
  deleteFrom,
  eq,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  diffManifests,
  agentTools,
} from 'ketjs'
import type { Adapter, Ctx, KetError, Row } from 'ketjs'

/**
 * Company isolation used to be a database boundary. Here it is a WHERE clause, so a
 * miss returns another legal entity's rows instead of failing. These tests exist to
 * prove it cannot be missed — including when a module actively tries.
 */

const ledger = defineModule({
  name: 'ledger',
  models: {
    Invoice: { scope: 'company+branch', fields: { id: 'id', total: 'int' } },
    Setting: { scope: 'company', fields: { id: 'id', value: 'text' } },
    Currency: { scope: 'shared', fields: { id: 'id', code: 'text' } },
  },
  functions: {
    add: defineFn({
      input: { id: 'id', total: 'int' },
      effects: ['write:ledger.Invoice'],
      handler: async (ctx: Ctx, a) => ctx.db.insert('ledger.Invoice', { id: a.id, total: a.total } as Row),
    }),
    list: defineFn({
      input: {},
      effects: ['read:ledger.Invoice'],
      handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('ledger.Invoice'))),
    }),
    listAllCompanies: defineFn({
      input: {},
      effects: ['read:ledger.Invoice'],
      crossCompany: true,
      agent: true,
      handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('ledger.Invoice'))),
    }),
    forge: defineFn({
      input: { id: 'id', companyId: 'text' },
      effects: ['write:ledger.Invoice'],
      handler: async (ctx: Ctx, a) =>
        ctx.db.insert('ledger.Invoice', { id: a.id, total: 1, companyId: a.companyId } as Row),
    }),
    currencies: defineFn({
      input: {},
      effects: ['read:ledger.Currency'],
      handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('ledger.Currency'))),
    }),
  },
})

const manifest = compose([ledger], { headless: true })
const A = { company: 'acme', branches: null }
const B = { company: 'globex', branches: null }

async function boot(): Promise<Adapter> {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions([ledger])
  return db
}

test('scope: a model that does not declare one is a build error', () => {
  const sloppy = defineModule({ name: 'sloppy', models: { Thing: { fields: { id: 'id' } } as never } })
  const e = (() => {
    try {
      compose([sloppy], { headless: true })
    } catch (err) {
      return err as KetError
    }
  })()!
  assert.match(e.message, /E_MODEL_NO_SCOPE/)
  assert.match(e.message, /there is no default, because the safe-looking one is the one that leaks/)
})

test('scope: the columns are added by the composer, not by the module', () => {
  const inv = manifest.models['ledger.Invoice']!
  assert.equal(inv.fields.companyId!.by, '(scope)')
  assert.equal(inv.fields.branchId!.optional, true, 'a row may belong to the company but no branch')
  assert.equal(
    'companyId' in manifest.models['ledger.Currency']!.fields,
    false,
    'shared data carries no company',
  )
})

test('scope: a module cannot extend the scope columns', () => {
  const meddler = defineModule({
    name: 'meddler',
    depends: ['ledger'],
    extend: { 'ledger.Invoice': { companyId: 'text?' } },
  })
  assert.throws(() => compose([ledger, meddler], { headless: true }), /E_SCOPE_FIELD_RESERVED/)
})

test('scope: one company cannot read another, even asking for everything', async () => {
  const db = await boot()
  await callFn('ledger.add', { id: 'a1', total: 100 }, { adapter: db, manifest, scope: A })
  await callFn('ledger.add', { id: 'b1', total: 200 }, { adapter: db, manifest, scope: B })

  const seenByA = (await callFn('ledger.list', {}, { adapter: db, manifest, scope: A })).value as Row[]
  const seenByB = (await callFn('ledger.list', {}, { adapter: db, manifest, scope: B })).value as Row[]
  assert.deepEqual(
    seenByA.map((r) => r.id),
    ['a1'],
  )
  assert.deepEqual(
    seenByB.map((r) => r.id),
    ['b1'],
  )
  assert.equal(
    (await db.all('SELECT * FROM ledger_invoice', [])).length,
    2,
    'both rows are in the same table',
  )
  await db.close()
})

test('scope: a write is stamped from the request, and cannot be aimed elsewhere', async () => {
  const db = await boot()
  await assert.rejects(
    () => callFn('ledger.forge', { id: 'x', companyId: 'globex' }, { adapter: db, manifest, scope: A }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_SCOPE_FIELD_WRITTEN')
      assert.match(
        (e as { hint: string }).hint,
        /the scope columns come from the request, not from the caller/,
      )
      return true
    },
  )
  assert.equal((await db.all('SELECT * FROM ledger_invoice', [])).length, 0)
  await db.close()
})

test('scope: a request with no company cannot touch company data at all', async () => {
  const db = await boot()
  await assert.rejects(
    () => callFn('ledger.list', {}, { adapter: db, manifest, scope: { company: null } }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_NO_COMPANY_IN_SCOPE')
      return true
    },
  )
  await db.close()
})

test('scope: shared data needs no company, and is visible to all of them', async () => {
  const db = await boot()
  await db.run('INSERT INTO ledger_currency (id, code) VALUES (?, ?)', ['vnd', 'VND'])
  for (const scope of [A, B, { company: null }]) {
    const rows = (await callFn('ledger.currencies', {}, { adapter: db, manifest, scope })).value as Row[]
    assert.deepEqual(
      rows.map((r) => r.code),
      ['VND'],
    )
  }
  await db.close()
})

test('scope: crossCompany is the only way across, and it is declared', async () => {
  const db = await boot()
  await callFn('ledger.add', { id: 'a1', total: 1 }, { adapter: db, manifest, scope: A })
  await callFn('ledger.add', { id: 'b1', total: 2 }, { adapter: db, manifest, scope: B })

  const all = (await callFn('ledger.listAllCompanies', {}, { adapter: db, manifest, scope: A }))
    .value as Row[]
  assert.deepEqual(all.map((r) => r.id).sort(), ['a1', 'b1'])
  assert.equal(manifest.functions['ledger.listAllCompanies']!.crossCompany, true)
  assert.equal(manifest.functions['ledger.list']!.crossCompany, false)
  await db.close()
})

test('scope: an agent is told which tools read across legal entities', () => {
  const tool = agentTools(manifest).find((t) => t.name === 'ledger__listAllCompanies')!
  assert.equal(tool.crossCompany, true)
  assert.match(tool.description, /reads across companies/)
})

test('scope: branch narrows within a company, and is not a permission', async () => {
  const db = await boot()
  await callFn(
    'ledger.add',
    { id: 'h1', total: 1 },
    { adapter: db, manifest, scope: { company: 'acme', branches: ['hanoi'] } },
  )
  await callFn(
    'ledger.add',
    { id: 's1', total: 2 },
    { adapter: db, manifest, scope: { company: 'acme', branches: ['saigon'] } },
  )

  const hanoi = (
    await callFn(
      'ledger.list',
      {},
      { adapter: db, manifest, scope: { company: 'acme', branches: ['hanoi'] } },
    )
  ).value as Row[]
  assert.deepEqual(
    hanoi.map((r) => r.id),
    ['h1'],
  )

  const both = (
    await callFn(
      'ledger.list',
      {},
      { adapter: db, manifest, scope: { company: 'acme', branches: ['hanoi', 'saigon'] } },
    )
  ).value as Row[]
  assert.deepEqual(both.map((r) => r.id).sort(), ['h1', 's1'], 'aggregating branches needs no permission')

  const everyBranch = (await callFn('ledger.list', {}, { adapter: db, manifest, scope: A })).value as Row[]
  assert.equal(everyBranch.length, 2, 'no branch list means every branch of the company, not none')
  await db.close()
})

test('scope: changing a model scope is a breaking change the diff reports', () => {
  const widened = defineModule({
    name: 'ledger',
    models: {
      Invoice: { scope: 'shared', fields: { id: 'id', total: 'int' } },
      Setting: { scope: 'company', fields: { id: 'id', value: 'text' } },
      Currency: { scope: 'shared', fields: { id: 'id', code: 'text' } },
    },
  })
  const items = diffManifests(manifest, compose([widened], { headless: true }))
  const change = items.find((i) => i.code === 'MODEL_SCOPE_CHANGED')!
  assert.equal(change.severity, 'breaking')
  assert.match(change.message, /company\+branch to shared/)
  assert.match(change.hint!, /widening leaks/)
})

test('scope: a transaction rolls back every write together', async () => {
  const db = await boot()
  const risky = defineModule({
    name: 'risky',
    functions: {
      pair: defineFn({
        input: {},
        effects: ['write:ledger.Invoice'],
        handler: async (ctx: Ctx) =>
          ctx.tx(async (tx) => {
            await tx.db.insert('ledger.Invoice', { id: 't1', total: 1 } as Row)
            await tx.db.insert('ledger.Invoice', { id: 't2', total: 2 } as Row)
            throw new Error('boom')
          }),
      }),
    },
  })
  const m = compose([ledger, risky], { headless: true })
  registerFunctions([ledger, risky])
  await assert.rejects(() => callFn('risky.pair', {}, { adapter: db, manifest: m, scope: A }), /boom/)
  assert.equal((await db.all('SELECT * FROM ledger_invoice', [])).length, 0, 'neither write survived')
  await db.close()
})

test('scope: a transaction keeps the company it was opened with', async () => {
  const db = await boot()
  const ok = defineModule({
    name: 'ok',
    functions: {
      pair: defineFn({
        input: {},
        effects: ['write:ledger.Invoice', 'read:ledger.Invoice'],
        handler: async (ctx: Ctx) =>
          ctx.tx(async (tx) => {
            assert.equal(tx.scope.company, 'acme')
            await tx.db.insert('ledger.Invoice', { id: 'q1', total: 1 } as Row)
            return (
              await tx.db.all(from(tx.table('ledger.Invoice')).where(eq(tx.table('ledger.Invoice').id, 'q1')))
            ).length
          }),
      }),
    },
  })
  const m = compose([ledger, ok], { headless: true })
  registerFunctions([ledger, ok])
  assert.equal((await callFn('ok.pair', {}, { adapter: db, manifest: m, scope: A })).value, 1)
  await db.close()
})

test('effects: an undeclared preload is refused whether or not the table has rows', async () => {
  // The check used to live where the children are fetched, so it only ran when the
  // parent returned rows: an empty table let an undeclared preload through, which
  // means a test suite with empty fixtures goes green and production throws on the
  // first customer that has data.
  const m = defineModule({
    name: 'reach',
    models: {
      Partner: { scope: 'shared', fields: { id: 'id', name: 'text' } },
      Order: { scope: 'company', fields: { id: 'id', partnerId: 'text' } },
    },
    relations: { 'reach.Order': { partner: { belongsTo: 'reach.Partner', by: 'partnerId' } } },
    functions: {
      sneak: {
        effects: ['read:reach.Order'],
        handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('reach.Order')).preload('partner')),
      },
    },
  })
  const manifest = compose([m])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([m])
  const scope = { company: 'c1', branches: null }

  const refused = async (why: string) => {
    await assert.rejects(
      () => callFn('reach.sneak', {}, { adapter, manifest, scope }),
      (e: unknown) => {
        assert.equal((e as { code: string }).code, 'E_EFFECT_NOT_DECLARED', why)
        return true
      },
    )
  }
  await refused('empty table')
  await adapter.run('INSERT INTO reach_partner (id, name) VALUES (?, ?)', ['p1', 'Acme'])
  await adapter.run('INSERT INTO reach_order (id, "companyId", "partnerId") VALUES (?, ?, ?)', [
    'o1',
    'c1',
    'p1',
  ])
  await refused('with rows — the answer must not depend on the data')
  await adapter.close()
})

test('effects: a preload of a relation nobody declared is named, not silently empty', async () => {
  const m = defineModule({
    name: 'norel',
    models: { Thing: { scope: 'shared', fields: { id: 'id' } } },
    functions: {
      go: {
        effects: ['read:norel.Thing'],
        handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('norel.Thing')).preload('nope')),
      },
    },
  })
  const manifest = compose([m])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([m])
  await assert.rejects(
    () => callFn('norel.go', {}, { adapter, manifest, scope: { company: 'c1', branches: null } }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_UNKNOWN_RELATION')
      return true
    },
  )
  await adapter.close()
})

test('del: a select handed to db.del is refused, because it would delete nothing', async () => {
  // website_menu.removeMenuItem was written this way and had therefore never once
  // worked: the query renders as a SELECT, and the effect check sees 'read', so a
  // function that correctly declared 'write' is refused for an effect it never
  // asked for. No test had ever called it.
  const m = defineModule({
    name: 'del',
    models: { Thing: { scope: 'shared', fields: { id: 'id' } } },
    functions: {
      wrong: {
        effects: ['write:del.Thing'],
        handler: (ctx: Ctx) => ctx.db.del(from(ctx.table('del.Thing'))),
      },
      right: {
        effects: ['write:del.Thing'],
        handler: (ctx: Ctx) => ctx.db.del(deleteFrom(ctx.table('del.Thing'))),
      },
    },
  })
  const manifest = compose([m])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([m])
  await adapter.run('INSERT INTO del_thing (id) VALUES (?)', ['t1'])
  const scope = { company: 'c1' }

  await assert.rejects(
    () => callFn('del.wrong', {}, { adapter, manifest, scope }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_NOT_A_DELETE')
      assert.match((e as { hint: string }).hint, /deleteFrom\(table\)/)
      return true
    },
  )
  assert.equal((await adapter.all('SELECT * FROM del_thing', [])).length, 1, 'and nothing was touched')

  await callFn('del.right', {}, { adapter, manifest, scope })
  assert.equal((await adapter.all('SELECT * FROM del_thing', [])).length, 0)
  await adapter.close()
})
