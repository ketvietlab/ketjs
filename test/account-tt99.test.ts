import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  address,
  assertTT99Catalog,
  buildTT99CatalogManifest,
  checksumTT99Catalog,
  company,
  partner,
  product,
  serializeTT99Catalog,
  TT99_ACCOUNT_CHECKSUM,
  TT99_ACCOUNTS,
  TT99_CATALOG_CHECKSUM,
  TT99_CATALOG_MANIFEST,
  TT99_CATALOG_METADATA,
  TT99_CODE,
  TT99_DEFAULT_ACCOUNTS,
  TT99_EXPECTED_ACCOUNT_COUNT,
  TT99_EXPECTED_TAX_COUNT,
  uom,
  VIETNAM_TAXES,
} from '@ketvietlab/ketsuite'

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

test('account TT99: canonical manifest owns the statutory catalog and posting map', () => {
  const catalog = TT99_CATALOG_MANIFEST
  assert.equal(catalog.schemaVersion, 1)
  assert.deepEqual(catalog.metadata, {
    version: '1.0.0',
    standard: 'TT99_2025',
    countryCode: 'VN',
    authority: 'Bộ Tài chính',
    sourceUrl:
      'https://www.mof.gov.vn/tin-tuc-tai-chinh/tin-chinh-sach-tai-chinh/quy-dinh-moi-ve-che-do-ke-toan-doanh-nghiep',
    legalBasis: 'Thông tư 99/2025/TT-BTC ngày 27/10/2025',
    issuedOn: '2025-10-27',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    approvalStatus: 'provisional',
  })
  assert.deepEqual(catalog.counts, {
    accounts: TT99_EXPECTED_ACCOUNT_COUNT,
    taxes: TT99_EXPECTED_TAX_COUNT,
  })
  assert.equal(catalog.accounts.length, 216)
  assert.equal(catalog.taxes.length, 17)
  assert.match(TT99_CATALOG_CHECKSUM, /^[0-9a-f]{64}$/)
  assert.equal(TT99_CATALOG_CHECKSUM, 'c2ee5de7daf9b4f9e98f587875d1c374a4c249cd0cfce1262f13457f472cb805')
  assert.equal(TT99_ACCOUNT_CHECKSUM, '62e0ccee163b4b4b336a7c9c6e28823a97f9ef16462e2b378e8133ca856c6b71')
  assert.equal(checksumTT99Catalog(), TT99_CATALOG_CHECKSUM)
  assert.doesNotThrow(() => assertTT99Catalog(catalog))

  // Source order is not catalog identity; normalized statutory content is.
  const reordered = {
    accounts: [...TT99_ACCOUNTS].reverse(),
    taxes: [...VIETNAM_TAXES].reverse(),
  }
  assert.equal(serializeTT99Catalog(reordered), serializeTT99Catalog())
  assert.equal(checksumTT99Catalog(reordered), TT99_CATALOG_CHECKSUM)

  assert.equal(new Set(catalog.accounts.map((item) => item.code)).size, catalog.accounts.length)
  assert.ok(catalog.accounts.every((item) => item.name.trim() && item.nameEn.trim()))
  assert.equal(new Set(catalog.taxes.map((item) => item.key)).size, catalog.taxes.length)
  assert.equal(new Set(catalog.taxes.map((item) => `${item.use}:${item.name}`)).size, catalog.taxes.length)

  const accounts = new Map(catalog.accounts.map((item) => [item.code, item]))
  assert.deepEqual(catalog.defaults, TT99_DEFAULT_ACCOUNTS)
  assert.equal(accounts.get(catalog.defaults.income)?.accountType, 'income')
  assert.equal(accounts.get(catalog.defaults.expense)?.accountType, 'expense_direct_cost')
  assert.equal(accounts.get(catalog.defaults.receivable)?.accountType, 'asset_receivable')
  assert.equal(accounts.get(catalog.defaults.receivable)?.reconcile, true)
  assert.equal(accounts.get(catalog.defaults.payable)?.accountType, 'liability_payable')
  assert.equal(accounts.get(catalog.defaults.payable)?.reconcile, true)

  for (const tax of catalog.taxes)
    assert.ok(tax.accountCode === null || accounts.has(tax.accountCode), tax.key)
  const classifications = catalog.taxes.filter(
    (tax) => tax.key.endsWith('-exempt') || tax.key.endsWith('-not-declared'),
  )
  assert.equal(classifications.length, 4)
  assert.ok(classifications.every((tax) => tax.accountCode === null && !tax.includeBaseAmount))
  assert.ok(
    catalog.taxes
      .filter((tax) => tax.key.startsWith('vat-purchase-') && !classifications.includes(tax))
      .every((tax) => tax.accountCode === '1331'),
  )
  assert.ok(
    catalog.taxes
      .filter((tax) => tax.key.startsWith('vat-sale-') && !classifications.includes(tax))
      .every((tax) => tax.accountCode === '33311'),
  )
  const importDuty = catalog.taxes.find((tax) => tax.key === 'import-5')
  assert.equal(importDuty?.accountCode, '33331')
  assert.equal(importDuty?.includeBaseAmount, true)
})

