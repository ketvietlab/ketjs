/**
 * A stay, billed.
 *
 * The folio was where hospitality stopped and accounting had not started: a
 * guest could check out owing money and nothing in the ledger knew. These tests
 * cover the seam itself — that a closed folio becomes one posted sales entry,
 * that it becomes exactly one however many times anyone asks, that money taken
 * against it settles the receivable, and that a charge nobody has classified is
 * refused rather than quietly filed as not subject to VAT.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  address,
  company,
  hospitalityBilling,
  hospitalityCore,
  partner,
  product,
  storage,
  uom,
} from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  uom,
  product,
  account,
  hospitalityCore,
  hospitalityBilling,
]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

const value = async (name: string, args: Record<string, unknown>, adapter: Adapter): Promise<Row> =>
  (await call(name, args, adapter)).value as Row

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)

  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Ket Hotel JSC' }, adapter)
  await call(
    'company.saveCompany',
    { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' },
    adapter,
  )
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    {
      id: 'water-template',
      name: 'Water',
      type: 'goods',
      uomId: 'unit',
      listPrice: '50',
      saleOk: true,
    },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'water', templateId: 'water-template', defaultCode: 'WATER', combinationKey: '' },
    adapter,
  )

  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['revenue', '5113', 'Doanh thu dịch vụ', 'income'],
    ['tax', '3331', 'Thuế GTGT phải nộp', 'liability_current'],
    ['cash', '1111', 'Tiền mặt', 'asset_cash'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call(
    'account.saveDefaults',
    { incomeAccountId: 'revenue', receivableAccountId: 'receivable' },
    adapter,
  )
  await call('account.saveJournal', { id: 'sales', name: 'Bán hàng', code: 'SAL', type: 'sale' }, adapter)
  await call(
    'account.saveJournal',
    { id: 'cash-journal', name: 'Tiền mặt', code: 'CSH', type: 'cash', defaultAccountId: 'cash' },
    adapter,
  )
  // Accommodation and food are not taxed at the same rate, which is the whole
  // reason a charge type has to say which it is.
  await call(
    'account.saveTax',
    {
      id: 'vat8',
      name: 'GTGT 8%',
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '8',
      accountId: 'tax',
    },
    adapter,
  )
  await call(
    'account.saveTax',
    {
      id: 'vat10',
      name: 'GTGT 10%',
      typeTaxUse: 'sale',
      amountType: 'percent',
      amount: '10',
      accountId: 'tax',
    },
    adapter,
  )

  await call(
    'hospitality_core.saveProperty',
    { id: 'hotel', code: 'HCM', name: 'Ket Hotel', accommodationType: 'hotel' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '500', published: true },
    adapter,
  )
  await call(
    'hospitality_core.saveRoom',
    { id: '101', propertyId: 'hotel', roomTypeId: 'deluxe', code: '101', name: '101' },
    adapter,
  )
  return adapter
}

/** A guest who arrived, spent, and left — the folio this module bills. */
const stayed = async (adapter: Adapter): Promise<string> => {
  await call(
    'hospitality_core.createReservation',
    {
      id: 'r1',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-09-01T14:00:00.000Z',
      checkOut: '2026-09-03T12:00:00.000Z',
      rate: '500',
    },
    adapter,
  )
  await call(
    'hospitality_core.checkIn',
    { stayId: 'r1:stay', roomId: '101', assignmentId: 'a1', at: '2026-09-01T14:05:00.000Z' },
    adapter,
  )
  await call('hospitality_core.checkOut', { stayId: 'r1:stay', at: '2026-09-03T12:00:00.000Z' }, adapter)
  const folio = (await adapter.all('SELECT id FROM hospitality_core_folio'))[0]!
  return String(folio.id)
}

const rule = (chargeType: string, taxId: string | null, adapter: Adapter) =>
  call(
    'hospitality_billing.saveChargeRule',
    { chargeType, taxId: taxId ?? undefined, taxExempt: !taxId, taxAccountId: 'tax' },
    adapter,
  )

