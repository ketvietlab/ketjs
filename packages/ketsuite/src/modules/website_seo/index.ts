import { defineModule } from '@ketvietlab/ketjs'
import { extend } from './extend.ts'
import { fills } from './fills.ts'
import { functions } from './functions.ts'
import { routes } from './routes.ts'
import { views } from './views.ts'

export default defineModule({
  name: 'website_seo',
  version: '0.1.0',
  title: 'SEO',
  summary: 'Thẻ mô tả, canonical, sitemap và robots cho từng website.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'SEO',
      'app.summary': 'Thẻ mô tả, canonical, sitemap và robots cho từng website.',
      'app.category': 'Website',
      'error.entryNotFound': 'Không tìm thấy nội dung.',
      'error.descriptionTooLong': 'Mô tả vượt quá 320 ký tự.',
      'error.foreignCanonical': 'Canonical phải trỏ về chính website này.',
      'error.invalidOgImage': 'Ảnh chia sẻ phải là đường dẫn nội bộ hoặc URL http(s).',
    },
    en: {
      'app.title': 'SEO',
      'app.summary': 'Description, canonical, sitemap and robots per site.',
      'app.category': 'Website',
      'error.entryNotFound': 'Content not found.',
      'error.descriptionTooLong': 'The description exceeds 320 characters.',
      'error.foreignCanonical': 'A canonical must point back at this site.',
      'error.invalidOgImage': 'The share image must be an internal path or an http(s) URL.',
    },
  },
  depends: ['website'],
  extend,
  fills,
  functions,
  routes,
  views,
})