test('account TT99: checksum detects mutations and semantic validation fails closed', () => {
  const renamedAccounts = TT99_ACCOUNTS.map((account) =>
    account.code === '111' ? { ...account, nameEn: 'Cash changed' } : account,
  )
  assert.notEqual(checksumTT99Catalog({ accounts: renamedAccounts }), TT99_CATALOG_CHECKSUM)

  const shiftedMetadata = { ...TT99_CATALOG_METADATA, effectiveFrom: '2026-01-02' }
  assert.notEqual(checksumTT99Catalog({ metadata: shiftedMetadata }), TT99_CATALOG_CHECKSUM)
  assert.throws(
    () => assertTT99Catalog(buildTT99CatalogManifest({ metadata: shiftedMetadata })),
    /effectiveFrom must be 2026-01-01/,
  )

  const remappedTaxes = VIETNAM_TAXES.map((tax) =>
    tax.key === 'import-5' ? { ...tax, accountCode: '33311' } : tax,
  )
  assert.notEqual(checksumTT99Catalog({ taxes: remappedTaxes }), TT99_CATALOG_CHECKSUM)
  assert.throws(
    () => assertTT99Catalog(buildTT99CatalogManifest({ taxes: remappedTaxes })),
    /import duty must post to 33331/,
  )

  const duplicateAccounts = TT99_ACCOUNTS.map((account, index) =>
    index === 1 ? { ...account, code: '111' } : account,
  )
  assert.throws(
    () => assertTT99Catalog(buildTT99CatalogManifest({ accounts: duplicateAccounts })),
    /duplicate account code 111/,
  )

  const untranslatedAccounts = TT99_ACCOUNTS.map((account) =>
    account.code === '111' ? { ...account, nameEn: '' } : account,
  )
  assert.throws(
    () => assertTT99Catalog(buildTT99CatalogManifest({ accounts: untranslatedAccounts })),
    /account 111 has no English name/,
  )

  assert.throws(
    () =>
      assertTT99Catalog(
        buildTT99CatalogManifest({
          defaults: { ...TT99_DEFAULT_ACCOUNTS, receivable: '111' },
        }),
      ),
    /default receivable account 111 must be asset_receivable/,
  )
})

test('account TT99: first accounting read installs the complete Vietnam defaults exactly once', async () => {
  const adapter = await boot()
  try {
    const [first, second] = await Promise.all([
      call('account.listAccounts', {}, adapter),
      call('account.initializeCompany', {}, adapter),
    ])
    assert.equal((first.value as Row[]).length, TT99_ACCOUNTS.length)
    assert.equal((second.value as Row).standard, TT99_CODE)
    assert.equal((second.value as Row).sourceChecksum, TT99_CATALOG_CHECKSUM)

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

    const taxes = (await call('account.listTaxes', {}, adapter)).value as Row[]
    assert.equal(VIETNAM_TAXES.length, 17)
    assert.equal(taxes.length, VIETNAM_TAXES.length)
    const kkknt = taxes.filter((tax) => tax.name === 'KKKNT')
    assert.deepEqual(kkknt.map((tax) => tax.typeTaxUse).sort(), ['purchase', 'sale'])
    assert.ok(kkknt.every((tax) => Number(tax.amount) === 0 && !tax.accountId))
    assert.equal(((await call('account.listJournals', {}, adapter)).value as Row[]).length, 5)
    assert.equal(((await call('account.listPaymentTerms', {}, adapter)).value as Row[]).length, 2)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_setup'))[0]!.n, 1)
    assert.equal(
      ((await call('company.getCompany', { id: 'acme' }, adapter)).value as Row).currencyLocked,
      true,
    )
  } finally {
    await adapter.close()
  }
})

