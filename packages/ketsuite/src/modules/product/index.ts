// Assembly only — each concern lives in its own file.

import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { fills } from './fills.ts'

export default defineModule({
  name: 'product',
  version: '0.1.0',
  depends: ['uom', 'backend'],
  app: true,
  title: 'Sản phẩm',
  summary: 'Danh mục, mẫu sản phẩm và biến thể.',
  category: 'Bán hàng',
  models, relations, views, functions, messages, fills,
})

export { PRODUCT_TYPES } from './types.ts'
export type { ProductType } from './types.ts'
