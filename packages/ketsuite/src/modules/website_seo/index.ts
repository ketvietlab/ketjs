import { defineModule } from '@ketvietlab/ketjs'
import { extend } from './extend.ts'
import { fills } from './fills.ts'
import { views } from './views.ts'

export default defineModule({
  name: 'website_seo',
  group: 'system',
  version: '0.1.0',
  app: true,
  title: 'SEO',
  summary: 'Thẻ mô tả, canonical và noindex cho từng trang.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'SEO',
      'app.summary': 'Thẻ mô tả, canonical và noindex cho từng trang.',
      'app.category': 'Website',
    },
    en: {
      'app.title': 'SEO',
      'app.summary': 'Description, canonical and noindex tags per page.',
      'app.category': 'Website',
    },
  },
  autoInstall: true,
  depends: ['website'],
  extend,
  fills,
  views,
})
