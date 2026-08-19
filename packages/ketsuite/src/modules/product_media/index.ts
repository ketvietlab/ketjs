import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'product_media',
  version: '0.1.0',
  depends: ['product', 'storage'],
  app: true,
  title: 'Hình ảnh sản phẩm',
  summary: 'Ảnh chính và thư viện ảnh của mẫu sản phẩm và biến thể.',
  category: 'Bán hàng',
  models,
  relations,
  functions,
})
