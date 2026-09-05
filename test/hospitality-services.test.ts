import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Lần', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    {
      id: 'breakfast-template',
      name: 'Bữa sáng',
      type: 'service',
      uomId: 'unit',
      listPrice: '25',
      saleOk: true,
    },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'breakfast', templateId: 'breakfast-template', defaultCode: 'BF', combinationKey: '' },
    adapter,
  )
  await call(
    'product.saveTemplate',
    {
      id: 'water-template',
      name: 'Nước suối',
      type: 'goods',
      uomId: 'unit',
      listPrice: '15',
      saleOk: true,
    },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'water', templateId: 'water-template', defaultCode: 'WATER', combinationKey: '' },
    adapter,
  )
  await call(
    'hospitality_core.saveProperty',
    { id: 'hotel', code: 'HCM', name: 'Két Hotel', accommodationType: 'hotel', timezone: 'UTC' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '100' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoom',
    { id: '101', propertyId: 'hotel', roomTypeId: 'deluxe', code: '101', name: '101' },
    adapter,
  )
  const reservation = await call(
    'hospitality_core.createReservation',
    {
      id: 'reservation',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-09-01T14:00:00.000Z',
      checkOut: '2026-09-03T12:00:00.000Z',
      rate: '100',
      createdAt: '2026-08-20T00:00:00.000Z',
    },
    adapter,
  )
  assert.equal((reservation.value as Row).ok, true, JSON.stringify(reservation.value))
  return adapter
}

