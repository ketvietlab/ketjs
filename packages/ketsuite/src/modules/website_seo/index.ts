import { defineModule } from 'ketjs'
import { extend } from './extend.ts'
import { fills } from './fills.ts'
import { views } from './views.ts'

export default defineModule({
  name: 'website_seo',
  version: '0.1.0',
  depends: ['website'],
  extend, fills, views,
})
