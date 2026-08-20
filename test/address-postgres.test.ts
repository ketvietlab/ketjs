import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import { address, partner } from 'ketsuite'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'

const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    await adapter.all('SELECT 1')
    await adapter.close()
    return true
  } catch {
    await adapter.close().catch(() => {})
    return false
  }
})()

const live = { skip: reachable ? false : `no PostgreSQL at ${adminUrl.toString()}` }
const modules = [address, partner]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown> = {}) =>
  callFn(name, input, { adapter, manifest, scope }).then((result) => result.value as Row)

test('address PostgreSQL: concurrent VN installation and default selection converge', live, async () => {
  const database = `ket_address_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const first = postgresAdapter(databaseUrl.toString(), { max: 2 })
  const second = postgresAdapter(databaseUrl.toString(), { max: 2 })
  await admin.open()
  await admin.exec(`CREATE DATABASE "${database}"`)
  try {
    await Promise.all([first.open(), second.open()])
    await migrateOne(first, manifest)
    registerFunctions(modules)

    const installs = await Promise.all([
      call(first, 'address.installCatalog', { countryCode: 'VN' }),
      call(second, 'address.installCatalog', { countryCode: 'vn' }),
    ])
    assert.equal(
      installs.every((result) => result.ok === true),
      true,
    )
    assert.equal(installs.filter((result) => result.alreadyInstalled === false).length, 1)
    assert.equal((await first.all('SELECT * FROM address_country', [])).length, 1)
    assert.equal((await first.all('SELECT * FROM address_catalog', [])).length, 1)
    assert.equal((await first.all('SELECT * FROM address_current_catalog', [])).length, 1)
    assert.equal((await first.all('SELECT * FROM address_division', [])).length, 3_355)

    await call(first, 'partner.savePartner', { id: 'customer', kind: 'company', name: 'Minh An' })
    const save = (adapter: Adapter, id: string, street1: string) =>
      call(adapter, 'partner.saveAddress', {
        id,
        partnerId: 'customer',
        use: 'delivery',
        street1,
        countryId: 'VN',
        divisionId: 'VN:2025-07-01:10101003',
        isDefault: true,
      })
    const saved = await Promise.all([
      save(first, 'delivery-a', '12 Nguyễn Huệ'),
      save(second, 'delivery-b', '14 Nguyễn Huệ'),
    ])
    assert.equal(
      saved.every((result) => result.ok === true),
      true,
    )
    assert.equal((await first.all('SELECT * FROM partner_address_default', [])).length, 1)
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.close()
  }
})
