import { defineFn, defineModule, desc, eq, from, gte } from 'ketjs'

export default defineModule({
  name: 'catalog',
  version: '1.0.0',

  models: {
    // Master data: one catalogue across every company in the tenant.
    Product: {
      scope: 'shared',
      fields: { id: 'id', title: 'text', priceCents: 'int', slug: 'text', active: 'bool' },
    },
  },

  // Extension points this module publishes on purpose. Nothing else may be patched.
  joints: {
    'product.detail.footer': { props: { product: 'catalog.product' } },
    'product.card.badge': { props: { product: 'catalog.product' } },
  },

  // The only shape a theme is allowed to see.
  views: {
    product: { of: 'catalog.Product', fields: ['id', 'title', 'priceCents', 'slug'] },
  },

  requires: ['layout', 'product.detail'],

  functions: {
    getProduct: defineFn({
      input: { id: 'id' },
      output: { id: 'id', title: 'text', priceCents: 'int' },
      effects: ['read:catalog.Product'],
      agent: true,
      handler: async (ctx, args) => (await ctx.db.select('catalog.Product', { id: args.id }))[0] ?? null,
    }),
    listProducts: defineFn({
      input: { minPriceCents: 'int?', limit: 'int?' },
      effects: ['read:catalog.Product'],
      agent: true,
      handler: async (ctx, args) => {
        const P = ctx.table('catalog.Product')
        let q = from(P).where(eq(P.active!, true))
        if (args.minPriceCents != null) q = q.where(gte(P.priceCents!, args.minPriceCents))
        return ctx.db.all(q.orderBy(desc(P.priceCents!)).limit(Number(args.limit ?? 20)))
      },
    }),
    createProduct: defineFn({
      input: { id: 'id', title: 'text', priceCents: 'int', slug: 'text' },
      effects: ['write:catalog.Product'],
      idempotent: true,
      agent: true,
      handler: async (ctx, args) => {
        // Casting is an explicit allow-list: anything else in args never reaches the row.
        const cs = ctx.change('catalog.Product', args)
          .cast(['id', 'title', 'priceCents', 'slug'])
          .required(['id', 'title'])
          .validate('priceCents', v => (v as number) > 0 || 'phải lớn hơn 0')
          .put('active', true)
        await ctx.db.commit(cs)
        return { id: args.id }
      },
    }),
  },

  tokens: {
    'color-ink': 'oklch(0.22 0.02 60)',
    'color-accent': 'oklch(0.55 0.18 275)',
    'font-sans': '"Inter", system-ui, sans-serif',
    'space-1': '0.5rem',
    'radius': '0.5rem',
  },
})
