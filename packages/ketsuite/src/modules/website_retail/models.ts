import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  /**
   * What a site needs before it can turn a cart into a sales order: which
   * warehouse ships it, which pricelist prices it, and which unit a product
   * that never declared one is ordered in.
   *
   * The channel has no human to ask, so every one of these is a stored decision
   * rather than a guess made per checkout. A site without a row here can still
   * browse and build a cart; it cannot place an order, and says so.
   */
  StoreSettings: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      warehouseId: 'ref:stock.Warehouse',
      pricelistId: 'ref:pricing.Pricelist?',
      defaultUomId: 'ref:uom.Unit',
      /** 'quotation' leaves the order in draft for a human; 'confirm' commits stock. */
      orderPolicy: 'text',
      active: 'bool',
    },
    indexes: { site: { fields: ['companyId', 'siteId'], unique: true } },
  },
  CatalogItem: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      productId: 'ref:product.Product',
      active: 'bool',
      position: 'int',
    },
    indexes: {
      site_product: { fields: ['companyId', 'siteId', 'productId'], unique: true },
      site_position: { fields: ['companyId', 'siteId', 'active', 'position'] },
    },
  },
  Cart: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      tokenDigest: 'text',
      /** 'open' | 'submitted' (lead) | 'ordered' (sales order) | 'merged' (claimed into another cart). */
      status: 'text',
      currency: 'text',
      /** Null until the shopper signs in and claims the cart they already had. */
      accountId: 'ref:website.CustomerAccount?',
      customerName: 'text?',
      customerEmail: 'text?',
      customerPhone: 'text?',
      note: 'text?',
      orderId: 'ref:sale.Order?',
      orderName: 'text?',
      submittedAt: 'datetime?',
      expiresAt: 'datetime',
    },
    indexes: {
      token: { fields: ['companyId', 'tokenDigest'], unique: true },
      site_status: { fields: ['companyId', 'siteId', 'status', 'updatedAt'] },
      account_status: { fields: ['companyId', 'accountId', 'status', 'updatedAt'] },
    },
  },
  CartLine: {
    scope: 'company',
    fields: {
      id: 'id',
      cartId: 'ref:website_retail.Cart',
      productId: 'ref:product.Product',
      name: 'text',
      quantity: 'decimal',
      unitPrice: 'decimal',
    },
    indexes: { cart_product: { fields: ['companyId', 'cartId', 'productId'], unique: true } },
  },
}