test('hospitality billing: a closed folio becomes one posted invoice, however often it is asked', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)

    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))

    const move = (
      await adapter.all(
        'SELECT id, state, "amountUntaxed", "amountTax", "amountTotal", name FROM account_move',
      )
    )[0]!
    assert.equal(move.state, 'posted')
    // Two nights at 500, at 8% — the room charges the stay itself posted.
    assert.equal(Number(move.amountUntaxed), 1000)
    assert.equal(Number(move.amountTax), 80)
    assert.equal(Number(move.amountTotal), 1080)
    assert.equal(String(move.name), 'SAL/2026/00001')

    const lines = await adapter.all('SELECT id, debit, credit FROM account_move_line ORDER BY sequence, id')
    assert.equal(
      lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0),
      0,
    )

    // The desk presses it again, the sweep runs, a request is retried. One
    // guest, one invoice.
    const again = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(again.ok, true)
    assert.equal(again.moveId, invoiced.moveId)
    assert.equal((await adapter.all('SELECT id FROM account_move')).length, 1)
    assert.equal((await adapter.all('SELECT id FROM hospitality_billing_folio_bill')).length, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: folio charges remain exact beyond JavaScript safe integers', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    await rule('minibar', null, adapter)

    await adapter.run(`UPDATE hospitality_core_folio SET state = 'open' WHERE id = ?`, [folioId])
    const charged = await value(
      'hospitality_core.addCharge',
      {
        id: 'large-minibar',
        folioId,
        description: 'Large exact charge',
        type: 'minibar',
        productId: 'water',
        uomId: 'unit',
        fulfillmentKind: 'external_stock',
        quantity: '1',
        unitPrice: '9007199254740993',
      },
      adapter,
    )
    assert.equal(charged.ok, true, JSON.stringify(charged.errors))
    assert.equal(charged.amount, '9007199254740993')
    const folio = (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio'))[0]!
    assert.equal(String(folio.amountTotal), '9007199254741993')
    await adapter.run(`UPDATE hospitality_core_folio SET state = 'closed' WHERE id = ?`, [folioId])

    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))
    const move = (
      await adapter.all('SELECT "amountUntaxed", "amountTax", "amountTotal" FROM account_move')
    )[0]!
    assert.equal(String(move.amountUntaxed), '9007199254741993')
    assert.equal(String(move.amountTax), '80')
    assert.equal(String(move.amountTotal), '9007199254742073')

    const lines = await adapter.all('SELECT debit, credit FROM account_move_line')
    const balance = lines.reduce(
      (sum, line) => sum + BigInt(String(line.debit)) - BigInt(String(line.credit)),
      0n,
    )
    assert.equal(balance, 0n)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: a charge nobody has classified is refused, not filed as untaxed', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    // Reopening is not on offer, so the minibar arrives on the folio the way a
    // late charge does: through the same call the bar uses, before billing.
    await adapter.run(`UPDATE hospitality_core_folio SET state = 'open' WHERE id = ?`, [folioId])
    await call(
      'hospitality_core.addCharge',
      {
        id: 'minibar-1',
        folioId,
        description: 'Minibar',
        type: 'minibar',
        productId: 'water',
        uomId: 'unit',
        fulfillmentKind: 'external_stock',
        quantity: '2',
        unitPrice: '50',
      },
      adapter,
    )
    await adapter.run(`UPDATE hospitality_core_folio SET state = 'closed' WHERE id = ?`, [folioId])

    // Sending this with no tax on it would tell the tax authority the minibar is
    // not subject to VAT. That is a claim about the sale, and nobody made it.
    const refused = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(refused.ok, false)
    const first = (refused.errors as Row[])[0]!
    assert.equal(first.code, 'charge_rule_missing')
    assert.deepEqual(first.params, { type: 'minibar' })
    assert.equal((await adapter.all('SELECT id FROM account_move')).length, 0)

    // And the screen can say which decision is missing before anyone presses it.
    const billing = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.deepEqual(billing.missingRules, ['minibar'])

    await rule('minibar', 'vat10', adapter)
    const invoiced = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))
    const move = (await adapter.all('SELECT "amountUntaxed", "amountTax" FROM account_move'))[0]!
    // 1000 of room at 8% and 100 of minibar at 10%, each at its own rate.
    assert.equal(Number(move.amountUntaxed), 1100)
    assert.equal(Number(move.amountTax), 90)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: money taken against a folio settles its invoice', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await rule('room', 'vat8', adapter)
    await value('hospitality_billing.invoiceFolio', { folioId }, adapter)

    const owed = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(Number(owed.amountDue), 1080)
    assert.equal(owed.paymentState, 'not_paid')

    // Half at the desk, half prepaid through a channel weeks earlier: the same
    // event seen at two different times, settling the same receivable.
    const part = await value(
      'hospitality_billing.recordFolioPayment',
      { id: 'pay-1', folioId, amount: '80', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(part.ok, true, JSON.stringify(part.errors))
    const partly = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(Number(partly.amountDue), 1000)
    assert.equal(partly.paymentState, 'partial')

    const rest = await value(
      'hospitality_billing.recordFolioPayment',
      { id: 'pay-2', folioId, amount: '1000', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(rest.ok, true, JSON.stringify(rest.errors))
    const settled = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.equal(Number(settled.amountDue), 0)
    assert.equal(settled.paymentState, 'paid')

    // The channel retries its prepayment notice. The receivable is already
    // settled and must not be settled twice.
    const retried = await value(
      'hospitality_billing.recordFolioPayment',
      { id: 'pay-2', folioId, amount: '1000', journalId: 'cash-journal' },
      adapter,
    )
    assert.equal(retried.ok, true)
    assert.equal((await adapter.all('SELECT id FROM account_payment')).length, 2)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: an open folio is not invoiced, because it can still take charges', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.createReservation',
      {
        id: 'r1',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        bookingType: 'nightly',
        checkIn: '2026-09-01T14:00:00.000Z',
        checkOut: '2026-09-03T12:00:00.000Z',
        rate: '500',
      },
      adapter,
    )
    const folioId = String((await adapter.all('SELECT id FROM hospitality_core_folio'))[0]!.id)
    await rule('room', 'vat8', adapter)

    const refused = await value('hospitality_billing.invoiceFolio', { folioId }, adapter)
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]!.code, 'folio_not_closed')
    const readiness = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.deepEqual(
      (readiness.blockers as Row[]).map((blocker) => blocker.code),
      ['folio_open'],
    )
    assert.equal((await adapter.all('SELECT id FROM account_move')).length, 0)
  } finally {
    await adapter.close()
  }
})

test('hospitality billing: readiness reports every repairable invoice blocker without provider data', async () => {
  const adapter = await boot()
  try {
    const folioId = await stayed(adapter)
    await adapter.run('DELETE FROM hospitality_core_charge WHERE "folioId" = ?', [folioId])
    await adapter.run('UPDATE hospitality_core_folio SET "amountTotal" = 0 WHERE id = ?', [folioId])
    await adapter.run("DELETE FROM account_journal WHERE type = 'sale'")

    const readiness = await value('hospitality_billing.getFolioBilling', { folioId }, adapter)
    assert.deepEqual(
      (readiness.blockers as Row[]).map((blocker) => blocker.code),
      ['folio_without_charges', 'journal_missing'],
    )
    assert.equal(JSON.stringify(readiness).includes('Nguyễn An'), false)
  } finally {
    await adapter.close()
  }
})
