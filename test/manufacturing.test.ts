import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, manufacturing, partner, product, stock, uom } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, stock, manufacturing]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(componentTracking: 'none' | 'lot' = 'none') {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  await call('uom.saveUnit', { id: 'kg', name: 'kg', relativeFactor: '1' }, adapter)
  for (const [templateId, productId, name, tracking] of [
    ['fruit-template', 'fruit', 'Fruit', componentTracking],
    ['basket-template', 'basket', 'Fruit basket', 'none'],
  ]) {
    await call(
      'product.saveTemplate',
      { id: templateId, name, type: 'goods', uomId: 'kg', listPrice: '0' },
      adapter,
    )
    await call(
      'product.saveVariant',
      { id: productId, templateId, combinationKey: '', defaultCode: productId.toUpperCase() },
      adapter,
    )
    await call('stock.configureProduct', { templateId, isStorable: true, tracking }, adapter)
  }
  for (const [id, name, usage] of [
    ['stock', 'Stock', 'internal'],
    ['production', 'Production', 'production'],
    ['finished', 'Finished goods', 'internal'],
    ['inventory', 'Inventory adjustment', 'inventory'],
  ])
    await call('stock.saveLocation', { id, name, usage }, adapter)
  if (componentTracking === 'lot')
    await call('stock.createLot', { id: 'fruit-lot', productId: 'fruit', name: 'FRUIT/001' }, adapter)
  await call(
    'stock.adjustInventory',
    {
      id: 'seed-fruit',
      productId: 'fruit',
      locationId: 'stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '100',
      lotId: componentTracking === 'lot' ? 'fruit-lot' : undefined,
      productUomId: 'kg',
    },
    adapter,
  )
  return adapter
}

