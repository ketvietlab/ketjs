// Assembly only — each concern lives in its own file.

import { defineModule } from '@ketvietlab/ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'

export default defineModule({
  name: 'product',
  version: '0.2.0',
  depends: ['uom'],
  title: 'Sản phẩm',
  summary: 'Danh mục, mẫu sản phẩm và biến thể.',
  category: 'Bán hàng',
  models,
  relations,
  views,
  functions,
  messages,
})

export { PRODUCT_TYPES } from './types.ts'
export type { ProductType } from './types.ts'
export { productListSearch, emptyProductListState } from './search.ts'
