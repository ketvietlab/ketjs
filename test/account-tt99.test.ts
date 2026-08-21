import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import {
  account,
  address,
  company,
  partner,
  product,
  TT99_ACCOUNT_CHECKSUM,
  TT99_ACCOUNTS,
  TT99_CODE,
  uom,
  VIETNAM_TAXES,
} from 'ketsuite'

const modules = [address, partner, company, uom, product, account]
const manifest = compose(modules, { headless: true })

const call = (name: string, args: Record<string, unknown>, adapter: Adapter, companyId = 'acme') =>
  callFn(name, args, { adapter, manifest, scope: { company: companyId, branches: null } })

async function boot(companyId = 'acme', currency = 'VND') {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call(
    'partner.savePartner',
    { id: `${companyId}-party`, kind: 'company', name: companyId.toUpperCase() },
    adapter,
    companyId,
  )
  await call(
    'company.saveCompany',
    { id: companyId, partnerId: `${companyId}-party`, currency },
    adapter,
    companyId,
  )
  return adapter
}

test('account TT99: first accounting read installs the complete Vietnam defaults exactly once', async () => {
  const adapter = await boot()
  try {
    const [first, second] = await Promise.all([
      call('account.listAccounts', {}, adapter),
      call('account.initializeCompany', {}, adapter),
    ])
    assert.equal((first.value as Row[]).length, TT99_ACCOUNTS.length)
    assert.equal((second.value as Row).standard, TT99_CODE)
    assert.equal((second.value as Row).sourceChecksum, TT99_ACCOUNT_CHECKSUM)

    const accounts = (await call('account.listAccounts', {}, adapter)).value as Row[]
    assert.equal(accounts.length, 216)
    assert.equal(new Set(accounts.map((row) => row.code)).size, 216)
    assert.ok(accounts.some((row) => row.code === '21511'))
    assert.ok(accounts.some((row) => row.code === '82112'))
    assert.ok(accounts.some((row) => row.code === '2421' && row.name === 'Chi phí chờ phân bổ - ngắn hạn'))
    assert.equal(accounts.find((row) => row.code === '411121')?.accountType, 'liability_current')
    for (const retired of ['1611', '1612', '4611', '4612', '6111', '6112', '631', '441', '466'])
      assert.equal(
        accounts.some((row) => row.code === retired),
        false,
        retired,
      )

    assert.equal(((await call('account.listTaxes', {}, adapter)).value as Row[]).length, VIETNAM_TAXES.length)
    assert.equal(((await call('account.listJournals', {}, adapter)).value as Row[]).length, 5)
    assert.equal(((await call('account.listPaymentTerms', {}, adapter)).value as Row[]).length, 2)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_setup'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('account TT99: an existing account code is preserved and becomes the journal default', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveAccount',
      { id: 'existing-bank', code: '112', name: 'Ngân hàng riêng', accountType: 'asset_cash' },
      adapter,
    )
    await call('account.initializeCompany', {}, adapter)
    const bank = ((await call('account.listJournals', { type: 'bank' }, adapter)).value as Row[])[0]!
    assert.equal(bank.defaultAccountId, 'existing-bank')
    assert.equal(
      ((await call('account.listAccounts', {}, adapter)).value as Row[]).filter((row) => row.code === '112')
        .length,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('account TT99: configured tax carries its posting account into invoices', async () => {
  const adapter = await boot()
  try {
    const accounts = (await call('account.listAccounts', {}, adapter)).value as Row[]
    const journals = (await call('account.listJournals', {}, adapter)).value as Row[]
    const taxes = (await call('account.listTaxes', { typeTaxUse: 'sale' }, adapter)).value as Row[]
    const id = (code: string) => String(accounts.find((row) => row.code === code)?.id)
    const result = await call(
      'account.createInvoice',
      {
        id: 'tt99-invoice',
        journalId: journals.find((row) => row.type === 'sale')?.id,
        moveType: 'out_invoice',
        partnerId: 'acme-party',
        description: 'Hàng hóa',
        quantity: '1',
        priceUnit: '100',
        lineAccountId: id('511'),
        counterpartAccountId: id('1311'),
        taxId: taxes.find((row) => Number(row.amount) === 10)?.id,
      },
      adapter,
    )
    assert.deepEqual(result.value, { ok: true, id: 'tt99-invoice', amountTotal: '110' })
    const move = (await call('account.getMove', { id: 'tt99-invoice' }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(move.lines.find((line) => line.id === 'tt99-invoice:tax')?.accountId, id('33311'))
  } finally {
    await adapter.close()
  }
})

test('account TT99: a non-Vietnam company is not silently initialized with Vietnam data', async () => {
  const adapter = await boot('foreign', 'USD')
  try {
    await assert.rejects(call('account.initializeCompany', {}, adapter, 'foreign'), /countryUnsupported/)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_account'))[0]!.n, 0)
  } finally {
    await adapter.close()
  }
})
