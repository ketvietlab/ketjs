// Phase 1 of the `--demo-data` seed: warehouses.
//
// `stock.saveWarehouse` already creates the locations and picking types a
// warehouse needs (see packages/ketsuite/src/modules/stock/functions.ts), so
// sale/purchase only need the ids this hands back — no separate location or
// picking-type seeding belongs here. Two warehouses (not thirty) is what a
// real single-company demo actually has; padding this for pagination would be
// exactly the fake-volume the content bar rules out.

import type { Call } from './util.ts'

export type StockSeedResult = { mainWarehouseId: string; receivingPickingTypeId: string }

export async function seedStock(call: Call): Promise<StockSeedResult> {
  await call('stock.saveWarehouse', {
    id: 'demo-wh-main',
    name: 'Kho trung tâm Kết Việt',
    code: 'WH-MAIN',
    receptionSteps: 'one_step',
    deliverySteps: 'ship_only',
  })
  await call('stock.saveWarehouse', {
    id: 'demo-wh-south',
    name: 'Kho khu vực miền Nam',
    code: 'WH-SOUTH',
    receptionSteps: 'one_step',
    deliverySteps: 'ship_only',
  })
  return { mainWarehouseId: 'demo-wh-main', receivingPickingTypeId: 'demo-wh-main:incoming' }
}