test('hospitality services: property fees are validated and enter the OTA content feed', async () => {
  const adapter = await boot()
  try {
    const saved = await call(
      'hospitality_core.savePropertyCharge',
      {
        id: 'city-tax',
        propertyId: 'hotel',
        chargeType: 'city_tax',
        name: 'Thuế thành phố',
        amount: '20',
        active: true,
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    const changes = await adapter.all(
      'SELECT "resourceType", "resourceId" FROM hospitality_core_content_change WHERE "resourceType" = ?',
      ['property_charge'],
    )
    assert.deepEqual(
      changes.map((row) => ({ ...row })),
      [{ resourceType: 'property_charge', resourceId: 'city-tax' }],
    )

    const duplicate = await call(
      'hospitality_core.savePropertyCharge',
      {
        id: 'city-tax-2',
        propertyId: 'hotel',
        chargeType: 'city_tax',
        name: 'Thuế thành phố',
        amount: '30',
      },
      adapter,
    )
    assert.equal((duplicate.value as Row).ok, false)
  } finally {
    await adapter.close()
  }
})

test('hospitality services: once and per-night materialisation is idempotent and auditable', async () => {
  const adapter = await boot()
  try {
    const once = {
      id: 'breakfast-once',
      reservationId: 'reservation',
      productId: 'breakfast',
      recurrence: 'once',
    }
    assert.equal(((await call('hospitality_core.saveExtraLine', once, adapter)).value as Row).ok, true)
    const first = (await call('hospitality_core.materializeExtraLine', { id: 'breakfast-once' }, adapter))
      .value as Row
    const retry = (await call('hospitality_core.materializeExtraLine', { id: 'breakfast-once' }, adapter))
      .value as Row
    assert.equal(first.existing, false)
    assert.equal(retry.existing, true)
    assert.equal(retry.chargeId, first.chargeId)

    await call(
      'hospitality_core.saveExtraLine',
      {
        id: 'breakfast-nightly',
        reservationId: 'reservation',
        productId: 'breakfast',
        recurrence: 'per_night',
        unitPrice: '10',
      },
      adapter,
    )
    for (const serviceDate of ['2026-09-01', '2026-09-02', '2026-09-02'])
      await call('hospitality_core.materializeExtraLine', { id: 'breakfast-nightly', serviceDate }, adapter)
    const outside = (
      await call(
        'hospitality_core.materializeExtraLine',
        { id: 'breakfast-nightly', serviceDate: '2026-09-03' },
        adapter,
      )
    ).value as Row
    assert.equal(outside.ok, false)
    assert.equal(((outside.errors as Row[])[0] as Row).code, 'extra_service_date')

    const lines = (await call('hospitality_core.listExtraLines', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.deepEqual(
      lines.map((line) => [line.id, line.materializedCount, line.materializedAmount]),
      [
        ['breakfast-once', 1, '25'],
        ['breakfast-nightly', 2, '20'],
      ],
    )
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio'))[0]!.amountTotal,
      '245',
    )
    await call(
      'hospitality_core.cancelReservation',
      { id: 'reservation', reason: 'guest request', at: '2026-08-25T00:00:00.000Z' },
      adapter,
    )
    const voided = (await call('hospitality_core.listServiceCharges', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.equal(voided.length, 3)
    assert.equal(
      voided.every((charge) => charge.state === 'void'),
      true,
    )
    const resetLines = (await call('hospitality_core.listExtraLines', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.equal(
      resetLines.every((line) => line.materializedCount === 0),
      true,
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality services: product-backed minibar charges require external stock fulfilment evidence', async () => {
  const adapter = await boot()
  try {
    const folioId = String((await adapter.all('SELECT id FROM hospitality_core_folio'))[0]!.id)
    const base = {
      id: 'minibar-water',
      folioId,
      description: 'Nước suối minibar',
      type: 'minibar',
      quantity: '2',
      unitPrice: '15',
      sourceKey: 'stock-authority:movement-1',
    }

    const missingProduct = (await call('hospitality_core.addCharge', base, adapter)).value as Row
    assert.equal(missingProduct.ok, false)
    assert.equal((missingProduct.errors as Row[])[0]!.code, 'minibar_product_required')

    const serviceProduct = (
      await call('hospitality_core.addCharge', { ...base, productId: 'breakfast' }, adapter)
    ).value as Row
    assert.equal(serviceProduct.ok, false)
    assert.equal(
      (serviceProduct.errors as Row[]).some((problem) => problem.code === 'minibar_goods_required'),
      true,
    )

    const missingFulfilment = (
      await call('hospitality_core.addCharge', { ...base, productId: 'water', uomId: 'unit' }, adapter)
    ).value as Row
    assert.equal(missingFulfilment.ok, false)
    assert.equal(
      (missingFulfilment.errors as Row[]).some((problem) => problem.code === 'minibar_fulfillment_required'),
      true,
    )

    const posted = (
      await call(
        'hospitality_core.addCharge',
        {
          ...base,
          productId: 'water',
          uomId: 'unit',
          fulfillmentKind: 'external_stock',
        },
        adapter,
      )
    ).value as Row
    assert.equal(posted.ok, true, JSON.stringify(posted.errors))
    const charge = (
      await adapter.all(
        'SELECT "productId", "uomId", type, "fulfillmentKind", amount FROM hospitality_core_charge WHERE id = ?',
        [base.id],
      )
    )[0]!
    assert.deepEqual(
      { ...charge },
      {
        productId: 'water',
        uomId: 'unit',
        type: 'minibar',
        fulfillmentKind: 'external_stock',
        amount: '30',
      },
    )

    const changedReplay = (
      await call(
        'hospitality_core.addCharge',
        {
          ...base,
          productId: 'water',
          uomId: 'unit',
          fulfillmentKind: 'external_stock',
          quantity: '3',
        },
        adapter,
      )
    ).value as Row
    assert.equal(changedReplay.ok, false)
    assert.equal((changedReplay.errors as Row[])[0]!.code, 'charge_id_reused')
  } finally {
    await adapter.close()
  }
})

test('hospitality services: externally fulfilled extra lines cannot bypass their connector', async () => {
  const adapter = await boot()
  try {
    const saved = (
      await call(
        'hospitality_core.saveExtraLine',
        {
          id: 'minibar-intent',
          reservationId: 'reservation',
          productId: 'water',
          chargeType: 'minibar',
          fulfillmentKind: 'external_stock',
          recurrence: 'once',
        },
        adapter,
      )
    ).value as Row
    assert.equal(saved.ok, true, JSON.stringify(saved.errors))

    const direct = (await call('hospitality_core.materializeExtraLine', { id: 'minibar-intent' }, adapter))
      .value as Row
    assert.equal(direct.ok, false)
    assert.equal((direct.errors as Row[])[0]!.code, 'external_fulfillment_required')
    assert.equal(
      Number(
        (
          await adapter.all('SELECT COUNT(*) AS count FROM hospitality_core_charge WHERE "extraLineId" = ?', [
            'minibar-intent',
          ])
        )[0]!.count,
      ),
      0,
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality services: per-unit requests have caller idempotency and posted lines are immutable', async () => {
  const adapter = await boot()
  try {
    const line = {
      id: 'laundry',
      stayId: 'reservation:stay',
      productId: 'breakfast',
      description: 'Giặt ủi',
      unitPrice: '2',
      recurrence: 'per_unit',
    }
    await call('hospitality_core.saveExtraLine', line, adapter)
    for (const requestKey of ['bag-1', 'bag-1', 'bag-2'])
      await call(
        'hospitality_core.materializeExtraLine',
        { id: 'laundry', requestKey, quantity: '3' },
        adapter,
      )
    assert.equal(
      (
        await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_charge WHERE "extraLineId" = ?', [
          'laundry',
        ])
      )[0]!.n,
      2,
    )

    const changed = (await call('hospitality_core.saveExtraLine', { ...line, unitPrice: '999' }, adapter))
      .value as Row
    assert.equal(changed.ok, false)
    assert.equal(((changed.errors as Row[])[0] as Row).code, 'extra_line_materialized')
    assert.equal(
      (await adapter.all('SELECT "unitPrice" FROM hospitality_core_extra_line WHERE id = ?', ['laundry']))[0]!
        .unitPrice,
      '2',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality services: invalid targets and unsaleable products never create service intentions', async () => {
  const adapter = await boot()
  try {
    const both = (
      await call(
        'hospitality_core.saveExtraLine',
        {
          id: 'invalid-target',
          reservationId: 'reservation',
          stayId: 'reservation:stay',
          productId: 'breakfast',
        },
        adapter,
      )
    ).value as Row
    assert.equal(both.ok, false)
    assert.equal(((both.errors as Row[])[0] as Row).code, 'extra_line_target')

    await adapter.run('UPDATE product_template SET "saleOk" = ? WHERE id = ?', [false, 'breakfast-template'])
    const unsaleable = (
      await call(
        'hospitality_core.saveExtraLine',
        { id: 'invalid-product', reservationId: 'reservation', productId: 'breakfast' },
        adapter,
      )
    ).value as Row
    assert.equal(unsaleable.ok, false)
    assert.equal(((unsaleable.errors as Row[])[0] as Row).code, 'product_not_saleable')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_extra_line'))[0]!.n, 0)
  } finally {
    await adapter.close()
  }
})
