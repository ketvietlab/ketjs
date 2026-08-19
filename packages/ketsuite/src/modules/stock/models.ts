import type { ModelDef } from 'ketjs'

/**
 * Stock, on Odoo's model.
 *
 * Two ideas carry the whole thing. First, locations are a tree and *everything* is
 * a location — suppliers and customers included — so every movement is a transfer
 * between two of them and nothing is ever created or destroyed. Second, the truth
 * about how much is where lives in one place, the quant, and moves are what change
 * it. Ask "what do we have" and the answer is a sum over internal locations; ask
 * "why" and the moves say so.
 *
 * Warehouses and locations are company-scoped, as decided: products and partners
 * are shared across the tenant, warehouses are not.
 */
export const models: Record<string, ModelDef> = {
  Warehouse: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      /** Short code, on labels and documents. */
      code: 'text',
      /** The folder holding everything of this warehouse. */
      viewLocationId: 'ref:stock.Location?',
      /** Where goods land by default. Odoo calls it lot_stock_id. */
      stockLocationId: 'ref:stock.Location?',
      active: 'bool',
    },
  },

  Location: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      /** The tree. Optional because the roots have no parent. */
      parentId: 'ref:stock.Location?',
      // 'view' | 'internal' | 'supplier' | 'customer' | 'inventory' | 'production' | 'transit'
      usage: 'text',
      /** Set on the locations belonging to a warehouse; null on the virtual ones. */
      warehouseId: 'ref:stock.Warehouse?',
      active: 'bool',
    },
  },

  /**
   * How much of one product is in one location — the only place that answers it.
   *
   * `reserved` is the part already promised to a move. Available is
   * quantity − reserved, and that subtraction is the whole reason two orders
   * cannot sell the same unit.
   */
  Quant: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      locationId: 'ref:stock.Location',
      /** In the product's own unit, always. Moves convert on the way in. */
      quantity: 'decimal',
      reserved: 'decimal',
    },
  },

  /**
   * One intended movement of one product between two locations.
   *
   * The quantity is in whatever unit the caller works in; it is converted to the
   * product's unit before it touches a quant, because a quant that mixed units
   * would be a quant nobody can add up.
   */
  Move: {
    scope: 'company',
    fields: {
      id: 'id',
      productId: 'ref:product.Product',
      uomId: 'ref:uom.Unit',
      quantity: 'decimal',
      sourceId: 'ref:stock.Location',
      destId: 'ref:stock.Location',
      // 'draft' | 'assigned' | 'done' | 'cancel'
      state: 'text',
      /** How much this move has set aside, in the product's unit. */
      reserved: 'decimal',
      /** The document this came from — an order number, a transfer reference. */
      reference: 'text?',
      doneAt: 'datetime?',
    },
  },
}