test('manufacturing: a BOM drives component consumption, work orders, and finished stock', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveWorkCenter',
      { id: 'packing', code: 'PACK', name: 'Packing', capacity: '2' },
      adapter,
    )
    const bom = (
      await call(
        'manufacturing.saveBom',
        {
          id: 'basket-bom',
          code: 'BASKET-01',
          productId: 'basket',
          productQty: '10',
          productUomId: 'kg',
          operations: [
            {
              id: 'pack-operation',
              name: 'Pack basket',
              workCenterId: 'packing',
              durationExpected: 15,
            },
          ],
          lines: [
            {
              id: 'fruit-line',
              productId: 'fruit',
              productQty: '12',
              productUomId: 'kg',
              operationId: 'pack-operation',
            },
          ],
        },
        adapter,
      )
    ).value as Row
    assert.equal(bom.ok, true)

    const saved = (
      await call(
        'manufacturing.saveProduction',
        {
          id: 'mo-1',
          name: 'MO/0001',
          bomId: 'basket-bom',
          productQty: '20',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-08-24T08:00:00.000Z',
        },
        adapter,
      )
    ).value as Row
    assert.equal(saved.version, 1)

    const confirmed = (await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter))
      .value as Row
    assert.equal(confirmed.ok, true)
    assert.deepEqual(confirmed.shortages, [])

    let production = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    assert.equal(production.state, 'confirmed')
    assert.equal((production.workOrders as Row[]).length, 1)
    const raw = (production.moves as Row[]).find((entry) => entry.kind === 'component')!
    assert.equal(
      Number((raw.move as Row).productUomQty),
      24,
      'BOM demand scales with the production quantity',
    )

    const work = (production.workOrders as Row[])[0]!
    await call('manufacturing.startWorkOrder', { id: work.id, version: work.version }, adapter)
    const active = ((await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row)
      .workOrders as Row[]
    await call('manufacturing.finishWorkOrder', { id: active[0]!.id, version: active[0]!.version }, adapter)

    production = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    const completed = (
      await call(
        'manufacturing.completeProduction',
        { id: 'mo-1', version: production.version, producedQuantity: '20' },
        adapter,
      )
    ).value as Row
    assert.equal(completed.ok, true)
    const balances = await adapter.all(
      'SELECT "productId", "locationId", quantity FROM stock_quant WHERE "locationId" IN (?, ?) ORDER BY "productId", "locationId"',
      ['stock', 'finished'],
    )
    assert.equal(Number(balances.find((row) => row.productId === 'fruit')!.quantity), 76)
    assert.equal(Number(balances.find((row) => row.productId === 'basket')!.quantity), 20)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a picked component reservation is not reserved and consumed twice', async () => {
  const adapter = await boot('lot')
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'tracked-bom',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-tracked',
        name: 'MO/TRACKED',
        bomId: 'tracked-bom',
        productQty: '20',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T08:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-tracked', version: 1 }, adapter)
    const production = (await call('manufacturing.getProduction', { id: 'mo-tracked' }, adapter)).value as Row
    const component = (production.moves as Row[]).find((entry) => entry.kind === 'component')!
    const move = component.move as Row
    const lines = await adapter.all('SELECT id, quantity, "lotId" FROM stock_move_line WHERE "moveId" = ?', [
      move.id,
    ])
    assert.equal(lines.length, 1)
    await call(
      'stock.saveMoveLine',
      {
        id: lines[0]!.id,
        moveId: move.id,
        quantity: lines[0]!.quantity,
        lotId: lines[0]!.lotId,
        picked: true,
      },
      adapter,
    )
    const completed = (
      await call(
        'manufacturing.completeProduction',
        { id: 'mo-tracked', version: production.version, producedQuantity: '20' },
        adapter,
      )
    ).value as Row
    assert.equal(completed.ok, true)
    const balance = await adapter.all(
      'SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?',
      ['fruit', 'stock'],
    )
    assert.equal(Number(balance[0]!.quantity), 76)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: completion fails closed when components are short', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'short-bom',
        productId: 'basket',
        productQty: '1',
        productUomId: 'kg',
        lines: [{ productId: 'fruit', productQty: '150', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-short',
        name: 'MO/SHORT',
        bomId: 'short-bom',
        productQty: '1',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T08:00:00.000Z',
      },
      adapter,
    )
    const confirmed = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.equal((confirmed.shortages as Row[])[0]!.quantity, '50')
    const completed = (
      await call('manufacturing.completeProduction', { id: 'mo-short', version: 2 }, adapter)
    ).value as Row
    assert.equal(completed.ok, false)
    assert.equal((completed.errors as Row[])[0]!.code, 'manufacturing.error.stockShortage')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a BOM in use cannot be rewritten under its production orders', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveWorkCenter',
      { id: 'packing', code: 'PACK', name: 'Packing', capacity: '2' },
      adapter,
    )
    const bom = {
      id: 'bom-1',
      productId: 'basket',
      productQty: '10',
      productUomId: 'kg',
      operations: [
        { id: 'op-a', name: 'Op A', workCenterId: 'packing', durationExpected: 5 },
        { id: 'op-b', name: 'Op B', workCenterId: 'packing', durationExpected: 5 },
      ],
      lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
    }
    await call('manufacturing.saveBom', bom, adapter)
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-1',
        name: 'MO-1',
        bomId: 'bom-1',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T00:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter)

    // Saving a BOM rewrites its operations. A confirmed order's work orders
    // point at those rows by id, through a reference the schema says cannot be
    // null — so an edit that drops one leaves a work order pointing at nothing.
    const refused = (
      await call('manufacturing.saveBom', { ...bom, operations: [bom.operations[0]] }, adapter)
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Array<{ code: string }>)[0]?.code, 'manufacturing.error.bomInUse')

    const operations = await adapter.all('SELECT id FROM manufacturing_operation ORDER BY id')
    const workOrders = await adapter.all('SELECT "operationId" FROM manufacturing_work_order')
    const known = new Set(operations.map((row) => String(row.id)))
    assert.deepEqual(
      workOrders.filter((row) => !known.has(String(row.operationId))),
      [],
      'no work order may point at an operation that no longer exists',
    )

    // Once the order is out of the way the BOM is editable again: refusing
    // forever would make a BOM write-once the first time it produced anything.
    await call('manufacturing.cancelProduction', { id: 'mo-1', version: 2 }, adapter)
    assert.equal(
      (
        (await call('manufacturing.saveBom', { ...bom, operations: [bom.operations[0]] }, adapter))
          .value as Row
      ).ok,
      true,
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: confirming twice reports the shortage both times', async () => {
  const adapter = await boot()
  try {
    // 500kg demanded against the 100kg the fixture stocks.
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-short',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '500', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-short',
        name: 'MO-SHORT',
        bomId: 'bom-short',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T00:00:00.000Z',
      },
      adapter,
    )
    const first = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.deepEqual(first.shortages, [{ moveId: 'mo-short:raw:l1', quantity: '400' }])

    // The second press used to answer with an empty list — reporting "nothing
    // missing" to an operator staring at a 400kg hole, and reporting it most
    // confidently in the case where the first attempt reserved nothing at all.
    const second = (await call('manufacturing.confirmProduction', { id: 'mo-short', version: 1 }, adapter))
      .value as Row
    assert.deepEqual(second.shortages, first.shortages)
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a production order is created once, however many callers ask', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-1',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    const args = {
      id: 'mo-race',
      name: 'MO-RACE',
      bomId: 'bom-1',
      productQty: '10',
      productUomId: 'kg',
      sourceLocationId: 'stock',
      productionLocationId: 'production',
      destinationLocationId: 'finished',
      scheduledStart: '2026-08-24T00:00:00.000Z',
    }
    // Two operators pressing create, or a browser resubmitting the form. Every
    // caller must get ok — the function declares itself idempotent — and one
    // row may exist.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call('manufacturing.saveProduction', args, adapter)),
    )
    for (const result of results) assert.equal((result.value as Row).ok, true)
    assert.equal((await adapter.all('SELECT COUNT(*) c FROM manufacturing_production'))[0]!.c, 1)

    // And a name already taken is refused rather than duplicated: the name is
    // what `origin` stamps on every move this order makes.
    const clash = (await call('manufacturing.saveProduction', { ...args, id: 'mo-other' }, adapter))
      .value as Row
    assert.equal(clash.ok, false)
    assert.equal((clash.errors as Array<{ field: string }>)[0]?.field, 'name')
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a completion interrupted after the components are gone finishes on retry', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-1',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    await call(
      'manufacturing.saveProduction',
      {
        id: 'mo-1',
        name: 'MO-1',
        bomId: 'bom-1',
        productQty: '10',
        productUomId: 'kg',
        sourceLocationId: 'stock',
        productionLocationId: 'production',
        destinationLocationId: 'finished',
        scheduledStart: '2026-08-24T00:00:00.000Z',
      },
      adapter,
    )
    await call('manufacturing.confirmProduction', { id: 'mo-1', version: 1 }, adapter)

    // Completion cannot run in one transaction — every stock command it calls
    // opens one of its own — so what stands in for atomicity is `to_close` plus
    // the picking states. This is that guarantee: the crash leaves the
    // components consumed and no output booked, which is the worst moment for
    // it to happen.
    await adapter.all(
      "UPDATE manufacturing_production SET state='to_close', version=version+1 WHERE id='mo-1'",
    )
    await call('stock.completePicking', { id: 'mo-1:components', createBackorder: false }, adapter)
    assert.equal(
      (
        await adapter.all(
          'SELECT quantity FROM stock_quant WHERE "productId" = \'fruit\' AND "locationId" = \'stock\'',
        )
      )[0]!.quantity,
      '88',
      'the components are gone',
    )

    const stuck = (await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row
    const finished = (
      await call('manufacturing.completeProduction', { id: 'mo-1', version: Number(stuck.version) }, adapter)
    ).value as Row
    assert.equal(finished.ok, true)
    assert.equal(
      ((await call('manufacturing.getProduction', { id: 'mo-1' }, adapter)).value as Row).state,
      'done',
    )
    assert.equal(
      (
        await adapter.all(
          'SELECT quantity FROM stock_quant WHERE "productId" = \'basket\' AND "locationId" = \'finished\'',
        )
      )[0]!.quantity,
      '10',
      'the retry books the output the crash never got to',
    )
  } finally {
    await adapter.close()
  }
})

