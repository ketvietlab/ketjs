// Phase 1 of the `--demo-data` seed: sales quotations/orders.
//
// `sale_backend`'s own order list has no page-size affordance yet (unlike
// partner/product/crm/user, it never adopted `backend/paging.ts`), so there is
// no real "page 2" to prove here — a dozen genuine, distinct orders against the
// seeded catalog is what a running business actually has, not padded volume.

import type { Call } from './util.ts'
import type { CatalogLine } from './product.ts'

type OrderSeed = { id: string; partnerId: string; clientOrderRef?: string; lines: number[] }

// `lines` indexes into the seeded catalog (product.ts's `catalog`, in
// declaration order) so each order pulls a believable, varied basket instead
// of always the first few products.
const ORDERS: OrderSeed[] = [
  { id: 'demo-so-01', partnerId: 'demo-partner-dai-phat', clientOrderRef: 'PO-DP-0142', lines: [0, 4, 20] },
  { id: 'demo-so-02', partnerId: 'demo-partner-song-hong', lines: [7, 8, 9] },
  {
    id: 'demo-so-03',
    partnerId: 'demo-partner-bien-xanh',
    clientOrderRef: 'KS-2026-018',
    lines: [1, 2, 3, 6],
  },
  { id: 'demo-so-04', partnerId: 'demo-partner-viet-nhat', lines: [6, 11] },
  { id: 'demo-so-05', partnerId: 'demo-partner-hong-ha', lines: [16] },
  { id: 'demo-so-06', partnerId: 'demo-partner-tay-bac', clientOrderRef: 'TB-AT-2026', lines: [14] },
  { id: 'demo-so-07', partnerId: 'demo-partner-mat-troi-viet', lines: [24, 25] },
  { id: 'demo-so-08', partnerId: 'demo-partner-an-binh', lines: [12, 13] },
  { id: 'demo-so-09', partnerId: 'demo-partner-phuong-nam', clientOrderRef: 'PN-QC-77', lines: [23] },
  { id: 'demo-so-10', partnerId: 'demo-partner-hoa-binh', lines: [29] },
  { id: 'demo-so-11', partnerId: 'demo-partner-hoang-long', lines: [0, 30, 31] },
  { id: 'demo-so-12', partnerId: 'demo-partner-mien-trung', lines: [0, 5] },
]

export async function seedSale(call: Call, catalog: CatalogLine[], warehouseId: string): Promise<string[]> {
  const ids: string[] = []
  for (const order of ORDERS) {
    await call('sale.saveDraft', {
      id: order.id,
      partnerId: order.partnerId,
      warehouseId,
      create: true,
      ...(order.clientOrderRef ? { clientOrderRef: order.clientOrderRef } : {}),
      lines: order.lines.map((index, position) => {
        const item = catalog[index % catalog.length] as CatalogLine
        return {
          id: `${order.id}:line-${position + 1}`,
          productId: item.productId,
          productUomId: item.uomId,
          productUomQty: String(2 + ((position * 3 + index) % 8)),
        }
      }),
    })
    ids.push(order.id)
  }
  return ids
}
