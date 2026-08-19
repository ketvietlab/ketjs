import { defineFn, defineModule } from 'ketjs'

export default defineModule({
  name: 'checkout',
  version: '1.0.0',
  depends: ['catalog'],

  models: {
    Order: { fields: { id: 'id', productId: 'ref:catalog.Product', qty: 'int', totalCents: 'int', placedAt: 'datetime' } },
  },

  views: {
    order: { of: 'checkout.Order', fields: ['id', 'qty', 'totalCents'] },
  },

  functions: {
    placeOrder: defineFn({
      input: { id: 'id', productId: 'id', qty: 'int' },
      effects: ['read:catalog.Product', 'write:checkout.Order'],
      idempotent: true,
      agent: true,
      handler: async (ctx, args) => {
        const product = (await ctx.db.select('catalog.Product', { id: args.productId }))[0]
        if (!product) throw new Error(`unknown product ${String(args.productId)}`)
        const total = Number(product.priceCents) * Number(args.qty)
        await ctx.db.insert('checkout.Order', {
          id: args.id, productId: args.productId, qty: args.qty,
          totalCents: total, placedAt: '2026-08-19T00:00:00.000Z',
        })
        return { id: args.id, totalCents: total }
      },
    }),
  },
})
