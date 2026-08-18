import { defineModule } from '../../../src/kernel/define.ts'
import { defineFn } from '../../../src/server/fn.ts'
import type { Row } from '../../../src/types.ts'

export default defineModule({
  name: 'catalog',
  version: '1.0.0',

  models: {
    Product: {
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
      handler: (ctx, args) => ctx.db.select('catalog.Product', { id: args.id })[0] ?? null,
    }),
    listProducts: defineFn({
      input: {},
      effects: ['read:catalog.Product'],
      agent: true,
      handler: (ctx) => ctx.db.select('catalog.Product'),
    }),
    createProduct: defineFn({
      input: { id: 'id', title: 'text', priceCents: 'int', slug: 'text' },
      effects: ['write:catalog.Product'],
      idempotent: true,
      agent: true,
      handler: (ctx, args) => {
        const row: Row = { id: args.id, title: args.title, priceCents: args.priceCents, slug: args.slug, active: true }
        ctx.db.insert('catalog.Product', row)
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
