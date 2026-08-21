import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootApp,
  callFn,
  compose,
  defineApp,
  defineModule,
  from,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  json,
} from '@ketvietlab/ketjs'
import type { Adapter, Ctx, Manifest, Scope } from '@ketvietlab/ketjs'

/**
 * Reads span a set of companies, writes go to exactly one.
 *
 * the domain contract splits readable company set from company_id and the split is right: a report
 * may span three legal entities, but an invoice belongs to one. Absent a set, reads
 * see only the company being written to — widening what you can see should take
 * saying so.
 */
const books = defineModule({
  name: 'books',
  models: { Entry: { scope: 'company', fields: { id: 'id', memo: 'text' } } },
  functions: {
    add: {
      input: { id: 'id', memo: 'text' },
      effects: ['write:books.Entry'],
      handler: (ctx: Ctx, a) => ctx.db.insert('books.Entry', a),
    },
    list: {
      effects: ['read:books.Entry'],
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('books.Entry'))),
    },
    listPlain: { effects: ['read:books.Entry'], handler: (ctx: Ctx) => ctx.db.select('books.Entry') },
    everywhere: {
      effects: ['read:books.Entry'],
      crossCompany: true,
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('books.Entry'))),
    },
  },
})

const boot = async (): Promise<{ adapter: Adapter; manifest: Manifest }> => {
  const manifest = compose([books])
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([books])
  return { adapter, manifest }
}

const ids = (v: unknown) => (v as Array<{ id: string }>).map((r) => r.id).sort()

test('multi-company: a read spans the set, a write lands in one', async () => {
  const { adapter, manifest } = await boot()
  const at = (scope: Scope) => ({ adapter, manifest, scope })
  await callFn('books.add', { id: 'a1', memo: 'acme' }, at({ company: 'acme' }))
  await callFn('books.add', { id: 'g1', memo: 'globex' }, at({ company: 'globex' }))
  await callFn('books.add', { id: 'i1', memo: 'initech' }, at({ company: 'initech' }))

  const both = await callFn('books.list', {}, at({ company: 'acme', companies: ['acme', 'globex'] }))
  assert.deepEqual(ids(both.value), ['a1', 'g1'], 'the set, and only the set')

  const rows = await adapter.all('SELECT id, "companyId" FROM books_entry ORDER BY id', [])
  assert.deepEqual(
    rows.map((r) => `${String(r.id)}/${String(r.companyId)}`),
    ['a1/acme', 'g1/globex', 'i1/initech'],
    'each write was stamped with the one company the request named',
  )
  await adapter.close()
})

test('multi-company: absent, the readable set is just the company being written to', async () => {
  const { adapter, manifest } = await boot()
  await callFn('books.add', { id: 'a1', memo: 'x' }, { adapter, manifest, scope: { company: 'acme' } })
  await callFn('books.add', { id: 'g1', memo: 'y' }, { adapter, manifest, scope: { company: 'globex' } })
  const seen = await callFn('books.list', {}, { adapter, manifest, scope: { company: 'acme' } })
  assert.deepEqual(ids(seen.value), ['a1'], 'the safe default: widening has to be asked for')
  await adapter.close()
})

test('multi-company: the convenience select spans the set too, not just the query builder', async () => {
  const { adapter, manifest } = await boot()
  await callFn('books.add', { id: 'a1', memo: 'x' }, { adapter, manifest, scope: { company: 'acme' } })
  await callFn('books.add', { id: 'g1', memo: 'y' }, { adapter, manifest, scope: { company: 'globex' } })
  const seen = await callFn(
    'books.listPlain',
    {},
    { adapter, manifest, scope: { company: 'acme', companies: ['acme', 'globex'] } },
  )
  assert.deepEqual(ids(seen.value), ['a1', 'g1'], 'two ways to read must not disagree about who you are')
  await adapter.close()
})

test('multi-company: writing somewhere you cannot read back is refused before the query runs', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () =>
      callFn(
        'books.add',
        { id: 'x', memo: 'x' },
        { adapter, manifest, scope: { company: 'initech', companies: ['acme', 'globex'] } },
      ),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_WRITE_COMPANY_NOT_READABLE')
      // The row would land and then be invisible to every later query — silent.
      return true
    },
  )
  assert.equal((await adapter.all('SELECT * FROM books_entry', [])).length, 0)
  await adapter.close()
})

test('multi-company: a readable set with nothing to write to says which companies it has', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () =>
      callFn(
        'books.add',
        { id: 'x', memo: 'x' },
        { adapter, manifest, scope: { company: null, companies: ['acme', 'globex'] } },
      ),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_NO_COMPANY_IN_SCOPE')
      assert.match((e as Error).message, /2 readable companies and none to write to/)
      assert.match((e as { hint: string }).hint, /acme, globex/)
      return true
    },
  )
  await adapter.close()
})

test('multi-company: naming no company at all is still refused, not answered', async () => {
  const { adapter, manifest } = await boot()
  await assert.rejects(
    () => callFn('books.list', {}, { adapter, manifest, scope: { company: null } }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_NO_COMPANY_IN_SCOPE')
      return true
    },
  )
  await adapter.close()
})

test('multi-company: crossCompany still means all of them, and still has to be declared', async () => {
  const { adapter, manifest } = await boot()
  for (const c of ['acme', 'globex', 'initech']) {
    await callFn('books.add', { id: c[0]!, memo: c }, { adapter, manifest, scope: { company: c } })
  }
  const all = await callFn(
    'books.everywhere',
    {},
    { adapter, manifest, scope: { company: 'acme', companies: ['acme'] } },
  )
  assert.equal(ids(all.value).length, 3, 'consolidated reporting is what this exists for')
  await adapter.close()
})

// ── over HTTP ────────────────────────────────────────────────────────────────

const app = defineApp({
  name: 'booksapp',
  modules: [books],
  headless: true,
  serve: {
    bootstrap: ['books'],
    routes: (ctx) => ({ '/entries': async (url, req) => json(await ctx.call('books.list', {}, url, req)) }),
  },
})

test('multi-company: the server reads both headers, and the active company joins the set', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:', KET_COMPANY: 'acme' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  const post = (company: string, id: string) =>
    fetch(`${at}/_ket/fn/books.add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ket-company': company },
      body: JSON.stringify({ id, memo: company }),
    })
  await post('acme', 'a1')
  await post('globex', 'g1')

  const one = await fetch(`${at}/entries`, { headers: { 'x-ket-company': 'acme' } }).then((r) => r.json())
  assert.deepEqual(ids(one), ['a1'])

  // X-Ket-Companies widens the read; the active company is included without saying so.
  const many = await fetch(`${at}/entries`, {
    headers: { 'x-ket-company': 'acme', 'x-ket-companies': 'globex' },
  }).then((r) => r.json())
  assert.deepEqual(ids(many), ['a1', 'g1'])
  await b.close()
})