test('manufacturing: a production detail reads its own moves, not the factory ledger', async () => {
  const adapter = await boot()
  try {
    await call(
      'manufacturing.saveBom',
      {
        id: 'bom-1',
        productId: 'basket',
        productQty: '10',
        productUomId: 'kg',
        lines: [{ id: 'l1', productId: 'fruit', productQty: '12', productUomId: 'kg' }],
      },
      adapter,
    )
    for (const id of ['mo-a', 'mo-b']) {
      await call(
        'manufacturing.saveProduction',
        {
          id,
          name: id.toUpperCase(),
          bomId: 'bom-1',
          productQty: '10',
          productUomId: 'kg',
          sourceLocationId: 'stock',
          productionLocationId: 'production',
          destinationLocationId: 'finished',
          scheduledStart: '2026-08-24T00:00:00.000Z',
        },
        adapter,
      )
      await call('manufacturing.confirmProduction', { id, version: 1 }, adapter)
    }
    // Both orders have moves. The narrowed read must still return exactly one
    // order's, and every link must resolve — an unresolved move on the detail
    // screen would look like a data loss rather than a bad query.
    const detail = (await call('manufacturing.getProduction', { id: 'mo-a' }, adapter)).value as Row
    const moves = detail.moves as Array<{ moveId: string; move: Row | null }>
    assert.equal(moves.length > 0, true)
    for (const link of moves) {
      assert.notEqual(link.move, null, `${link.moveId} did not resolve`)
      assert.match(String(link.moveId), /^mo-a:/u)
    }
  } finally {
    await adapter.close()
  }
})