test('account TT99: setup freezes currency but company metadata saves and exact retries still work', async () => {
  const adapter = await boot()
  try {
    await call('account.initializeCompany', {}, adapter)
    const locked = (await call('company.getCompany', { id: 'acme' }, adapter)).value as Row
    assert.equal(locked.currency, 'VND')
    assert.equal(locked.currencyLocked, true)

    const refused = (
      await call(
        'company.saveCompany',
        {
          id: 'acme',
          code: 'ACME',
          partnerId: 'acme-party',
          currency: 'USD',
          expectedVersion: locked.version,
        },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.match(JSON.stringify(refused.errors), /company\.error\.currencyLocked/)

    const metadataSave = {
      id: 'acme',
      code: 'ACME-NEW',
      partnerId: 'acme-party',
      currency: 'VND',
      expectedVersion: locked.version,
    }
    const saved = (await call('company.saveCompany', metadataSave, adapter)).value as Row
    assert.equal(saved.ok, true)
    assert.equal(saved.version, Number(locked.version) + 1)

    const replay = (await call('company.saveCompany', metadataSave, adapter)).value as Row
    assert.equal(replay.ok, true)
    assert.equal(replay.version, saved.version)
    const current = (await call('company.getCompany', { id: 'acme' }, adapter)).value as Row
    assert.equal(current.code, 'ACME-NEW')
    assert.equal(current.currency, 'VND')
    assert.equal(current.currencyLocked, true)
  } finally {
    await adapter.close()
  }
})

test('account TT99: a legacy current setup backfills the currency lock once', async () => {
  const adapter = await boot()
  try {
    await call('account.initializeCompany', {}, adapter)
    const before = (await call('company.getCompany', { id: 'acme' }, adapter)).value as Row
    await adapter.run('UPDATE company_company SET "currencyLocked" = NULL WHERE id = ?', ['acme'])

    await call('account.initializeCompany', {}, adapter)
    const backfilled = (await call('company.getCompany', { id: 'acme' }, adapter)).value as Row
    assert.equal(backfilled.currencyLocked, true)
    assert.equal(backfilled.version, Number(before.version) + 1)

    await call('account.initializeCompany', {}, adapter)
    const replay = (await call('company.getCompany', { id: 'acme' }, adapter)).value as Row
    assert.equal(replay.currencyLocked, true)
    assert.equal(replay.version, backfilled.version)
  } finally {
    await adapter.close()
  }
})

test('account TT99: catalog upgrade backfills KKKNT for an existing company', async () => {
  const adapter = await boot()
  try {
    await call('account.initializeCompany', {}, adapter)
    await adapter.run(`DELETE FROM account_tax WHERE name = ?`, ['KKKNT'])
    await adapter.run(`UPDATE account_setup SET "sourceChecksum" = ?`, [TT99_ACCOUNT_CHECKSUM])

    const upgraded = (await call('account.initializeCompany', {}, adapter)).value as Row
    const taxes = (await call('account.listTaxes', {}, adapter)).value as Row[]
    assert.equal(upgraded.sourceChecksum, TT99_CATALOG_CHECKSUM)
    assert.equal(taxes.filter((tax) => tax.name === 'KKKNT').length, 2)
  } finally {
    await adapter.close()
  }
})

test('account TT99: a catalog upgrade corrects the rows it installed and leaves the rest alone', async () => {
  const adapter = await boot()
  try {
    await call('account.initializeCompany', {}, adapter)
    // Stand in for an older catalog: a stale name, type and rate on rows this
    // catalog owns, plus one account the company added for itself.
    await adapter.run(`UPDATE account_account SET name = ?, "accountType" = ? WHERE code = ?`, [
      'Tiền mặt (bản cũ)',
      'asset_current',
      '111',
    ])
    await adapter.run(`UPDATE account_tax SET amount = ? WHERE name = ?`, ['8', 'GTGT 10%'])
    await call(
      'account.saveAccount',
      { id: 'own-account', code: '9999', name: 'Tài khoản riêng', accountType: 'asset_current' },
      adapter,
    )
    await adapter.run(`UPDATE account_setup SET "sourceChecksum" = ?`, [TT99_ACCOUNT_CHECKSUM])

    await call('account.initializeCompany', {}, adapter)
    const accounts = (await call('account.listAccounts', {}, adapter)).value as Row[]
    const cash = accounts.find((row) => row.code === '111')!
    assert.equal(cash.name, 'Tiền mặt')
    assert.equal(cash.accountType, 'asset_cash')
    // A statutory rate change arrives the same way.
    const vat = ((await call('account.listTaxes', {}, adapter)).value as Row[]).find(
      (tax) => tax.name === 'GTGT 10%',
    )!
    assert.equal(Number(vat.amount), 10)
    // Nothing the company owns is touched.
    const own = accounts.find((row) => row.code === '9999')!
    assert.equal(own.name, 'Tài khoản riêng')
  } finally {
    await adapter.close()
  }
})

test('account TT99: the installed chart carries the statutory name in both languages', async () => {
  const adapter = await boot()
  try {
    await call('account.initializeCompany', {}, adapter)
    const accounts = (await call('account.listAccounts', {}, adapter)).value as Row[]
    const byCode = new Map(accounts.map((row) => [String(row.code), row]))
    assert.equal(byCode.get('111')!.name, 'Tiền mặt')
    assert.equal(byCode.get('111')!.nameEn, 'Cash')
    // Every catalog account, not just the one this test names.
    assert.equal(
      accounts.filter((row) => typeof row.nameEn === 'string' && row.nameEn).length,
      TT99_ACCOUNTS.length,
    )
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

    const kkknt = await call(
      'account.createInvoice',
      {
        id: 'kkknt-invoice',
        journalId: journals.find((row) => row.type === 'sale')?.id,
        moveType: 'out_invoice',
        partnerId: 'acme-party',
        description: 'Không kê khai, tính nộp thuế GTGT',
        quantity: '1',
        priceUnit: '100',
        lineAccountId: id('511'),
        counterpartAccountId: id('1311'),
        taxId: taxes.find((row) => row.name === 'KKKNT')?.id,
      },
      adapter,
    )
    assert.deepEqual(kkknt.value, { ok: true, id: 'kkknt-invoice', amountTotal: '100' })
    const kkkntMove = (await call('account.getMove', { id: 'kkknt-invoice' }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(
      kkkntMove.lines.some((line) => line.id === 'kkknt-invoice:tax'),
      false,
    )
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
