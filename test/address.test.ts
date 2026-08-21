import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Manifest, Row } from '@ketvietlab/ketjs'
import { address, loadAddressCatalog, partner } from '@ketvietlab/ketsuite'
import { loadCatalogFrom } from '../packages/ketsuite/src/modules/address/loader.ts'

const modules = [address, partner]
const scope = { company: 'acme', branches: null }

const boot = async (): Promise<{ adapter: Adapter; manifest: Manifest }> => {
  const manifest = compose(modules, { headless: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  return { adapter, manifest }
}

const call = async <T = Row>(
  runtime: { adapter: Adapter; manifest: Manifest },
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> => (await callFn(name, input, { ...runtime, scope })).value as T

test('address data: Vietnam bundle is checksum verified and complete', async () => {
  const bundle = await loadAddressCatalog('vn')
  assert.equal(bundle.catalog.version, '2025-07-01')
  assert.equal(bundle.catalog.codeSystem, 'VIDOO_VN_ADDRESS_2025')
  assert.deepEqual(bundle.catalog.sourceAttribution, {
    name: 'Vidoo Vietnam Address Core',
    author: 'vidoo.dev',
    website: 'https://vidoo.dev',
    license: 'LGPL-3.0',
  })
  assert.equal(bundle.divisions.length, 3_355)
  assert.equal(bundle.divisions.filter((row: { level: number }) => row.level === 1).length, 34)
  assert.equal(bundle.divisions.filter((row: { level: number }) => row.level === 2).length, 3_321)
  assert.deepEqual(bundle.catalog.divisions.counts, {
    municipality: 6,
    province: 28,
    ward: 687,
    commune: 2_621,
    special_zone: 13,
  })
})

test('address data: a modified signed file is rejected before installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ket-address-corrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const shipped = new URL('modules/address/data/', import.meta.resolve('@ketvietlab/ketsuite'))
  await cp(shipped, root, { recursive: true })
  const policy = join(root, 'VN/catalogs/2025-07-01/policy.json')
  const contents = await readFile(policy, 'utf8')
  await writeFile(policy, contents.replace('^[0-9]{5,6}$', '^[0-9]+$'))
  await assert.rejects(loadCatalogFrom(pathToFileURL(`${root}/`), 'VN'), /checksum mismatch.*policy\.json/)
})

test('address: explicit lazy installation is idempotent and activates one catalog', async (t) => {
  const runtime = await boot()
  t.after(() => runtime.adapter.close())

  assert.deepEqual(await call(runtime, 'address.listCountries'), [])
  const first = await call<Row>(runtime, 'address.installCatalog', { countryCode: 'vn' })
  assert.equal(first.ok, true)
  assert.equal(first.recordCount, 3_355)
  assert.equal(first.alreadyInstalled, false)
  const second = await call<Row>(runtime, 'address.installCatalog', { countryCode: 'VN' })
  assert.equal(second.ok, true)
  assert.equal(second.alreadyInstalled, true)

  assert.equal((await runtime.adapter.all('SELECT * FROM address_country', [])).length, 1)
  assert.equal((await runtime.adapter.all('SELECT * FROM address_catalog', [])).length, 1)
  assert.equal((await runtime.adapter.all('SELECT * FROM address_current_catalog', [])).length, 1)
  assert.equal((await runtime.adapter.all('SELECT * FROM address_division', [])).length, 3_355)
})

test('address: Vietnam follows the two-level 2025 tree and formats canonical addresses', async (t) => {
  const runtime = await boot()
  t.after(() => runtime.adapter.close())
  await call(runtime, 'address.installCatalog', { countryCode: 'VN' })

  const roots = await call<Row[]>(runtime, 'address.listDivisionChildren', { countryCode: 'VN' })
  assert.equal(roots.length, 34)
  const hanoi = roots.find((row) => row.code === '01')!
  assert.equal(hanoi.officialName, 'Hà Nội')
  const wards = await call<Row[]>(runtime, 'address.listDivisionChildren', {
    countryCode: 'VN',
    parentId: hanoi.id,
  })
  assert.equal(wards.length > 0, true)
  const baDinh = wards.find((row) => row.code === '10101003')!

  const provinceOnly = await call<Row>(runtime, 'address.validate', {
    street1: '12 Nguyễn Huệ',
    countryId: 'VN',
    divisionId: hanoi.id,
  })
  assert.equal(provinceOnly.ok, false)
  assert.match(JSON.stringify(provinceOnly.errors), /address\.error\.requiredLevel/)

  const formatted = await call<Row>(runtime, 'address.format', {
    street1: '12 Nguyễn Huệ',
    countryId: 'VN',
    divisionId: baDinh.id,
  })
  assert.equal(formatted.ok, true)
  assert.equal(formatted.oneLine, '12 Nguyễn Huệ, Phường Ba Đình, Hà Nội, Việt Nam')
})

test('partner: canonical address refs retain a stable snapshot', async (t) => {
  const runtime = await boot()
  t.after(() => runtime.adapter.close())
  await call(runtime, 'address.installCatalog', { countryCode: 'VN' })
  await call(runtime, 'partner.savePartner', { id: 'customer', kind: 'company', name: 'Minh An' })
  const saved = await call<Row>(runtime, 'partner.saveAddress', {
    id: 'delivery',
    partnerId: 'customer',
    use: 'delivery',
    street1: '12 Nguyễn Huệ',
    countryId: 'VN',
    divisionId: 'VN:2025-07-01:10101003',
    isDefault: true,
  })
  assert.equal(saved.ok, true)

  const detail = await call<Row>(runtime, 'partner.getPartner', { id: 'customer' })
  const stored = (detail.addresses as Row[])[0]!
  assert.equal(stored.oneLine, '12 Nguyễn Huệ, Phường Ba Đình, Hà Nội, Việt Nam')
  const snapshot = await call<Row>(runtime, 'partner.snapshotAddress', { id: 'delivery' })
  assert.equal(snapshot.ok, true)
  assert.equal((snapshot.snapshot as Row).catalogId, 'VN:2025-07-01')
  assert.equal((snapshot.snapshot as Row).oneLine, stored.oneLine)
})
