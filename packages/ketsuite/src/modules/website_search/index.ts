import { defineModule } from 'ketjs'
import { islands } from './islands.ts'

export default defineModule({
  name: 'website_search',
  version: '0.1.0',
  depends: ['website'],
  islands,
})
