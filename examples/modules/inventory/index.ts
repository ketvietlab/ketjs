import { defineModule } from '../../../src/kernel/define.ts'
import { defineFn } from '../../../src/server/fn.ts'

// The lego pillar in one file: this module adds a typed field to a model it does
// not own, and fills an extension point the owner published — without importing,
// forking or patching anything inside catalog.
export default defineModule({
  name: 'inventory',
  version: '1.0.0',
  depends: ['catalog'],

  extend: {
    'catalog.Product': { leadTimeDays: 'int?', warehouse: 'text?' },
  },

  fills: {
    'catalog:product.detail.footer': `{% if product.leadTimeDays %}<p class="lead">Giao sau {{ product.leadTimeDays }} ngày</p>{% endif %}`,
  },

  views: {
    stock: { of: 'catalog.Product', fields: ['id', 'leadTimeDays', 'warehouse'] },
  },

  functions: {
    setLeadTime: defineFn({
      input: { productId: 'id', days: 'int' },
      effects: ['write:catalog.Product'],
      idempotent: true,
      agent: true,
      handler: (ctx, args) => {
        ctx.db.update('catalog.Product', { id: args.productId }, { leadTimeDays: args.days })
        return { ok: true }
      },
    }),
  },
})
