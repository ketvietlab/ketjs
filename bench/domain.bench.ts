// Measures the new Odoo-derived hot paths separately from setup and migration.
// The numbers are deliberately end-to-end through the public function boundary.
import { performance } from 'node:perf_hooks'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { company, partner, pricing, product, stock, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, pricing, stock]
const manifest = compose(modules, { headless: true })
const scope = { company: 'bench', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function measure(label: string, count: number, run: () => Promise<void>) {
  const started = performance.now()
  await run()
  const elapsed = performance.now() - started
  const rate = (count / elapsed) * 1000
  console.log(
    `${label.padEnd(34)} ${elapsed.toFixed(2).padStart(9)} ms  ${rate.toFixed(0).padStart(8)} ops/s`,
  )
}

const adapter = sqliteAdapter()
await adapter.open()
try {
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'bench-party', kind: 'company', name: 'Benchmark' }, adapter)
  await call('company.saveCompany', { id: 'bench', partnerId: 'bench-party', currency: 'VND' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    { id: 'tpl', name: 'Benchmark', type: 'goods', uomId: 'unit', listPrice: '100.00' },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'base', templateId: 'tpl', defaultCode: 'BASE', combinationKey: '' },
    adapter,
  )

  for (let attribute = 0; attribute < 3; attribute++) {
    const attributeId = `a${attribute}`
    await call('product.saveAttribute', { id: attributeId, name: attributeId }, adapter)
    const valueIds: string[] = []
    for (let value = 0; value < 5; value++) {
      const id = `${attributeId}:v${value}`
      valueIds.push(id)
      await call('product.saveAttributeValue', { id, attributeId, name: id }, adapter)
    }
    await call(
      'product.saveAttributeLine',
      { id: `tpl:${attributeId}`, templateId: 'tpl', attributeId, valueIds },
      adapter,
    )
  }
  await measure('generate 125 variants', 125, async () => {
    await call('product.generateVariants', { templateId: 'tpl' }, adapter)
  })

  await call('pricing.savePricelist', { id: 'retail', name: 'Retail' }, adapter)
  await call(
    'pricing.savePricelistItem',
    {
      id: 'variant-price',
      pricelistId: 'retail',
      appliedOn: '0_product_variant',
      productId: 'base',
      computePrice: 'percentage',
      percentPrice: '10',
    },
    adapter,
  )
  await measure('resolve 1,000 prices', 1000, async () => {
    for (let index = 0; index < 1000; index++)
      await call('pricing.priceFor', { pricelistId: 'retail', productId: 'base', quantity: '1' }, adapter)
  })

  await call('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, adapter)
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
  await call('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' }, adapter)
  await call('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' }, adapter)
  await call(
    'stock.adjustInventory',
    {
      id: 'opening',
      productId: 'base',
      locationId: 'stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '100',
      productUomId: 'unit',
    },
    adapter,
  )
  for (let index = 0; index < 100; index++)
    await call(
      'stock.addMove',
      {
        id: `move:${index}`,
        name: `Move ${index}`,
        productId: 'base',
        productUomId: 'unit',
        productUomQty: '1',
        locationId: 'stock',
        locationDestId: 'customer',
      },
      adapter,
    )
  await measure('reserve 100 stock moves', 100, async () => {
    for (let index = 0; index < 100; index++)
      await call('stock.reserveMove', { id: `move:${index}` }, adapter)
  })
} finally {
  await adapter.close()
}
