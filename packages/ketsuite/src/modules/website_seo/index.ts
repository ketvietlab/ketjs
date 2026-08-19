import { defineModule } from 'ketjs'
import { extend } from './extend.ts'
import { fills } from './fills.ts'
import { views } from './views.ts'

export default defineModule({
  name: 'website_seo',
  version: '0.1.0',
  app: true,
  title: 'SEO',
  summary: 'Thẻ mô tả, canonical và noindex cho từng trang.',
  category: 'Website',
  autoInstall: true,
  depends: ['website'],
  extend, fills, views,
})
