import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
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
      status: 'text',
      currency: 'text',
      customerName: 'text?',
      customerEmail: 'text?',
      customerPhone: 'text?',
      note: 'text?',
      submittedAt: 'datetime?',
      expiresAt: 'datetime',
    },
    indexes: {
      token: { fields: ['companyId', 'tokenDigest'], unique: true },
      site_status: { fields: ['companyId', 'siteId', 'status', 'updatedAt'] },
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
