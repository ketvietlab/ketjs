import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootRuntime, callFn, migrateOne, sqliteStore } from '@ketvietlab/ketjs'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { ensureDevelopmentAdmin } from '../packages/ketsuite/src/development.ts'
import { seedDemoData } from '../packages/ketsuite/src/demo/seed.ts'

// `ensureDevelopmentAdmin`/`seedDemoData` each open and close their own store
// connection (mirroring how `ketsuite serve --demo-data` runs them), so the
// state has to persist across those connections — a real file, not `:memory:`.
const openDb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ketsuite-demo-seed-'))
  return { dir, file: join(dir, 'demo.sqlite') }
}

const envFor = (file: string) => ({ KET_LOG: 'null', KET_SQLITE: file, KET_SECRET: 'demo-seed-test' })

// The `PAGE_SIZE` every list built on `packages/ketsuite/src/modules/backend/paging.ts`
// uses (partner_backend, product_backend, crm_backend, user_backend among them).
const PAGE_SIZE = 30

test('seeds a demo dataset once, and leaves it alone on a second run', async (t) => {
  const { dir, file } = openDb()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const env = envFor(file)

  assert.equal(await ensureDevelopmentAdmin(ketsuite, env), 'created')
  assert.equal(await seedDemoData(ketsuite, env), 'seeded')
  assert.equal(await seedDemoData(ketsuite, env), 'exists')

  const runtime = await bootRuntime(ketsuite, { env })
  const adapter = await sqliteStore(runtime.config)
  t.after(() => adapter.close())
  await migrateOne(adapter, runtime.manifest)
  const boot: {
    adapter: typeof adapter
    manifest: typeof runtime.manifest
    actor: string | null
    scope: Scope
  } = {
    adapter,
    manifest: runtime.manifest,
    actor: null,
    scope: { company: null, branch: null },
  }

  const call = async <T>(name: string, input: Row, ctx: typeof boot = boot): Promise<T> =>
    (await callFn(name, input, ctx)).value as T

  const [company] = await call<Row[]>('company.listCompanies', {})
  assert.ok(company, 'the demo company exists')
  const branches = await call<Row[]>('company.listBranches', { companyId: company!.id })
  const branch = branches.find((row) => row.isRoot) ?? branches[0]
  const [admin] = await call<Row[]>('user.listUsers', { search: 'admin', limit: 1 })
  assert.ok(admin, 'the admin user exists')
  const ctx = {
    adapter,
    manifest: runtime.manifest,
    actor: String(admin!.id),
    scope: {
      company: String(company!.id),
      companies: [String(company!.id)],
      branch: String(branch!.id),
      branches: [String(branch!.id)],
    },
  }

  const partners = await call<Row[]>('partner.listPartners', { limit: 200 }, ctx)
  const templates = await call<Row[]>('product.listTemplates', { limit: 200 }, ctx)
  const cases = await call<{ rows: Row[]; total: number }>('crm.case.list', { limit: 200 }, ctx)
  const users = await call<Row[]>('user.listUsers', { limit: 200 }, ctx)
  const salesOrders = await call<Row[]>('sale.listOrders', { limit: 200 }, ctx)
  const purchaseOrders = await call<Row[]>('purchase.listOrders', { limit: 200 }, ctx)

  // Pagination: every one of these lists must clear its real page size so a
  // developer opening it on day one genuinely sees a second page.
  assert.ok(partners.length > PAGE_SIZE, `expected > ${PAGE_SIZE} partners, got ${partners.length}`)
  assert.ok(templates.length > PAGE_SIZE, `expected > ${PAGE_SIZE} templates, got ${templates.length}`)
  assert.ok(cases.total > PAGE_SIZE, `expected > ${PAGE_SIZE} CRM cases, got ${cases.total}`)

  // Content quality: no "Name 01 / Name 02" templated placeholders — every
  // seeded record was individually authored, so names must be unique.
  const uniqueNames = (rows: Row[]) => new Set(rows.map((row) => String(row.name))).size
  assert.equal(uniqueNames(partners), partners.length, 'partner names must be unique')
  assert.equal(uniqueNames(templates), templates.length, 'template names must be unique')
  assert.equal(uniqueNames(cases.rows), cases.rows.length, 'CRM case names must be unique')

  // A small, real team — not padded to page-size volume (see demo/user.ts).
  assert.ok(
    users.length >= 6 && users.length < PAGE_SIZE,
    `expected a small staff roster, got ${users.length}`,
  )

  // Real orders against the seeded catalog, with non-zero totals — a zero
  // total would mean a line silently fell back to an unpriced default.
  assert.ok(salesOrders.length > 0, 'at least one sales order was seeded')
  assert.ok(purchaseOrders.length > 0, 'at least one purchase order was seeded')
  for (const order of salesOrders) assert.ok(Number(order.amountTotal) > 0, `${order.name} has a real total`)
  for (const order of purchaseOrders)
    assert.ok(Number(order.amountTotal) > 0, `${order.name} has a real total`)
})

test('refuses to seed without an existing company', async (t) => {
  const { dir, file } = openDb()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  await assert.rejects(() => seedDemoData(ketsuite, envFor(file)), /run with --dev-admin/)
})
