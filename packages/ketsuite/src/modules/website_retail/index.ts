import { defineModule } from 'ketjs'
import { contentTypes } from './content-types.ts'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { sections } from './sections.ts'

export default defineModule({
  name: 'website_retail',
  version: '0.1.0',
  app: true,
  depends: ['website', 'product'],
  title: 'Website Retail',
  summary: 'Catalog, giỏ hàng và checkout lead cho website bán lẻ.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Website Retail',
      'app.summary': 'Catalog, giỏ hàng và checkout lead cho website bán lẻ.',
      'app.category': 'Website',
      'content.product': 'Sản phẩm website',
      'content.products': 'Sản phẩm website',
      'section.products': 'Lưới sản phẩm',
      'section.cart': 'Giỏ hàng',
    },
    en: {
      'app.title': 'Retail website',
      'app.summary': 'Catalogue, cart and checkout leads for retail sites.',
      'app.category': 'Website',
      'content.product': 'Website product',
      'content.products': 'Website products',
      'section.products': 'Product grid',
      'section.cart': 'Cart',
    },
  },
  models,
  functions,
  contentTypes,
  sections,
})
