// Phase 1 of the `--demo-data` seed: purchase orders against the seeded
// suppliers. Same rationale as sale.ts for the order count — see there.
//
// `purchase.addLine` prices a line from the vendor's own `SupplierInfo` (it
// ignores a `priceUnit` passed inside `saveDraft`'s `lines`), so every product
// on an order gets a real supplier price registered first — otherwise the line
// would silently cost 0, which is exactly the fake-looking data the content
// bar rules out.

import type { Call } from './util.ts'
import type { CatalogLine } from './product.ts'

type OrderSeed = { id: string; partnerId: string; lines: number[] }

const ORDERS: OrderSeed[] = [
  { id: 'demo-po-01', partnerId: 'demo-partner-vai-soi-bd', lines: [0, 6] },
  { id: 'demo-po-02', partnerId: 'demo-partner-da-giay-dn', lines: [7, 22] },
  { id: 'demo-po-03', partnerId: 'demo-partner-hoa-chat-la', lines: [8, 9] },
  { id: 'demo-po-04', partnerId: 'demo-partner-thep-viet', lines: [23] },
  { id: 'demo-po-05', partnerId: 'demo-partner-carton-sg', lines: [26, 27] },
  { id: 'demo-po-06', partnerId: 'demo-partner-cao-su-md', lines: [8, 15] },
  { id: 'demo-po-07', partnerId: 'demo-partner-linh-kien-bn', lines: [30] },
  { id: 'demo-po-08', partnerId: 'demo-partner-vai-soi-bd', lines: [1, 2] },
  { id: 'demo-po-09', partnerId: 'demo-partner-da-giay-dn', lines: [9, 20] },
]

export async function seedPurchase(
  call: Call,
  catalog: CatalogLine[],
  pickingTypeId: string,
): Promise<string[]> {
  const priced = new Set<string>()
  const ids: string[] = []
  for (const order of ORDERS) {
    for (const index of order.lines) {
      const item = catalog[index % catalog.length] as CatalogLine
      const key = `${order.partnerId}:${item.templateId}`
      if (priced.has(key)) continue
      priced.add(key)
      await call('purchase.saveSupplierInfo', {
        id: `demo-supplier-info:${key}`,
        partnerId: order.partnerId,
        productTemplateId: item.templateId,
        productUomId: item.uomId,
        price: item.cost,
        delay: 3,
      })
    }
    await call('purchase.saveDraft', {
      id: order.id,
      partnerId: order.partnerId,
      pickingTypeId,
      create: true,
      lines: order.lines.map((index, position) => {
        const item = catalog[index % catalog.length] as CatalogLine
        return {
          id: `${order.id}:line-${position + 1}`,
          productId: item.productId,
          productUomId: item.uomId,
          productQty: String(10 + ((position * 5 + index) % 40)),
        }
      }),
    })
    ids.push(order.id)
  }
  return ids
}
